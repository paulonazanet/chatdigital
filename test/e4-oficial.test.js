const assert = require('node:assert');
const { test, before, after } = require('node:test');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E4 (1a e 2a parte): central de envio e API oficial do WhatsApp, contra uma Meta de mentira.
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e4oficial-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.CHATDIGITAL_FLUXO = path.join(diretorioTeste, 'fluxo.json');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify({ nome: 'Loja Exemplo', formas_pagamento: ['Pix'], produtos: [], faq: [] }));
fs.copyFileSync(path.join(__dirname, '..', 'config', 'fluxo.json'), process.env.CHATDIGITAL_FLUXO);

// ---- Meta de mentira ----
const recebidas = []; // o que o ChatDigital mandou para a "Meta"
let meta;
let metaUrl;
function iniciarMeta() {
  return new Promise((resolve) => {
    meta = http.createServer((req, res) => {
      let corpo = Buffer.alloc(0);
      req.on('data', (p) => (corpo = Buffer.concat([corpo, p])));
      req.on('end', () => {
        const url = new URL(req.url, 'http://x');
        const json = (status, dados) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(dados));
        };
        if (req.headers.authorization !== 'Bearer CHAVE-TESTE' && !url.pathname.startsWith('/arquivo')) return json(401, { error: { code: 190, message: 'Invalid OAuth access token' } });
        if (req.method === 'GET' && url.pathname === '/v23.0/111222333') return json(200, { display_phone_number: '+55 81 99999-0000', verified_name: 'Eu no Digital', quality_rating: 'GREEN' });
        if (req.method === 'POST' && url.pathname === '/v23.0/111222333/messages') {
          const dados = JSON.parse(corpo.toString());
          recebidas.push(dados);
          if (dados.to === '5581900000666') return json(400, { error: { code: 131047, message: 'Re-engagement message' } });
          return json(200, { messages: [{ id: `wamid.${recebidas.length}` }] });
        }
        if (req.method === 'POST' && url.pathname === '/v23.0/111222333/media') {
          recebidas.push({ upload: true, tamanho: corpo.length, tipo: req.headers['content-type'] });
          return json(200, { id: 'midia-subida-1' });
        }
        if (req.method === 'GET' && url.pathname === '/v23.0/999888777/message_templates') {
          return json(200, {
            data: [
              { name: 'lembrete_gas', language: 'pt_BR', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Oi {{1}}! Já faz {{2}} dias do seu último pedido.' }] },
              { name: 'promo', language: 'pt_BR', status: 'PENDING', category: 'MARKETING', components: [{ type: 'BODY', text: 'Promoção!' }] },
            ],
          });
        }
        if (req.method === 'GET' && url.pathname === '/v23.0/midia-do-cliente') return json(200, { url: `${metaUrl}/arquivo/foto.jpg`, mime_type: 'image/jpeg' });
        if (req.method === 'GET' && url.pathname === '/arquivo/foto.jpg') {
          res.writeHead(200, { 'Content-Type': 'image/jpeg' });
          return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
        }
        json(404, { error: { message: 'não existe' } });
      });
    });
    meta.listen(0, '127.0.0.1', () => {
      metaUrl = `http://127.0.0.1:${meta.address().port}`;
      process.env.CHATDIGITAL_META_URL = metaUrl;
      resolve();
    });
  });
}

const { app } = require('../src/server');
const { db } = require('../src/db');
const oficial = require('../src/whatsapp-oficial');
const { definirModo, definirCanalOficial, definirSocket, obterSocket, modoAtual } = require('../src/socket-atual');
const { tratarWebhook } = require('../src/routes/webhook-whatsapp');
const { obterOuCriarConversa, listarMensagens, renomearContato } = require('../src/conversas');
const envios = require('../src/envios');
const campanhas = require('../src/campanhas');
const { salvarConfiguracoes } = require('../src/negocio');

let servidor;
let baseUrl;
let cookie;
function post(caminho, campos = {}) {
  const corpo = new URLSearchParams();
  for (const [chave, valor] of Object.entries(campos)) [].concat(valor).forEach((v) => corpo.append(chave, v));
  return fetch(`${baseUrl}${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, body: corpo, redirect: 'manual' });
}
const pagina = async (caminho) => (await fetch(`${baseUrl}${caminho}`, { headers: { cookie } })).text();
const webhookTexto = (de, texto, id = `wamid.cli${Math.random()}`) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { metadata: { phone_number_id: '111222333' }, contacts: [{ wa_id: de, profile: { name: 'Cliente Meta' } }], messages: [{ from: de, id, timestamp: '1', type: 'text', text: { body: texto } }] } }] }],
});
function assinar(corpo, segredo = 'SEGREDO-APP') {
  return `sha256=${crypto.createHmac('sha256', segredo).update(corpo).digest('hex')}`;
}
function segundaAs10() {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  while (d.getDay() !== 1 || d <= new Date()) d.setDate(d.getDate() + 1);
  return d;
}

before(async () => {
  await iniciarMeta();
  await new Promise((resolve) => {
    servidor = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${servidor.address().port}`;
      resolve();
    });
  });
  const resp = await fetch(`${baseUrl}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nome: 'Carla', email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  cookie = resp.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  definirModo('celular');
  definirCanalOficial(null);
  await new Promise((resolve) => servidor.close(resolve));
  await new Promise((resolve) => meta.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('central de envio: celular por padrão; com a oficial em uso, tudo sai pela Meta', () => {
  const celular = { sendMessage: async () => ({ key: { id: 'baileys' } }) };
  definirSocket(celular);
  assert.strictEqual(modoAtual(), 'celular');
  assert.strictEqual(obterSocket(), celular);
  const adaptador = oficial.criarAdaptador();
  definirCanalOficial(adaptador);
  definirModo('oficial');
  assert.strictEqual(obterSocket(), adaptador);
  definirModo('qualquer-coisa');
  assert.strictEqual(modoAtual(), 'celular', 'modo desconhecido volta pro celular');
  definirModo('oficial');
  definirSocket(null);
});

test('configuração: salva, esconde a chave, confere com a Meta e mostra o webhook', async () => {
  let resp = await post('/painel/configuracoes/whatsapp/oficial', { numero_id: 'abc', conta_id: '', chave: 'x' });
  assert.match(await resp.text(), /só números/);
  resp = await post('/painel/configuracoes/whatsapp/oficial', { numero_id: '111222333', conta_id: '999888777', chave: 'CHAVE-ERRADA', segredo_app: 'SEGREDO-APP', versao: 'v23.0' });
  assert.strictEqual(resp.headers.get('location'), '/painel/configuracoes/whatsapp?aviso=falhou');
  assert.match(oficial.lerConfig().erro, /chave de acesso não vale mais/);
  resp = await post('/painel/configuracoes/whatsapp/oficial', { numero_id: '111222333', conta_id: '999888777', chave: 'CHAVE-TESTE', segredo_app: '', versao: 'v23.0' });
  assert.strictEqual(resp.headers.get('location'), '/painel/configuracoes/whatsapp?aviso=testado');
  assert.strictEqual(oficial.lerConfig().segredo_app, 'SEGREDO-APP', 'segredo em branco mantém o de antes');
  assert.strictEqual(oficial.lerConfig().numero_exibicao, '+55 81 99999-0000');

  await post('/painel/configuracoes/whatsapp/conexao', { whatsapp_conexao: 'oficial' });
  const tela = await pagina('/painel/configuracoes/whatsapp');
  assert.ok(tela.includes('Conectado à Meta: <strong>+55 81 99999-0000</strong>'));
  assert.ok(!tela.includes('CHAVE-TESTE'), 'a chave nunca aparece inteira');
  assert.ok(tela.includes('••••••••ESTE'));
  assert.ok(tela.includes(`${baseUrl}/webhook/whatsapp`.replace('http://', 'http://')));
  assert.ok(tela.includes(oficial.lerConfig().codigo_verificacao));

  // modelos
  resp = await post('/painel/configuracoes/whatsapp/oficial/modelos');
  assert.strictEqual(resp.headers.get('location'), '/painel/configuracoes/whatsapp?aviso=modelos');
  const modelos = oficial.listarModelos();
  assert.deepStrictEqual(modelos.map((m) => [m.nome, m.situacao, m.variaveis]), [['lembrete_gas', 'APPROVED', 2], ['promo', 'PENDING', 0]]);
  assert.deepStrictEqual(oficial.listarModelos({ soAprovados: true }).map((m) => m.nome), ['lembrete_gas']);
});

test('webhook: a Meta confere o endereço e só aceita mensagem assinada', async () => {
  const codigo = oficial.lerConfig().codigo_verificacao;
  let resp = await fetch(`${baseUrl}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${codigo}&hub.challenge=12345`);
  assert.strictEqual(await resp.text(), '12345');
  resp = await fetch(`${baseUrl}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`);
  assert.strictEqual(resp.status, 403);

  const corpo = JSON.stringify(webhookTexto('5581900000001', 'oi'));
  resp = await fetch(`${baseUrl}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinar(corpo, 'outro') }, body: corpo });
  assert.strictEqual(resp.status, 401, 'assinatura errada');
  resp = await fetch(`${baseUrl}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinar(corpo) }, body: corpo });
  assert.strictEqual(resp.status, 200);
});

test('mensagem que chega pela Meta: o bot responde pela Meta; foto é baixada; recibos e falhas', async () => {
  recebidas.length = 0;
  await tratarWebhook(webhookTexto('5581900000002', 'oi', 'wamid.cliente1'));
  const conversa = db.prepare("SELECT * FROM conversas WHERE numero = '5581900000002@s.whatsapp.net'").get();
  assert.strictEqual(conversa.nome_contato, 'Cliente Meta');
  const resposta = recebidas.find((r) => r.to === '5581900000002');
  assert.strictEqual(resposta.type, 'text');
  assert.match(resposta.text.body, /Loja Exemplo/, 'o menu do bot saiu pela API oficial');

  // foto do cliente
  await tratarWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '111222333' }, messages: [{ from: '5581900000002', id: 'wamid.foto', type: 'image', image: { id: 'midia-do-cliente', mime_type: 'image/jpeg', caption: 'olha' } }] } }] }] });
  const foto = listarMensagens(conversa.id).find((m) => m.midia_tipo === 'imagem');
  assert.ok(foto && foto.midia_url, 'a foto foi baixada da Meta e guardada');

  // recibos de um envio e falha de uma mensagem
  const idEnvio = envios.enfileirar({ tipo: 'lembrete', conversaId: conversa.id, texto: 'x' });
  db.prepare("UPDATE envios SET status = 'enviado', wa_id = 'wamid.e1' WHERE id = ?").run(idEnvio);
  db.prepare("INSERT INTO mensagens (conversa_id, remetente, texto, criado_em, wa_id) VALUES (?, 'atendente', 'oi', ?, 'wamid.falhou')").run(conversa.id, new Date().toISOString());
  await tratarWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.e1', status: 'delivered' }, { id: 'wamid.e1', status: 'read' }, { id: 'wamid.falhou', status: 'failed', errors: [{ code: 131047 }] }] } }] }] });
  const envio = db.prepare('SELECT * FROM envios WHERE id = ?').get(idEnvio);
  assert.ok(envio.entregue_em && envio.lido_em);
  assert.strictEqual(db.prepare("SELECT falha FROM mensagens WHERE wa_id = 'wamid.falhou'").get().falha, 1);

  // mensagem para outro número da Meta é ignorada
  const antes = db.prepare('SELECT COUNT(*) AS n FROM conversas').get().n;
  await tratarWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'outro' }, messages: [{ from: '5581900000099', id: 'x', type: 'text', text: { body: 'oi' } }] } }] }] });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM conversas').get().n, antes);
});

test('adaptador: foto sobe para a Meta antes; responder citando; reação', async () => {
  recebidas.length = 0;
  const canal = oficial.criarAdaptador();
  await canal.sendMessage('5581900000002@s.whatsapp.net', { image: Buffer.from([1, 2, 3]), caption: 'nossa loja', mimetype: 'image/jpeg' });
  assert.ok(recebidas[0].upload);
  assert.deepStrictEqual(recebidas[1].image, { id: 'midia-subida-1', caption: 'nossa loja' });
  await canal.sendMessage('5581900000002@s.whatsapp.net', { text: 'sim' }, { quoted: { key: { id: 'wamid.cliente1' } } });
  assert.deepStrictEqual(recebidas[2].context, { message_id: 'wamid.cliente1' });
  await canal.sendMessage('5581900000002@s.whatsapp.net', { react: { text: '👍', key: { id: 'wamid.cliente1' } } });
  assert.deepStrictEqual(recebidas[3].reaction, { message_id: 'wamid.cliente1', emoji: '👍' });
});

test('Fila: dentro das 24 h responde texto; fora, só modelo aprovado', async () => {
  const conversa = db.prepare("SELECT * FROM conversas WHERE numero = '5581900000002@s.whatsapp.net'").get();
  await post(`/painel/fila/${conversa.id}/assumir`);
  recebidas.length = 0;
  let resp = await post(`/painel/fila/${conversa.id}/responder`, { texto: 'Olá, tudo bem?' });
  assert.strictEqual(resp.status, 302);
  assert.strictEqual(recebidas[0].text.body, 'Olá, tudo bem?');

  db.prepare("UPDATE mensagens SET criado_em = ? WHERE conversa_id = ? AND remetente = 'cliente'").run(new Date(Date.now() - 25 * 3600000).toISOString(), conversa.id);
  const tela = await pagina(`/painel/fila/${conversa.id}`);
  assert.ok(tela.includes('Passaram 24 horas'));
  assert.ok(tela.includes('lembrete_gas (pt_BR)'));
  resp = await post(`/painel/fila/${conversa.id}/responder`, { texto: 'oi de novo' });
  assert.match(await resp.text(), /só dá para mandar um modelo aprovado/);

  resp = await post(`/painel/fila/${conversa.id}/modelo`, { modelo: 'lembrete_gas|pt_BR', parametros: ['Maria'] });
  assert.match(await resp.text(), /Preencha as 2 informações/);
  recebidas.length = 0;
  resp = await post(`/painel/fila/${conversa.id}/modelo`, { modelo: 'lembrete_gas|pt_BR', parametros: ['Maria', '30'] });
  assert.strictEqual(resp.status, 302);
  assert.deepStrictEqual(recebidas[0].template, { name: 'lembrete_gas', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Maria' }, { type: 'text', text: '30' }] }] });
  assert.ok(listarMensagens(conversa.id).some((m) => m.remetente === 'atendente' && m.texto === 'Oi Maria! Já faz 30 dias do seu último pedido.'));
  resp = await post(`/painel/fila/${conversa.id}/modelo`, { modelo: 'promo|pt_BR' });
  assert.match(await resp.text(), /Escolha um modelo aprovado/, 'modelo em análise não vai');
});

test('envios pela oficial: com modelo vai o modelo; sem modelo e fora das 24 h fica de fora', async () => {
  const fora = obterOuCriarConversa('5581900000003@s.whatsapp.net');
  renomearContato(fora.id, 'Joana');
  const comModelo = envios.enfileirar({ tipo: 'lembrete', conversaId: fora.id, texto: 'Oi Joana! Já faz 31 dias do seu último pedido.', modelo: { nome: 'lembrete_gas', idioma: 'pt_BR', parametros: ['Joana', '31'] } });
  recebidas.length = 0;
  assert.deepStrictEqual(await envios.processarFila({ agora: segundaAs10(), forcar: true }), { enviado: comModelo });
  assert.strictEqual(recebidas[0].type, 'template');
  const semModelo = envios.enfileirar({ tipo: 'lembrete', conversaId: fora.id, texto: 'texto livre' });
  const r = await envios.processarFila({ agora: segundaAs10(), forcar: true });
  assert.deepStrictEqual(r, { pulado: semModelo, motivo: 'API oficial sem modelo' });
  assert.match(db.prepare('SELECT motivo FROM envios WHERE id = ?').get(semModelo).motivo, /precisa de um modelo aprovado/);

  // campanha com modelo: cada cliente recebe o modelo com o nome dele
  salvarConfiguracoes({ envio_limite_dia: 100 });
  db.prepare("UPDATE conversas SET consentimento = 1 WHERE id = ?").run(fora.id);
  const { campos } = campanhas.validar({ nome: 'Oficial', texto: 'Oi', so_consentiu: '1', excluir_dias: '0', modelo: 'lembrete_gas|pt_BR', modelo_parametros: ['{{cliente.nome}}', '10'] }, {});
  const id = campanhas.criarCampanha(campos);
  assert.ok(campanhas.iniciarCampanha(id).total >= 1);
  const envioJoana = db.prepare("SELECT * FROM envios WHERE tipo = 'campanha' AND conversa_id = ?").get(fora.id);
  assert.deepStrictEqual(JSON.parse(envioJoana.modelo), { nome: 'lembrete_gas', idioma: 'pt_BR', parametros: ['Joana', '10'] });
  assert.strictEqual(envioJoana.texto, 'Oi Joana! Já faz 10 dias do seu último pedido.', 'o histórico guarda o texto do modelo');

  // tela da campanha mostra a escolha do modelo
  assert.ok((await pagina(`/painel/campanhas/campanha/${id}`)).includes('Pela API oficial: modelo aprovado'));
});

test('erro da Meta vira texto em português e o status do sistema mostra a oficial', async () => {
  const canal = oficial.criarAdaptador();
  await assert.rejects(() => canal.sendMessage('5581900000666@s.whatsapp.net', { text: 'oi' }), /Passaram 24 horas/);
  assert.match((await pagina('/painel/configuracoes/status')), /API oficial/);
});

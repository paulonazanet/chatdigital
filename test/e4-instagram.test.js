const assert = require('node:assert');
const { test, before, after } = require('node:test');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E4: Instagram (Direct) na mesma Fila, contra um Instagram de mentira (graph.instagram.com falso).
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e4instagram-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.CHATDIGITAL_FLUXO = path.join(diretorioTeste, 'fluxo.json');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify({ nome: 'Loja Exemplo', formas_pagamento: ['Pix'], produtos: [], faq: [] }));
fs.copyFileSync(path.join(__dirname, '..', 'config', 'fluxo.json'), process.env.CHATDIGITAL_FLUXO);

const CONTA = '17841400000000';
const CLIENTE = '9001002003';

// ---- Instagram de mentira ----
const recebidas = []; // o que o ChatDigital mandou para o "Instagram"
let falso;
let falsoUrl;
let renovacoes = 0;
function iniciarInstagramFalso() {
  return new Promise((resolve) => {
    falso = http.createServer((req, res) => {
      let corpo = Buffer.alloc(0);
      req.on('data', (p) => (corpo = Buffer.concat([corpo, p])));
      req.on('end', () => {
        const url = new URL(req.url, 'http://x');
        const json = (status, dados) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(dados));
        };
        if (req.method === 'GET' && url.pathname === '/arquivo/foto.jpg') {
          res.writeHead(200, { 'Content-Type': 'image/jpeg' });
          return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
        }
        if (!['Bearer CHAVE-TESTE', 'Bearer CHAVE-NOVA'].includes(req.headers.authorization)) return json(400, { error: { code: 190, message: 'Invalid OAuth access token' } });
        if (req.method === 'GET' && url.pathname === '/v26.0/me') return json(200, { user_id: CONTA, username: 'novanetpb', name: 'Novanet' });
        if (req.method === 'GET' && url.pathname === `/v26.0/${CLIENTE}`) return json(200, { name: 'Maria do Insta', username: 'maria.insta' });
        if (req.method === 'GET' && url.pathname === '/refresh_access_token') {
          renovacoes += 1;
          return json(200, { access_token: 'CHAVE-NOVA', token_type: 'bearer', expires_in: 5184000 });
        }
        if (req.method === 'POST' && url.pathname === `/v26.0/${CONTA}/messages`) {
          const dados = JSON.parse(corpo.toString());
          recebidas.push(dados);
          return json(200, { recipient_id: dados.recipient.id, message_id: `mid.${recebidas.length}` });
        }
        json(404, { error: { message: 'não existe' } });
      });
    });
    falso.listen(0, '127.0.0.1', () => {
      falsoUrl = `http://127.0.0.1:${falso.address().port}`;
      process.env.CHATDIGITAL_INSTAGRAM_URL = falsoUrl;
      resolve();
    });
  });
}

const { app } = require('../src/server');
const { db } = require('../src/db');
const instagram = require('../src/instagram');
const canais = require('../src/canais');
const { obterSocket, definirSocket } = require('../src/socket-atual');
const { tratarWebhook } = require('../src/routes/webhook-instagram');
const { listarMensagens } = require('../src/conversas');
const envios = require('../src/envios');
const { formatarTelefone } = require('../src/relatorio');

let servidor;
let baseUrl;
let cookie;
function post(caminho, campos = {}) {
  const corpo = new URLSearchParams();
  for (const [chave, valor] of Object.entries(campos)) [].concat(valor).forEach((v) => corpo.append(chave, v));
  return fetch(`${baseUrl}${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, body: corpo, redirect: 'manual' });
}
const pagina = async (caminho) => (await fetch(`${baseUrl}${caminho}`, { headers: { cookie } })).text();
const evento = (mensagem, de = CLIENTE) => ({ object: 'instagram', entry: [{ id: CONTA, time: 1, messaging: [{ sender: { id: de }, recipient: { id: CONTA }, timestamp: Date.now(), message: mensagem }] }] });
const assinar = (corpo, segredo = 'SEGREDO-IG') => `sha256=${crypto.createHmac('sha256', segredo).update(corpo).digest('hex')}`;
function segundaAs10() {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  while (d.getDay() !== 1 || d <= new Date()) d.setDate(d.getDate() + 1);
  return d;
}
const conversaDoCliente = () => db.prepare('SELECT * FROM conversas WHERE numero = ?').get(`${CLIENTE}@instagram`);

before(async () => {
  await iniciarInstagramFalso();
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
  definirSocket(null);
  await new Promise((resolve) => servidor.close(resolve));
  await new Promise((resolve) => falso.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('sem Instagram configurado nada muda: a central continua só com o WhatsApp', () => {
  assert.strictEqual(instagram.configurado(), false);
  assert.strictEqual(obterSocket(), null, 'sem WhatsApp e sem Instagram não há por onde mandar');
  assert.strictEqual(canais.canalInstagram(), null);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'configuracoes', 'editar.ejs'), 'utf8'), /configuracoes\/instagram/);
});

test('configuração: valida, esconde a chave, confere com o Instagram e cria o canal', async () => {
  let resp = await post('/painel/configuracoes/instagram', { conta_id: 'abc' });
  assert.match(await resp.text(), /só números/);
  resp = await post('/painel/configuracoes/instagram', { conta_id: CONTA, endereco_publico: 'http://sem-https.com' });
  assert.match(await resp.text(), /https:\/\//);
  resp = await post('/painel/configuracoes/instagram', { conta_id: CONTA, chave: 'CHAVE-ERRADA', segredo_app: 'SEGREDO-IG', endereco_publico: 'https://novanet.exemplo.com/' });
  assert.strictEqual(resp.headers.get('location'), '/painel/configuracoes/instagram?aviso=falhou');
  assert.match(instagram.lerConfig().erro, /chave de acesso do Instagram não vale mais/);
  resp = await post('/painel/configuracoes/instagram', { conta_id: CONTA, chave: 'CHAVE-TESTE', segredo_app: '', endereco_publico: 'https://novanet.exemplo.com/' });
  assert.strictEqual(resp.headers.get('location'), '/painel/configuracoes/instagram?aviso=testado');
  const config = instagram.lerConfig();
  assert.strictEqual(config.segredo_app, 'SEGREDO-IG', 'segredo em branco mantém o de antes');
  assert.strictEqual(config.usuario, 'novanetpb');
  assert.strictEqual(config.endereco_publico, 'https://novanet.exemplo.com', 'tira a barra do fim');

  const canal = canais.canalInstagram();
  assert.ok(canal && canal.tipo === 'instagram' && canal.nome === 'Instagram' && canal.ativo === 1);
  assert.deepStrictEqual(canais.listarCanais({ tipo: 'celular' }).map((c) => c.id), [1], 'o Instagram não aparece entre os números de WhatsApp');
  assert.ok(canais.temVariosNumeros(), 'com o Instagram ligado a Fila mostra de onde veio cada conversa');

  const tela = await pagina('/painel/configuracoes/instagram');
  assert.ok(tela.includes('Conectado ao Instagram: <strong>@novanetpb</strong>'));
  assert.ok(!tela.includes('CHAVE-TESTE'), 'a chave nunca aparece inteira');
  assert.ok(tela.includes('••••••••ESTE'));
  assert.ok(tela.includes(`${baseUrl}/webhook/instagram`));
  assert.ok(tela.includes(config.codigo_verificacao));
  assert.ok(!(await pagina('/painel/configuracoes/whatsapp')).includes('action="/painel/configuracoes/whatsapp/numeros/2"'), 'a tela do WhatsApp não lista o Instagram');
  assert.ok((await pagina('/painel/configuracoes')).includes('@novanetpb'), 'o cartão de Configurações mostra a conta');
});

test('webhook: a Meta confere o endereço e só aceita mensagem assinada', async () => {
  const codigo = instagram.lerConfig().codigo_verificacao;
  let resp = await fetch(`${baseUrl}/webhook/instagram?hub.mode=subscribe&hub.verify_token=${codigo}&hub.challenge=777`);
  assert.strictEqual(await resp.text(), '777');
  resp = await fetch(`${baseUrl}/webhook/instagram?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`);
  assert.strictEqual(resp.status, 403);
  const corpo = JSON.stringify(evento({ mid: 'mid.assinado', text: 'oi' }, '9001000000'));
  resp = await fetch(`${baseUrl}/webhook/instagram`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinar(corpo, 'outro') }, body: corpo });
  assert.strictEqual(resp.status, 401, 'assinatura errada');
  resp = await fetch(`${baseUrl}/webhook/instagram`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinar(corpo) }, body: corpo });
  assert.strictEqual(resp.status, 200);
});

test('mensagem do Direct: entra na Fila com o nome e o @ do perfil, e o bot responde pelo Instagram', async () => {
  recebidas.length = 0;
  await tratarWebhook(evento({ mid: 'mid.cliente1', text: 'oi' }));
  const conversa = conversaDoCliente();
  assert.ok(conversa, 'a conversa usa "<IGSID>@instagram"');
  assert.strictEqual(conversa.nome_contato, 'Maria do Insta');
  assert.strictEqual(conversa.numero_exibicao, '@maria.insta');
  assert.strictEqual(conversa.canal_id, canais.canalInstagram().id);
  assert.strictEqual(formatarTelefone(conversa.numero_exibicao), '@maria.insta');
  assert.strictEqual(formatarTelefone(conversa.numero), 'Instagram');
  const resposta = recebidas.find((r) => r.recipient?.id === CLIENTE && r.message?.text);
  assert.ok(resposta, 'o bot respondeu pelo Instagram');
  assert.match(resposta.message.text, /Loja Exemplo/);

  // o eco (o que a própria conta mandou) e o que vem de outra conta são ignorados
  const antes = listarMensagens(conversa.id).length;
  await tratarWebhook(evento({ mid: 'mid.eco', text: 'eco', is_echo: true }));
  await tratarWebhook({ object: 'instagram', entry: [{ id: '999', messaging: [{ sender: { id: CLIENTE }, recipient: { id: '999' }, timestamp: 1, message: { mid: 'mid.outra', text: 'x' } }] }] });
  assert.strictEqual(listarMensagens(conversa.id).length, antes);

  // foto do cliente é baixada; citação vira a mensagem citada
  await tratarWebhook(evento({ mid: 'mid.foto', attachments: [{ type: 'image', payload: { url: `${falsoUrl}/arquivo/foto.jpg` } }] }));
  const foto = listarMensagens(conversa.id).find((m) => m.midia_tipo === 'imagem');
  assert.ok(foto && foto.midia_url, 'a foto foi baixada e guardada');
  await tratarWebhook(evento({ mid: 'mid.citou', text: 'sobre isso', reply_to: { mid: 'mid.cliente1' } }));
  const citou = listarMensagens(conversa.id).find((m) => m.texto === 'sobre isso');
  const original = listarMensagens(conversa.id).find((m) => m.texto === 'oi');
  assert.strictEqual(citou.citada_id, original.id);
});

test('envio pelo Instagram: texto, citação, foto por endereço público com legenda depois, reação; áudio não vai', async () => {
  definirSocket({ tipo: 'celular', sendMessage: async () => ({ key: { id: 'baileys' } }) });
  const central = obterSocket();
  recebidas.length = 0;
  const numero = `${CLIENTE}@instagram`;
  assert.deepStrictEqual(await central.sendMessage('5581999990000@s.whatsapp.net', { text: 'oi' }), { key: { id: 'baileys' } }, 'WhatsApp continua pelo WhatsApp');
  const r1 = await central.sendMessage(numero, { text: 'Olá!' }, { quoted: { key: { id: 'mid.cliente1' } } });
  assert.strictEqual(r1.key.id, 'mid.1');
  assert.deepStrictEqual(recebidas[0], { recipient: { id: CLIENTE }, message: { text: 'Olá!' }, reply_to: { mid: 'mid.cliente1' } });

  await central.sendMessage(numero, { image: Buffer.from('x'), caption: 'o boleto', urlLocal: '/uploads/abc.jpg' });
  assert.deepStrictEqual(recebidas[1].message, { attachment: { type: 'image', payload: { url: 'https://novanet.exemplo.com/uploads/abc.jpg' } } });
  assert.deepStrictEqual(recebidas[2].message, { text: 'o boleto' }, 'a legenda vai logo depois');

  await central.sendMessage(numero, { react: { key: { id: 'mid.cliente1' }, text: '👍' } });
  assert.deepStrictEqual(recebidas[3], { recipient: { id: CLIENTE }, sender_action: 'react', payload: { message_id: 'mid.cliente1', reaction: '👍' } });
  await central.sendMessage(numero, { react: { key: { id: 'mid.cliente1' }, text: '' } });
  assert.strictEqual(recebidas[4].sender_action, 'unreact');

  await assert.rejects(() => central.sendMessage(numero, { audio: Buffer.from('x'), mimetype: 'audio/ogg' }), /Áudio gravado não vai pelo Instagram/);
  const longo = await central.sendMessage(numero, { text: 'é'.repeat(800) });
  assert.ok(longo.key.id);
  assert.ok(Buffer.from(recebidas.at(-1).message.text).length <= 1000, 'o texto é cortado no limite de 1000 bytes do Instagram');

  definirSocket(null);
  const soInstagram = obterSocket();
  assert.ok(soInstagram, 'sem WhatsApp, o Instagram continua mandando');
  await assert.rejects(async () => soInstagram.sendMessage('5581@s.whatsapp.net', { text: 'x' }), /Nenhum número de WhatsApp/);
});

test('Fila: etiqueta do Instagram e, depois de 24 h sem o cliente escrever, não deixa responder', async () => {
  const conversa = conversaDoCliente();
  db.prepare("UPDATE conversas SET status = 'atendendo', atendente_id = 1 WHERE id = ?").run(conversa.id);
  let tela = await pagina(`/painel/fila/${conversa.id}`);
  assert.ok(tela.includes('@maria.insta'));
  assert.ok(tela.includes('selo-numero') && tela.includes('>Instagram<'), 'a conversa mostra a etiqueta do Instagram');
  assert.ok(!tela.includes('Pelo Instagram não dá mais para responder'));

  const velha = new Date(Date.now() - 25 * 3600000).toISOString();
  db.prepare("UPDATE mensagens SET criado_em = ? WHERE conversa_id = ? AND remetente = 'cliente'").run(velha, conversa.id);
  tela = await pagina(`/painel/fila/${conversa.id}`);
  assert.ok(tela.includes('Pelo Instagram não dá mais para responder'));
  const resp = await post(`/painel/fila/${conversa.id}/responder`, { texto: 'oi?' });
  assert.match(await resp.text(), /pelo Instagram não dá mais para responder/);

  // lembrete ou campanha para contato do Instagram fora das 24 h: pulado, nunca mandado
  recebidas.length = 0;
  const agora = segundaAs10();
  const id = envios.enfileirar({ tipo: 'lembrete', conversaId: conversa.id, texto: 'Promoção!', agendadoPara: new Date(agora.getTime() - 60000) });
  db.prepare("UPDATE conversas SET status = 'finalizado', atendente_id = NULL WHERE id = ?").run(conversa.id);
  const resultado = await envios.processarFila({ agora, forcar: true });
  assert.deepStrictEqual(resultado, { pulado: id, motivo: 'Instagram fora das 24 h' });
  assert.match(db.prepare('SELECT motivo FROM envios WHERE id = ?').get(id).motivo, /Instagram/);
  assert.strictEqual(recebidas.length, 0);
});

test('a chave de 60 dias é renovada sozinha depois de 30 dias', async () => {
  assert.deepStrictEqual(await instagram.renovarChaveSePrecisar(), { renovou: false }, 'chave nova não precisa renovar');
  db.prepare('UPDATE instagram_config SET chave_renovada_em = ? WHERE id = 1').run(new Date(Date.now() - 31 * 86400000).toISOString());
  assert.deepStrictEqual(await instagram.renovarChaveSePrecisar(), { renovou: true });
  assert.strictEqual(renovacoes, 1);
  assert.strictEqual(instagram.lerConfig().chave, 'CHAVE-NOVA');
});

test('desligado em Configurações: as mensagens do Instagram não entram; canal com fluxo próprio', async () => {
  let resp = await post('/painel/configuracoes/instagram/canal', { nome: 'Insta Novanet', fluxo_id: '1' });
  assert.strictEqual(resp.headers.get('location'), '/painel/configuracoes/instagram?aviso=salvo');
  assert.strictEqual(canais.canalInstagram().nome, 'Insta Novanet');
  resp = await post('/painel/configuracoes/instagram/ativo');
  assert.strictEqual(canais.canalInstagram().ativo, 0, 'o Instagram desliga mesmo sendo o único além do Principal');
  await tratarWebhook(evento({ mid: 'mid.desligado', text: 'tem alguém?' }, '9001009999'));
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM conversas WHERE numero = '9001009999@instagram'").get().n, 0);
  await post('/painel/configuracoes/instagram/ativo');
  assert.strictEqual(canais.canalInstagram().ativo, 1);
});

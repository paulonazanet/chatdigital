const assert = require('node:assert');
const { test, before, after } = require('node:test');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E4, 4a parte: as opções do bot viram botões/lista na API oficial e respostas rápidas no Instagram.
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e4botoes-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.CHATDIGITAL_FLUXO = path.join(diretorioTeste, 'fluxo.json');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';
fs.writeFileSync(
  process.env.CHATDIGITAL_NEGOCIO,
  JSON.stringify({ nome: 'Loja Exemplo', formas_pagamento: ['Pix'], produtos: [{ id: 'p13', nome: 'Botijão P13', preco: '110' }, { id: 'p45', nome: 'Botijão P45', preco: '420' }], faq: [] }),
);
fs.copyFileSync(path.join(__dirname, '..', 'config', 'fluxo.json'), process.env.CHATDIGITAL_FLUXO);

// ---- Meta e Instagram de mentira (o mesmo servidor) ----
const recebidas = [];
let falso;
function iniciarFalso() {
  return new Promise((resolve) => {
    falso = http.createServer((req, res) => {
      let corpo = Buffer.alloc(0);
      req.on('data', (p) => (corpo = Buffer.concat([corpo, p])));
      req.on('end', () => {
        const url = new URL(req.url, 'http://x');
        const json = (dados) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(dados));
        };
        if (req.method === 'GET' && url.pathname === '/v23.0/111222333') return json({ display_phone_number: '+55 81 99999-0000', verified_name: 'Loja' });
        if (req.method === 'POST' && url.pathname === '/v23.0/111222333/messages') {
          recebidas.push({ canal: 'oficial', ...JSON.parse(corpo.toString()) });
          return json({ messages: [{ id: `wamid.${recebidas.length}` }] });
        }
        if (req.method === 'GET' && url.pathname === '/v26.0/me') return json({ user_id: '17841400000000', username: 'loja' });
        if (req.method === 'GET' && url.pathname === '/v26.0/9001') return json({ name: 'Ana', username: 'ana' });
        if (req.method === 'POST' && url.pathname === '/v26.0/17841400000000/messages') {
          recebidas.push({ canal: 'instagram', ...JSON.parse(corpo.toString()) });
          return json({ recipient_id: '9001', message_id: `mid.${recebidas.length}` });
        }
        res.writeHead(404);
        res.end('{}');
      });
    });
    falso.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${falso.address().port}`;
      process.env.CHATDIGITAL_META_URL = url;
      process.env.CHATDIGITAL_INSTAGRAM_URL = url;
      resolve();
    });
  });
}

const { app } = require('../src/server');
const { db } = require('../src/db');
const oficial = require('../src/whatsapp-oficial');
const instagram = require('../src/instagram');
const canais = require('../src/canais');
const { definirModo, definirCanalOficial, definirSocket, obterSocket } = require('../src/socket-atual');
const { tratarWebhook } = require('../src/routes/webhook-whatsapp');
const webhookInstagram = require('../src/routes/webhook-instagram');
const { tratarMensagemRecebida } = require('../src/bot');
const { carregarNegocio } = require('../src/negocio');
const { carregarFluxo } = require('../src/fluxo');
const { listarMensagens } = require('../src/conversas');
const { extrairOpcoes, paraWhatsapp, paraInstagram } = require('../src/opcoes-interativas');

let servidor;
let baseUrl;
let cookie;
const textoDoWebhook = (de, texto, id) => ({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '111222333' }, messages: [{ from: de, id, type: 'text', text: { body: texto } }] } }] }] });
const conversaDe = (numero) => db.prepare('SELECT * FROM conversas WHERE numero = ?').get(numero);

before(async () => {
  await iniciarFalso();
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
  definirSocket(null);
  await new Promise((resolve) => servidor.close(resolve));
  await new Promise((resolve) => falso.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('lê as opções do texto do bot e monta botões, lista ou respostas rápidas', () => {
  const menu = 'Olá!\n\nO que você precisa?\n1. Fazer pedido\n*2* - Preços\n3) Atendente\n\nResponda só com o número da opção.';
  const lido = extrairOpcoes(menu, ['1', '2', '3']);
  assert.deepStrictEqual(lido, { corpo: 'Olá!\n\nO que você precisa?', opcoes: [{ id: '1', titulo: 'Fazer pedido' }, { id: '2', titulo: 'Preços' }, { id: '3', titulo: 'Atendente' }] });
  assert.strictEqual(paraWhatsapp(lido).type, 'button', 'até 3 opções curtas = botões');
  assert.deepStrictEqual(paraWhatsapp(lido).action.buttons[0], { type: 'reply', reply: { id: '1', title: 'Fazer pedido' } });

  const longo = extrairOpcoes('Escolha:\n1. Dúvidas frequentes (preço, horário, entrega)\n2. Outra', ['1', '2']);
  const lista = paraWhatsapp(longo);
  assert.strictEqual(lista.type, 'list', 'título com mais de 20 letras = lista');
  assert.strictEqual(lista.action.sections[0].rows[0].title.length, 24);
  assert.strictEqual(lista.action.sections[0].rows[0].description, 'Dúvidas frequentes (preço, horário, entrega)');

  assert.strictEqual(extrairOpcoes('Responda *1* para confirmar ou *0* para voltar.', ['1', '0']), null, 'opção no meio da frase = fica o texto');
  assert.deepStrictEqual(extrairOpcoes('Qual?\n1️⃣ Pedido\n0️⃣ Voltar', ['1', '0']).opcoes.map((o) => o.titulo), ['Pedido', 'Voltar']);
  const onze = extrairOpcoes(Array.from({ length: 11 }, (_, i) => `${i + 1}. Item ${i + 1}`).join('\n'), Array.from({ length: 11 }, (_, i) => String(i + 1)));
  assert.strictEqual(paraWhatsapp(onze), null, 'mais de 10 = texto');
  assert.deepStrictEqual(paraInstagram(lido).quick_replies[2], { content_type: 'text', title: 'Atendente', payload: '3' });
});

test('API oficial: o menu vai como lista, o toque volta como o número da opção e o histórico mostra o título', async () => {
  oficial.salvarConfig({ numero_id: '111222333', conta_id: '99988877', chave: 'CHAVE', segredo_app: 'S', versao: 'v23.0' });
  definirCanalOficial(oficial.criarAdaptador());
  definirModo('oficial');
  recebidas.length = 0;
  await tratarWebhook(textoDoWebhook('5581900000001', 'oi', 'wamid.c1'));
  const menu = recebidas.find((r) => r.to === '5581900000001');
  assert.strictEqual(menu.type, 'interactive');
  assert.strictEqual(menu.interactive.type, 'list');
  assert.match(menu.interactive.body.text, /Loja Exemplo/);
  assert.ok(!menu.interactive.body.text.includes('Responda só com o número'), 'a instrução de digitar o número sai');
  assert.deepStrictEqual(menu.interactive.action.sections[0].rows.map((r) => r.id), ['1', '2', '3']);
  const conversa = conversaDe('5581900000001@s.whatsapp.net');
  assert.match(listarMensagens(conversa.id).at(-1).texto, /1\. Fazer um pedido/, 'o histórico guarda o texto numerado');

  // cliente toca em "Fazer um pedido": a lista de produtos (opções dinâmicas) também vira botões
  recebidas.length = 0;
  await tratarWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '111222333' }, messages: [{ from: '5581900000001', id: 'wamid.c2', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: '1', title: 'Fazer um pedido' } } }] } }] }] });
  assert.strictEqual(listarMensagens(conversa.id).find((m) => m.remetente === 'cliente' && m.texto === 'Fazer um pedido').texto, 'Fazer um pedido');
  const produtos = recebidas.find((r) => r.to === '5581900000001');
  assert.strictEqual(produtos.type, 'interactive');
  assert.deepStrictEqual(produtos.interactive.action.buttons.map((b) => [b.reply.id, b.reply.title]), [['1', 'Botijão P13 - R$ 110'], ['2', 'Botijão P45 - R$ 420'], ['0', 'Voltar ao menu']]);

  // pergunta de texto livre (endereço) vai como texto
  recebidas.length = 0;
  await tratarWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '111222333' }, messages: [{ from: '5581900000001', id: 'wamid.c3', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: '1', title: 'Botijão P13 - R$ 110' } } }] } }] }] });
  assert.strictEqual(recebidas.find((r) => r.to === '5581900000001').type, 'text');
});

test('desligado em Configurações > WhatsApp: volta o texto numerado', async () => {
  let tela = await (await fetch(`${baseUrl}/painel/configuracoes/whatsapp`, { headers: { cookie } })).text();
  assert.ok(tela.includes('name="botoes_interativos" value="1" checked'));
  const resp = await fetch(`${baseUrl}/painel/configuracoes/whatsapp/botoes`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, body: '', redirect: 'manual' });
  assert.strictEqual(resp.headers.get('location'), '/painel/configuracoes/whatsapp?aviso=botoes');
  assert.strictEqual(carregarNegocio().botoes_interativos, false);
  tela = await (await fetch(`${baseUrl}/painel/configuracoes/whatsapp`, { headers: { cookie } })).text();
  assert.ok(!tela.includes('name="botoes_interativos" value="1" checked'));

  recebidas.length = 0;
  await tratarWebhook(textoDoWebhook('5581900000002', 'oi', 'wamid.d1'));
  assert.strictEqual(recebidas.find((r) => r.to === '5581900000002').type, 'text');
  await fetch(`${baseUrl}/painel/configuracoes/whatsapp/botoes`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, body: 'botoes_interativos=1', redirect: 'manual' });
  assert.strictEqual(carregarNegocio().botoes_interativos, true);
});

test('WhatsApp do celular: continua o texto numerado, sem botões', async () => {
  definirModo('celular');
  const mandadas = [];
  definirSocket({ tipo: 'celular', sendMessage: async (numero, conteudo) => (mandadas.push(conteudo), { key: { id: `b${mandadas.length}` } }) });
  await tratarMensagemRecebida(obterSocket(), { key: { remoteJid: '5581900000003@s.whatsapp.net', id: 'x1', fromMe: false }, message: { conversation: 'oi' } }, carregarNegocio(), carregarFluxo());
  assert.ok(mandadas.length >= 1);
  assert.deepStrictEqual(Object.keys(mandadas[0]), ['text'], 'pelo celular só vai { text }');
  definirSocket(null);
});

test('Instagram: as opções viram respostas rápidas e o toque volta como o número da opção', async () => {
  instagram.salvarConfig({ conta_id: '17841400000000', chave: 'CHAVE', segredo_app: 'S' });
  canais.canalInstagram({ criar: true });
  recebidas.length = 0;
  const evento = (message) => ({ object: 'instagram', entry: [{ id: '17841400000000', messaging: [{ sender: { id: '9001' }, recipient: { id: '17841400000000' }, timestamp: Date.now(), message }] }] });
  await webhookInstagram.tratarWebhook(evento({ mid: 'mid.i1', text: 'oi' }));
  const menu = recebidas.find((r) => r.canal === 'instagram');
  assert.deepStrictEqual(menu.message.quick_replies.map((q) => q.payload), ['1', '2', '3']);
  assert.ok(menu.message.quick_replies[1].title.length <= 20 && menu.message.quick_replies[1].title.endsWith('…'), 'título cortado no limite do Instagram');

  await webhookInstagram.tratarWebhook(evento({ mid: 'mid.i2', text: 'Falar com um atendente', quick_reply: { payload: '3' } }));
  const conversa = conversaDe('9001@instagram');
  assert.ok(listarMensagens(conversa.id).some((m) => m.remetente === 'cliente' && m.texto === 'Falar com um atendente'));
  assert.strictEqual(conversa.status, 'aguardando', 'a opção 3 levou para o atendente');
});

const assert = require('node:assert');
const { test, before, after } = require('node:test');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E4, 4a parte: celular e API oficial na mesma instalação (modo "misto").
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e4misto-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.CHATDIGITAL_FLUXO = path.join(diretorioTeste, 'fluxo.json');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify({ nome: 'Loja Exemplo', formas_pagamento: ['Pix'], produtos: [], faq: [] }));
fs.copyFileSync(path.join(__dirname, '..', 'config', 'fluxo.json'), process.env.CHATDIGITAL_FLUXO);

const pelaMeta = [];
let meta;
function iniciarMeta() {
  return new Promise((resolve) => {
    meta = http.createServer((req, res) => {
      let corpo = Buffer.alloc(0);
      req.on('data', (p) => (corpo = Buffer.concat([corpo, p])));
      req.on('end', () => {
        if (req.method === 'POST') pelaMeta.push(JSON.parse(corpo.toString() || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages: [{ id: `wamid.${pelaMeta.length}` }], display_phone_number: '+55 81 3000-0000' }));
      });
    });
    meta.listen(0, '127.0.0.1', () => {
      process.env.CHATDIGITAL_META_URL = `http://127.0.0.1:${meta.address().port}`;
      resolve();
    });
  });
}

const { app } = require('../src/server');
const { db } = require('../src/db');
const oficial = require('../src/whatsapp-oficial');
const canais = require('../src/canais');
const socketAtual = require('../src/socket-atual');
const { tratarWebhook } = require('../src/routes/webhook-whatsapp');
const { tratarMensagemRecebida } = require('../src/bot');
const { carregarNegocio, salvarConfiguracoes } = require('../src/negocio');
const { carregarFluxo } = require('../src/fluxo');
const envios = require('../src/envios');
const { montarStatus } = require('../src/status-sistema');

let servidor;
let baseUrl;
let cookie;
const pelaCelular = [];
const pagina = async (caminho) => (await fetch(`${baseUrl}${caminho}`, { headers: { cookie } })).text();
const conversaDe = (numero) => db.prepare('SELECT * FROM conversas WHERE numero = ?').get(numero);
const doCelular = (de, texto, id) => tratarMensagemRecebida(socketAtual.obterSocket(), { key: { remoteJid: `${de}@s.whatsapp.net`, id, fromMe: false }, message: { conversation: texto } }, carregarNegocio(), carregarFluxo(), { canalId: 1 });
const daMeta = (de, texto, id) => tratarWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '111222333' }, messages: [{ from: de, id, type: 'text', text: { body: texto } }] } }] }] });
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
  const resp = await fetch(`${baseUrl}/setup`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ nome: 'Carla', email: 'admin@teste.com', senha: '123456' }), redirect: 'manual' });
  cookie = resp.headers.get('set-cookie').split(';')[0];
  oficial.salvarConfig({ numero_id: '111222333', conta_id: '99988877', chave: 'CHAVE', segredo_app: 'S', versao: 'v23.0' });
  salvarConfiguracoes({ whatsapp_conexao: 'misto' });
  socketAtual.definirModo('misto');
  socketAtual.definirCanalOficial(oficial.criarAdaptador());
  socketAtual.definirSocket({ tipo: 'celular', sendMessage: async (numero, conteudo) => (pelaCelular.push({ numero, conteudo }), { key: { id: `b${pelaCelular.length}` } }) }, 1);
});

after(async () => {
  socketAtual.definirModo('celular');
  socketAtual.definirCanalOficial(null);
  socketAtual.definirSocket(null, 1);
  await new Promise((resolve) => servidor.close(resolve));
  await new Promise((resolve) => meta.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('cada conversa responde pelo número por onde o cliente escreveu: oficial pela Meta, celular pelo celular', async () => {
  await daMeta('5581900000001', 'oi', 'wamid.m1');
  const numeroOficial = canais.canalOficial();
  assert.ok(numeroOficial && numeroOficial.tipo === 'oficial', 'o número oficial virou um canal');
  assert.strictEqual(conversaDe('5581900000001@s.whatsapp.net').canal_id, numeroOficial.id);
  assert.ok(pelaMeta.some((m) => m.to === '5581900000001' && m.type === 'interactive'), 'resposta pela Meta, com botões/lista');
  assert.ok(!pelaCelular.some((m) => m.numero === '5581900000001@s.whatsapp.net'));

  await doCelular('5581900000002', 'oi', 'b-in-1');
  assert.ok(pelaCelular.some((m) => m.numero === '5581900000002@s.whatsapp.net' && Object.keys(m.conteudo).join() === 'text'), 'resposta pelo celular, texto numerado');
  assert.ok(!pelaMeta.some((m) => m.to === '5581900000002'));

  assert.strictEqual(socketAtual.usaOficial('5581900000001@s.whatsapp.net'), true);
  assert.strictEqual(socketAtual.usaOficial('5581900000002@s.whatsapp.net'), false);
  assert.ok(typeof socketAtual.obterSocket().enviarModelo === 'function', 'modelo disponível pelo número oficial');
  assert.ok(canais.temVariosNumeros(), 'a Fila mostra de qual número veio cada conversa');

  // o cliente do número oficial passa a escrever no celular: a conversa muda de número
  pelaCelular.length = 0;
  await doCelular('5581900000001', 'menu', 'b-in-2');
  assert.strictEqual(conversaDe('5581900000001@s.whatsapp.net').canal_id, 1);
  assert.ok(pelaCelular.some((m) => m.numero === '5581900000001@s.whatsapp.net'));
  await daMeta('5581900000001', 'menu', 'wamid.m2'); // e volta para o oficial
});

test('regra das 24 h e modelos só nas conversas do número oficial', async () => {
  const velha = new Date(Date.now() - 25 * 3600000).toISOString();
  for (const numero of ['5581900000001@s.whatsapp.net', '5581900000002@s.whatsapp.net']) {
    const c = conversaDe(numero);
    db.prepare("UPDATE mensagens SET criado_em = ? WHERE conversa_id = ? AND remetente = 'cliente'").run(velha, c.id);
    db.prepare("UPDATE conversas SET status = 'atendendo', atendente_id = 1 WHERE id = ?").run(c.id);
  }
  const oficialConversa = conversaDe('5581900000001@s.whatsapp.net');
  const celularConversa = conversaDe('5581900000002@s.whatsapp.net');
  assert.ok((await pagina(`/painel/fila/${oficialConversa.id}`)).includes('Passaram 24 horas'));
  assert.ok(!(await pagina(`/painel/fila/${celularConversa.id}`)).includes('Passaram 24 horas'));

  // lembrete: o do celular sai em texto; o do oficial, sem modelo, fica de fora
  db.prepare("UPDATE conversas SET status = 'finalizado', atendente_id = NULL").run();
  const agora = segundaAs10();
  pelaCelular.length = 0;
  const idCelular = envios.enfileirar({ tipo: 'lembrete', conversaId: celularConversa.id, texto: 'Oi!', agendadoPara: new Date(agora.getTime() - 120000) });
  const idOficial = envios.enfileirar({ tipo: 'lembrete', conversaId: oficialConversa.id, texto: 'Oi!', agendadoPara: new Date(agora.getTime() - 60000) });
  assert.deepStrictEqual(await envios.processarFila({ agora, forcar: true }), { enviado: idCelular });
  assert.ok(pelaCelular.some((m) => m.numero === '5581900000002@s.whatsapp.net'));
  assert.deepStrictEqual(await envios.processarFila({ agora, forcar: true }), { pulado: idOficial, motivo: 'API oficial sem modelo' });
});

test('telas: a escolha "Os dois", o número oficial com nome e fluxo, e o status com os dois', async () => {
  const tela = await pagina('/painel/configuracoes/whatsapp');
  assert.ok(tela.includes('value="misto" checked'));
  assert.ok(tela.includes('Em uso agora: <strong>os dois (celular e API oficial)</strong>'));
  assert.ok(tela.includes('Número oficial na Fila'));
  assert.ok(tela.includes('<h2>Números</h2>'), 'os números do celular continuam na tela');
  const resp = await fetch(`${baseUrl}/painel/configuracoes/whatsapp/numeros/${canais.canalOficial().id}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, body: new URLSearchParams({ nome: 'Oficial', fluxo_id: '1' }), redirect: 'manual' });
  assert.strictEqual(resp.status, 302);
  assert.strictEqual(canais.canalOficial().nome, 'Oficial');
  assert.ok(montarStatus().itens.some((i) => i.nome === 'WhatsApp: Oficial'));
});

const assert = require('node:assert');
const { test, before, after } = require('node:test');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E4: central do Instagram (um app só na Meta para todas as instalações). Uma instalação de teste,
// a central e um Instagram de mentira, no mesmo processo.
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e4central-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.CHATDIGITAL_FLUXO = path.join(diretorioTeste, 'fluxo.json');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify({ nome: 'Loja Exemplo', formas_pagamento: ['Pix'], produtos: [], faq: [] }));
fs.copyFileSync(path.join(__dirname, '..', 'config', 'fluxo.json'), process.env.CHATDIGITAL_FLUXO);

const CONTA = '17841499999999';
const CLIENTE = '9002003004';
const APP_SECRET = 'SEGREDO-DO-APP';

// ---- Instagram de mentira (login, troca de chave, Graph) ----
const chamadas = [];
let falso;
let falsoUrl;
function iniciarInstagramFalso() {
  return new Promise((resolve) => {
    falso = http.createServer((req, res) => {
      let corpo = Buffer.alloc(0);
      req.on('data', (p) => (corpo = Buffer.concat([corpo, p])));
      req.on('end', () => {
        const url = new URL(req.url, 'http://x');
        chamadas.push(`${req.method} ${url.pathname}${url.search}`);
        const json = (status, dados) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(dados));
        };
        if (req.method === 'POST' && url.pathname === '/oauth/access_token') {
          const form = new URLSearchParams(corpo.toString());
          if (form.get('code') !== 'CODIGO-BOM' || form.get('client_secret') !== APP_SECRET || form.get('client_id') !== 'APP-ID') return json(400, { error_message: 'código inválido' });
          return json(200, { data: [{ access_token: 'CHAVE-CURTA', user_id: CONTA, permissions: 'instagram_business_basic,instagram_business_manage_messages' }] });
        }
        if (req.method === 'GET' && url.pathname === '/access_token') {
          if (url.searchParams.get('access_token') !== 'CHAVE-CURTA' || url.searchParams.get('client_secret') !== APP_SECRET) return json(400, { error: { message: 'troca inválida' } });
          return json(200, { access_token: 'CHAVE-LONGA', token_type: 'bearer', expires_in: 5184000 });
        }
        if (req.headers.authorization !== 'Bearer CHAVE-LONGA') return json(400, { error: { code: 190, message: 'Invalid OAuth access token' } });
        if (req.method === 'GET' && url.pathname === '/v26.0/me') return json(200, { user_id: CONTA, username: 'nazagas_oficial' });
        if (req.method === 'POST' && url.pathname === '/v26.0/me/subscribed_apps') return json(200, { success: true });
        if (req.method === 'GET' && url.pathname === `/v26.0/${CLIENTE}`) return json(200, { name: 'João do Insta', username: 'joao.insta' });
        if (req.method === 'POST' && url.pathname === `/v26.0/${CONTA}/messages`) return json(200, { recipient_id: CLIENTE, message_id: 'mid.resposta' });
        json(404, { error: { message: 'não existe' } });
      });
    });
    falso.listen(0, '127.0.0.1', () => {
      falsoUrl = `http://127.0.0.1:${falso.address().port}`;
      process.env.CHATDIGITAL_INSTAGRAM_URL = falsoUrl;
      process.env.CHATDIGITAL_INSTAGRAM_OAUTH_URL = falsoUrl;
      process.env.CHATDIGITAL_INSTAGRAM_LOGIN_URL = falsoUrl;
      resolve();
    });
  });
}

const { app } = require('../src/server');
const { db } = require('../src/db');
const instagram = require('../src/instagram');
const canais = require('../src/canais');
const { criarCentral } = require('../src/central-instagram');

let servidor;
let baseUrl;
let cookie;
let central;
let servidorCentral;
let centralUrl;
const ir = (url, extra = {}) => fetch(url, { redirect: 'manual', ...extra });
function post(caminho, campos = {}) {
  return fetch(`${baseUrl}${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, body: new URLSearchParams(campos), redirect: 'manual' });
}
const pagina = async (caminho) => (await fetch(`${baseUrl}${caminho}`, { headers: { cookie } })).text();
const assinar = (corpo, segredo) => `sha256=${crypto.createHmac('sha256', segredo).update(corpo).digest('hex')}`;
async function esperar(condicao) {
  for (let i = 0; i < 100 && !condicao(); i++) await new Promise((r) => setTimeout(r, 20));
  return condicao();
}

before(async () => {
  await iniciarInstagramFalso();
  await new Promise((resolve) => {
    servidor = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${servidor.address().port}`;
      resolve();
    });
  });
  // a central precisa saber o próprio endereço (volta do login): abre a porta antes de criar
  servidorCentral = http.createServer((req, res) => central.app(req, res));
  await new Promise((resolve) => servidorCentral.listen(0, '127.0.0.1', resolve));
  centralUrl = `http://127.0.0.1:${servidorCentral.address().port}`;
  central = criarCentral({
    appId: 'APP-ID',
    appSecret: APP_SECRET,
    verifyToken: 'TOKEN-DA-CENTRAL',
    endereco: centralUrl,
    instalacoes: [
      { id: 'nazagas', nome: 'Naza Gás', endereco: baseUrl, segredo: 'SEG-NAZA' },
      { id: 'novanet', nome: 'Novanet', endereco: 'http://127.0.0.1:9', segredo: 'SEG-NOVA' },
    ],
    arquivoDados: path.join(diretorioTeste, 'central.json'),
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
  await new Promise((resolve) => servidor.close(resolve));
  await new Promise((resolve) => servidorCentral.close(resolve));
  await new Promise((resolve) => falso.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

let linkDoLogin;

test('instalação: dados da central e o botão "Entrar com Instagram"', async () => {
  let tela = await pagina('/painel/configuracoes/instagram');
  assert.ok(!tela.includes('>Entrar com Instagram<'), 'sem os dados da central não há botão');
  let resp = await post('/painel/configuracoes/instagram/central', { central_url: 'central.sem.protocolo', central_instalacao: 'nazagas', segredo_app: 'SEG-NAZA' });
  assert.match(await resp.text(), /tem que começar com https/);
  resp = await post('/painel/configuracoes/instagram/central', { central_url: 'https://x', central_instalacao: 'Naza Gás', segredo_app: 'SEG-NAZA' });
  assert.match(await resp.text(), /letras minúsculas/);
  resp = await post('/painel/configuracoes/instagram/central', { central_url: `${centralUrl}/`, central_instalacao: 'nazagas', segredo_app: 'SEG-NAZA' });
  assert.strictEqual(resp.headers.get('location'), '/painel/configuracoes/instagram?aviso=central-salva');
  assert.ok(instagram.usaCentral());
  tela = await pagina('/painel/configuracoes/instagram');
  assert.ok(tela.includes('>Entrar com Instagram<'));
  assert.ok(!tela.includes('SEG-NAZA'), 'o segredo nunca aparece inteiro');

  // o botão manda para a central com um pedido assinado, e a central manda para o login do Instagram
  resp = await ir(`${baseUrl}/painel/configuracoes/instagram/conectar`, { headers: { cookie } });
  const paraCentral = new URL(resp.headers.get('location'));
  assert.strictEqual(`${paraCentral.origin}${paraCentral.pathname}`, `${centralUrl}/instagram/conectar`);
  resp = await ir(paraCentral.toString());
  linkDoLogin = new URL(resp.headers.get('location'));
  assert.strictEqual(`${linkDoLogin.origin}${linkDoLogin.pathname}`, `${falsoUrl}/oauth/authorize`);
  assert.strictEqual(linkDoLogin.searchParams.get('client_id'), 'APP-ID');
  assert.strictEqual(linkDoLogin.searchParams.get('redirect_uri'), `${centralUrl}/instagram/retorno`);
  assert.strictEqual(linkDoLogin.searchParams.get('scope'), 'instagram_business_basic,instagram_business_manage_messages');
  assert.match(linkDoLogin.searchParams.get('state'), /^nazagas\.\d+\.[0-9a-f]{64}$/);

  // pedido adulterado, de outra instalação ou vencido: recusado
  const adulterado = new URL(paraCentral);
  adulterado.searchParams.set('instalacao', 'novanet');
  assert.strictEqual((await ir(adulterado.toString())).status, 403);
  const vencido = new URL(paraCentral);
  vencido.searchParams.set('t', String(Date.now() - 3600000));
  assert.strictEqual((await ir(vencido.toString())).status, 403);
});

test('volta do Instagram: a central troca o código pela chave, inscreve a conta e entrega à instalação', async () => {
  const estado = linkDoLogin.searchParams.get('state');
  // cancelou no Instagram
  let resp = await ir(`${centralUrl}/instagram/retorno?error=access_denied&state=${estado}`);
  assert.strictEqual(resp.headers.get('location'), `${baseUrl}/painel/configuracoes/instagram?aviso=cancelado`);
  // estado falso
  assert.strictEqual((await ir(`${centralUrl}/instagram/retorno?code=CODIGO-BOM&state=nazagas.1.abc`)).status, 403);
  // código ruim
  resp = await ir(`${centralUrl}/instagram/retorno?code=CODIGO-RUIM&state=${estado}`);
  assert.strictEqual(resp.headers.get('location'), `${baseUrl}/painel/configuracoes/instagram?aviso=falhou-central`);
  assert.strictEqual(instagram.configurado(), false);

  chamadas.length = 0;
  resp = await ir(`${centralUrl}/instagram/retorno?code=CODIGO-BOM&state=${estado}`);
  assert.strictEqual(resp.headers.get('location'), `${baseUrl}/painel/configuracoes/instagram?aviso=conectado`);
  assert.ok(chamadas.includes('POST /v26.0/me/subscribed_apps?subscribed_fields=messages,message_reactions'), 'a conta foi inscrita no webhook do app');
  const config = instagram.lerConfig();
  assert.strictEqual(config.conta_id, CONTA);
  assert.strictEqual(config.usuario, 'nazagas_oficial');
  assert.strictEqual(config.chave, 'CHAVE-LONGA', 'a instalação recebeu a chave de 60 dias');
  assert.ok(canais.canalInstagram(), 'o canal do Instagram foi criado');
  assert.deepStrictEqual(Object.keys(central.lerDados().contas), [CONTA]);
  assert.strictEqual(central.lerDados().contas[CONTA].instalacao, 'nazagas');

  const tela = await pagina('/painel/configuracoes/instagram?aviso=conectado');
  assert.ok(tela.includes('Conectado ao Instagram: <strong>@nazagas_oficial</strong>'));
  assert.ok(tela.includes('Desconectar o Instagram'));
  assert.ok(!tela.includes('CHAVE-LONGA'));
});

test('a instalação só aceita conta entregue com o segredo combinado', async () => {
  const corpo = JSON.stringify({ conta_id: '17841400000001', usuario: 'intruso', chave: 'X' });
  let resp = await fetch(`${baseUrl}/webhook/instagram/conta`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinar(corpo, 'outro') }, body: corpo });
  assert.strictEqual(resp.status, 401);
  assert.strictEqual(instagram.lerConfig().usuario, 'nazagas_oficial');
  resp = await fetch(`${baseUrl}/webhook/instagram/conta`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinar('{"conta_id":"abc"}', 'SEG-NAZA') }, body: '{"conta_id":"abc"}' });
  assert.strictEqual(resp.status, 400);
});

test('webhook do app: a central confere a Meta e repassa cada conta para a instalação dela', async () => {
  let resp = await fetch(`${centralUrl}/webhook/instagram?hub.mode=subscribe&hub.verify_token=TOKEN-DA-CENTRAL&hub.challenge=42`);
  assert.strictEqual(await resp.text(), '42');
  resp = await fetch(`${centralUrl}/webhook/instagram?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`);
  assert.strictEqual(resp.status, 403);

  const corpo = JSON.stringify({
    object: 'instagram',
    entry: [
      { id: CONTA, time: 1, messaging: [{ sender: { id: CLIENTE }, recipient: { id: CONTA }, timestamp: Date.now(), message: { mid: 'mid.via-central', text: 'oi' } }] },
      { id: '17841400000002', time: 1, messaging: [{ sender: { id: '1' }, recipient: { id: '17841400000002' }, timestamp: Date.now(), message: { mid: 'mid.de-ninguem', text: 'oi' } }] },
    ],
  });
  resp = await fetch(`${centralUrl}/webhook/instagram`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinar(corpo, 'outro') }, body: corpo });
  assert.strictEqual(resp.status, 401, 'assinatura errada');
  resp = await fetch(`${centralUrl}/webhook/instagram`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinar(corpo, APP_SECRET) }, body: corpo });
  assert.strictEqual(resp.status, 200);

  const chegou = await esperar(() => db.prepare('SELECT numero_exibicao FROM conversas WHERE numero = ?').get(`${CLIENTE}@instagram`)?.numero_exibicao);
  assert.ok(chegou, 'a mensagem chegou na Fila da instalação certa');
  const conversa = db.prepare('SELECT * FROM conversas WHERE numero = ?').get(`${CLIENTE}@instagram`);
  assert.strictEqual(conversa.numero_exibicao, '@joao.insta');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM conversas WHERE numero = '1@instagram'").get().n, 0, 'conta que ninguém conectou não vai para ninguém');
  assert.deepStrictEqual(await central.repassar(JSON.parse(corpo)), { nazagas: 1 });
});

test('desconectar tira a conta e volta o botão', async () => {
  const resp = await post('/painel/configuracoes/instagram/desconectar');
  assert.strictEqual(resp.headers.get('location'), '/painel/configuracoes/instagram?aviso=desconectado');
  assert.strictEqual(instagram.configurado(), false);
  assert.ok(instagram.usaCentral(), 'os dados da central ficam');
  assert.ok((await pagina('/painel/configuracoes/instagram')).includes('>Entrar com Instagram<'));
});

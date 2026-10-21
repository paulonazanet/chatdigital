const assert = require('node:assert');
const { test, before, after } = require('node:test');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E4, 4a parte: Custos da Meta (modelos mandados pela API oficial e a estimativa em reais).
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e4custos-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.CHATDIGITAL_FLUXO = path.join(diretorioTeste, 'fluxo.json');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify({ nome: 'Loja Exemplo', formas_pagamento: ['Pix'], produtos: [], faq: [] }));
fs.copyFileSync(path.join(__dirname, '..', 'config', 'fluxo.json'), process.env.CHATDIGITAL_FLUXO);

let meta;
function iniciarMeta() {
  return new Promise((resolve) => {
    let n = 0;
    meta = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages: [{ id: `wamid.${++n}` }] }));
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
const custos = require('../src/custos-meta');
const { obterOuCriarConversa, registrarMensagem } = require('../src/conversas');

let servidor;
let baseUrl;
let cookie;
const pagina = async (caminho) => (await fetch(`${baseUrl}${caminho}`, { headers: { cookie } })).text();
const post = (caminho, campos) => fetch(`${baseUrl}${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, body: new URLSearchParams(campos), redirect: 'manual' });

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
  const inserir = db.prepare("INSERT INTO modelos_oficiais (nome, idioma, categoria, situacao, corpo, variaveis, atualizado_em) VALUES (?, 'pt_BR', ?, 'APPROVED', ?, 0, ?)");
  inserir.run('promo', 'MARKETING', 'Promoção!', new Date().toISOString());
  inserir.run('lembrete', 'UTILITY', 'Seu gás está acabando?', new Date().toISOString());
});

after(async () => {
  await new Promise((resolve) => servidor.close(resolve));
  await new Promise((resolve) => meta.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('cada modelo mandado fica anotado com o tipo, a origem e se foi grátis (utilidade dentro das 24 h)', async () => {
  const dentro = '5581900000001@s.whatsapp.net';
  const fora = '5581900000002@s.whatsapp.net';
  obterOuCriarConversa(dentro);
  obterOuCriarConversa(fora);
  registrarMensagem(dentro, 'cliente', 'oi'); // escreveu agora: dentro das 24 h
  const adaptador = oficial.criarAdaptador();
  await adaptador.enviarModelo(dentro, { nome: 'lembrete', idioma: 'pt_BR' }, { origem: 'lembrete' });
  await adaptador.enviarModelo(fora, { nome: 'lembrete', idioma: 'pt_BR' }, { origem: 'lembrete' });
  await adaptador.enviarModelo(dentro, { nome: 'promo', idioma: 'pt_BR' }, { origem: 'campanha' });
  await adaptador.enviarModelo(fora, { nome: 'promo', idioma: 'pt_BR' });
  const linhas = db.prepare('SELECT nome, categoria, origem, gratis FROM modelos_enviados ORDER BY id').all().map((l) => ({ ...l }));
  assert.deepStrictEqual(linhas, [
    { nome: 'lembrete', categoria: 'UTILITY', origem: 'lembrete', gratis: 1 },
    { nome: 'lembrete', categoria: 'UTILITY', origem: 'lembrete', gratis: 0 },
    { nome: 'promo', categoria: 'MARKETING', origem: 'campanha', gratis: 0 },
    { nome: 'promo', categoria: 'MARKETING', origem: 'fila', gratis: 0 },
  ]);
});

test('tela: sem preço mostra as quantidades; com preço calcula a estimativa do mês', async () => {
  let tela = await pagina('/painel/configuracoes/whatsapp/custos');
  assert.ok(tela.includes('Custos da Meta'));
  assert.ok(tela.includes('falta o preço'));
  assert.ok(tela.includes('estimativa do mês (falta preço)'));

  let resp = await post('/painel/configuracoes/whatsapp/custos', { marketing: 'caro' });
  assert.match(await resp.text(), /tem que ser um valor em reais/);
  resp = await post('/painel/configuracoes/whatsapp/custos', { marketing: 'R$ 0,35', utilidade: '0,05', autenticacao: '' });
  assert.strictEqual(resp.headers.get('location'), '/painel/configuracoes/whatsapp/custos?aviso=precos');
  assert.deepStrictEqual(custos.lerPrecos(), { marketing: 0.35, utilidade: 0.05, autenticacao: null });

  const resumo = custos.resumoDoMes();
  assert.strictEqual(resumo.total, 4);
  assert.strictEqual(resumo.cobradas, 3, 'o lembrete dentro das 24 h não é cobrado');
  assert.strictEqual(Math.round(resumo.estimativa * 100), 75, '2 × 0,35 + 1 × 0,05');
  assert.deepStrictEqual(resumo.porOrigem.map((o) => [o.origem, o.n]).sort(), [['campanha', 1], ['fila', 1], ['lembrete', 2]]);

  tela = await pagina('/painel/configuracoes/whatsapp/custos');
  assert.ok(tela.includes(custos.formatarReais(0.75)));
  assert.ok(tela.includes('value="0,35"'));
  tela = await pagina(`/painel/configuracoes/whatsapp/custos?mes=${custos.mesAnterior(custos.mesAtual())}`);
  assert.ok(tela.includes('<span class="numero">0</span><span class="rotulo">modelos enviados</span>'), 'o mês passado está vazio');
});

test('estimativa para uma campanha', () => {
  assert.deepStrictEqual(custos.estimarEnvio('MARKETING', 10), { preco: 0.35, total: 3.5, rotulo: 'Marketing' });
  assert.strictEqual(custos.estimarEnvio('AUTHENTICATION', 10), null, 'sem preço, sem estimativa');
});

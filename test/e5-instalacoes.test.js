const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E5, 1a parte: um código só, uma pasta de dados por cliente (CHATDIGITAL_DADOS), código do primeiro
// acesso e a página de verificação (/saude) para o Zabbix.
const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e5-cliente-'));
process.env.CHATDIGITAL_DADOS = dados;
process.env.CHATDIGITAL_CODIGO_SETUP = 'codigo-secreto-de-teste';
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';
delete process.env.CHATDIGITAL_DB;
delete process.env.CHATDIGITAL_NEGOCIO;
delete process.env.CHATDIGITAL_FLUXO;

const { app } = require('../src/server');
const { db, ARQUIVO_DB } = require('../src/db');
const caminhos = require('../src/caminhos');
const { carregarNegocio } = require('../src/negocio');
const { salvarBufferDeMidia, lerArquivoDeMidia } = require('../src/midia');

let servidor;
let baseUrl;
const RAIZ = path.join(__dirname, '..');

before(async () => {
  await new Promise((resolve) => {
    servidor = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${servidor.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => servidor.close(resolve));
  db.close();
  fs.rmSync(dados, { recursive: true, force: true });
});

test('tudo do cliente fica na pasta de dados dele, começando dos modelos', () => {
  assert.strictEqual(ARQUIVO_DB, path.join(dados, 'data', 'chatdigital.db'));
  assert.ok(fs.existsSync(ARQUIVO_DB));
  assert.strictEqual(caminhos.arquivoNegocio(), path.join(dados, 'config', 'negocio.json'));
  assert.strictEqual(caminhos.arquivoFluxo(), path.join(dados, 'config', 'fluxo.json'));
  assert.strictEqual(caminhos.pastaAuth('auth-numero-2'), path.join(dados, 'auth-numero-2'));
  assert.strictEqual(caminhos.pastaUploads(), path.join(dados, 'uploads'));

  // configuração e fluxo vêm de config/modelos (nunca dos arquivos de trabalho do código)
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(caminhos.arquivoNegocio(), 'utf8')), JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'modelos', 'negocio.json'), 'utf8')));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(caminhos.arquivoFluxo(), 'utf8')), JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'modelos', 'fluxo.json'), 'utf8')));
  assert.match(carregarNegocio().nome, /TODO/);

  // não sobrescreve o que o cliente já mudou
  fs.writeFileSync(caminhos.arquivoNegocio(), JSON.stringify({ ...carregarNegocio(), nome: 'Novanet' }));
  caminhos.prepararPastaDeDados();
  assert.strictEqual(carregarNegocio().nome, 'Novanet');
});

test('mídias vão para a pasta do cliente e são servidas em /uploads', async () => {
  const url = salvarBufferDeMidia(Buffer.from('arquivo de teste'), 'application/pdf');
  assert.match(url, /^\/uploads\//);
  assert.ok(fs.existsSync(path.join(dados, 'uploads', path.basename(url))));
  assert.strictEqual(lerArquivoDeMidia(url).buffer.toString(), 'arquivo de teste');
  const resp = await fetch(`${baseUrl}${url}`);
  assert.strictEqual(resp.status, 200);
  assert.strictEqual(await resp.text(), 'arquivo de teste');
});

test('primeiro acesso só com o código da instalação', async () => {
  const semCodigo = await fetch(`${baseUrl}/setup`);
  assert.strictEqual(semCodigo.status, 403);
  assert.ok(!(await semCodigo.text()).includes('<form'), 'sem código não mostra o formulário');
  const naoCria = await fetch(`${baseUrl}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nome: 'Intruso', email: 'x@x.com', senha: '123456', codigo: 'errado' }),
    redirect: 'manual',
  });
  assert.strictEqual(naoCria.status, 403);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM atendentes').get().n, 0);

  const comCodigo = await fetch(`${baseUrl}/setup?codigo=codigo-secreto-de-teste`);
  assert.strictEqual(comCodigo.status, 200);
  assert.match(await comCodigo.text(), /name="codigo" value="codigo-secreto-de-teste"/);
  const cria = await fetch(`${baseUrl}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nome: 'Paulo', email: 'paulo@teste.com', senha: '123456', codigo: 'codigo-secreto-de-teste' }),
    redirect: 'manual',
  });
  assert.strictEqual(cria.status, 302);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM atendentes').get().n, 1);
  // depois do 1o administrador o link não serve mais
  assert.strictEqual((await fetch(`${baseUrl}/setup?codigo=codigo-secreto-de-teste`, { redirect: 'manual' })).headers.get('location'), '/login');
});

test('/saude: sem login, só o nível de cada peça', async () => {
  const resp = await fetch(`${baseUrl}/saude`);
  assert.strictEqual(resp.status, 200);
  const saude = await resp.json();
  assert.deepStrictEqual(Object.keys(saude).sort(), ['backup', 'banco', 'disco', 'versao', 'whatsapp']);
  assert.strictEqual(saude.whatsapp, 'problema', 'sem WhatsApp ligado no teste');
  assert.strictEqual(saude.banco, 'ok');
  require('../src/whatsapp-status').definirConectado(1);
  assert.strictEqual((await (await fetch(`${baseUrl}/saude`)).json()).whatsapp, 'ok');
});

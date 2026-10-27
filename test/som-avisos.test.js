const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Som dos avisos (Configurações > Pausas e alertas): liga/desliga mensagem e alertas, volume, e o
// que chega em cada página do painel (window.CHATDIGITAL_SOM, lido pelo notificacoes.js).
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-som-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify({ nome: 'Loja Exemplo', formas_pagamento: ['Pix'], produtos: [], faq: [] }));

const { app } = require('../src/server');
const { carregarNegocio } = require('../src/negocio');

let servidor;
let baseUrl;
let cookie;
const pagina = async (caminho) => (await fetch(`${baseUrl}${caminho}`, { headers: { cookie } })).text();
const somDaPagina = (html) => JSON.parse(/window\.CHATDIGITAL_SOM = (\{[^<]*\});/.exec(html)[1]);

before(async () => {
  await new Promise((resolve) => {
    servidor = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${servidor.address().port}`;
      resolve();
    });
  });
  const resp = await fetch(`${baseUrl}/setup`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ nome: 'Carla', email: 'admin@teste.com', senha: '123456' }), redirect: 'manual' });
  cookie = resp.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  await new Promise((resolve) => servidor.close(resolve));
  const banco = require.cache[require.resolve('../src/db')];
  if (banco) banco.exports.db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('sem configurar: som de mensagem e de alerta ligados, volume médio, em todas as páginas do painel', async () => {
  for (const caminho of ['/painel', '/painel/fila', '/painel/relatorio']) {
    assert.deepStrictEqual(somDaPagina(await pagina(caminho)), { mensagem: true, alertas: true, volume: 'medio' }, caminho);
  }
  const tela = await pagina('/painel/configuracoes/pausas');
  assert.ok(tela.includes('Som dos avisos'));
  assert.ok(tela.includes('name="som_mensagem" value="1" checked'));
  assert.ok(tela.includes('name="som_alertas" value="1" checked'));
  assert.ok(tela.includes('data-testar-som="alerta"'));
});

test('desligar o som dos alertas e pôr volume alto vale na hora', async () => {
  const resp = await fetch(`${baseUrl}/painel/configuracoes/pausas/som`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ som_mensagem: '1', som_volume: 'alto' }),
    redirect: 'manual',
  });
  assert.strictEqual(resp.headers.get('location'), '/painel/configuracoes/pausas?salvo=1#som');
  const negocio = carregarNegocio();
  assert.strictEqual(negocio.som_mensagem, true);
  assert.strictEqual(negocio.som_alertas, false);
  assert.strictEqual(negocio.som_volume, 'alto');
  assert.deepStrictEqual(somDaPagina(await pagina('/painel/fila')), { mensagem: true, alertas: false, volume: 'alto' });
  const tela = await pagina('/painel/configuracoes/pausas');
  assert.ok(!tela.includes('name="som_alertas" value="1" checked'));
  assert.ok(tela.includes('<option value="alto" selected>'));
});

test('volume inválido volta para médio', async () => {
  await fetch(`${baseUrl}/painel/configuracoes/pausas/som`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, body: 'som_volume=estourado', redirect: 'manual' });
  assert.deepStrictEqual(somDaPagina(await pagina('/painel')), { mensagem: false, alertas: false, volume: 'medio' });
});

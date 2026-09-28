const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-fluxo-teste-'));
process.env.CHATDIGITAL_FLUXO = path.join(diretorioTeste, 'fluxo.json');
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.SESSION_SECRET = 'segredo-de-teste';

const { validarFluxo, salvarFluxo, carregarFluxo } = require('../src/fluxo');
const { app } = require('../src/server');

const fluxoValido = {
  inicio: 'inicio',
  nos: {
    inicio: { tipo: 'inicio', proximo: 'oi' },
    oi: { tipo: 'mensagem', texto: 'Olá!', proximo: '_fim' },
    _fim: { tipo: 'fim' },
  },
};

let servidor;
let baseUrl;

function extrairCookie(resposta) {
  const bruto = resposta.headers.get('set-cookie');
  return bruto ? bruto.split(';')[0] : null;
}

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
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('validarFluxo aceita um fluxo correto e rejeita referências quebradas', () => {
  assert.deepStrictEqual(validarFluxo(fluxoValido), []);

  const semInicio = { inicio: 'naoexiste', nos: fluxoValido.nos };
  assert.match(validarFluxo(semInicio)[0], /inicial "naoexiste" não existe/);

  const referenciaQuebrada = {
    inicio: 'inicio',
    nos: {
      inicio: { tipo: 'inicio', proximo: 'destino-fantasma' },
    },
  };
  const erros = validarFluxo(referenciaQuebrada);
  assert.ok(erros.some((e) => e.includes('destino-fantasma')));

  const tipoInvalido = { inicio: 'a', nos: { a: { tipo: 'voar' } } };
  assert.ok(validarFluxo(tipoInvalido)[0].includes('tipo desconhecido'));
});

test('salvarFluxo grava no disco e carregarFluxo lê de volta', () => {
  salvarFluxo(fluxoValido);
  const relido = carregarFluxo();
  assert.deepStrictEqual(relido, fluxoValido);
});

test('salvarFluxo recusa gravar um fluxo com referência quebrada', () => {
  assert.throws(() => salvarFluxo({ inicio: 'a', nos: { a: { tipo: 'mensagem', texto: 'x', proximo: 'fantasma' } } }));
});

test('rota /painel/fluxo/salvar exige admin e valida o corpo', async () => {
  let resp = await fetch(`${baseUrl}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nome: 'Admin', email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  const cookieAdmin = extrairCookie(resp);
  assert.ok(cookieAdmin);

  resp = await fetch(`${baseUrl}/painel/fluxo/dados`, { headers: { cookie: cookieAdmin } });
  assert.strictEqual(resp.status, 200);
  const dados = await resp.json();
  assert.strictEqual(dados.inicio, 'inicio');

  resp = await fetch(`${baseUrl}/painel/fluxo/salvar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: cookieAdmin },
    body: JSON.stringify({ inicio: 'a', nos: { a: { tipo: 'mensagem', texto: 'x', proximo: 'fantasma' } } }),
  });
  assert.strictEqual(resp.status, 400);
  const corpo = await resp.json();
  assert.strictEqual(corpo.ok, false);
  assert.ok(corpo.erros.length > 0);

  console.log('OK: rota do editor de fluxo valida e recusa referência quebrada');
});

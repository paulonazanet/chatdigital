const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.SESSION_SECRET = 'segredo-de-teste';

const { app } = require('../src/server');

let servidor;
let baseUrl;

function extrairCookie(resposta) {
  const bruto = resposta.headers.get('set-cookie');
  if (!bruto) return null;
  return bruto.split(';')[0];
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

test('fluxo completo: setup do primeiro admin, login, setores, atendentes e permissões', async () => {
  let resp = await fetch(`${baseUrl}/setup`);
  assert.strictEqual(resp.status, 200);
  assert.match(await resp.text(), /Crie o administrador/);

  resp = await fetch(`${baseUrl}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nome: 'Paulo Admin', email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 302);
  const cookieAdmin = extrairCookie(resp);
  assert.ok(cookieAdmin, 'deve receber cookie de sessão após o setup');

  resp = await fetch(`${baseUrl}/painel`, { headers: { cookie: cookieAdmin } });
  assert.match(await resp.text(), /Paulo Admin/);

  resp = await fetch(`${baseUrl}/painel/setores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieAdmin },
    body: new URLSearchParams({ nome: 'Vendas' }),
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 302);

  resp = await fetch(`${baseUrl}/painel/setores`, { headers: { cookie: cookieAdmin } });
  assert.match(await resp.text(), /Vendas/);

  resp = await fetch(`${baseUrl}/painel/atendentes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieAdmin },
    body: new URLSearchParams({
      nome: 'Ana Atendente',
      email: 'ana@teste.com',
      senha: '123456',
      papel: 'atendente',
      setores: '1',
    }),
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 302);

  resp = await fetch(`${baseUrl}/painel/atendentes`, { headers: { cookie: cookieAdmin } });
  assert.match(await resp.text(), /Ana Atendente/);

  // sem cookie, painel exige login
  resp = await fetch(`${baseUrl}/painel`, { redirect: 'manual' });
  assert.strictEqual(resp.status, 302);
  assert.match(resp.headers.get('location'), /\/login/);

  // login como o atendente comum (não-admin)
  resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'ana@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 302);
  const cookieAna = extrairCookie(resp);

  resp = await fetch(`${baseUrl}/painel/atendentes`, { headers: { cookie: cookieAna } });
  assert.strictEqual(resp.status, 403, 'atendente comum não deve acessar cadastro de atendentes');

  resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'ana@teste.com', senha: 'senha-errada' }),
  });
  assert.match(await resp.text(), /inválidos/);

  console.log('OK: setup, login, setores, atendentes e permissões');
});

test('não deixa remover o último administrador ativo', async () => {
  let resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  const cookieAdmin = extrairCookie(resp);

  resp = await fetch(`${baseUrl}/painel/atendentes/1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieAdmin },
    body: new URLSearchParams({ nome: 'Paulo Admin', papel: 'atendente' }),
  });
  assert.match(await resp.text(), /último administrador/);

  console.log('OK: bloqueia remover o último administrador ativo');
});

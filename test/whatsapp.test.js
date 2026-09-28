const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-whatsapp-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.SESSION_SECRET = 'segredo-de-teste';

const { app } = require('../src/server');
const whatsappStatus = require('../src/whatsapp-status');

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

test('Configurações > WhatsApp: mostra desconectado, depois QR Code, depois conectado', async () => {
  let resp = await fetch(`${baseUrl}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nome: 'Paulo Admin', email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  const cookieAdmin = extrairCookie(resp);

  // sem QR ainda (ex.: servidor acabou de subir)
  resp = await fetch(`${baseUrl}/painel/configuracoes/whatsapp`, { headers: { cookie: cookieAdmin } });
  assert.strictEqual(resp.status, 200);
  assert.match(await resp.text(), /desconectado e nenhum QR Code disponível/);

  resp = await fetch(`${baseUrl}/painel/configuracoes/whatsapp/qr.png`, { headers: { cookie: cookieAdmin } });
  assert.strictEqual(resp.status, 404, 'sem QR gerado ainda, a imagem não deve existir');

  // Baileys manda um QR
  whatsappStatus.definirQr('string-qualquer-do-baileys');

  resp = await fetch(`${baseUrl}/painel/configuracoes/whatsapp`, { headers: { cookie: cookieAdmin } });
  const html = await resp.text();
  assert.match(html, /Aparelhos conectados/);
  assert.match(html, /\/painel\/configuracoes\/whatsapp\/qr\.png/);

  resp = await fetch(`${baseUrl}/painel/configuracoes/whatsapp/qr.png`, { headers: { cookie: cookieAdmin } });
  assert.strictEqual(resp.status, 200);
  assert.strictEqual(resp.headers.get('content-type'), 'image/png');

  // conecta de verdade
  whatsappStatus.definirConectado();

  resp = await fetch(`${baseUrl}/painel/configuracoes/whatsapp`, { headers: { cookie: cookieAdmin } });
  assert.match(await resp.text(), /WhatsApp conectado/);

  resp = await fetch(`${baseUrl}/painel/configuracoes/whatsapp/qr.png`, { headers: { cookie: cookieAdmin } });
  assert.strictEqual(resp.status, 404, 'depois de conectar não deve sobrar QR antigo');

  // atendente sem gerenciar_configuracoes não acessa (mesma proteção da tela de Configurações)
  await fetch(`${baseUrl}/painel/atendentes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieAdmin },
    body: new URLSearchParams({ nome: 'Carlos', email: 'carlos@teste.com', senha: '123456', papel: 'atendente' }),
  });
  resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'carlos@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  const cookieCarlos = extrairCookie(resp);

  resp = await fetch(`${baseUrl}/painel/configuracoes/whatsapp`, { headers: { cookie: cookieCarlos } });
  assert.strictEqual(resp.status, 403);

  console.log('OK: Configurações > WhatsApp — desconectado, QR Code, conectado, permissão');
});

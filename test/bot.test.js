const assert = require('node:assert');
const { test } = require('node:test');
const { ehConversaDeCliente } = require('../src/bot');

test('ehConversaDeCliente aceita só conversa 1:1 de verdade (número ou @lid), rejeita grupo/status/canal', () => {
  assert.strictEqual(ehConversaDeCliente('5511999998888@s.whatsapp.net'), true);
  assert.strictEqual(ehConversaDeCliente('236760458072274@lid'), true, 'formato @lid é uma conversa real (visto em produção)');

  assert.strictEqual(ehConversaDeCliente('status@broadcast'), false, 'Status/stories do WhatsApp não é um cliente');
  assert.strictEqual(ehConversaDeCliente('120363000000000000@g.us'), false, 'grupo não é atendimento 1:1');
  assert.strictEqual(ehConversaDeCliente('111111111111111@newsletter'), false, 'canal não é um cliente');
  assert.strictEqual(ehConversaDeCliente(null), false);
  assert.strictEqual(ehConversaDeCliente(''), false);

  console.log('OK: filtro de conversa de cliente ignora grupo/status/canal, aceita @s.whatsapp.net e @lid');
});

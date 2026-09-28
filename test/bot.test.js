const assert = require('node:assert');
const { test } = require('node:test');
const { ehConversaDeCliente, construirVerificadorNumeroPermitido } = require('../src/bot');

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

test('modo de teste (NUMEROS_TESTE): sem lista atende todo mundo, com lista só quem está nela', () => {
  const semFiltro = construirVerificadorNumeroPermitido([]);
  assert.strictEqual(semFiltro('5511999998888@s.whatsapp.net'), true, 'lista vazia = comportamento normal, atende todo mundo');

  const comFiltro = construirVerificadorNumeroPermitido(['5511999998888']);
  assert.strictEqual(comFiltro('5511999998888@s.whatsapp.net'), true, 'número da lista é atendido');
  assert.strictEqual(comFiltro('5511977776666@s.whatsapp.net'), false, 'número fora da lista é ignorado');

  // conversa @lid: sem o número visível no JID, usa o senderPn (que o Baileys manda separado)
  assert.strictEqual(comFiltro('236760458072274@lid', '5511999998888@s.whatsapp.net'), true, 'usa senderPn quando é @lid');
  assert.strictEqual(comFiltro('236760458072274@lid', '5511977776666@s.whatsapp.net'), false);
  assert.strictEqual(comFiltro('236760458072274@lid', undefined), false, 'sem senderPn e sem bater no @lid, fica de fora');

  console.log('OK: modo de teste ignora quem não está na lista de números de teste, sem lista atende todo mundo');
});

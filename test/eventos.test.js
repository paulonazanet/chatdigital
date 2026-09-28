const assert = require('node:assert');
const { test, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-eventos-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');

const { processarMensagem } = require('../src/flow-engine');
const { registrarMensagem, sincronizarConversa, assumirConversa, obterOuCriarConversa } = require('../src/conversas');
const { criarAtendente } = require('../src/atendentes');
const { carregarFluxo } = require('../src/fluxo');
const { barramento } = require('../src/eventos');

const negocio = {
  nome: 'Loja Exemplo',
  numero_atendente_legivel: '(11) 90000-0000',
  formas_pagamento: ['Pix'],
  produtos: [{ id: 'p13', nome: 'Botijão 13kg', preco: 120 }],
  faq: [],
};
const fluxo = carregarFluxo();

after(() => {
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

async function simular(numero, texto) {
  registrarMensagem(numero, 'cliente', texto);
  const resposta = await processarMensagem({ numero, texto, negocio, fluxo });
  sincronizarConversa(numero, fluxo);
  if (resposta) registrarMensagem(numero, 'bot', resposta);
}

test('emite "atencao" (novo-atendimento) quando o cliente é transferido pro atendente', async () => {
  const numero = '5511911112222@s.whatsapp.net';

  const promessaEvento = new Promise((resolve) => barramento.once('atencao', resolve));
  await simular(numero, 'oi');
  await simular(numero, '3'); // "Falar com um atendente"

  const evento = await promessaEvento;
  assert.strictEqual(evento.motivo, 'novo-atendimento');
  assert.strictEqual(evento.numero, numero);

  console.log('OK: evento de novo atendimento disparado');
});

test('emite "atencao" (mensagem) quando o cliente escreve de novo numa conversa já assumida', async () => {
  const numero = '5511933334444@s.whatsapp.net';
  await simular(numero, 'oi');
  await simular(numero, '3');

  const atendente = criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: '123456', papel: 'atendente' });
  const conversa = obterOuCriarConversa(numero);
  assumirConversa(conversa.id, atendente.id);

  const promessaEvento = new Promise((resolve) => barramento.once('atencao', resolve));
  registrarMensagem(numero, 'cliente', 'alguém pode me ajudar?');
  const evento = await promessaEvento;

  assert.strictEqual(evento.motivo, 'mensagem');
  assert.strictEqual(evento.numero, numero);

  console.log('OK: evento de nova mensagem numa conversa assumida disparado');
});

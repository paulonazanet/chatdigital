const assert = require('node:assert');
const { test } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Versões da mensagem: várias separadas por uma linha com ---, uma sorteada por cliente.
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-versoes-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify({ nome: 'Gás Exemplo', formas_pagamento: ['Pix'], produtos: [], faq: [] }));

const envios = require('../src/envios');
const lembretes = require('../src/lembretes');
const campanhas = require('../src/campanhas');
const { carregarNegocio } = require('../src/negocio');
const { db } = require('../src/db');

test('separa as versões pela linha com --- e ignora as vazias', () => {
  assert.deepStrictEqual(envios.versoesDoTexto('Oi\n---\nOlá\n  ----  \n\n---\nE aí'), ['Oi', 'Olá', 'E aí']);
  assert.deepStrictEqual(envios.versoesDoTexto('Texto com - e -- no meio'), ['Texto com - e -- no meio']);
  assert.strictEqual(envios.sortearVersao('A\n---\nB', () => 0), 'A');
  assert.strictEqual(envios.sortearVersao('A\n---\nB', () => 0.99), 'B');
});

test('o lembrete padrão tem 3 versões, todas com SAIR, e cada cliente recebe uma só', () => {
  const regras = lembretes.regrasDeRecompra(carregarNegocio());
  for (const texto of [regras.texto, ...regras.etapas.map((e) => e.texto)]) {
    const versoes = envios.versoesDoTexto(texto);
    assert.strictEqual(versoes.length, 3);
    assert.ok(versoes.every((v) => /responda SAIR/.test(v)));
  }
  const saida = lembretes.montarTexto(regras, carregarNegocio(), { nome_contato: 'Maria' }, 30, regras.texto, () => 0.5);
  assert.ok(!saida.includes('---'));
  assert.ok(saida.startsWith('Olá, Maria!'));
  assert.ok(saida.includes('30 dias'));
  // sem nome, nenhuma versão fica com vírgula sobrando ("Oi, , tudo bem?")
  for (const sorteio of [0, 0.5, 0.9]) {
    const semNome = lembretes.montarTexto(regras, carregarNegocio(), { nome_contato: '' }, 30, regras.texto, () => sorteio);
    assert.ok(!/,\s*[,!?.]/.test(semNome), semNome);
  }
});

test('campanha sorteia a versão e põe o SAIR na versão sorteada', () => {
  const texto = campanhas.textoParaCliente({ texto: 'Promo A, {{cliente.nome}}\n---\nPromo B, {{cliente.nome}}' }, { nome_contato: 'Ana' }, carregarNegocio(), () => 0.9);
  assert.ok(texto.startsWith('Promo B, Ana'));
  assert.ok(/SAIR/.test(texto));
  assert.ok(!texto.includes('Promo A'));
});

test.after(() => db.close());

const assert = require('node:assert');
const { test, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-restaurar-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');

const { processarMensagem } = require('../src/flow-engine');
const { restaurarAtendimentosEmAndamento, sincronizarConversa, obterOuCriarConversa } = require('../src/conversas');
const { carregarFluxo } = require('../src/fluxo');
const { db } = require('../src/db');

const negocio = { nome: 'Loja Exemplo', formas_pagamento: ['Pix'], produtos: [], faq: [] };

after(() => {
  try {
    fs.rmSync(diretorioTeste, { recursive: true, force: true });
  } catch {
    // Windows às vezes segura o arquivo do SQLite (EPERM) — não é falha do teste.
  }
});

function inserirConversa(numero, status, setorId = null) {
  const agora = new Date().toISOString();
  db.prepare('INSERT INTO conversas (numero, status, setor_id, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)').run(
    numero,
    status,
    setorId,
    agora,
    agora,
  );
}

test('depois de reiniciar, conversa com atendente continua sem bot e sem perder status/setor (bug real)', async () => {
  const fluxo = carregarFluxo();
  const setorId = Number(db.prepare('INSERT INTO setores (nome) VALUES (?)').run('Vendas').lastInsertRowid);

  // grava direto no banco — simula conversas de ANTES do reinício, que o motor de fluxo (memória)
  // nunca viu neste processo
  inserirConversa('111@lid', 'atendendo', setorId);
  inserirConversa('222@lid', 'aguardando', setorId);
  inserirConversa('333@lid', 'bot');
  inserirConversa('444@lid', 'finalizado');

  assert.strictEqual(restaurarAtendimentosEmAndamento(fluxo), 2, 'só atendendo/aguardando voltam pra humano');

  for (const numero of ['111@lid', '222@lid']) {
    const statusAntes = obterOuCriarConversa(numero).status;
    const resposta = await processarMensagem({ numero, texto: 'oi, alguém aí?', negocio, fluxo });
    assert.strictEqual(resposta, null, `${numero}: bot deve ficar em silêncio, a conversa está com atendente`);

    sincronizarConversa(numero, fluxo);
    const depois = obterOuCriarConversa(numero);
    assert.strictEqual(depois.status, statusAntes, `${numero}: não pode voltar pra 'bot' e sumir da fila`);
    assert.strictEqual(depois.setor_id, setorId, `${numero}: não pode perder o setor`);
  }

  for (const numero of ['333@lid', '444@lid']) {
    const resposta = await processarMensagem({ numero, texto: 'oi', negocio, fluxo });
    assert.ok(resposta, `${numero}: conversa sem atendente continua sendo atendida pelo bot`);
  }

  console.log('OK: estado "com atendente" é restaurado do banco no boot, bot não reabre o menu após reinício');
});

const { db } = require('./db');

// Motivos de encerramento em 2 níveis: grupos (ex.: "Resolvido") com motivos dentro (ex.:
// "Pedido feito"). O atendente escolhe ao Finalizar; com `exigir_motivo_encerramento` ligado em
// Configurações, não finaliza sem escolher.

function listarArvore({ soAtivos = false } = {}) {
  const todos = db.prepare('SELECT * FROM motivos_encerramento ORDER BY nome COLLATE NOCASE').all();
  const filtro = (m) => !soAtivos || m.ativo;
  return todos
    .filter((m) => m.pai_id === null && filtro(m))
    .map((g) => ({ ...g, motivos: todos.filter((m) => m.pai_id === g.id && filtro(m)) }));
}

/** { id, texto: "Grupo › Motivo" } de um motivo ativo (não grupo), ou null. */
function resolverMotivo(id) {
  const m = db
    .prepare(
      `SELECT m.id, m.nome, g.nome AS grupo FROM motivos_encerramento m
       JOIN motivos_encerramento g ON g.id = m.pai_id AND g.ativo = 1
       WHERE m.id = ? AND m.ativo = 1`,
    )
    .get(id);
  return m ? { id: m.id, texto: `${m.grupo} › ${m.nome}` } : null;
}

function criarMotivo(nome, paiId = null) {
  db.prepare('INSERT INTO motivos_encerramento (nome, pai_id) VALUES (?, ?)').run(String(nome).trim().slice(0, 80), paiId);
}

function atualizarMotivo(id, { nome, ativo }) {
  db.prepare('UPDATE motivos_encerramento SET nome = ?, ativo = ? WHERE id = ?').run(String(nome).trim().slice(0, 80), ativo ? 1 : 0, id);
}

function excluirMotivo(id) {
  db.prepare('DELETE FROM motivos_encerramento WHERE id = ?').run(id);
}

// Lista inicial, pensada pra revenda de gás/pequeno negócio — só entra se a tabela estiver vazia
// (1a vez); depois o administrador edita à vontade.
const PADRAO = {
  Resolvido: ['Pedido feito', 'Dúvida esclarecida', 'Informação de preço ou horário', 'Problema resolvido'],
  'Não resolvido': ['Cliente desistiu', 'Fora da área de entrega', 'Sem o produto no momento', 'Encaminhado para outro canal'],
  'Sem contato': ['Cliente não respondeu', 'Engano ou spam'],
};
function criarMotivosPadraoSeVazio() {
  if (db.prepare('SELECT 1 FROM motivos_encerramento LIMIT 1').get()) return;
  for (const [grupo, motivos] of Object.entries(PADRAO)) {
    const paiId = Number(db.prepare('INSERT INTO motivos_encerramento (nome) VALUES (?)').run(grupo).lastInsertRowid);
    for (const nome of motivos) db.prepare('INSERT INTO motivos_encerramento (nome, pai_id) VALUES (?, ?)').run(nome, paiId);
  }
}
criarMotivosPadraoSeVazio();

module.exports = { listarArvore, resolverMotivo, criarMotivo, atualizarMotivo, excluirMotivo };

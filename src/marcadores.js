const { db } = require('./db');

// Marcadores da conversa (menu Configurações > Marcadores; aplicados em Ações na conversa).

const CORES = ['#2f6690', '#1f7a4d', '#a4222c', '#ed813b', '#7b4fa3', '#c79a00', '#47535e', '#0f8a8a'];

function listarMarcadores({ soAtivos = false } = {}) {
  return db
    .prepare(
      `SELECT m.*, (SELECT COUNT(*) FROM conversas_marcadores cm WHERE cm.marcador_id = m.id) AS em_uso
       FROM marcadores m ${soAtivos ? 'WHERE m.ativo = 1' : ''} ORDER BY m.nome COLLATE NOCASE`,
    )
    .all();
}

function corValida(cor) {
  return /^#[0-9a-f]{6}$/i.test(String(cor || '')) ? cor : CORES[0];
}

function criarMarcador(nome, cor) {
  db.prepare('INSERT INTO marcadores (nome, cor) VALUES (?, ?)').run(String(nome).trim().slice(0, 40), corValida(cor));
}

function atualizarMarcador(id, { nome, cor, ativo }) {
  db.prepare('UPDATE marcadores SET nome = ?, cor = ?, ativo = ? WHERE id = ?').run(String(nome).trim().slice(0, 40), corValida(cor), ativo ? 1 : 0, id);
}

function excluirMarcador(id) {
  db.prepare('DELETE FROM marcadores WHERE id = ?').run(id);
}

/** { conversaId: [marcador, ...] } das conversas pedidas (só marcadores ativos). */
function marcadoresPorConversa(ids) {
  const mapa = {};
  if (!ids.length) return mapa;
  const linhas = db
    .prepare(
      `SELECT cm.conversa_id, m.id, m.nome, m.cor FROM conversas_marcadores cm
       JOIN marcadores m ON m.id = cm.marcador_id AND m.ativo = 1
       WHERE cm.conversa_id IN (${ids.map(() => '?').join(',')}) ORDER BY m.nome COLLATE NOCASE`,
    )
    .all(...ids);
  for (const l of linhas) (mapa[l.conversa_id] = mapa[l.conversa_id] || []).push({ id: l.id, nome: l.nome, cor: l.cor });
  return mapa;
}

/** Troca os marcadores da conversa pelos `ids` marcados (só os que existem e estão ativos). */
function definirMarcadoresDaConversa(conversaId, ids) {
  const ativos = new Set(listarMarcadores({ soAtivos: true }).map((m) => m.id));
  db.prepare(
    'DELETE FROM conversas_marcadores WHERE conversa_id = ? AND marcador_id IN (SELECT id FROM marcadores WHERE ativo = 1)',
  ).run(conversaId);
  const inserir = db.prepare('INSERT OR IGNORE INTO conversas_marcadores (conversa_id, marcador_id) VALUES (?, ?)');
  for (const id of ids) if (ativos.has(id)) inserir.run(conversaId, id);
}

// Lista inicial (só se a tabela estiver vazia, na 1a vez); o administrador edita à vontade.
const PADRAO = [
  ['Urgente', '#a4222c'],
  ['Aguardando retorno', '#c79a00'],
  ['Reclamação', '#ed813b'],
  ['Cliente novo', '#1f7a4d'],
  ['VIP', '#7b4fa3'],
];
if (!db.prepare('SELECT 1 FROM marcadores LIMIT 1').get()) {
  for (const [nome, cor] of PADRAO) db.prepare('INSERT INTO marcadores (nome, cor) VALUES (?, ?)').run(nome, cor);
}

// Fixar conversa: por atendente
function idsFixados(atendenteId) {
  return new Set(db.prepare('SELECT conversa_id FROM conversas_fixadas WHERE atendente_id = ?').all(atendenteId).map((l) => l.conversa_id));
}
function alternarFixada(atendenteId, conversaId) {
  const apagou = db.prepare('DELETE FROM conversas_fixadas WHERE atendente_id = ? AND conversa_id = ?').run(atendenteId, conversaId);
  if (!apagou.changes) db.prepare('INSERT INTO conversas_fixadas (atendente_id, conversa_id) VALUES (?, ?)').run(atendenteId, conversaId);
}

module.exports = {
  CORES,
  listarMarcadores,
  criarMarcador,
  atualizarMarcador,
  excluirMarcador,
  marcadoresPorConversa,
  definirMarcadoresDaConversa,
  idsFixados,
  alternarFixada,
};

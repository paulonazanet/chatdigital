const { db } = require('./db');
const { obterEstadoConversa } = require('./flow-engine');

function obterOuCriarConversa(numero) {
  const existente = db.prepare('SELECT * FROM conversas WHERE numero = ?').get(numero);
  if (existente) return existente;

  const agora = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO conversas (numero, status, criado_em, atualizado_em) VALUES (?, ?, ?, ?)')
    .run(numero, 'bot', agora, agora);
  return db.prepare('SELECT * FROM conversas WHERE id = ?').get(Number(info.lastInsertRowid));
}

function registrarMensagem(numero, remetente, texto) {
  const conversa = obterOuCriarConversa(numero);
  const agora = new Date().toISOString();
  db.prepare('INSERT INTO mensagens (conversa_id, remetente, texto, criado_em) VALUES (?, ?, ?, ?)').run(
    conversa.id,
    remetente,
    texto,
    agora,
  );
  db.prepare('UPDATE conversas SET atualizado_em = ? WHERE id = ?').run(agora, conversa.id);
}

/**
 * Sincroniza a tabela `conversas` com o estado em memória do motor de fluxo (obterEstadoConversa),
 * depois de processarMensagem. Chame sempre que uma conversa puder ter mudado de "bot" para
 * "aguardando atendente" (ou vice-versa, ao digitar "menu" de novo).
 */
function sincronizarConversa(numero, fluxo) {
  const estado = obterEstadoConversa(numero, fluxo);
  const conversa = obterOuCriarConversa(numero);

  let setorId = null;
  if (estado.setor) {
    const setor = db.prepare('SELECT id FROM setores WHERE nome = ? COLLATE NOCASE').get(estado.setor);
    setorId = setor ? setor.id : null;
  }

  let status = 'bot';
  if (estado.humano) {
    status = conversa.status === 'atendendo' || conversa.status === 'finalizado' ? conversa.status : 'aguardando';
  }

  db.prepare('UPDATE conversas SET status = ?, setor_id = ?, atualizado_em = ? WHERE id = ?').run(
    status,
    setorId,
    new Date().toISOString(),
    conversa.id,
  );
}

function listarFila() {
  return db
    .prepare(
      `SELECT c.*, s.nome AS setor_nome, a.nome AS atendente_nome,
              (SELECT texto FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem
       FROM conversas c
       LEFT JOIN setores s ON s.id = c.setor_id
       LEFT JOIN atendentes a ON a.id = c.atendente_id
       WHERE c.status IN ('aguardando', 'atendendo')
       ORDER BY c.atualizado_em DESC`,
    )
    .all();
}

function obterConversaPorId(id) {
  return db
    .prepare(
      `SELECT c.*, s.nome AS setor_nome, a.nome AS atendente_nome
       FROM conversas c
       LEFT JOIN setores s ON s.id = c.setor_id
       LEFT JOIN atendentes a ON a.id = c.atendente_id
       WHERE c.id = ?`,
    )
    .get(id);
}

function listarMensagens(conversaId) {
  return db.prepare('SELECT * FROM mensagens WHERE conversa_id = ? ORDER BY id ASC').all(conversaId);
}

function assumirConversa(id, atendenteId) {
  db.prepare("UPDATE conversas SET atendente_id = ?, status = 'atendendo', atualizado_em = ? WHERE id = ?").run(
    atendenteId,
    new Date().toISOString(),
    id,
  );
}

function finalizarConversa(id) {
  db.prepare("UPDATE conversas SET status = 'finalizado', atualizado_em = ? WHERE id = ?").run(
    new Date().toISOString(),
    id,
  );
}

module.exports = {
  obterOuCriarConversa,
  registrarMensagem,
  sincronizarConversa,
  listarFila,
  obterConversaPorId,
  listarMensagens,
  assumirConversa,
  finalizarConversa,
};

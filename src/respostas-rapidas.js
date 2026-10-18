const { db } = require('./db');

// Respostas rápidas (menu Respostas rápidas): textos prontos que o atendente puxa digitando "/"
// no campo de resposta. Sem setor marcado = vale pra todos os setores. Some sozinha depois de
// `expira_em` (data AAAA-MM-DD, o dia todo ainda vale) ou quando desativada.

function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function setoresDa(id) {
  return db.prepare('SELECT setor_id FROM respostas_rapidas_setores WHERE resposta_id = ?').all(id).map((r) => r.setor_id);
}

function listarRespostas() {
  return db
    .prepare(
      `SELECT r.*, a.nome AS criado_por_nome FROM respostas_rapidas r
       LEFT JOIN atendentes a ON a.id = r.criado_por ORDER BY r.nome COLLATE NOCASE`,
    )
    .all()
    .map((r) => ({ ...r, setores: setoresDa(r.id), vencida: !!r.expira_em && r.expira_em < hojeLocal() }));
}

function obterResposta(id) {
  const r = db.prepare('SELECT * FROM respostas_rapidas WHERE id = ?').get(id);
  return r ? { ...r, setores: setoresDa(r.id) } : null;
}

/** As que valem agora pra uma conversa do setor `setorId` (null = conversa sem setor). */
function respostasParaConversa(setorId) {
  return listarRespostas().filter((r) => r.ativa && !r.vencida && (r.setores.length === 0 || r.setores.includes(setorId)));
}

function validar({ nome, texto, expira_em }) {
  if (!String(nome || '').trim()) return 'Dê um nome pra resposta (é por ele que o atendente acha).';
  if (!String(texto || '').trim()) return 'Escreva o texto da resposta.';
  if (String(texto).length > 4000) return 'O texto pode ter no máximo 4.000 caracteres.';
  if (expira_em && !/^\d{4}-\d{2}-\d{2}$/.test(expira_em)) return 'Data de validade inválida.';
  return null;
}

function gravarSetores(id, setores) {
  db.prepare('DELETE FROM respostas_rapidas_setores WHERE resposta_id = ?').run(id);
  const inserir = db.prepare('INSERT OR IGNORE INTO respostas_rapidas_setores (resposta_id, setor_id) VALUES (?, ?)');
  for (const setorId of setores) inserir.run(id, setorId);
}

function salvarResposta(id, dados, criadoPor) {
  const nome = String(dados.nome).trim().slice(0, 80);
  const texto = String(dados.texto).trim();
  const ativa = dados.ativa ? 1 : 0;
  const expira = dados.expira_em || null;
  if (id) {
    db.prepare('UPDATE respostas_rapidas SET nome = ?, texto = ?, ativa = ?, expira_em = ? WHERE id = ?').run(nome, texto, ativa, expira, id);
  } else {
    id = Number(
      db
        .prepare('INSERT INTO respostas_rapidas (nome, texto, ativa, expira_em, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
        .run(nome, texto, ativa, expira, criadoPor || null, new Date().toISOString()).lastInsertRowid,
    );
  }
  gravarSetores(id, dados.setores || []);
  return id;
}

function excluirResposta(id) {
  db.prepare('DELETE FROM respostas_rapidas WHERE id = ?').run(id);
}

// "Bom dia" / "Boa tarde" / "Boa noite" pela hora do servidor
function saudacao(data = new Date()) {
  const h = data.getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

module.exports = {
  listarRespostas,
  obterResposta,
  respostasParaConversa,
  validar,
  salvarResposta,
  excluirResposta,
  saudacao,
};

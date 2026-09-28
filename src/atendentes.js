const { db } = require('./db');
const { gerarHashSenha, conferirSenha } = require('./auth');

function listarAtendentes() {
  return db.prepare('SELECT id, nome, email, papel, ativo, criado_em FROM atendentes ORDER BY nome').all();
}

function obterAtendentePorId(id) {
  return db.prepare('SELECT id, nome, email, papel, ativo, criado_em FROM atendentes WHERE id = ?').get(id);
}

function obterAtendentePorEmail(email) {
  return db.prepare('SELECT * FROM atendentes WHERE email = ?').get(email);
}

function contarAtendentes() {
  return db.prepare('SELECT COUNT(*) AS total FROM atendentes').get().total;
}

function contarAdminsAtivos(excluirId = null) {
  return db
    .prepare("SELECT id FROM atendentes WHERE papel = 'admin' AND ativo = 1")
    .all()
    .filter((a) => a.id !== excluirId).length;
}

function criarAtendente({ nome, email, senha, papel }) {
  const senhaHash = gerarHashSenha(senha);
  const info = db
    .prepare('INSERT INTO atendentes (nome, email, senha_hash, papel, ativo, criado_em) VALUES (?, ?, ?, ?, 1, ?)')
    .run(nome, email, senhaHash, papel, new Date().toISOString());
  return obterAtendentePorId(Number(info.lastInsertRowid));
}

function autenticar(email, senha) {
  const atendente = obterAtendentePorEmail(email);
  if (!atendente || !atendente.ativo) return null;
  if (!conferirSenha(senha, atendente.senha_hash)) return null;
  return obterAtendentePorId(atendente.id);
}

function atualizarAtendente(id, { nome, papel, ativo, novaSenha }) {
  db.prepare('UPDATE atendentes SET nome = ?, papel = ?, ativo = ? WHERE id = ?').run(nome, papel, ativo ? 1 : 0, id);
  if (novaSenha) {
    db.prepare('UPDATE atendentes SET senha_hash = ? WHERE id = ?').run(gerarHashSenha(novaSenha), id);
  }
  return obterAtendentePorId(id);
}

function definirSetoresDoAtendente(atendenteId, setorIds) {
  db.prepare('DELETE FROM atendentes_setores WHERE atendente_id = ?').run(atendenteId);
  const inserir = db.prepare('INSERT INTO atendentes_setores (atendente_id, setor_id) VALUES (?, ?)');
  for (const setorId of setorIds) inserir.run(atendenteId, setorId);
}

function listarSetoresDoAtendente(atendenteId) {
  return db
    .prepare(
      `SELECT s.id, s.nome FROM setores s
       JOIN atendentes_setores vinc ON vinc.setor_id = s.id
       WHERE vinc.atendente_id = ?
       ORDER BY s.nome`,
    )
    .all(atendenteId);
}

module.exports = {
  listarAtendentes,
  obterAtendentePorId,
  obterAtendentePorEmail,
  contarAtendentes,
  contarAdminsAtivos,
  criarAtendente,
  autenticar,
  atualizarAtendente,
  definirSetoresDoAtendente,
  listarSetoresDoAtendente,
};

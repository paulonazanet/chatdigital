const { db } = require('./db');
const { gerarHashSenha, conferirSenha } = require('./auth');
const { permissoesParaSalvar } = require('./permissoes');

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const COLUNAS = 'id, nome, email, papel, ativo, permissoes, ultimo_login, criado_em';

function listarAtendentes() {
  return db.prepare(`SELECT ${COLUNAS} FROM atendentes ORDER BY nome`).all();
}

function obterAtendentePorId(id) {
  return db.prepare(`SELECT ${COLUNAS} FROM atendentes WHERE id = ?`).get(id);
}

function obterAtendentePorEmail(email) {
  return db.prepare('SELECT * FROM atendentes WHERE email = ?').get(normalizarEmail(email));
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

function criarAtendente({ nome, email, senha, papel, permissoes }) {
  const senhaHash = gerarHashSenha(senha);
  const permissoesFinal = JSON.stringify(permissoesParaSalvar(papel, permissoes));
  const info = db
    .prepare(
      'INSERT INTO atendentes (nome, email, senha_hash, papel, ativo, permissoes, criado_em) VALUES (?, ?, ?, ?, 1, ?, ?)',
    )
    .run(nome, normalizarEmail(email), senhaHash, papel, permissoesFinal, new Date().toISOString());
  return obterAtendentePorId(Number(info.lastInsertRowid));
}

function autenticar(email, senha) {
  const atendente = obterAtendentePorEmail(email);
  if (!atendente || !atendente.ativo) return null;
  if (!conferirSenha(senha, atendente.senha_hash)) return null;
  return obterAtendentePorId(atendente.id);
}

function registrarUltimoLogin(id) {
  db.prepare('UPDATE atendentes SET ultimo_login = ? WHERE id = ?').run(new Date().toISOString(), id);
}

function atualizarAtendente(id, { nome, papel, ativo, novaSenha, permissoes }) {
  const permissoesFinal = JSON.stringify(permissoesParaSalvar(papel, permissoes));
  db.prepare('UPDATE atendentes SET nome = ?, papel = ?, ativo = ?, permissoes = ? WHERE id = ?').run(
    nome,
    papel,
    ativo ? 1 : 0,
    permissoesFinal,
    id,
  );
  if (novaSenha) {
    db.prepare('UPDATE atendentes SET senha_hash = ? WHERE id = ?').run(gerarHashSenha(novaSenha), id);
  }
  return obterAtendentePorId(id);
}

function alternarAtivo(id) {
  db.prepare('UPDATE atendentes SET ativo = NOT ativo WHERE id = ?').run(id);
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
  registrarUltimoLogin,
  atualizarAtendente,
  alternarAtivo,
  definirSetoresDoAtendente,
  listarSetoresDoAtendente,
};

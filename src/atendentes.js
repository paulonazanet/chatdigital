const { db } = require('./db');
const { gerarHashSenha, conferirSenha } = require('./auth');
const { permissoesParaSalvar, temPermissao } = require('./permissoes');
const { listarOnline } = require('./presenca');
const { podeReceberConversa } = require('./equipe');

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const COLUNAS = 'id, nome, email, papel, ativo, permissoes, ultimo_login, criado_em, limite_conversas, grupo_id, acesso_horario, acesso_ips';

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

// limite de conversas ao mesmo tempo: inteiro de 0 (sem limite) a 50
function normalizarLimite(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 50) : 0;
}

// Grupo de permissões (E2, 4a parte): com grupo, as permissões são as dele (as marcadas à mão não valem)
function permissoesComGrupo(papel, permissoes, grupoId) {
  if (grupoId && papel !== 'admin') {
    const grupo = db.prepare('SELECT permissoes FROM grupos_permissao WHERE id = ?').get(grupoId);
    if (grupo) return { permissoes: JSON.parse(grupo.permissoes || '[]'), grupoId };
  }
  return { permissoes, grupoId: null };
}

// Horário e IPs de acesso: janelas do formulário (lista) e texto dos IPs; vazio = sem restrição
function normalizarAcesso({ acessoHorario, acessoIps }) {
  const janelas = Array.isArray(acessoHorario) ? acessoHorario : [];
  const ips = String(acessoIps || '').split(/[\s,;]+/).map((ip) => ip.trim()).filter(Boolean).slice(0, 20);
  return { horario: janelas.length ? JSON.stringify(janelas) : null, ips: ips.length ? ips.join('\n') : null };
}

function criarAtendente({ nome, email, senha, papel, permissoes, limiteConversas = 0, grupoId = null, acessoHorario = [], acessoIps = '' }) {
  const senhaHash = gerarHashSenha(senha);
  const comGrupo = permissoesComGrupo(papel, permissoes, grupoId);
  const permissoesFinal = JSON.stringify(permissoesParaSalvar(papel, comGrupo.permissoes));
  const acesso = normalizarAcesso({ acessoHorario, acessoIps });
  const info = db
    .prepare(
      'INSERT INTO atendentes (nome, email, senha_hash, papel, ativo, permissoes, criado_em, limite_conversas, grupo_id, acesso_horario, acesso_ips) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)',
    )
    .run(nome, normalizarEmail(email), senhaHash, papel, permissoesFinal, new Date().toISOString(), normalizarLimite(limiteConversas), comGrupo.grupoId, acesso.horario, acesso.ips);
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

function atualizarAtendente(id, { nome, papel, ativo, novaSenha, permissoes, limiteConversas, grupoId, acessoHorario, acessoIps }) {
  const comGrupo = grupoId === undefined ? { permissoes, grupoId: undefined } : permissoesComGrupo(papel, permissoes, grupoId);
  const permissoesFinal = JSON.stringify(permissoesParaSalvar(papel, comGrupo.permissoes));
  db.prepare('UPDATE atendentes SET nome = ?, papel = ?, ativo = ?, permissoes = ? WHERE id = ?').run(
    nome,
    papel,
    ativo ? 1 : 0,
    permissoesFinal,
    id,
  );
  if (comGrupo.grupoId !== undefined) db.prepare('UPDATE atendentes SET grupo_id = ? WHERE id = ?').run(comGrupo.grupoId, id);
  if (acessoHorario !== undefined || acessoIps !== undefined) {
    const acesso = normalizarAcesso({ acessoHorario, acessoIps });
    db.prepare('UPDATE atendentes SET acesso_horario = ?, acesso_ips = ? WHERE id = ?').run(acesso.horario, acesso.ips, id);
  }
  if (limiteConversas !== undefined) {
    db.prepare('UPDATE atendentes SET limite_conversas = ? WHERE id = ?').run(normalizarLimite(limiteConversas), id);
  }
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

/**
 * Existe alguém ativo, online (painel aberto) e apto a responder esse setor agora? Usado pra
 * decidir se manda a mensagem "sem atendente disponível" quando uma conversa é transferida pro
 * humano — mesma regra de quem "pode ver" a conversa na fila (routes/fila.js podeVerConversa):
 * quem tem ver_fila_outros_setores vê/atende qualquer setor; sem isso, só o(s) setor(es) dele
 * (ou setorId nulo, que aparece pra todo mundo). Quem está em pausa ou no limite não conta.
 */
function haAtendenteDisponivel(setorId) {
  const online = new Set(listarOnline());
  return listarAtendentes()
    // em pausa ou no limite de conversas não conta (E2, 2a parte)
    .filter((a) => a.ativo && online.has(a.id) && temPermissao(a, 'responder_conversas') && podeReceberConversa(a.id).ok)
    .some((a) => {
      if (!setorId) return true;
      if (temPermissao(a, 'ver_fila_outros_setores')) return true;
      return listarSetoresDoAtendente(a.id).some((s) => s.id === setorId);
    });
}

module.exports = {
  listarAtendentes,
  haAtendenteDisponivel,
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

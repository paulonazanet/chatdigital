const { db } = require('./db');
const { listarOnline } = require('./presenca');

// Equipe ao vivo (E2, 2a parte): pausa do atendente com motivo, limite de conversas ao mesmo tempo
// e a situação de cada um agora (livre, atendendo, no limite, em pausa, offline), usada pela Fila,
// pelo Painel, pelo painel da TV e pelos alertas. Quem está em pausa ou no limite não recebe
// conversa nova: não conta como "atendente disponível", não dá pra transferir pra ele, e o bloco
// "Transferir para atendente" do fluxo deixa a conversa na fila do setor.

const agora = () => new Date().toISOString();

// ---- Motivos de pausa (Configurações > Pausas e alertas) ----

function listarMotivosPausa({ soAtivos = false } = {}) {
  return db.prepare(`SELECT * FROM motivos_pausa ${soAtivos ? 'WHERE ativo = 1' : ''} ORDER BY id`).all();
}

function validarMotivoPausa(nome, limite) {
  const limpo = String(nome || '').trim().slice(0, 40);
  const minutos = String(limite ?? '').trim() === '' ? 0 : Number(limite);
  if (!limpo) return { erro: 'Escreva o nome do motivo de pausa.' };
  if (!Number.isInteger(minutos) || minutos < 0 || minutos > 600) return { erro: 'O limite da pausa tem que ser minutos inteiros, de 0 a 600.' };
  return { nome: limpo, limite: minutos };
}

function criarMotivoPausa(nome, limite) {
  db.prepare('INSERT INTO motivos_pausa (nome, limite_minutos) VALUES (?, ?)').run(nome, limite);
}

function atualizarMotivoPausa(id, { nome, limite, ativo }) {
  db.prepare('UPDATE motivos_pausa SET nome = ?, limite_minutos = ?, ativo = ? WHERE id = ?').run(nome, limite, ativo ? 1 : 0, id);
}

// as pausas já feitas guardam o nome do motivo, então apagar não mexe no histórico
function excluirMotivoPausa(id) {
  db.prepare('DELETE FROM motivos_pausa WHERE id = ?').run(id);
}

// ---- Pausas ----

function pausaAtual(atendenteId) {
  return db.prepare('SELECT * FROM pausas WHERE atendente_id = ? AND fim IS NULL ORDER BY id DESC LIMIT 1').get(atendenteId) || null;
}

/** Começa uma pausa (fecha a que estiver aberta antes). Devolve a pausa, ou null se o motivo não vale. */
function iniciarPausa(atendenteId, motivoId) {
  const motivo = db.prepare('SELECT * FROM motivos_pausa WHERE id = ? AND ativo = 1').get(motivoId);
  if (!motivo) return null;
  encerrarPausa(atendenteId);
  db.prepare('INSERT INTO pausas (atendente_id, motivo_id, motivo_texto, limite_minutos, inicio) VALUES (?, ?, ?, ?, ?)').run(
    atendenteId,
    motivo.id,
    motivo.nome,
    motivo.limite_minutos,
    agora(),
  );
  return pausaAtual(atendenteId);
}

/** Volta da pausa. Devolve true se havia pausa aberta. */
function encerrarPausa(atendenteId) {
  return db.prepare('UPDATE pausas SET fim = ? WHERE atendente_id = ? AND fim IS NULL').run(agora(), atendenteId).changes > 0;
}

/** Pausa com o tempo corrido e se passou do limite do motivo. */
function descreverPausa(pausa, agoraMs = Date.now()) {
  if (!pausa) return null;
  const minutos = Math.floor((agoraMs - Date.parse(pausa.inicio)) / 60000);
  return {
    id: pausa.id,
    motivo: pausa.motivo_texto,
    inicio: pausa.inicio,
    minutos,
    limite: pausa.limite_minutos,
    passou: pausa.limite_minutos > 0 && minutos >= pausa.limite_minutos,
  };
}

// ---- Limite de conversas ----

function contarConversasAtendendo(atendenteId) {
  return db.prepare("SELECT COUNT(*) AS n FROM conversas WHERE status = 'atendendo' AND atendente_id = ?").get(atendenteId).n;
}

/**
 * Pode ficar com mais uma conversa agora? { ok, motivo } — motivo é o texto pra mostrar quando não
 * pode. `quem` muda a frase: 'voce' (o próprio atendente) ou o nome de outra pessoa.
 */
function podeReceberConversa(atendenteId, quem = 'voce') {
  const atendente = db.prepare('SELECT id, nome, ativo, limite_conversas FROM atendentes WHERE id = ?').get(atendenteId);
  if (!atendente || !atendente.ativo) return { ok: false, motivo: 'Esse atendente não está ativo.' };
  const voce = quem === 'voce';
  const pausa = pausaAtual(atendente.id);
  if (pausa) {
    return { ok: false, emPausa: true, motivo: voce ? `Você está em pausa (${pausa.motivo_texto}).` : `${atendente.nome} está em pausa (${pausa.motivo_texto}).` };
  }
  const limite = atendente.limite_conversas || 0;
  const atendendo = contarConversasAtendendo(atendente.id);
  if (limite && atendendo >= limite) {
    return {
      ok: false,
      noLimite: true,
      motivo: voce
        ? `Você já está com ${atendendo} conversa${atendendo === 1 ? '' : 's'} (seu limite é ${limite}). Finalize ou transfira uma antes de pegar outra.`
        : `${atendente.nome} já está com ${atendendo} conversa${atendendo === 1 ? '' : 's'} (limite ${limite}).`,
    };
  }
  return { ok: true };
}

// ---- Situação da equipe agora ----

const ROTULO_SITUACAO = { livre: 'Livre', atendendo: 'Atendendo', limite: 'No limite', pausa: 'Em pausa', offline: 'Offline' };

/** Uma linha por atendente ativo: online, conversas, limite, pausa e a situação resumida. */
function situacaoDaEquipe(agoraMs = Date.now()) {
  const online = new Set(listarOnline());
  const atendentes = db.prepare('SELECT id, nome, limite_conversas FROM atendentes WHERE ativo = 1 ORDER BY nome').all();
  const contagens = new Map(
    db.prepare("SELECT atendente_id, COUNT(*) AS n FROM conversas WHERE status = 'atendendo' AND atendente_id IS NOT NULL GROUP BY atendente_id").all().map((r) => [r.atendente_id, r.n]),
  );
  const pausas = new Map(db.prepare('SELECT * FROM pausas WHERE fim IS NULL').all().map((p) => [p.atendente_id, p]));
  const ordem = { pausa: 1, limite: 2, atendendo: 3, livre: 4, offline: 5 };
  return atendentes
    .map((a) => {
      const atendendo = contagens.get(a.id) || 0;
      const pausa = descreverPausa(pausas.get(a.id), agoraMs);
      const estaOnline = online.has(a.id);
      let situacao = 'offline';
      if (pausa) situacao = 'pausa';
      else if (estaOnline || atendendo) {
        if (a.limite_conversas && atendendo >= a.limite_conversas) situacao = 'limite';
        else situacao = atendendo ? 'atendendo' : 'livre';
      }
      return { id: a.id, nome: a.nome, online: estaOnline, atendendo, limite: a.limite_conversas || 0, pausa, situacao, rotulo: ROTULO_SITUACAO[situacao] };
    })
    .sort((x, y) => ordem[x.situacao] - ordem[y.situacao] || x.nome.localeCompare(y.nome));
}

// ---- Relatório: resumo de pausas ----

/** Pausas que começaram no período, por atendente (com o total por motivo). */
function resumoDePausas({ inicio, fim, atendenteId = null, agoraMs = Date.now() }) {
  const linhas = db
    .prepare(
      `SELECT p.*, a.nome AS atendente_nome FROM pausas p JOIN atendentes a ON a.id = p.atendente_id
       WHERE p.inicio >= ? AND p.inicio < ? AND (? IS NULL OR p.atendente_id = ?) ORDER BY p.inicio`,
    )
    .all(new Date(inicio).toISOString(), new Date(fim).toISOString(), atendenteId, atendenteId);
  const grupos = new Map();
  for (const p of linhas) {
    const duracao = Math.max(0, (p.fim ? Date.parse(p.fim) : agoraMs) - Date.parse(p.inicio));
    if (!grupos.has(p.atendente_id)) grupos.set(p.atendente_id, { nome: p.atendente_nome, quantidade: 0, totalMs: 0, maiorMs: 0, passaram: 0, motivos: new Map() });
    const g = grupos.get(p.atendente_id);
    g.quantidade += 1;
    g.totalMs += duracao;
    g.maiorMs = Math.max(g.maiorMs, duracao);
    if (p.limite_minutos && duracao >= p.limite_minutos * 60000) g.passaram += 1;
    g.motivos.set(p.motivo_texto, (g.motivos.get(p.motivo_texto) || 0) + duracao);
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, motivos: [...g.motivos.entries()].sort((a, b) => b[1] - a[1]) }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

module.exports = {
  listarMotivosPausa,
  validarMotivoPausa,
  criarMotivoPausa,
  atualizarMotivoPausa,
  excluirMotivoPausa,
  pausaAtual,
  iniciarPausa,
  encerrarPausa,
  descreverPausa,
  contarConversasAtendendo,
  podeReceberConversa,
  situacaoDaEquipe,
  resumoDePausas,
  ROTULO_SITUACAO,
};

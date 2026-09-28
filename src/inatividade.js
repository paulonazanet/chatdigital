const { db } = require('./db');
const { carregarFluxo } = require('./fluxo');
const { carregarNegocio } = require('./negocio');
const { obterSocket } = require('./socket-atual');
const { encerrarAtendimento } = require('./flow-engine');
const { registrarMensagem } = require('./conversas');

// Cliente parou no meio de uma pergunta do fluxo (não confirmou nem transferiu pra humano) e
// sumiu: depois de MINUTOS_LEMBRETE sem responder, manda um lembrete uma única vez; se mesmo
// assim continuar sem responder até MINUTOS_RESET (contados a partir do lembrete), desiste
// silenciosamente e volta a conversa pro início do fluxo — assim ela não fica "parada" pra
// sempre esperando um atendente notar e puxar manualmente.
const MINUTOS_LEMBRETE = 10;
const MINUTOS_RESET = 30;
const INTERVALO_CHECAGEM_MS = 60 * 1000;

function isoMinutosAtras(minutos) {
  return new Date(Date.now() - minutos * 60000).toISOString();
}

async function enviarLembretes(sock, negocio, fluxo) {
  if (!negocio.mensagem_inatividade) return;

  const parados = db
    .prepare(
      `SELECT * FROM conversas WHERE status = 'bot' AND no_fluxo_atual IS NOT NULL AND no_fluxo_atual != ?
       AND lembrete_inatividade_em IS NULL AND atualizado_em <= ?`,
    )
    .all(fluxo.inicio, isoMinutosAtras(MINUTOS_LEMBRETE));

  for (const conversa of parados) {
    if (sock) {
      try {
        await sock.sendMessage(conversa.numero, { text: negocio.mensagem_inatividade });
        registrarMensagem(conversa.numero, 'bot', negocio.mensagem_inatividade);
      } catch (erro) {
        console.error(`Falha ao enviar lembrete de inatividade para ${conversa.numero}:`, erro);
      }
    }
    db.prepare('UPDATE conversas SET lembrete_inatividade_em = ? WHERE id = ?').run(new Date().toISOString(), conversa.id);
  }
}

function resetarAbandonadas(fluxo) {
  const abandonadas = db
    .prepare(`SELECT * FROM conversas WHERE status = 'bot' AND lembrete_inatividade_em IS NOT NULL AND lembrete_inatividade_em <= ?`)
    .all(isoMinutosAtras(MINUTOS_RESET - MINUTOS_LEMBRETE));

  for (const conversa of abandonadas) {
    encerrarAtendimento(conversa.numero, fluxo); // reseta o estado em memória do motor de fluxo
    db.prepare('UPDATE conversas SET no_fluxo_atual = ?, lembrete_inatividade_em = NULL, atualizado_em = ? WHERE id = ?').run(
      fluxo.inicio,
      new Date().toISOString(),
      conversa.id,
    );
  }
}

async function verificarInatividade() {
  const fluxo = carregarFluxo();
  const negocio = carregarNegocio();
  const sock = obterSocket();

  await enviarLembretes(sock, negocio, fluxo);
  resetarAbandonadas(fluxo);
}

function iniciarChecagemInatividade() {
  return setInterval(() => {
    verificarInatividade().catch((erro) => console.error('Erro ao checar inatividade de clientes:', erro));
  }, INTERVALO_CHECAGEM_MS);
}

module.exports = { verificarInatividade, iniciarChecagemInatividade, MINUTOS_LEMBRETE, MINUTOS_RESET };

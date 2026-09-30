const { db } = require('./db');
const { carregarFluxo } = require('./fluxo');
const { carregarNegocio } = require('./negocio');
const { obterSocket } = require('./socket-atual');
const { encerrarAtendimento } = require('./flow-engine');
const { registrarMensagem, finalizarConversa } = require('./conversas');
const { podeEnviarAutomatico } = require('./modo-teste');

// Atendimento aberto há mais de `fechamento_automatico_horas` (Configurações; padrão 24h, 0
// desliga) é fechado sozinho — com o bot (parado no meio do fluxo), na fila ou com atendente.
// Conta desde `aberta_em` (quando o atendimento atual foi aberto), não desde a última mensagem:
// decisão do Paulo. Manda `mensagem_fechamento_automatico` antes, se tiver texto.
const INTERVALO_CHECAGEM_MS = 60 * 1000;

async function fecharAtendimentosVencidos() {
  const negocio = carregarNegocio();
  const horas = Number(negocio.fechamento_automatico_horas);
  if (!horas) return;

  const fluxo = carregarFluxo();
  const limite = new Date(Date.now() - horas * 3600000).toISOString();
  const vencidas = db
    .prepare(
      `SELECT * FROM conversas WHERE aberta_em IS NOT NULL AND aberta_em <= ?
       AND (status IN ('aguardando', 'atendendo') OR (status = 'bot' AND no_fluxo_atual IS NOT NULL AND no_fluxo_atual != ?))`,
    )
    .all(limite, fluxo.inicio);

  const sock = obterSocket();
  for (const conversa of vencidas) {
    // em modo de teste, número fora da lista é fechado do mesmo jeito, só que em silêncio
    if (sock && negocio.mensagem_fechamento_automatico && podeEnviarAutomatico(conversa.numero)) {
      try {
        await sock.sendMessage(conversa.numero, { text: negocio.mensagem_fechamento_automatico });
        registrarMensagem(conversa.numero, 'bot', negocio.mensagem_fechamento_automatico);
      } catch (erro) {
        console.error(`Falha ao avisar fechamento automático pra ${conversa.numero}:`, erro);
      }
    }
    finalizarConversa(conversa.id);
    encerrarAtendimento(conversa.numero, fluxo); // bot volta a atender normalmente na próxima mensagem
  }
}

function iniciarFechamentoAutomatico() {
  return setInterval(() => {
    fecharAtendimentosVencidos().catch((erro) => console.error('Erro no fechamento automático de atendimentos:', erro));
  }, INTERVALO_CHECAGEM_MS);
}

module.exports = { fecharAtendimentosVencidos, iniciarFechamentoAutomatico };

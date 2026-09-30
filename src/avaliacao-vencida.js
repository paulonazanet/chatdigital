const { registrarMensagem } = require('./conversas');
const { podeEnviarAutomatico } = require('./modo-teste');
const { carregarNegocio } = require('./negocio');
const { obterSocket } = require('./socket-atual');
const { listarAguardandoAvaliacaoVencidos, desligarAguardandoAvaliacao } = require('./flow-engine');

// Cliente que finalizou o atendimento e não respondeu a pesquisa de satisfação dentro do prazo
// (MINUTOS_LIMITE_AVALIACAO, ver flow-engine.js) recebe um aviso automático de encerramento —
// entendemos que ele não quis/não pôde responder, agradecemos e avisamos que ficamos por aqui.
// Roda a cada 1 minuto; "aguardando nota" só existe na memória do processo (não sobrevive a um
// reinício do servidor durante a janela de espera — ver ressalva no RESUMO_SESSAO.md).
const INTERVALO_CHECAGEM_MS = 60 * 1000;

async function verificarAvaliacoesVencidas() {
  const numeros = listarAguardandoAvaliacaoVencidos();
  if (numeros.length === 0) return;

  const negocio = carregarNegocio();
  const sock = obterSocket();

  for (const numero of numeros) {
    if (sock && negocio.mensagem_avaliacao_nao_respondida && podeEnviarAutomatico(numero)) {
      try {
        await sock.sendMessage(numero, { text: negocio.mensagem_avaliacao_nao_respondida });
        registrarMensagem(numero, 'bot', negocio.mensagem_avaliacao_nao_respondida);
      } catch (erro) {
        console.error(`Falha ao avisar avaliação vencida pra ${numero}:`, erro);
      }
    }
    desligarAguardandoAvaliacao(numero);
  }
}

function iniciarChecagemAvaliacaoVencida() {
  return setInterval(() => {
    verificarAvaliacoesVencidas().catch((erro) => console.error('Erro ao checar avaliações vencidas:', erro));
  }, INTERVALO_CHECAGEM_MS);
}

module.exports = { verificarAvaliacoesVencidas, iniciarChecagemAvaliacaoVencida };

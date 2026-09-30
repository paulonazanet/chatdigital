const { db } = require('./db');
const { carregarFluxo } = require('./fluxo');
const { carregarNegocio } = require('./negocio');
const { obterSocket } = require('./socket-atual');
const { encerrarAtendimento, transferirParaHumano } = require('./flow-engine');
const { registrarMensagem, sincronizarConversa } = require('./conversas');
const { podeEnviarAutomatico } = require('./modo-teste');

// Cliente parou no meio de uma pergunta do fluxo (não confirmou nem transferiu pra humano) e
// sumiu: depois de `inatividade_minutos_lembrete` sem responder, manda um lembrete uma única vez;
// se mesmo assim continuar sem responder até `inatividade_minutos_limite` (contados desde que ele
// parou), desiste — e aí, conforme `inatividade_acao` em Configurações, ou volta a conversa pro
// início do fluxo em silêncio ('reiniciar'), ou passa pra fila de um atendente ('transferir').
// Os valores padrão (10 / 30 min, reiniciar) ficam em src/negocio.js.
const MINUTOS_LEMBRETE = 10; // padrões, só pra referência dos testes
const MINUTOS_RESET = 30;
const INTERVALO_CHECAGEM_MS = 60 * 1000;

function isoMinutosAtras(minutos) {
  return new Date(Date.now() - minutos * 60000).toISOString();
}

async function enviar(sock, numero, texto) {
  if (!sock || !texto || !podeEnviarAutomatico(numero)) return;
  try {
    await sock.sendMessage(numero, { text: texto });
    registrarMensagem(numero, 'bot', texto);
  } catch (erro) {
    console.error(`Falha ao enviar mensagem de inatividade para ${numero}:`, erro);
  }
}

async function enviarLembretes(sock, negocio, fluxo) {
  const parados = db
    .prepare(
      `SELECT * FROM conversas WHERE status = 'bot' AND no_fluxo_atual IS NOT NULL AND no_fluxo_atual != ?
       AND lembrete_inatividade_em IS NULL AND atualizado_em <= ?`,
    )
    .all(fluxo.inicio, isoMinutosAtras(negocio.inatividade_minutos_lembrete));

  for (const conversa of parados) {
    await enviar(sock, conversa.numero, negocio.mensagem_inatividade);
    // marca mesmo sem mensagem configurada: é essa marca que conta o tempo até desistir (antes,
    // com a mensagem em branco, a conversa ficava parada pra sempre)
    db.prepare('UPDATE conversas SET lembrete_inatividade_em = ? WHERE id = ?').run(new Date().toISOString(), conversa.id);
  }
}

function nomeDoSetorDaTransferencia(negocio) {
  if (negocio.inatividade_setor_id) {
    const setor = db.prepare('SELECT nome FROM setores WHERE id = ?').get(negocio.inatividade_setor_id);
    if (setor) return setor.nome;
  }
  return 'Geral';
}

async function desistirDasAbandonadas(sock, negocio, fluxo) {
  const minutosDepoisDoLembrete = negocio.inatividade_minutos_limite - negocio.inatividade_minutos_lembrete;
  const abandonadas = db
    .prepare(`SELECT * FROM conversas WHERE status = 'bot' AND lembrete_inatividade_em IS NOT NULL AND lembrete_inatividade_em <= ?`)
    .all(isoMinutosAtras(minutosDepoisDoLembrete));

  for (const conversa of abandonadas) {
    db.prepare('UPDATE conversas SET lembrete_inatividade_em = NULL WHERE id = ?').run(conversa.id);

    if (negocio.inatividade_acao === 'transferir') {
      // mesmo caminho de um nó "transferir" do fluxo: memória do motor + fila + aviso no painel
      transferirParaHumano(conversa.numero, fluxo, nomeDoSetorDaTransferencia(negocio));
      sincronizarConversa(conversa.numero, fluxo);
      await enviar(sock, conversa.numero, negocio.mensagem_inatividade_transferencia);
      continue;
    }

    encerrarAtendimento(conversa.numero, fluxo); // reseta o estado em memória do motor de fluxo
    db.prepare('UPDATE conversas SET no_fluxo_atual = ?, aberta_em = NULL, atualizado_em = ? WHERE id = ?').run(
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
  await desistirDasAbandonadas(sock, negocio, fluxo);
}

function iniciarChecagemInatividade() {
  return setInterval(() => {
    verificarInatividade().catch((erro) => console.error('Erro ao checar inatividade de clientes:', erro));
  }, INTERVALO_CHECAGEM_MS);
}

module.exports = { verificarInatividade, iniciarChecagemInatividade, MINUTOS_LEMBRETE, MINUTOS_RESET };

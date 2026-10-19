const { db } = require('./db');
const envios = require('./envios');
const { regrasDeRecompra } = require('./lembretes');
const { transferirParaHumano, obterEstadoConversa } = require('./flow-engine');
const { carregarNegocio } = require('./negocio');

// O cliente respondeu um envio automático (lembrete de recompra ou campanha). Chamado pelo bot antes
// do fluxo: "SAIR" tira o cliente das mensagens automáticas; responder o lembrete de recompra passa a
// conversa para um atendente (ou segue o bot, conforme Campanhas > Lembretes); a frase-chave de uma
// campanha leva para um atendente ou para um bloco do fluxo (2a parte).

/**
 * Devolve null (segue o fluxo normal) ou { resposta, transferiu, bloco } — `resposta` é o texto pra
 * mandar ao cliente; `transferiu` = a conversa foi pra fila (o bot fica quieto); `bloco` = começar o
 * fluxo neste bloco.
 */
function tratarRespostaAEnvio(numero, texto, { negocio = carregarNegocio(), fluxo, agora = new Date() } = {}) {
  const { registrarNotaInterna } = require('./conversas');
  const conversa = db.prepare('SELECT * FROM conversas WHERE numero = ?').get(numero);
  if (!conversa) return null;
  const resultado = envios.registrarResposta(conversa, texto, agora);
  if (resultado.saiu) {
    registrarNotaInterna(conversa.id, 'O cliente pediu para não receber mais mensagens automáticas (respondeu SAIR).');
    return { resposta: resultado.mensagem };
  }
  if (!resultado.envio) return null;
  if (obterEstadoConversa(numero, fluxo).humano) return null; // já está com atendente: segue normal

  if (resultado.envio.tipo === 'lembrete') {
    const regras = regrasDeRecompra(negocio);
    registrarNotaInterna(conversa.id, '🔁 Respondeu ao lembrete de recompra.');
    if (regras.resposta !== 'atendente') return null;
    transferirParaHumano(numero, fluxo, regras.setor);
    return { transferiu: true };
  }

  if (resultado.envio.tipo === 'campanha') {
    const campanha = db.prepare('SELECT * FROM campanhas WHERE id = ?').get(resultado.envio.referencia_id);
    if (!campanha) return null;
    const { fraseConfere } = require('./campanhas');
    if (!fraseConfere(campanha, texto)) {
      registrarNotaInterna(conversa.id, `📣 Respondeu à campanha "${campanha.nome}".`);
      return null;
    }
    registrarNotaInterna(conversa.id, `📣 Respondeu à campanha "${campanha.nome}" com a frase-chave "${campanha.frase_chave}".`);
    if (campanha.acao_frase === 'bloco' && campanha.bloco_frase && fluxo.nos[campanha.bloco_frase]) return { bloco: campanha.bloco_frase };
    transferirParaHumano(numero, fluxo, campanha.setor_frase || 'Geral');
    return { transferiu: true };
  }
  return null;
}

module.exports = { tratarRespostaAEnvio };

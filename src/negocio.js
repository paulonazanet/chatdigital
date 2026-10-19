const fs = require('fs');
const path = require('path');

function caminhoArquivo() {
  return process.env.CHATDIGITAL_NEGOCIO || path.join(__dirname, '..', 'config', 'negocio.json');
}

// Valores usados quando o negocio.json ainda não tem o campo (instalações de antes dele existir).
const PADROES = {
  fila_minutos_amarelo: 0, // bolinha da fila fica amarela assim que o cliente escreve...
  fila_minutos_vermelho: 10, // ...e vermelha depois de 10 min sem resposta

  // cliente parado no meio do bot (src/inatividade.js): lembrete aos 10 min, desiste aos 30
  inatividade_minutos_lembrete: 10,
  inatividade_minutos_limite: 30,
  inatividade_acao: 'reiniciar', // 'reiniciar' (volta pro início, em silêncio) ou 'transferir'
  inatividade_setor_id: null, // setor que recebe na opção 'transferir' (null = "Geral")
  mensagem_inatividade_transferencia: 'Vou te passar pra alguém da equipe continuar seu atendimento. 🙂',

  // fechamento automático (src/fechamento-automatico.js): horas desde a abertura; 0 desliga
  fechamento_automatico_horas: 24,
  mensagem_fechamento_automatico:
    'Seu atendimento ficou aberto por muito tempo, então estamos encerrando por aqui. Se ainda precisar de algo, é só mandar uma nova mensagem que a gente te atende. 🙂',

  // metas do Relatório (Configurações > Metas), em minutos; 0 = sem meta. meta_nota = média mínima.
  meta_espera_minutos: 0,
  meta_primeira_resposta_minutos: 0,
  meta_duracao_minutos: 0,
  meta_nota: 0,
  reincidencia_dias: 7, // cliente que volta até X dias depois de finalizar conta como reincidência

  // alertas de fila (src/alertas.js, Configurações > Pausas e alertas); 0 desliga
  alerta_fila_minutos: 0, // cliente esperando na fila há mais de X min
  alerta_fila_quantidade: 0, // fila cheia: N clientes ou mais esperando
  alerta_sem_resposta_minutos: 0, // atendente com cliente sem resposta há mais de X min

  // painel ao vivo para TV (/tv/<token>, sem login): null = desligado
  painel_tv_token: null,

  // E3: regras dos envios automáticos (src/envios.js, Campanhas > Regras de envio)
  envio_janelas: ['1,2,3,4,5,6 08:00-19:00'],
  envio_intervalo_min: 45, // segundos entre um envio e outro (sorteado entre min e max)
  envio_intervalo_max: 90,
  envio_limite_dia: 100,
  envio_pular_feriados: true,

  // lembrete de recompra (src/lembretes.js, Campanhas > Lembretes): vem desligado
  recompra_ligado: false,
  recompra_dias: 30,
  recompra_resposta: 'atendente', // 'atendente' (vai pra fila do setor) ou 'bot' (segue o fluxo)
  recompra_setor: 'Geral',
  recompra_usar_media: true, // com 3 compras ou mais, usa a média do cliente
};

function carregarNegocio() {
  return { ...PADROES, ...JSON.parse(fs.readFileSync(caminhoArquivo(), 'utf8')) };
}

/**
 * Atualiza só os campos "de configuração" (textos e dados de contato) do negocio.json, mantendo
 * produtos/faq como estão (essa tela ainda não edita produtos/FAQ — fica pra depois).
 */
function salvarConfiguracoes(campos) {
  // quem escolhe os campos que chegam aqui é src/routes/configuracoes.js; produtos/faq e o que
  // não vier em `campos` ficam como estão no arquivo
  const atualizado = { ...carregarNegocio(), ...campos };
  fs.writeFileSync(caminhoArquivo(), JSON.stringify(atualizado, null, 2) + '\n', 'utf8');
  return atualizado;
}

module.exports = { carregarNegocio, salvarConfiguracoes };

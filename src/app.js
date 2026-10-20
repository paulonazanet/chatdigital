require('dotenv').config();

const { app } = require('./server');
const { carregarNegocio } = require('./negocio');
const { carregarFluxo } = require('./fluxo');
const { iniciarBot } = require('./bot');
const { definirModo, definirCanalOficial } = require('./socket-atual');
const oficial = require('./whatsapp-oficial');
const whatsappStatus = require('./whatsapp-status');
const { restaurarAtendimentosEmAndamento } = require('./conversas');
const { iniciarChecagemInatividade } = require('./inatividade');
const { iniciarBackupDiario } = require('./backup');
const { iniciarRetencaoDiaria } = require('./retencao');
const { iniciarChecagemAvaliacaoVencida } = require('./avaliacao-vencida');
const { iniciarFechamentoAutomatico } = require('./fechamento-automatico');
const { iniciarChecagemAlertas } = require('./alertas');
const { iniciarFilaDeEnvios } = require('./envios');
const { iniciarLembretesDeRecompra } = require('./lembretes');
const { iniciarRetornos } = require('./retornos');
const { livroDeAtendimentosVazio, reconstruirAtendimentosAntigos } = require('./atendimentos');
const { MENSAGEM_ENCERRAMENTO_PADRAO } = require('./routes/fila');

async function iniciar() {
  const negocio = carregarNegocio();
  const fluxo = carregarFluxo();
  if (process.env.NUMERO_ATENDENTE) {
    negocio.numero_atendente_legivel = process.env.NUMERO_ATENDENTE;
  }

  const porta = process.env.PORTA || 3000;
  // HOST=127.0.0.1 no servidor: só o Caddy (na mesma máquina) acessa; sem HOST, escuta em tudo
  const host = process.env.HOST || '0.0.0.0';
  app.listen(porta, host, () => console.log(`Painel do ChatDigital em http://${host === '0.0.0.0' ? 'localhost' : host}:${porta}`));

  // 1o boot com o Relatório (livro vazio): monta os atendimentos de antes pelas mensagens
  if (livroDeAtendimentosVazio()) {
    const reconstruidos = reconstruirAtendimentosAntigos({
      textosFinalizacao: [negocio.mensagem_encerramento, MENSAGEM_ENCERRAMENTO_PADRAO, negocio.pesquisa_satisfacao],
      textosFechamentoAutomatico: [negocio.mensagem_fechamento_automatico],
      horasLimite: negocio.fechamento_automatico_horas,
    });
    console.log(`Relatório: ${reconstruidos} atendimento(s) antigo(s) reconstruído(s) a partir das mensagens.`);
  }

  const restauradas = restaurarAtendimentosEmAndamento(fluxo);
  if (restauradas) console.log(`${restauradas} conversa(s) com atendente restaurada(s) — o bot continua em silêncio com elas.`);

  // conexão escolhida em Configurações > WhatsApp: celular (QR Code) ou API oficial da Meta
  if (negocio.whatsapp_conexao === 'oficial') {
    definirModo('oficial');
    definirCanalOficial(oficial.criarAdaptador());
    const teste = await oficial.testarConexao();
    if (teste.ok) whatsappStatus.definirConectado();
    else whatsappStatus.definirDesconectado();
    console.log(teste.ok ? `API oficial do WhatsApp ligada (${teste.numero}).` : `API oficial do WhatsApp com problema: ${teste.erro}`);
  } else {
    // todos os números ligados (Configurações > WhatsApp; E4, 3a parte), e o jeito de ligar um novo
    // sem reiniciar
    const { listarCanais } = require('./canais');
    const { definirIniciadorDeCanal } = require('./socket-atual');
    definirIniciadorDeCanal((canal) => iniciarBot(negocio, fluxo, canal));
    for (const canal of listarCanais({ soAtivos: true })) await iniciarBot(negocio, fluxo, canal);
  }
  iniciarChecagemInatividade();
  iniciarBackupDiario();
  iniciarRetencaoDiaria();
  iniciarChecagemAvaliacaoVencida();
  iniciarFechamentoAutomatico();
  iniciarChecagemAlertas();
  iniciarFilaDeEnvios();
  iniciarLembretesDeRecompra();
  iniciarRetornos();
}

iniciar().catch((erro) => {
  console.error('Erro ao iniciar o ChatDigital:', erro);
  process.exit(1);
});

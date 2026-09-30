require('dotenv').config();

const { app } = require('./server');
const { carregarNegocio } = require('./negocio');
const { carregarFluxo } = require('./fluxo');
const { iniciarBot } = require('./bot');
const { restaurarAtendimentosEmAndamento } = require('./conversas');
const { iniciarChecagemInatividade } = require('./inatividade');
const { iniciarBackupDiario } = require('./backup');
const { iniciarRetencaoDiaria } = require('./retencao');
const { iniciarChecagemAvaliacaoVencida } = require('./avaliacao-vencida');
const { iniciarFechamentoAutomatico } = require('./fechamento-automatico');

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

  const restauradas = restaurarAtendimentosEmAndamento(fluxo);
  if (restauradas) console.log(`${restauradas} conversa(s) com atendente restaurada(s) — o bot continua em silêncio com elas.`);

  await iniciarBot(negocio, fluxo);
  iniciarChecagemInatividade();
  iniciarBackupDiario();
  iniciarRetencaoDiaria();
  iniciarChecagemAvaliacaoVencida();
  iniciarFechamentoAutomatico();
}

iniciar().catch((erro) => {
  console.error('Erro ao iniciar o ChatDigital:', erro);
  process.exit(1);
});

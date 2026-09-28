require('dotenv').config();

const { app } = require('./server');
const { carregarNegocio } = require('./negocio');
const { carregarFluxo } = require('./fluxo');
const { iniciarBot } = require('./bot');
const { iniciarChecagemInatividade } = require('./inatividade');

async function iniciar() {
  const negocio = carregarNegocio();
  const fluxo = carregarFluxo();
  if (process.env.NUMERO_ATENDENTE) {
    negocio.numero_atendente_legivel = process.env.NUMERO_ATENDENTE;
  }

  const porta = process.env.PORTA || 3000;
  app.listen(porta, () => console.log(`Painel do ChatDigital em http://localhost:${porta}`));

  await iniciarBot(negocio, fluxo);
  iniciarChecagemInatividade();
}

iniciar().catch((erro) => {
  console.error('Erro ao iniciar o ChatDigital:', erro);
  process.exit(1);
});

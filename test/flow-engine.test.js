const assert = require('assert');
const { processarMensagem, estaDentroDoHorario } = require('../src/flow-engine');
const { carregarFluxo } = require('../src/fluxo');

const negocio = {
  nome: 'Loja Exemplo',
  formas_pagamento: ['Dinheiro', 'Pix', 'Cartão na entrega'],
  numero_atendente_legivel: '(11) 90000-0000',
  produtos: [
    { id: 'p13', nome: 'Botijão 13kg', preco: 120 },
    { id: 'p45', nome: 'Botijão 45kg', preco: null },
  ],
  faq: [
    { pergunta: 'qual o preço do gás', resposta: 'R$ 120 o botijão de 13kg.' },
    { pergunta: 'vocês entregam', resposta: 'Sim, entregamos no mesmo dia.' },
  ],
};

async function enviar(numero, texto, fluxo) {
  return processarMensagem({ numero, texto, negocio, fluxo });
}

async function testarFluxoDePedidoCompleto() {
  const fluxo = carregarFluxo();
  const numero = 'cliente-pedido';

  let resp = await enviar(numero, 'oi', fluxo);
  assert.match(resp, /Loja Exemplo/);
  assert.match(resp, /1\. Fazer um pedido/);

  resp = await enviar(numero, '1', fluxo);
  assert.match(resp, /Qual produto você quer\?/);
  assert.match(resp, /1\. Botijão 13kg - R\$ 120/);
  assert.match(resp, /2\. Botijão 45kg\n/); // sem preço, sem "- R$"
  assert.match(resp, /0\. Voltar ao menu/);

  resp = await enviar(numero, 'x', fluxo);
  assert.match(resp, /Não entendi/);

  resp = await enviar(numero, '1', fluxo);
  assert.match(resp, /endereço de entrega/);

  resp = await enviar(numero, 'Rua das Flores, 123', fluxo);
  assert.match(resp, /pagamento\? \(Dinheiro, Pix, Cartão na entrega\)/);

  resp = await enviar(numero, 'Pix', fluxo);
  assert.match(resp, /Produto: Botijão 13kg/);
  assert.match(resp, /Endereço: Rua das Flores, 123/);
  assert.match(resp, /Pagamento: Pix/);

  resp = await enviar(numero, '1', fluxo);
  assert.match(resp, /Pedido registrado/);

  // depois do fim, qualquer mensagem reabre o menu
  resp = await enviar(numero, 'obrigado', fluxo);
  assert.match(resp, /1\. Fazer um pedido/);

  console.log('OK: fluxo de pedido completo');
}

async function testarVoltarAoMenuDentroDoPedido() {
  const fluxo = carregarFluxo();
  const numero = 'cliente-voltar';

  await enviar(numero, 'menu', fluxo);
  await enviar(numero, '1', fluxo);
  const resp = await enviar(numero, '0', fluxo);
  assert.match(resp, /1\. Fazer um pedido/);

  console.log('OK: opção 0 volta ao menu durante o pedido');
}

async function testarFaq() {
  const fluxo = carregarFluxo();
  const numero = 'cliente-faq';

  await enviar(numero, 'menu', fluxo);
  let resp = await enviar(numero, '2', fluxo);
  assert.match(resp, /qual o preço do gás/);
  assert.match(resp, /R\$ 120 o botijão de 13kg/);
  assert.match(resp, /0\. Voltar ao menu/);

  resp = await enviar(numero, '0', fluxo);
  assert.match(resp, /1\. Fazer um pedido/);

  console.log('OK: FAQ lista perguntas dinamicamente e volta ao menu');
}

async function testarTransferenciaParaAtendente() {
  const fluxo = carregarFluxo();
  const numero = 'cliente-atendente';

  await enviar(numero, 'menu', fluxo);
  let resp = await enviar(numero, '3', fluxo);
  assert.match(resp, /atendente humano/);
  assert.match(resp, /\(11\) 90000-0000/);

  resp = await enviar(numero, 'estou com um problema', fluxo);
  assert.strictEqual(resp, null, 'bot deve ficar em silêncio após transferir');

  resp = await enviar(numero, 'menu', fluxo);
  assert.match(resp, /1\. Fazer um pedido/, '"menu" deve retomar o bot mesmo transferido');

  console.log('OK: transferência para atendente silencia o bot e "menu" retoma');
}

async function testarOpcaoDeTextoIgnoraMaiusculaMinuscula() {
  const fluxo = {
    inicio: 'pergunta',
    nos: {
      pergunta: {
        tipo: 'pergunta',
        texto: 'Confirma o pedido? (sim/não)',
        opcoes: [
          { quando: 'sim', proximo: 'fim' },
          { quando: 'não', proximo: 'fim' },
        ],
      },
      fim: { tipo: 'fim', texto: 'Combinado!' },
    },
  };
  const numero = 'cliente-sim-nao';

  await enviar(numero, 'oi', fluxo); // entra no fluxo, cai na pergunta
  const resp = await enviar(numero, 'Sim', fluxo); // maiúscula de propósito
  assert.match(resp, /Combinado/, 'deve aceitar "Sim" como equivalente a "sim"');

  console.log('OK: opção de texto (sim/não) ignora maiúscula/minúscula');
}

async function testarBlocoHorario() {
  const fluxo = {
    inicio: 'checagem',
    nos: {
      checagem: { tipo: 'horario', janelas: ['1,2,3,4,5 08:00-18:00', '6 08:00-12:00'], dentro: 'aberto', fora: 'fechado' },
      aberto: { tipo: 'fim', texto: 'Estamos abertos!' },
      fechado: { tipo: 'fim', texto: 'Estamos fechados agora.' },
    },
  };

  // segunda-feira (1) às 10:00 -> dentro da janela
  assert.strictEqual(estaDentroDoHorario(fluxo.nos.checagem, new Date(2026, 8, 28, 10, 0)), true);
  // segunda-feira às 19:00 -> fora
  assert.strictEqual(estaDentroDoHorario(fluxo.nos.checagem, new Date(2026, 8, 28, 19, 0)), false);
  // domingo (0) -> não tem janela nenhuma pro domingo
  assert.strictEqual(estaDentroDoHorario(fluxo.nos.checagem, new Date(2026, 8, 27, 10, 0)), false);
  // sábado (6) às 10:00 -> dentro da janela de sábado
  assert.strictEqual(estaDentroDoHorario(fluxo.nos.checagem, new Date(2026, 8, 26, 10, 0)), true);
  // sábado às 13:00 -> fora do horário de sábado
  assert.strictEqual(estaDentroDoHorario(fluxo.nos.checagem, new Date(2026, 8, 26, 13, 0)), false);

  const numero = 'cliente-horario';
  const resp = await processarMensagem({ numero, texto: 'oi', negocio: {}, fluxo });
  assert.match(resp, /Estamos (abertos|fechados)/, 'deve seguir pro ramo dentro ou fora conforme o horário real');

  console.log('OK: bloco "Horário" segue o ramo certo conforme dia/hora');
}

async function main() {
  await testarFluxoDePedidoCompleto();
  await testarVoltarAoMenuDentroDoPedido();
  await testarFaq();
  await testarTransferenciaParaAtendente();
  await testarOpcaoDeTextoIgnoraMaiusculaMinuscula();
  await testarBlocoHorario();
  console.log('\nTodos os testes do motor de fluxo passaram.');
}

main().catch((erro) => {
  console.error('FALHA:', erro);
  process.exit(1);
});

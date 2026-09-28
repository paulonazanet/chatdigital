const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-fila-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.SESSION_SECRET = 'segredo-de-teste';

const { app } = require('../src/server');
const { processarMensagem } = require('../src/flow-engine');
const { registrarMensagem, sincronizarConversa, listarFila } = require('../src/conversas');
const { carregarFluxo } = require('../src/fluxo');
const { definirSocket } = require('../src/socket-atual');

const negocio = {
  nome: 'Loja Exemplo',
  numero_atendente_legivel: '(11) 90000-0000',
  formas_pagamento: ['Pix'],
  produtos: [{ id: 'p13', nome: 'Botijão 13kg', preco: 120 }],
  faq: [],
};
fs.writeFileSync(
  process.env.CHATDIGITAL_NEGOCIO,
  JSON.stringify({
    ...negocio,
    mensagem_boas_vindas_atendente: 'Oi! Aqui é {{atendente.nome}}, vou te ajudar agora.',
    mensagem_encerramento: 'Fechado por aqui, valeu!',
    pesquisa_satisfacao: 'De 0 a 10, como foi o atendimento?',
  }),
);
const fluxo = carregarFluxo();

let servidor;
let baseUrl;

function extrairCookie(resposta) {
  const bruto = resposta.headers.get('set-cookie');
  if (!bruto) return null;
  return bruto.split(';')[0];
}

// Simula o que src/bot.js faz a cada mensagem recebida do WhatsApp, sem precisar de conexão real.
async function simularMensagemDoCliente(numero, texto) {
  registrarMensagem(numero, 'cliente', texto);
  const resposta = await processarMensagem({ numero, texto, negocio, fluxo });
  sincronizarConversa(numero, fluxo);
  if (resposta) registrarMensagem(numero, 'bot', resposta);
  return resposta;
}

before(async () => {
  await new Promise((resolve) => {
    servidor = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${servidor.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => servidor.close(resolve));
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('conversa transferida para atendente aparece na fila com o setor certo, e assumir/finalizar funcionam', async () => {
  const numero = '5511999998888@s.whatsapp.net';
  await simularMensagemDoCliente(numero, 'oi');
  await simularMensagemDoCliente(numero, '3'); // "Falar com um atendente" no fluxo da Loja Exemplo

  let resp = await fetch(`${baseUrl}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nome: 'Paulo Admin', email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  const cookieAdmin = extrairCookie(resp);
  assert.ok(cookieAdmin);

  resp = await fetch(`${baseUrl}/painel/fila`, { headers: { cookie: cookieAdmin } });
  let corpo = await resp.text();
  assert.match(corpo, /5511999998888/);
  assert.match(corpo, /Geral/, 'deve casar com o setor "geral" do fluxo, seedado como "Geral" no banco');
  assert.match(corpo, /Aguardando/);

  const idConversa = /\/painel\/fila\/(\d+)/.exec(corpo)[1];

  resp = await fetch(`${baseUrl}/painel/fila/${idConversa}`, { headers: { cookie: cookieAdmin } });
  corpo = await resp.text();
  assert.match(corpo, /atendente humano/, 'histórico deve conter a mensagem de transferência do bot');

  // socket falso pra verificar as mensagens automáticas (boas-vindas/encerramento/pesquisa)
  const mensagensEnviadas = [];
  definirSocket({
    sendMessage: async (numero, msg) => {
      mensagensEnviadas.push({ numero, texto: msg.text });
    },
  });

  resp = await fetch(`${baseUrl}/painel/fila/${idConversa}/assumir`, {
    method: 'POST',
    headers: { cookie: cookieAdmin },
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 302);
  assert.strictEqual(mensagensEnviadas.length, 1);
  assert.strictEqual(
    mensagensEnviadas[0].texto,
    'Oi! Aqui é Paulo Admin, vou te ajudar agora.',
    'boas-vindas do atendente deve interpolar {{atendente.nome}}',
  );

  resp = await fetch(`${baseUrl}/painel/fila/${idConversa}`, { headers: { cookie: cookieAdmin } });
  corpo = await resp.text();
  assert.match(corpo, /Paulo Admin/, 'atendente que assumiu deve aparecer no detalhe');
  assert.match(corpo, /atendendo/);
  assert.match(corpo, /<textarea name="texto"/, 'conversa assumida deve mostrar o formulário de resposta');

  // sem o bot conectado (não há WhatsApp real neste teste), responder deve falhar com aviso claro,
  // não travar nem enviar silenciosamente
  definirSocket(null);
  resp = await fetch(`${baseUrl}/painel/fila/${idConversa}/responder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieAdmin },
    body: new URLSearchParams({ texto: 'Já estou verificando seu pedido' }),
  });
  corpo = await resp.text();
  assert.match(corpo, /não está conectado ao WhatsApp/);

  mensagensEnviadas.length = 0;
  definirSocket({
    sendMessage: async (numero, msg) => {
      mensagensEnviadas.push({ numero, texto: msg.text });
    },
  });
  resp = await fetch(`${baseUrl}/painel/fila/${idConversa}/finalizar`, {
    method: 'POST',
    headers: { cookie: cookieAdmin },
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 302);
  assert.deepStrictEqual(
    mensagensEnviadas.map((m) => m.texto),
    ['Fechado por aqui, valeu!', 'De 0 a 10, como foi o atendimento?'],
    'finalizar deve mandar a mensagem de encerramento configurável seguida da pesquisa de satisfação',
  );
  definirSocket(null);

  resp = await fetch(`${baseUrl}/painel/fila`, { headers: { cookie: cookieAdmin } });
  corpo = await resp.text();
  assert.doesNotMatch(corpo, /5511999998888/, 'conversa finalizada não deve mais aparecer na fila');

  // regressão: finalizar tem que devolver o controle pro bot, não deixar o cliente em silêncio
  const respostaPosFinalizar = await simularMensagemDoCliente(numero, 'oi');
  assert.match(respostaPosFinalizar, /Loja Exemplo/, 'bot deve voltar a responder normalmente após finalizar');

  console.log('OK: conversa transferida entra na fila, assumir/finalizar funcionam, e finalizar devolve o controle pro bot');
});

test('conversa que ainda está com o bot não aparece na fila', async () => {
  const numero = '5511977776666@s.whatsapp.net';
  await simularMensagemDoCliente(numero, 'oi'); // só mostra o menu, não transfere pra ninguém

  const fila = listarFila();
  assert.ok(!fila.some((c) => c.numero === numero));

  console.log('OK: conversa ainda em atendimento automático não entra na fila');
});

const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-avancado-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.SESSION_SECRET = 'segredo-de-teste';

fs.writeFileSync(
  process.env.CHATDIGITAL_NEGOCIO,
  JSON.stringify({
    nome: 'Loja Exemplo',
    numero_atendente_legivel: '(11) 90000-0000',
    formas_pagamento: ['Pix'],
    produtos: [],
    faq: [],
    mensagem_sem_atendente_disponivel: 'No momento não temos ninguém disponível.',
    mensagem_inatividade: 'Ainda por aí?',
  }),
);

const { db } = require('../src/db');
const { carregarNegocio } = require('../src/negocio');
const { carregarFluxo } = require('../src/fluxo');
const { processarMensagem, obterEstadoConversa } = require('../src/flow-engine');
const { registrarMensagem, sincronizarConversa, listarMensagens, obterOuCriarConversa } = require('../src/conversas');
const { criarAtendente, definirSetoresDoAtendente } = require('../src/atendentes');
const { criarSetor, listarSetores } = require('../src/setores');
const presenca = require('../src/presenca');
const { definirSocket } = require('../src/socket-atual');
const { verificarInatividade, MINUTOS_LEMBRETE, MINUTOS_RESET } = require('../src/inatividade');

const negocio = carregarNegocio();
const fluxo = carregarFluxo();

after(() => {
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

async function simularMensagemDoCliente(numero, texto) {
  registrarMensagem(numero, 'cliente', texto);
  const resposta = await processarMensagem({ numero, texto, negocio, fluxo });
  const sincronizacao = sincronizarConversa(numero, fluxo);
  if (resposta) registrarMensagem(numero, 'bot', resposta);
  return { resposta, sincronizacao };
}

test('transferência avisa "sem atendente disponível" só quando ninguém do setor está online', async () => {
  const geral = listarSetores().find((s) => s.nome === 'Geral');
  const atendente = criarAtendente({
    nome: 'Carlos',
    email: 'carlos@teste.com',
    senha: '123456',
    papel: 'atendente',
    permissoes: ['responder_conversas', 'finalizar_conversas'],
  });
  definirSetoresDoAtendente(atendente.id, [geral.id]);

  // ninguém online ainda -> avisa
  const numero1 = '5511900000001@s.whatsapp.net';
  await simularMensagemDoCliente(numero1, 'oi');
  const { sincronizacao: s1 } = await simularMensagemDoCliente(numero1, '3'); // opção "falar com atendente"
  assert.strictEqual(s1.semAtendenteDisponivel, true, 'sem ninguém online no setor, deve sinalizar que precisa avisar');

  // Carlos fica online (conecta o SSE do painel dele)
  presenca.conectou(atendente.id);

  const numero2 = '5511900000002@s.whatsapp.net';
  await simularMensagemDoCliente(numero2, 'oi');
  const { sincronizacao: s2 } = await simularMensagemDoCliente(numero2, '3');
  assert.strictEqual(s2.semAtendenteDisponivel, false, 'com Carlos online no setor, não deve avisar');

  presenca.desconectou(atendente.id);

  console.log('OK: aviso de "sem atendente disponível" reflete quem está online no setor certo');
});

test('inatividade: lembrete único depois de parar no fluxo, e reset silencioso depois de tempo demais', async () => {
  const numero = '5511900000099@s.whatsapp.net';
  await simularMensagemDoCliente(numero, 'oi'); // fica esperando resposta no menu -> "parado no fluxo"

  const conversa = obterOuCriarConversa(numero);
  assert.ok(conversa.no_fluxo_atual && conversa.no_fluxo_atual !== fluxo.inicio);

  // envelhece a conversa artificialmente pra parecer que o cliente sumiu há MINUTOS_LEMBRETE
  const haLembrete = new Date(Date.now() - (MINUTOS_LEMBRETE + 1) * 60000).toISOString();
  db.prepare('UPDATE conversas SET atualizado_em = ? WHERE id = ?').run(haLembrete, conversa.id);

  const mensagensEnviadas = [];
  definirSocket({ sendMessage: async (numero, msg) => mensagensEnviadas.push({ numero, texto: msg.text }) });

  await verificarInatividade();

  let atualizada = obterOuCriarConversa(numero);
  assert.ok(atualizada.lembrete_inatividade_em, 'deve ter marcado que o lembrete foi enviado');
  assert.deepStrictEqual(mensagensEnviadas, [{ numero, texto: 'Ainda por aí?' }], 'deve ter mandado o lembrete pelo WhatsApp');
  const mensagens = listarMensagens(conversa.id);
  assert.ok(mensagens.some((m) => m.remetente === 'bot' && m.texto === 'Ainda por aí?'), 'deve ter registrado o lembrete enviado');

  // rodar de novo não deve duplicar o lembrete
  const totalAntes = listarMensagens(conversa.id).length;
  await verificarInatividade();
  assert.strictEqual(listarMensagens(conversa.id).length, totalAntes, 'não deve mandar o lembrete duas vezes');

  // envelhece o lembrete além do total de MINUTOS_RESET -> deve resetar silenciosamente
  const passouDoReset = new Date(Date.now() - (MINUTOS_RESET - MINUTOS_LEMBRETE + 1) * 60000).toISOString();
  db.prepare('UPDATE conversas SET lembrete_inatividade_em = ? WHERE id = ?').run(passouDoReset, conversa.id);

  await verificarInatividade();

  atualizada = obterOuCriarConversa(numero);
  assert.strictEqual(atualizada.no_fluxo_atual, fluxo.inicio, 'deve ter resetado a conversa pro início do fluxo');
  assert.strictEqual(atualizada.lembrete_inatividade_em, null, 'lembrete deve ter sido limpo depois do reset');
  assert.strictEqual(obterEstadoConversa(numero, fluxo).no, fluxo.inicio, 'estado em memória do motor de fluxo também deve ter voltado ao início');

  // cliente responder de novo deve funcionar normalmente (não ficou travado)
  const { resposta } = await simularMensagemDoCliente(numero, 'oi');
  assert.match(resposta, /Loja Exemplo|1\./, 'bot deve responder normalmente depois do reset por inatividade');

  definirSocket(null);
  console.log('OK: inatividade manda lembrete uma vez e reseta a conversa depois de tempo demais sem resposta');
});

test('cliente responder antes do lembrete cancela o lembrete pendente (não reseta à toa)', async () => {
  const numero = '5511900000088@s.whatsapp.net';
  await simularMensagemDoCliente(numero, 'oi');

  const conversa = obterOuCriarConversa(numero);
  db.prepare('UPDATE conversas SET lembrete_inatividade_em = ? WHERE id = ?').run(new Date().toISOString(), conversa.id);

  await simularMensagemDoCliente(numero, '1'); // cliente responde -> deve limpar o lembrete pendente

  const atualizada = obterOuCriarConversa(numero);
  assert.strictEqual(atualizada.lembrete_inatividade_em, null, 'responder deve cancelar o lembrete pendente');

  console.log('OK: cliente responder cancela o lembrete de inatividade pendente');
});

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
    mensagem_avaliacao_nao_respondida: 'Entendemos que não deu pra responder, até logo!',
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
const { aguardarAvaliacao, MINUTOS_LIMITE_AVALIACAO } = require('../src/flow-engine');
const { verificarAvaliacoesVencidas } = require('../src/avaliacao-vencida');

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

test('avaliação vencida: manda o aviso de encerramento automático uma vez, e desliga sem mandar de novo', async () => {
  const numero = '5511900000077@s.whatsapp.net';
  await simularMensagemDoCliente(numero, 'oi'); // só pra existir um estado no motor de fluxo

  aguardarAvaliacao(numero, fluxo);
  obterEstadoConversa(numero, fluxo).aguardandoAvaliacaoDesde = Date.now() - (MINUTOS_LIMITE_AVALIACAO + 1) * 60000;

  const mensagensEnviadas = [];
  definirSocket({ sendMessage: async (numero, msg) => mensagensEnviadas.push({ numero, texto: msg.text }) });

  await verificarAvaliacoesVencidas();

  assert.deepStrictEqual(
    mensagensEnviadas,
    [{ numero, texto: 'Entendemos que não deu pra responder, até logo!' }],
    'deve mandar o aviso de encerramento automático pelo WhatsApp',
  );
  const conversa = obterOuCriarConversa(numero);
  const mensagens = listarMensagens(conversa.id);
  assert.ok(
    mensagens.some((m) => m.remetente === 'bot' && m.texto === 'Entendemos que não deu pra responder, até logo!'),
    'deve ter registrado o aviso no histórico',
  );

  // rodar de novo não deve mandar duas vezes (já foi desligado)
  await verificarAvaliacoesVencidas();
  assert.strictEqual(mensagensEnviadas.length, 1, 'não deve mandar o aviso duas vezes');

  // cliente escrever depois disso é atendimento normal, não "obrigado pela nota"
  const { resposta } = await simularMensagemDoCliente(numero, 'oi de novo');
  assert.match(resposta, /Loja Exemplo|1\./, 'depois do aviso automático, volta a ser atendimento normal');

  definirSocket(null);
  console.log('OK: avaliação vencida manda o aviso de encerramento uma vez e não trava a conversa');
});

test('inatividade configurável: tempos de Configurações, lembrete em branco ainda conta, e "transferir" manda pra fila do setor escolhido', async () => {
  const { salvarConfiguracoes } = require('../src/negocio');
  const suporte = criarSetor('Suporte Inatividade');
  salvarConfiguracoes({
    inatividade_minutos_lembrete: 5,
    inatividade_minutos_limite: 15,
    mensagem_inatividade: '', // sem lembrete — antes disso a conversa ficava parada pra sempre
    inatividade_acao: 'transferir',
    inatividade_setor_id: suporte.id,
    mensagem_inatividade_transferencia: 'Vou te passar pra equipe.',
  });

  const numero = '5511900000077@s.whatsapp.net';
  await simularMensagemDoCliente(numero, 'oi'); // para no menu
  const conversa = obterOuCriarConversa(numero);
  const minutosAtras = (m) => new Date(Date.now() - m * 60000).toISOString();

  const mensagensEnviadas = [];
  definirSocket({ sendMessage: async (n, msg) => mensagensEnviadas.push({ numero: n, texto: msg.text }) });

  db.prepare('UPDATE conversas SET atualizado_em = ? WHERE id = ?').run(minutosAtras(4), conversa.id);
  await verificarInatividade();
  assert.strictEqual(obterOuCriarConversa(numero).lembrete_inatividade_em, null, '4 min: ainda não passou dos 5 configurados');

  db.prepare('UPDATE conversas SET atualizado_em = ? WHERE id = ?').run(minutosAtras(6), conversa.id);
  await verificarInatividade();
  assert.ok(obterOuCriarConversa(numero).lembrete_inatividade_em, '6 min: marca o lembrete mesmo sem mensagem configurada');
  assert.deepStrictEqual(mensagensEnviadas, [], 'mensagem em branco = não manda nada');

  db.prepare('UPDATE conversas SET lembrete_inatividade_em = ? WHERE id = ?').run(minutosAtras(11), conversa.id);
  await verificarInatividade();
  const transferida = obterOuCriarConversa(numero);
  assert.strictEqual(transferida.status, 'aguardando', 'desistiu: vai pra "Na fila"');
  assert.strictEqual(transferida.setor_id, suporte.id, 'no setor escolhido em Configurações');
  assert.deepStrictEqual(mensagensEnviadas, [{ numero, texto: 'Vou te passar pra equipe.' }]);
  const { resposta } = await simularMensagemDoCliente(numero, 'voltei');
  assert.strictEqual(resposta, null, 'com atendente, o bot fica em silêncio');

  definirSocket(null);
  salvarConfiguracoes({ inatividade_acao: 'reiniciar', inatividade_minutos_lembrete: 10, inatividade_minutos_limite: 30, mensagem_inatividade: 'Ainda por aí?' });
  console.log('OK: inatividade usa os tempos de Configurações e "transferir" manda pra fila do setor escolhido');
});

test('fechamento automático: fecha o atendimento aberto há mais das horas configuradas, contando da abertura', async () => {
  const { fecharAtendimentosVencidos } = require('../src/fechamento-automatico');
  const { salvarConfiguracoes } = require('../src/negocio');
  const { assumirConversa } = require('../src/conversas');
  const horasAtras = (h) => new Date(Date.now() - h * 3600000).toISOString();

  // abertura: a 1a mensagem do cliente marca aberta_em; mensagem do bot não mexe
  const antigo = '5511900000066@s.whatsapp.net';
  await simularMensagemDoCliente(antigo, 'oi');
  await simularMensagemDoCliente(antigo, '3'); // pede atendente
  const conversaAntiga = obterOuCriarConversa(antigo);
  assert.ok(conversaAntiga.aberta_em, 'mensagem do cliente abre o atendimento');
  assumirConversa(conversaAntiga.id, null);
  // aberto há 25h, mas com mensagem recente — conta da abertura (decisão do Paulo), fecha mesmo assim
  db.prepare('UPDATE conversas SET aberta_em = ?, atualizado_em = ? WHERE id = ?').run(horasAtras(25), new Date().toISOString(), conversaAntiga.id);

  const recente = '5511900000055@s.whatsapp.net';
  await simularMensagemDoCliente(recente, 'oi');
  await simularMensagemDoCliente(recente, '3');
  db.prepare('UPDATE conversas SET aberta_em = ? WHERE numero = ?').run(horasAtras(2), recente);

  const mensagensEnviadas = [];
  definirSocket({ sendMessage: async (n, msg) => mensagensEnviadas.push({ numero: n, texto: msg.text }) });

  salvarConfiguracoes({ fechamento_automatico_horas: 0 });
  await fecharAtendimentosVencidos();
  assert.strictEqual(obterOuCriarConversa(antigo).status, 'atendendo', '0 horas = desligado');

  salvarConfiguracoes({ fechamento_automatico_horas: 24, mensagem_fechamento_automatico: 'Encerrando por aqui.' });
  await fecharAtendimentosVencidos();
  const fechada = obterOuCriarConversa(antigo);
  assert.strictEqual(fechada.status, 'finalizado', 'aberto há 25h: fecha');
  assert.strictEqual(fechada.aberta_em, null, 'fechar zera a abertura');
  assert.strictEqual(obterOuCriarConversa(recente).status, 'aguardando', 'aberto há 2h: continua');
  assert.deepStrictEqual(mensagensEnviadas, [{ numero: antigo, texto: 'Encerrando por aqui.' }]);

  // cliente volta depois: abre um atendimento novo, com o bot respondendo normal
  const { resposta } = await simularMensagemDoCliente(antigo, 'oi de novo');
  assert.match(resposta, /Loja Exemplo|1\./, 'depois do fechamento automático o bot atende normalmente');
  assert.ok(obterOuCriarConversa(antigo).aberta_em, 'nova mensagem abre um novo atendimento');

  definirSocket(null);
  console.log('OK: fechamento automático fecha por tempo desde a abertura, respeita o "0 desliga" e manda a mensagem');
});

test('modo de teste (NUMEROS_TESTE) também vale pras mensagens automáticas: fora da lista fecha em silêncio', async () => {
  const { fecharAtendimentosVencidos } = require('../src/fechamento-automatico');
  const { salvarConfiguracoes } = require('../src/negocio');
  const horasAtras = (h) => new Date(Date.now() - h * 3600000).toISOString();

  const daLista = '5511900000044@s.whatsapp.net';
  const deFora = '999000000000044@lid'; // @lid: vale o número guardado em numero_exibicao
  for (const numero of [daLista, deFora]) {
    await simularMensagemDoCliente(numero, 'oi');
    await simularMensagemDoCliente(numero, '3');
    db.prepare('UPDATE conversas SET aberta_em = ? WHERE numero = ?').run(horasAtras(30), numero);
  }
  db.prepare('UPDATE conversas SET numero_exibicao = ? WHERE numero = ?').run('5511911112222', deFora);

  const mensagensEnviadas = [];
  definirSocket({ sendMessage: async (n, msg) => mensagensEnviadas.push({ numero: n, texto: msg.text }) });
  salvarConfiguracoes({ fechamento_automatico_horas: 24, mensagem_fechamento_automatico: 'Encerrando por aqui.' });
  const antes = process.env.NUMEROS_TESTE;
  process.env.NUMEROS_TESTE = '5511900000044';
  try {
    await fecharAtendimentosVencidos();
  } finally {
    if (antes === undefined) delete process.env.NUMEROS_TESTE;
    else process.env.NUMEROS_TESTE = antes;
    definirSocket(null);
  }

  assert.deepStrictEqual(mensagensEnviadas.map((m) => m.numero), [daLista], 'só o número da lista de teste recebe a mensagem automática');
  assert.strictEqual(obterOuCriarConversa(deFora).status, 'finalizado', 'o de fora é fechado do mesmo jeito, só que em silêncio');

  console.log('OK: modo de teste bloqueia mensagem automática pra quem não está na lista, sem travar o fechamento');
});

const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-relatorio-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.SESSION_SECRET = 'segredo-de-teste';

const negocio = { nome: 'Loja Exemplo', formas_pagamento: ['Pix'], produtos: [], faq: [] };
fs.writeFileSync(
  process.env.CHATDIGITAL_NEGOCIO,
  JSON.stringify({ ...negocio, mensagem_encerramento: 'Fechado por aqui, valeu!', pesquisa_satisfacao: 'De 0 a 10, quanto você recomendaria a Loja?' }),
);

const { app } = require('../src/server');
const { db } = require('../src/db');
const { processarMensagem } = require('../src/flow-engine');
const { registrarMensagem, sincronizarConversa, obterOuCriarConversa } = require('../src/conversas');
const { carregarFluxo } = require('../src/fluxo');
const { definirSocket } = require('../src/socket-atual');
const { lerNota, reconstruirAtendimentosAntigos } = require('../src/atendimentos');
const { montarRelatorio, intervaloDoPeriodo, mediana, formatarDuracao } = require('../src/relatorio');

const fluxo = carregarFluxo();
let servidor;
let baseUrl;
let cookieAdmin;

const extrairCookie = (resposta) => (resposta.headers.get('set-cookie') || '').split(';')[0] || null;

async function simularMensagemDoCliente(numero, texto) {
  registrarMensagem(numero, 'cliente', texto);
  const resposta = await processarMensagem({ numero, texto, negocio, fluxo });
  sincronizarConversa(numero, fluxo);
  if (resposta) registrarMensagem(numero, 'bot', resposta);
}

before(async () => {
  await new Promise((resolve) => {
    servidor = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${servidor.address().port}`;
      resolve();
    });
  });
  const resp = await fetch(`${baseUrl}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nome: 'Paulo Admin', email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  cookieAdmin = extrairCookie(resp);
  definirSocket({ sendMessage: async () => {} });
});

after(async () => {
  await new Promise((resolve) => servidor.close(resolve));
  db.close(); // sem isso o Windows não deixa apagar a pasta (EPERM)
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('lerNota entende o jeito que o cliente responde a pesquisa', () => {
  assert.strictEqual(lerNota('10'), 10);
  assert.strictEqual(lerNota('nota 9!'), 9);
  assert.strictEqual(lerNota(' 0 '), 0);
  assert.strictEqual(lerNota('Dez'), 10);
  assert.strictEqual(lerNota('três'), 3);
  assert.strictEqual(lerNota('100'), null);
  assert.strictEqual(lerNota('ótimo atendimento'), null);
});

test('atendimento real: entra na fila, é assumido, respondido, finalizado e recebe a nota', async () => {
  const numero = '5581999990001@s.whatsapp.net';
  await simularMensagemDoCliente(numero, 'oi');
  await simularMensagemDoCliente(numero, '3'); // "Falar com um atendente" no fluxo de exemplo
  const conversa = obterOuCriarConversa(numero);

  let atendimento = db.prepare('SELECT * FROM atendimentos WHERE conversa_id = ?').get(conversa.id);
  assert.strictEqual(atendimento.origem, 'cliente');
  assert.ok(atendimento.aberto_em && !atendimento.assumido_em);

  await fetch(`${baseUrl}/painel/fila/${conversa.id}/assumir`, { method: 'POST', headers: { cookie: cookieAdmin }, redirect: 'manual' });
  atendimento = db.prepare('SELECT * FROM atendimentos WHERE id = ?').get(atendimento.id);
  assert.ok(atendimento.assumido_em, 'assumir marca a hora');
  assert.ok(!atendimento.primeira_resposta_em, 'a boas-vindas automática não conta como resposta');

  await simularMensagemDoCliente(numero, 'quero um botijão');
  const adminId = db.prepare("SELECT id FROM atendentes WHERE email = 'admin@teste.com'").get().id;
  registrarMensagem(numero, 'atendente', 'Já vai!', null, adminId);
  await fetch(`${baseUrl}/painel/fila/${conversa.id}/finalizar`, { method: 'POST', headers: { cookie: cookieAdmin }, redirect: 'manual' });
  await simularMensagemDoCliente(numero, 'nota 9');

  atendimento = db.prepare('SELECT * FROM atendimentos WHERE id = ?').get(atendimento.id);
  assert.ok(atendimento.primeira_resposta_em);
  assert.strictEqual(atendimento.atendente_id, adminId);
  assert.strictEqual(atendimento.finalizado_como, 'atendente');
  assert.strictEqual(atendimento.nota, 9);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM atendimentos WHERE conversa_id = ?').get(conversa.id).n, 1, 'a nota não abre outro atendimento');

  // cliente volta depois: atendimento novo
  await simularMensagemDoCliente(numero, 'oi');
  await simularMensagemDoCliente(numero, '3');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM atendimentos WHERE conversa_id = ?').get(conversa.id).n, 2);

  const resp = await fetch(`${baseUrl}/painel/relatorio?periodo=hoje`, { headers: { cookie: cookieAdmin } });
  assert.strictEqual(resp.status, 200);
  const corpo = await resp.text();
  assert.match(corpo, /<span class="numero">2<\/span><span class="rotulo">Atendimentos/);
  assert.match(corpo, /class="nota nota-boa">9</);
  assert.match(corpo, /href="\/painel\/relatorio"/, 'admin vê o Relatório no menu');
});

test('atendente sem a permissão não vê o Relatório; com a permissão vê', async () => {
  for (const [email, permissoes] of [['ana@teste.com', 'responder_conversas'], ['bia@teste.com', 'responder_conversas,ver_relatorio']]) {
    await fetch(`${baseUrl}/painel/atendentes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieAdmin },
      body: new URLSearchParams([['nome', email], ['email', email], ['senha', '123456'], ['papel', 'atendente'], ...permissoes.split(',').map((p) => ['permissoes', p])]),
      redirect: 'manual',
    });
  }
  const entrar = async (email) =>
    extrairCookie(
      await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email, senha: '123456' }),
        redirect: 'manual',
      }),
    );

  const cookieAna = await entrar('ana@teste.com');
  let resp = await fetch(`${baseUrl}/painel/relatorio`, { headers: { cookie: cookieAna }, redirect: 'manual' });
  assert.notStrictEqual(resp.status, 200, 'sem ver_relatorio não abre');
  resp = await fetch(`${baseUrl}/painel/fila`, { headers: { cookie: cookieAna } });
  assert.doesNotMatch(await resp.text(), /href="\/painel\/relatorio"/, 'nem aparece no menu');

  const cookieBia = await entrar('bia@teste.com');
  resp = await fetch(`${baseUrl}/painel/relatorio`, { headers: { cookie: cookieBia } });
  assert.strictEqual(resp.status, 200);
});

test('reconstrói atendimentos antigos pelas mensagens, com a nota guardada em registros', () => {
  const conversa = obterOuCriarConversa('5581999990002@s.whatsapp.net');
  db.prepare("UPDATE conversas SET status = 'finalizado' WHERE id = ?").run(conversa.id);
  const inserir = db.prepare('INSERT INTO mensagens (conversa_id, remetente, texto, criado_em, atendente_id) VALUES (?, ?, ?, ?, ?)');
  const m = (remetente, texto, iso, atendenteId = null) => inserir.run(conversa.id, remetente, texto, iso, atendenteId);
  // atendimento 1: chega 10:00, Carlos responde 10:05, finaliza 10:20, nota 10 às 10:22
  m('cliente', 'oi', '2026-10-05T13:00:00.000Z');
  m('bot', 'Vou te passar pra um atendente', '2026-10-05T13:00:01.000Z');
  m('atendente', 'Bom dia!', '2026-10-05T13:05:00.000Z', 1);
  m('bot', 'Fechado por aqui, valeu!', '2026-10-05T13:20:00.000Z');
  m('bot', 'De 0 a 10, o quanto você recomendaria nosso atendimento a um amigo?', '2026-10-05T13:20:01.000Z');
  m('cliente', '10', '2026-10-05T13:22:00.000Z');
  db.prepare("INSERT INTO registros (colecao, dados, criado_em) VALUES ('avaliacoes', ?, '2026-10-05T13:22:00.000Z')").run(
    JSON.stringify({ numero: conversa.numero, nota: '10' }),
  );
  // conversa só com o bot (não é atendimento)
  m('cliente', 'qual o horário?', '2026-10-06T13:00:00.000Z');
  m('bot', 'Das 7h às 18h', '2026-10-06T13:00:01.000Z');
  // atendimento 2 dois dias depois, sem finalizar (fechamento automático sem mensagem)
  m('cliente', 'oi de novo', '2026-10-08T13:00:00.000Z');
  m('atendente', 'Pois não', '2026-10-08T13:30:00.000Z', 1);

  const total = reconstruirAtendimentosAntigos({ textosFinalizacao: ['Fechado por aqui, valeu!'] });
  const linhas = db.prepare('SELECT * FROM atendimentos WHERE conversa_id = ? ORDER BY aberto_em').all(conversa.id);
  assert.ok(total >= linhas.length, 'devolve quantos reconstruiu (todas as conversas)');
  assert.strictEqual(linhas.length, 2, 'só os que tiveram resposta de atendente');
  assert.strictEqual(linhas[0].aberto_em, '2026-10-05T13:00:00.000Z');
  assert.strictEqual(linhas[0].primeira_resposta_em, '2026-10-05T13:05:00.000Z');
  assert.strictEqual(linhas[0].finalizado_em, '2026-10-05T13:20:00.000Z');
  assert.strictEqual(linhas[0].nota, 10);
  assert.strictEqual(linhas[0].reconstruido, 1);
  assert.strictEqual(linhas[1].aberto_em, '2026-10-08T13:00:00.000Z');
  assert.strictEqual(linhas[1].nota, null);
  assert.ok(linhas[1].finalizado_em);
});

test('relatório: período em horário de Recife, mediana, barras e horários de pico', () => {
  const agora = Date.parse('2026-10-13T15:00:00.000Z'); // terça 12:00 em Recife
  assert.deepStrictEqual(
    [intervaloDoPeriodo('hoje', agora).inicio, intervaloDoPeriodo('mes-passado', agora).inicio].map((ms) => new Date(ms).toISOString()),
    ['2026-10-13T03:00:00.000Z', '2026-09-01T03:00:00.000Z'],
  );
  assert.strictEqual(mediana([1, 50, 3]), 3);
  assert.strictEqual(formatarDuracao(90 * 60000), '1h 30min');
  assert.strictEqual(formatarDuracao(20000), 'menos de 1 min');

  const r = montarRelatorio({ periodo: '30', agoraMs: agora });
  const dia5 = r.barras.find((b) => b.rotulo === '05/10');
  assert.ok(dia5.total >= 1, 'o reconstruído de 05/10 conta no dia certo');
  const segunda = r.pico.dias.find((d) => d.nome === 'Seg'); // 05/10/2026 é segunda
  assert.ok(segunda.valores[r.pico.horas.indexOf(10)] >= 1, '13:00 UTC = 10h em Recife');
  assert.strictEqual(montarRelatorio({ periodo: 'invalido', agoraMs: agora }).periodo, '30');
});

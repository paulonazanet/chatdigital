const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E2, 2a parte: pausa com motivo, limite de conversas, alertas de fila, painel da TV e resumo de pausas.
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e2equipe-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = ''; // o .env local pode ter modo de teste ligado (dotenv não sobrescreve)

const { app } = require('../src/server');
const { processarMensagem } = require('../src/flow-engine');
const { registrarMensagem, sincronizarConversa } = require('../src/conversas');
const { carregarFluxo } = require('../src/fluxo');
const { definirSocket } = require('../src/socket-atual');
const { db } = require('../src/db');
const equipe = require('../src/equipe');
const presenca = require('../src/presenca');
const { haAtendenteDisponivel } = require('../src/atendentes');
const { calcularAlertas, checarAlertas } = require('../src/alertas');
const { barramento } = require('../src/eventos');

const negocio = {
  nome: 'Loja Exemplo',
  formas_pagamento: ['Pix'],
  produtos: [],
  faq: [],
  mensagem_boas_vindas_atendente: '',
  mensagem_encerramento: 'Fechado por aqui!',
  pesquisa_satisfacao: '',
};
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify(negocio));
const fluxo = carregarFluxo();

let servidor;
let baseUrl;
let cookieAdmin;
let cookieBeto;
let betoId;

async function clienteEscreve(numero, texto) {
  registrarMensagem(numero, 'cliente', texto);
  const resposta = await processarMensagem({ numero, texto, negocio, fluxo });
  sincronizarConversa(numero, fluxo);
  if (resposta) registrarMensagem(numero, 'bot', resposta);
}
function post(caminho, campos = {}, cookie = cookieAdmin) {
  return fetch(`${baseUrl}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(campos),
    redirect: 'manual',
  });
}
async function pagina(caminho, cookie = cookieAdmin) {
  return (await fetch(`${baseUrl}${caminho}`, { headers: { cookie } })).text();
}
async function entrarComo(email) {
  const login = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, senha: '123456' }),
    redirect: 'manual',
  });
  return login.headers.get('set-cookie').split(';')[0];
}
async function clienteNaFila(numero) {
  await clienteEscreve(numero, 'oi');
  await clienteEscreve(numero, '3'); // "Falar com um atendente" no fluxo de exemplo
  return db.prepare('SELECT * FROM conversas WHERE numero = ?').get(numero);
}
const conversa = (id) => db.prepare('SELECT * FROM conversas WHERE id = ?').get(id);
function salvarNegocio(campos) {
  const atual = JSON.parse(fs.readFileSync(process.env.CHATDIGITAL_NEGOCIO, 'utf8'));
  fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify({ ...atual, ...campos }));
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
    body: new URLSearchParams({ nome: 'Carla', email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  cookieAdmin = resp.headers.get('set-cookie').split(';')[0];
  definirSocket({ sendMessage: async () => ({ key: { id: `X${Math.random()}`, fromMe: true } }) });
  await post('/painel/atendentes', {
    nome: 'Beto',
    email: 'beto@teste.com',
    senha: '123456',
    papel: 'atendente',
    permissoes: 'responder_conversas',
    limite_conversas: '1',
    setores: String(db.prepare("SELECT id FROM setores WHERE nome = 'Geral'").get().id),
  });
  betoId = db.prepare("SELECT id FROM atendentes WHERE email = 'beto@teste.com'").get().id;
  cookieBeto = await entrarComo('beto@teste.com');
});

after(async () => {
  definirSocket(null);
  await new Promise((resolve) => servidor.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('motivos de pausa: vêm prontos, a tela cria, valida e edita', async () => {
  const nomes = equipe.listarMotivosPausa().map((m) => m.nome);
  assert.deepStrictEqual(nomes, ['Almoço', 'Lanche ou café', 'Banheiro', 'Reunião', 'Outro']);
  let resp = await post('/painel/configuracoes/pausas', { nome: 'Entrega no balcão', limite_minutos: '-1' });
  assert.match(await resp.text(), /de 0 a 600/);
  resp = await post('/painel/configuracoes/pausas', { nome: 'Entrega no balcão', limite_minutos: '20' });
  assert.strictEqual(resp.status, 302);
  const novo = equipe.listarMotivosPausa().find((m) => m.nome === 'Entrega no balcão');
  assert.strictEqual(novo.limite_minutos, 20);
  // salvar todos: desativa o novo
  const campos = {};
  for (const m of equipe.listarMotivosPausa()) {
    campos[`nome_${m.id}`] = m.nome;
    campos[`limite_${m.id}`] = String(m.limite_minutos);
    if (m.id !== novo.id) campos[`ativo_${m.id}`] = '1';
  }
  await post('/painel/configuracoes/pausas/salvar', campos);
  assert.strictEqual(equipe.listarMotivosPausa({ soAtivos: true }).some((m) => m.id === novo.id), false);
  const tela = await pagina('/painel/configuracoes');
  assert.match(tela, /5 motivos de pausa · alertas desligados/);
});

test('pausa: o atendente pausa, não conta como disponível, ninguém transfere pra ele, e Voltar encerra', async () => {
  presenca.conectou(betoId);
  const almoco = equipe.listarMotivosPausa().find((m) => m.nome === 'Almoço');
  assert.strictEqual(haAtendenteDisponivel(null), true, 'Beto online e livre');

  let resp = await post('/painel/fila/pausa', { motivo_id: String(almoco.id), voltar: '/painel/fila?filtro=fila' }, cookieBeto);
  assert.strictEqual(resp.headers.get('location'), '/painel/fila?filtro=fila');
  assert.strictEqual(equipe.pausaAtual(betoId).motivo_texto, 'Almoço');
  assert.strictEqual(haAtendenteDisponivel(null), false, 'em pausa não conta como disponível');
  const fila = await pagina('/painel/fila', cookieBeto);
  assert.match(fila, /Você está em pausa: <strong>Almoço<\/strong>/);
  assert.ok(!fila.includes('<summary class="botao-como-summary">Pausar</summary>'), 'em pausa, o botão vira Voltar');

  const c = await clienteNaFila('5581922220001@s.whatsapp.net');
  await post(`/painel/fila/${c.id}/assumir`); // a Carla assume
  resp = await post(`/painel/fila/${c.id}/transferir`, { setor_id: String(c.setor_id), atendente_id: String(betoId) });
  assert.match(await resp.text(), /Beto está em pausa \(Almoço\)/);
  assert.strictEqual(conversa(c.id).atendente_id, 1, 'continua com a Carla');

  resp = await post('/painel/fila/pausa/voltar', { voltar: 'https://site-estranho.com' }, cookieBeto);
  assert.strictEqual(resp.headers.get('location'), '/painel/fila', 'voltar só para a Fila');
  assert.strictEqual(equipe.pausaAtual(betoId), null);
  assert.strictEqual(haAtendenteDisponivel(null), true);
  presenca.desconectou(betoId);
});

test('pausa: assumir uma conversa encerra a pausa, e sair do sistema também', async () => {
  const banheiro = equipe.listarMotivosPausa().find((m) => m.nome === 'Banheiro');
  equipe.iniciarPausa(betoId, banheiro.id);
  const c = await clienteNaFila('5581922220002@s.whatsapp.net');
  await post(`/painel/fila/${c.id}/assumir`, {}, cookieBeto);
  assert.strictEqual(conversa(c.id).atendente_id, betoId);
  assert.strictEqual(equipe.pausaAtual(betoId), null, 'assumiu = voltou da pausa');

  equipe.iniciarPausa(betoId, banheiro.id);
  await post('/logout', {}, cookieBeto);
  assert.strictEqual(equipe.pausaAtual(betoId), null, 'saiu = pausa encerrada');
  cookieBeto = await entrarComo('beto@teste.com');
});

test('limite de conversas: no limite não assume, não puxa e não recebe transferência', async () => {
  // Beto (limite 1) já está com a conversa 5581922220002
  assert.strictEqual(db.prepare('SELECT limite_conversas FROM atendentes WHERE id = ?').get(betoId).limite_conversas, 1);
  const c = await clienteNaFila('5581922220003@s.whatsapp.net');
  let resp = await post(`/painel/fila/${c.id}/assumir`, {}, cookieBeto);
  assert.match(await resp.text(), /Você já está com 1 conversa \(seu limite é 1\)/);
  assert.strictEqual(conversa(c.id).status, 'aguardando');

  resp = await post(`/painel/fila/${c.id}/transferir`, { setor_id: String(c.setor_id), atendente_id: String(betoId) });
  assert.match(await resp.text(), /Beto já está com 1 conversa \(limite 1\)/);

  const tela = await pagina('/painel/fila', cookieBeto);
  assert.match(tela, /Suas conversas: <strong>1 de 1<\/strong>/);

  // reassumir a que já é dele não conta
  const dele = db.prepare('SELECT id FROM conversas WHERE numero = ?').get('5581922220002@s.whatsapp.net').id;
  resp = await post(`/painel/fila/${dele}/assumir`, {}, cookieBeto);
  assert.strictEqual(resp.status, 302);

  // o limite muda pela tela de Atendentes
  await post(`/painel/atendentes/${betoId}`, { nome: 'Beto', papel: 'atendente', ativo: 'on', permissoes: 'responder_conversas', limite_conversas: '2', setores: String(c.setor_id) });
  resp = await post(`/painel/fila/${c.id}/assumir`, {}, cookieBeto);
  assert.strictEqual(resp.status, 302);
  assert.strictEqual(conversa(c.id).atendente_id, betoId);
  assert.ok((await pagina('/painel/atendentes')).includes('até 2 conversas'));
});

test('alertas: fila parada, fila cheia, sem resposta e pausa longa; avisa uma vez e de novo quando piora', async () => {
  assert.deepStrictEqual(calcularAlertas(), [], 'tudo desligado por padrão (só a pausa longa depende do motivo)');
  let resp = await post('/painel/configuracoes/pausas/alertas', { alerta_fila_minutos: 'x', alerta_fila_quantidade: '0', alerta_sem_resposta_minutos: '0' });
  assert.match(await resp.text(), /número inteiro de 0 a 1440/);
  resp = await post('/painel/configuracoes/pausas/alertas', { alerta_fila_minutos: '10', alerta_fila_quantidade: '2', alerta_sem_resposta_minutos: '5' });
  assert.strictEqual(resp.headers.get('location'), '/painel/configuracoes/pausas?salvo=1');

  const c = await clienteNaFila('5581922220004@s.whatsapp.net');
  const ha = (min) => new Date(Date.now() - min * 60000).toISOString();
  db.prepare('UPDATE conversas SET aberta_em = ? WHERE id = ?').run(ha(30), c.id);
  db.prepare("UPDATE mensagens SET criado_em = ? WHERE conversa_id = ? AND remetente = 'cliente'").run(ha(25), c.id);
  // a conversa do Beto: cliente escreveu há 8 min e ninguém respondeu
  const doBeto = db.prepare('SELECT id, numero FROM conversas WHERE numero = ?').get('5581922220002@s.whatsapp.net');
  db.prepare('UPDATE mensagens SET criado_em = ? WHERE conversa_id = ?').run(ha(8), doBeto.id);
  db.prepare('UPDATE conversas SET aberta_em = ? WHERE id = ?').run(ha(9), doBeto.id);
  // pausa longa: almoço (limite 60) começado há 70 min
  const almoco = equipe.listarMotivosPausa().find((m) => m.nome === 'Almoço');
  equipe.iniciarPausa(1, almoco.id);
  db.prepare('UPDATE pausas SET inicio = ? WHERE atendente_id = 1 AND fim IS NULL').run(ha(70));

  const alertas = calcularAlertas();
  const tipos = alertas.map((a) => a.tipo).sort();
  assert.deepStrictEqual(tipos, ['fila_espera', 'pausa_longa', 'sem_resposta']);
  assert.match(alertas.find((a) => a.tipo === 'fila_espera').texto, /1 cliente esperando na fila há mais de 10 min \(o mais antigo há 25 min\)/);
  assert.match(alertas.find((a) => a.tipo === 'sem_resposta').texto, /Beto tem 1 cliente sem resposta há mais de 5 min/);
  assert.match(alertas.find((a) => a.tipo === 'pausa_longa').texto, /Carla está em pausa \(Almoço\) há 70 min; o limite é 60 min/);

  const avisos = [];
  const ouvir = (a) => avisos.push(a.chave);
  barramento.on('alerta', ouvir);
  checarAlertas();
  checarAlertas();
  assert.strictEqual(avisos.length, 3, 'cada alerta avisa uma vez');
  await clienteNaFila('5581922220005@s.whatsapp.net'); // 2 na fila: fila cheia
  checarAlertas();
  assert.deepStrictEqual(avisos.slice(3), ['fila_cheia']);
  barramento.off('alerta', ouvir);

  const filaBeto = await pagina('/painel/fila', cookieBeto);
  assert.ok(filaBeto.includes('Beto tem 1 cliente sem resposta'));
  assert.ok(!filaBeto.includes('Carla está em pausa'), 'pausa longa só para a gestão e a própria pessoa');
  assert.ok((await pagina('/painel')).includes('Carla está em pausa (Almoço)'));
  equipe.encerrarPausa(1);
});

test('painel da TV: link secreto sem login, sem dados de cliente; trocar e desligar', async () => {
  assert.strictEqual((await fetch(`${baseUrl}/tv/qualquer`)).status, 404, 'desligado por padrão');
  await post('/painel/configuracoes/painel-tv/gerar');
  const token = JSON.parse(fs.readFileSync(process.env.CHATDIGITAL_NEGOCIO, 'utf8')).painel_tv_token;
  assert.ok(token && token.length >= 20);
  assert.ok((await pagina('/painel/configuracoes/painel-tv')).includes(`/tv/${token}`));

  const tela = await fetch(`${baseUrl}/tv/${token}`);
  assert.strictEqual(tela.status, 200);
  const html = await tela.text();
  assert.ok(html.includes('Atendimento ao vivo'));
  const dados = await (await fetch(`${baseUrl}/tv/${token}/dados`)).json();
  assert.strictEqual(dados.esperando, 2);
  assert.ok(dados.maiorEspera >= 25);
  assert.ok(dados.equipe.some((p) => p.nome === 'Beto' && p.atendendo === 2 && p.limite === 2));
  const json = JSON.stringify(dados);
  assert.ok(!/922220/.test(json) && !/922220/.test(html), 'nenhum telefone de cliente');
  assert.ok(!json.includes('oi'), 'nenhuma mensagem de cliente');

  assert.strictEqual((await fetch(`${baseUrl}/tv/${token}x`)).status, 404);
  await post('/painel/configuracoes/painel-tv/gerar');
  assert.strictEqual((await fetch(`${baseUrl}/tv/${token}/dados`)).status, 404, 'o link antigo para de funcionar');
  await post('/painel/configuracoes/painel-tv/desligar');
  assert.strictEqual(JSON.parse(fs.readFileSync(process.env.CHATDIGITAL_NEGOCIO, 'utf8')).painel_tv_token, null);
  salvarNegocio({});
});

test('Relatório: resumo de pausas por atendente e motivo', async () => {
  const relatorio = await pagina('/painel/relatorio?periodo=hoje');
  assert.ok(relatorio.includes('Pausas'));
  assert.match(relatorio, /<td>Carla<\/td>\s*<td>1<\/td>\s*<td>1h 10min<\/td>/);
  assert.match(relatorio, /Almoço 1h 10min/);
  assert.match(relatorio, /celula-meta-fora">1</, 'passou do limite');
  assert.match(relatorio, /<td>Beto<\/td>\s*<td>3<\/td>/);
});

test('permissão: telas novas de Configurações só com "Ver e editar Configurações"', async () => {
  for (const caminho of ['/painel/configuracoes/pausas', '/painel/configuracoes/painel-tv']) {
    assert.strictEqual((await fetch(`${baseUrl}${caminho}`, { headers: { cookie: cookieBeto } })).status, 403, caminho);
  }
  assert.strictEqual((await post('/painel/configuracoes/painel-tv/gerar', {}, cookieBeto)).status, 403);
});

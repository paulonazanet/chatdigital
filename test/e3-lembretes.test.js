const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E3, 1a parte: fila de envios automáticos, lembrete de recompra, SAIR e retorno agendado.
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e3lembretes-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify({ nome: 'Gás Exemplo', formas_pagamento: ['Pix'], produtos: [], faq: [] }));

const { app } = require('../src/server');
const { db } = require('../src/db');
const { carregarFluxo } = require('../src/fluxo');
const { definirSocket } = require('../src/socket-atual');
const { obterOuCriarConversa, renomearContato, finalizarConversa, assumirConversa, listarMensagens } = require('../src/conversas');
const { salvarRegistro } = require('../src/registros');
const { salvarConfiguracoes } = require('../src/negocio');
const envios = require('../src/envios');
const lembretes = require('../src/lembretes');
const retornos = require('../src/retornos');
const { tratarMensagemRecebida } = require('../src/bot');
const { barramento } = require('../src/eventos');

const fluxo = carregarFluxo();
const DIA = 86400000;
let servidor;
let baseUrl;
let cookie;
const enviadas = [];
let contador = 0;
const sockFalso = {
  sendMessage: async (numero, conteudo) => {
    enviadas.push({ numero, texto: conteudo.text });
    contador += 1;
    return { key: { id: `ENVIO${contador}`, fromMe: true } };
  },
};
// uma segunda-feira às 10h (horário local), dentro da janela padrão de envio
function segundaAs10() {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}
const msgDoCliente = (numero, texto) => ({ key: { remoteJid: numero, id: `R${Math.random()}`, fromMe: false }, message: { conversation: texto }, pushName: 'Cliente' });
function post(caminho, campos = {}) {
  const corpo = new URLSearchParams();
  for (const [chave, valor] of Object.entries(campos)) [].concat(valor).forEach((v) => corpo.append(chave, v));
  return fetch(`${baseUrl}${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, body: corpo, redirect: 'manual' });
}
const pagina = async (caminho) => (await fetch(`${baseUrl}${caminho}`, { headers: { cookie } })).text();
// atendimento finalizado com "Pedido feito" há `dias` dias
function compraHa(conversaId, dias) {
  const quando = new Date(Date.now() - dias * DIA).toISOString();
  db.prepare("INSERT INTO atendimentos (conversa_id, origem, aberto_em, assumido_em, finalizado_em, finalizado_como, motivo_texto) VALUES (?, 'cliente', ?, ?, ?, 'atendente', 'Resolvido › Pedido feito')").run(conversaId, quando, quando, quando);
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
  cookie = resp.headers.get('set-cookie').split(';')[0];
  definirSocket(sockFalso);
});

after(async () => {
  definirSocket(null);
  await new Promise((resolve) => servidor.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('fila de envios: só no horário, um por vez, pula quem não pode e lê os recibos', async () => {
  const domingoMadrugada = new Date(segundaAs10().getTime() - DIA - 7 * 3600000); // domingo 03h
  assert.match(envios.situacaoDaFila(domingoMadrugada).motivo, /Fora do horário/);
  definirSocket(null);
  assert.strictEqual(envios.situacaoDaFila(segundaAs10()).motivo, 'WhatsApp desconectado');
  definirSocket(sockFalso);

  const ana = obterOuCriarConversa('5581900000001@s.whatsapp.net');
  const beto = obterOuCriarConversa('5581900000002@s.whatsapp.net');
  db.prepare("UPDATE conversas SET situacao_contato = 'bloqueado' WHERE id = ?").run(beto.id);
  const idAna = envios.enfileirar({ tipo: 'lembrete', conversaId: ana.id, texto: 'Oi Ana' });
  const idBeto = envios.enfileirar({ tipo: 'lembrete', conversaId: beto.id, texto: 'Oi Beto' });

  assert.deepStrictEqual(await envios.processarFila({ agora: domingoMadrugada, forcar: true }), { esperando: 'Fora do horário de envio' });
  assert.deepStrictEqual(await envios.processarFila({ agora: segundaAs10(), forcar: true }), { enviado: idAna });
  assert.strictEqual((await envios.processarFila({ agora: segundaAs10() })).esperando, 'Intervalo entre envios', 'espera o intervalo sorteado');
  const pulado = await envios.processarFila({ agora: segundaAs10(), forcar: true });
  assert.deepStrictEqual(pulado, { pulado: idBeto, motivo: 'Contato bloqueado' });
  assert.deepStrictEqual(enviadas.map((e) => e.texto), ['Oi Ana']);
  assert.ok(listarMensagens(ana.id).some((m) => m.remetente === 'bot' && m.texto === 'Oi Ana'), 'fica no histórico da conversa');

  const envio = db.prepare('SELECT * FROM envios WHERE id = ?').get(idAna);
  envios.atualizarRecibos([{ key: { id: envio.wa_id }, update: { status: 3 } }]);
  assert.ok(db.prepare('SELECT entregue_em FROM envios WHERE id = ?').get(idAna).entregue_em);
  envios.atualizarRecibos([{ key: { id: envio.wa_id }, update: { status: 4 } }]);
  assert.ok(db.prepare('SELECT lido_em FROM envios WHERE id = ?').get(idAna).lido_em);

  // limite por dia
  salvarConfiguracoes({ envio_limite_dia: 1 });
  envios.enfileirar({ tipo: 'lembrete', conversaId: ana.id, texto: 'De novo' });
  assert.match((await envios.processarFila({ agora: new Date(), forcar: true })).esperando || '', /limite do dia|Fora do horário/);
  salvarConfiguracoes({ envio_limite_dia: 100 });
  db.prepare("UPDATE envios SET status = 'cancelado' WHERE status = 'pendente'").run();
  db.prepare("UPDATE conversas SET situacao_contato = 'normal' WHERE id = ?").run(beto.id);
});

test('lembrete de recompra: quem venceu, média do cliente, prazo da ficha, uma vez por compra', async () => {
  const maria = obterOuCriarConversa('5581900000011@s.whatsapp.net');
  renomearContato(maria.id, 'Maria');
  compraHa(maria.id, 31);
  const joao = obterOuCriarConversa('5581900000012@s.whatsapp.net');
  compraHa(joao.id, 10);
  const velho = obterOuCriarConversa('5581900000013@s.whatsapp.net');
  compraHa(velho.id, 90); // venceu há 60 dias: cliente sumido, não manda
  const regular = obterOuCriarConversa('5581900000014@s.whatsapp.net');
  [45, 30, 15].forEach((d) => compraHa(regular.id, d)); // média 15 dias, última há 15
  // pedido feito pelo bot conta como compra
  const bot = obterOuCriarConversa('5581900000015@s.whatsapp.net');
  salvarRegistro('pedidos', { numero: bot.numero, pedido: '1 P13' });
  db.prepare("UPDATE registros SET criado_em = ? WHERE colecao = 'pedidos'").run(new Date(Date.now() - 40 * DIA).toISOString());

  const ids = () => lembretes.candidatos().map((c) => c.conversa.id).sort((a, b) => a - b);
  assert.deepStrictEqual(ids(), [maria.id, regular.id, bot.id].sort((a, b) => a - b));
  db.prepare('UPDATE conversas SET recompra_dias = 7 WHERE id = ?').run(joao.id);
  assert.ok(ids().includes(joao.id), 'prazo da ficha do cliente');

  assert.strictEqual(lembretes.gerarLembretes(), 0, 'vem desligado');
  salvarConfiguracoes({ recompra_ligado: true });
  assert.strictEqual(lembretes.gerarLembretes(), 4);
  assert.strictEqual(lembretes.gerarLembretes(), 0, 'não repete para a mesma compra');
  const textoMaria = db.prepare("SELECT texto FROM envios WHERE conversa_id = ? AND tipo = 'lembrete'").get(maria.id).texto;
  assert.match(textoMaria, /^Oi, Maria! Aqui é da Gás Exemplo\. 🔥 Já faz 31 dias/);
  const textoBot = db.prepare("SELECT texto FROM envios WHERE conversa_id = ? AND tipo = 'lembrete'").get(bot.id).texto;
  assert.match(textoBot, /^Oi! Aqui é da Gás Exemplo/, 'sem nome não fica "Oi, !"');

  // compra nova depois do lembrete: volta a valer o prazo
  compraHa(maria.id, 0);
  assert.ok(!ids().includes(maria.id));

  const tela = await pagina('/painel/campanhas/lembretes');
  assert.ok(tela.includes('Lembrete de recompra'));
  assert.ok(tela.includes('Resolvido › Pedido feito'));
});

test('respostas: responder o lembrete passa para atendente; SAIR tira das mensagens automáticas', async () => {
  const numero = '5581900000014@s.whatsapp.net'; // o "regular", que já está na fila de lembretes
  db.prepare("UPDATE envios SET status = 'cancelado' WHERE status = 'pendente' AND conversa_id <> (SELECT id FROM conversas WHERE numero = ?)").run(numero);
  await envios.processarFila({ agora: segundaAs10(), forcar: true });
  const conversaId = db.prepare('SELECT id FROM conversas WHERE numero = ?').get(numero).id;
  assert.strictEqual(db.prepare("SELECT status FROM envios WHERE conversa_id = ? AND tipo = 'lembrete'").get(conversaId).status, 'enviado');

  await tratarMensagemRecebida(sockFalso, msgDoCliente(numero, 'SIM'), { nome: 'Gás Exemplo' }, fluxo);
  const conversa = db.prepare('SELECT c.*, s.nome AS setor FROM conversas c LEFT JOIN setores s ON s.id = c.setor_id WHERE c.id = ?').get(conversaId);
  assert.strictEqual(conversa.status, 'aguardando', 'foi para a fila');
  assert.strictEqual(conversa.setor, 'Geral');
  assert.ok(listarMensagens(conversaId).some((m) => m.interna && /Respondeu ao lembrete/.test(m.texto)));
  assert.ok(db.prepare("SELECT respondido_em FROM envios WHERE conversa_id = ? AND tipo = 'lembrete'").get(conversaId).respondido_em);

  // SAIR (com envio recente e fora de atendimento)
  const outro = '5581900000011@s.whatsapp.net';
  const idOutro = db.prepare('SELECT id FROM conversas WHERE numero = ?').get(outro).id;
  db.prepare("UPDATE envios SET status = 'enviado', enviado_em = ? WHERE conversa_id = ? AND tipo = 'lembrete'").run(new Date().toISOString(), idOutro);
  const pendente = envios.enfileirar({ tipo: 'lembrete', conversaId: idOutro, texto: 'outro' });
  enviadas.length = 0;
  await tratarMensagemRecebida(sockFalso, msgDoCliente(outro, 'Sair'), { nome: 'Gás Exemplo' }, fluxo);
  const c = db.prepare('SELECT * FROM conversas WHERE id = ?').get(idOutro);
  assert.strictEqual(c.consentimento, 0);
  assert.ok(c.optout_em);
  assert.match(enviadas[0].texto, /não vai mais receber/);
  assert.strictEqual(db.prepare('SELECT status FROM envios WHERE id = ?').get(pendente).status, 'cancelado');
  assert.strictEqual(envios.motivoParaNaoMandar(c), 'Pediu para não receber mensagens');
  assert.ok(!lembretes.candidatos().some((x) => x.conversa.id === idOutro && !envios.motivoParaNaoMandar(x.conversa)));

  // "sair" sem envio recente é só uma mensagem normal (vai pro bot)
  enviadas.length = 0;
  await tratarMensagemRecebida(sockFalso, msgDoCliente('5581900000099@s.whatsapp.net', 'sair'), { nome: 'Gás Exemplo' }, fluxo);
  assert.ok(!enviadas.some((e) => /não vai mais receber/.test(e.texto)));
});

test('retorno agendado: marca na conversa, valida, e na hora vai para a pessoa com nota e mensagem', async () => {
  const conversa = obterOuCriarConversa('5581900000021@s.whatsapp.net');
  finalizarConversa(conversa.id);
  let resp = await post(`/painel/fila/${conversa.id}/retorno`, { data: '2020-01-01', hora: '09:00', nota: 'x' });
  assert.match(await resp.text(), /já passaram/);
  const amanha = new Date(Date.now() - 3 * 3600000 + DIA).toISOString().slice(0, 10);
  resp = await post(`/painel/fila/${conversa.id}/retorno`, { data: amanha, hora: '10:30', nota: 'Confirmar P45', mandar_mensagem: '1', mensagem: 'Oi! Confirmando seu P45.' });
  assert.strictEqual(resp.status, 302);
  const [retorno] = retornos.retornosDaConversa(conversa.id);
  assert.strictEqual(retorno.quando, `${amanha}T13:30:00.000Z`, '10:30 de Recife');
  assert.match(await pagina(`/painel/fila/${conversa.id}`), /Retorno marcado para <strong>\d{2}\/\d{2} às 10:30<\/strong> \(Carla\): Confirmar P45/);
  assert.ok((await pagina('/painel/campanhas/retornos')).includes('Confirmar P45'));

  assert.strictEqual(await retornos.processarRetornos(new Date()), 0, 'ainda não chegou a hora');
  const avisos = [];
  const ouvir = (d) => avisos.push(d.motivo);
  barramento.on('atencao', ouvir);
  enviadas.length = 0;
  assert.strictEqual(await retornos.processarRetornos(new Date(Date.now() + 2 * DIA)), 1);
  barramento.off('atencao', ouvir);
  const depois = db.prepare('SELECT * FROM conversas WHERE id = ?').get(conversa.id);
  assert.strictEqual(depois.status, 'atendendo');
  assert.strictEqual(depois.atendente_id, 1);
  assert.ok(listarMensagens(conversa.id).some((m) => m.interna && /Retorno agendado para Carla: Confirmar P45/.test(m.texto)));
  assert.deepStrictEqual(enviadas.map((e) => e.texto), ['Oi! Confirmando seu P45.']);
  assert.ok(avisos.includes('retorno'));

  // cancelar
  await post(`/painel/fila/${conversa.id}/retorno`, { data: amanha, hora: '11:00', nota: 'outro' });
  const [outro] = retornos.retornosDaConversa(conversa.id);
  await post(`/painel/fila/${conversa.id}/retorno/${outro.id}/cancelar`);
  assert.deepStrictEqual(retornos.retornosDaConversa(conversa.id), []);
});

test('regras de envio e permissão do menu Campanhas', async () => {
  let resp = await post('/painel/campanhas/regras', { inicio_1_1: '08:00', fim_1_1: '18:00', envio_intervalo_min: '90', envio_intervalo_max: '30', envio_limite_dia: '50' });
  assert.match(await resp.text(), /o máximo não pode ser menor/);
  resp = await post('/painel/campanhas/regras', { envio_intervalo_min: '30', envio_intervalo_max: '60', envio_limite_dia: '50' });
  assert.match(await resp.text(), /pelo menos um horário/);
  resp = await post('/painel/campanhas/regras', { inicio_1_1: '08:00', fim_1_1: '18:00', inicio_6_1: '08:00', fim_6_1: '12:00', envio_intervalo_min: '30', envio_intervalo_max: '60', envio_limite_dia: '50', envio_pular_feriados: '1' });
  assert.strictEqual(resp.headers.get('location'), '/painel/campanhas/regras?salvo=1');
  assert.deepStrictEqual(envios.regrasDeEnvio(), { janelas: ['1 08:00-18:00', '6 08:00-12:00'], intervaloMin: 30, intervaloMax: 60, limiteDia: 50, pularFeriados: true });
  assert.ok((await pagina('/painel/campanhas/envios')).includes('Lembrete de recompra'));

  await post('/painel/atendentes', { nome: 'Beto', email: 'beto@teste.com', senha: '123456', papel: 'atendente', permissoes: 'responder_conversas' });
  const login = await fetch(`${baseUrl}/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'beto@teste.com', senha: '123456' }), redirect: 'manual' });
  const cookieBeto = login.headers.get('set-cookie').split(';')[0];
  assert.strictEqual((await fetch(`${baseUrl}/painel/campanhas/lembretes`, { headers: { cookie: cookieBeto } })).status, 403);
  assert.ok(!(await (await fetch(`${baseUrl}/painel/fila`, { headers: { cookie: cookieBeto } })).text()).includes('href="/painel/campanhas"'), 'sem a permissão, o menu não aparece');
});

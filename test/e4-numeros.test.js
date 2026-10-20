const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E4, 3a parte: vários números de WhatsApp (celular) na mesma instalação, cada um com o seu fluxo.
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e4numeros-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.CHATDIGITAL_FLUXO = path.join(diretorioTeste, 'fluxo.json');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify({ nome: 'Provedor Exemplo', formas_pagamento: ['Pix'], produtos: [], faq: [] }));
fs.copyFileSync(path.join(__dirname, '..', 'config', 'fluxo.json'), process.env.CHATDIGITAL_FLUXO);
const arquivoFluxoAntes = fs.readFileSync(process.env.CHATDIGITAL_FLUXO, 'utf8');

const { app } = require('../src/server');
const { db } = require('../src/db');
const canais = require('../src/canais');
const { carregarFluxoPorId, carregarFluxoDaConversa, listarFluxos } = require('../src/fluxo');
const { definirSocket, obterSocket } = require('../src/socket-atual');
const whatsappStatus = require('../src/whatsapp-status');
const { tratarMensagemRecebida } = require('../src/bot');
const { listarMensagens } = require('../src/conversas');
const versoes = require('../src/fluxo-versoes');
const { montarStatus } = require('../src/status-sistema');

let servidor;
let baseUrl;
let cookie;
function criarSock(nome) {
  const enviadas = [];
  return {
    nome,
    enviadas,
    sendMessage: async (numero, conteudo) => {
      enviadas.push({ numero, texto: conteudo.text });
      return { key: { id: `${nome}-${enviadas.length}`, fromMe: true } };
    },
    onWhatsApp: async (jid) => [{ exists: true, jid }],
    signalRepository: null,
  };
}
const sockA = criarSock('A');
const sockB = criarSock('B');
const msg = (numero, texto) => ({ key: { remoteJid: numero, id: `R${Math.random()}`, fromMe: false }, message: { conversation: texto }, pushName: 'Cliente' });
function post(caminho, campos = {}) {
  const corpo = new URLSearchParams();
  for (const [chave, valor] of Object.entries(campos)) [].concat(valor).forEach((v) => corpo.append(chave, v));
  return fetch(`${baseUrl}${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, body: corpo, redirect: 'manual' });
}
const pagina = async (caminho) => (await fetch(`${baseUrl}${caminho}`, { headers: { cookie } })).text();
const negocio = { nome: 'Provedor Exemplo' };

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
});

after(async () => {
  definirSocket(null, 1);
  definirSocket(null, 2);
  await new Promise((resolve) => servidor.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('números: o Principal já existe; a tela adiciona, renomeia e não deixa desligar o último', async () => {
  assert.deepStrictEqual(canais.listarCanais().map((c) => [c.id, c.nome, c.pasta]), [[1, 'Principal', 'auth']]);
  let resp = await post('/painel/configuracoes/whatsapp/numeros', { nome: 'Suporte 2' });
  assert.match(resp.headers.get('location'), /aviso=numero-reiniciar/, 'no teste não liga o WhatsApp de verdade');
  assert.deepStrictEqual(canais.obterCanal(2).pasta, 'auth-numero-2');
  resp = await post('/painel/configuracoes/whatsapp/numeros', { nome: 'suporte 2' });
  assert.match(await resp.text(), /Já existe um número com esse nome/);
  await post('/painel/configuracoes/whatsapp/numeros/1', { nome: 'Suporte 1', fluxo_id: '1' });
  assert.strictEqual(canais.obterCanal(1).nome, 'Suporte 1');

  // desligar o 2 e ligar de novo; o último ligado não desliga
  await post('/painel/configuracoes/whatsapp/numeros/2/ativo');
  assert.strictEqual(canais.obterCanal(2).ativo, 0);
  resp = await post('/painel/configuracoes/whatsapp/numeros/1/ativo');
  assert.match(await resp.text(), /Pelo menos um número tem que ficar ligado/);
  await post('/painel/configuracoes/whatsapp/numeros/2/ativo');
  assert.strictEqual(canais.obterCanal(2).ativo, 1);

  const tela = await pagina('/painel/configuracoes/whatsapp');
  assert.ok(tela.includes('Suporte 1') && tela.includes('Suporte 2'));
  assert.ok(tela.includes('/painel/configuracoes/whatsapp/qr.png?numero=2') === false, 'sem QR ainda');
  whatsappStatus.definirQr('qr-do-numero-2', 2);
  assert.ok((await pagina('/painel/configuracoes/whatsapp')).includes('/painel/configuracoes/whatsapp/qr.png?numero=2'));
  const png = await fetch(`${baseUrl}/painel/configuracoes/whatsapp/qr.png?numero=2`, { headers: { cookie } });
  assert.strictEqual(png.headers.get('content-type'), 'image/png');
  assert.strictEqual((await fetch(`${baseUrl}/painel/configuracoes/whatsapp/qr.png?numero=1`, { headers: { cookie } })).status, 404);
});

test('a conversa responde pelo número por onde o cliente escreveu', async () => {
  definirSocket(sockA, 1);
  definirSocket(sockB, 2);
  whatsappStatus.definirConectado(1);
  whatsappStatus.definirConectado(2);
  const fluxo = carregarFluxoPorId(1);

  await tratarMensagemRecebida(sockB, msg('5583900000001@s.whatsapp.net', 'oi'), negocio, fluxo, { canalId: 2 });
  const conversa = db.prepare("SELECT * FROM conversas WHERE numero = '5583900000001@s.whatsapp.net'").get();
  assert.strictEqual(conversa.canal_id, 2);
  assert.strictEqual(listarMensagens(conversa.id).find((m) => m.remetente === 'cliente').canal_id, 2);
  assert.strictEqual(sockB.enviadas.length, 1, 'o bot respondeu pelo número 2');
  assert.strictEqual(sockA.enviadas.length, 0);

  // o atendente responde pela tela: sai pelo número 2
  await tratarMensagemRecebida(sockB, msg('5583900000001@s.whatsapp.net', '3'), negocio, fluxo, { canalId: 2 });
  await post(`/painel/fila/${conversa.id}/assumir`);
  await post(`/painel/fila/${conversa.id}/responder`, { texto: 'Olá, sou a Carla' });
  assert.strictEqual(sockB.enviadas.at(-1).texto, 'Olá, sou a Carla');
  assert.ok(!sockA.enviadas.some((e) => e.texto === 'Olá, sou a Carla'));

  // outro cliente no número 1
  await tratarMensagemRecebida(sockA, msg('5583900000002@s.whatsapp.net', 'oi'), negocio, fluxo, { canalId: 1 });
  assert.strictEqual(sockA.enviadas.length, 1);
  await obterSocket().sendMessage('5583900000002@s.whatsapp.net', { text: 'pelo roteador' });
  assert.strictEqual(sockA.enviadas.at(-1).texto, 'pelo roteador');

  // na Fila: etiqueta do número e filtro
  const fila = await pagina('/painel/fila?filtro=todas&numero=');
  assert.ok(fila.includes('<span class="selo selo-numero" title="Chegou por este número">Suporte 2</span>'));
  const so2 = await pagina('/painel/fila?filtro=todas&numero=2');
  assert.ok(so2.includes('5583900000001') && !so2.includes('5583900000002'));
  await pagina('/painel/fila?filtro=todas&numero=');
  assert.match(await pagina(`/painel/fila/${conversa.id}`), /Pelo número <strong>Suporte 2<\/strong>/);
});

test('nova conversa: escolhe por qual número começar', async () => {
  const resp = await post('/painel/fila/nova', { numero: '5583900000003', texto: 'Oi, aqui é do suporte', canal_id: '2' });
  assert.strictEqual(resp.status, 302);
  const conversa = db.prepare("SELECT * FROM conversas WHERE numero = '5583900000003@s.whatsapp.net'").get();
  assert.strictEqual(conversa.canal_id, 2);
  assert.strictEqual(sockB.enviadas.at(-1).texto, 'Oi, aqui é do suporte');
});

test('cada número com o seu fluxo: o cliente segue o bot do número por onde escreve', async () => {
  let resp = await post('/painel/fluxo/fluxos', { nome: 'Suporte técnico', base: 'modelo:provedor' });
  const idFluxo = Number(/fluxo=(\d+)/.exec(resp.headers.get('location'))[1]);
  assert.ok(listarFluxos().some((f) => f.id === idFluxo && f.nome === 'Suporte técnico'));
  await post('/painel/configuracoes/whatsapp/numeros/2', { nome: 'Suporte 2', fluxo_id: String(idFluxo) });
  assert.strictEqual(canais.obterCanal(2).fluxo_id, idFluxo);

  const cliente = '5583900000004@s.whatsapp.net';
  sockB.enviadas.length = 0;
  await tratarMensagemRecebida(sockB, msg(cliente, 'oi'), negocio, carregarFluxoPorId(1), { canalId: 2 });
  assert.match(sockB.enviadas[0].texto, /Estou sem internet ou está lenta/, 'número 2: bot do provedor');
  assert.strictEqual(carregarFluxoDaConversa(cliente)._id, idFluxo);
  await tratarMensagemRecebida(sockB, msg(cliente, '1'), negocio, carregarFluxoPorId(1), { canalId: 2 });
  assert.match(sockB.enviadas[1].texto, /desligou o roteador/);

  // o mesmo cliente escreve no número 1: começa no bot do número 1
  sockA.enviadas.length = 0;
  await tratarMensagemRecebida(sockA, msg(cliente, 'bom dia'), negocio, carregarFluxoPorId(1), { canalId: 1 });
  assert.match(sockA.enviadas[0].texto, /Fazer um pedido/, 'número 1: o fluxo Principal, do início');

  // excluir: o Principal nunca; um fluxo em uso também não
  resp = await post('/painel/fluxo/fluxos/1/excluir');
  assert.match(decodeURIComponent(resp.headers.get('location')), /Principal não pode ser excluído/);
  resp = await post(`/painel/fluxo/fluxos/${idFluxo}/excluir`);
  assert.match(decodeURIComponent(resp.headers.get('location')), /sendo usado por um número/);
});

test('editor: cada fluxo abre, salva e tem as versões dele (o arquivo do Principal não muda)', async () => {
  const idFluxo = listarFluxos().find((f) => f.nome === 'Suporte técnico').id;
  const dados = await (await fetch(`${baseUrl}/painel/fluxo/dados?fluxo=${idFluxo}`, { headers: { cookie } })).json();
  assert.ok(dados.nos.suporte_reiniciou);
  dados.nos.menu.texto = 'Menu do suporte técnico, mudado';
  const resp = await fetch(`${baseUrl}/painel/fluxo/salvar?fluxo=${idFluxo}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(dados) });
  assert.ok((await resp.json()).ok);
  assert.strictEqual(carregarFluxoPorId(idFluxo).nos.menu.texto, 'Menu do suporte técnico, mudado');
  assert.strictEqual(fs.readFileSync(process.env.CHATDIGITAL_FLUXO, 'utf8'), arquivoFluxoAntes, 'o arquivo do Principal não mudou');
  assert.deepStrictEqual(versoes.listarVersoes(idFluxo).map((v) => v.origem), ['Salvo no editor', 'Como estava antes do histórico de versões']);
  assert.strictEqual(versoes.listarVersoes(1).length, 1, 'o Principal tem as versões dele');

  const tela = await pagina(`/painel/fluxo?fluxo=${idFluxo}`);
  assert.ok(tela.includes(`data-fluxo="${idFluxo}"`));
  assert.ok(tela.includes('Suporte técnico (1 número)'));
  assert.ok((await pagina(`/painel/fluxo/versoes?fluxo=${idFluxo}`)).includes('Versões do fluxo Suporte técnico'));
  const exportado = await fetch(`${baseUrl}/painel/fluxo/exportar?fluxo=${idFluxo}`, { headers: { cookie } });
  assert.strictEqual((await exportado.json()).nos.menu.texto, 'Menu do suporte técnico, mudado');
});

test('status do sistema: um item por número', () => {
  whatsappStatus.definirDesconectado(2);
  const nomes = montarStatus().itens.map((i) => `${i.nome}: ${i.nivel}`);
  assert.ok(nomes.includes('WhatsApp: Suporte 1: ok'));
  assert.ok(nomes.includes('WhatsApp: Suporte 2: problema'));
});

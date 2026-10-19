const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E3, 2a parte: campanhas (público por tag, fila, pausar/retomar/cancelar, teste, frase-chave).
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e3campanhas-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.CHATDIGITAL_FLUXO = path.join(diretorioTeste, 'fluxo.json');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify({ nome: 'Gás Exemplo', formas_pagamento: ['Pix'], produtos: [], faq: [] }));
fs.copyFileSync(path.join(__dirname, '..', 'config', 'fluxo.json'), process.env.CHATDIGITAL_FLUXO);

const { app } = require('../src/server');
const { db } = require('../src/db');
const { carregarFluxo } = require('../src/fluxo');
const { definirSocket } = require('../src/socket-atual');
const { obterOuCriarConversa, renomearContato, listarMensagens } = require('../src/conversas');
const contatos = require('../src/contatos');
const envios = require('../src/envios');
const campanhas = require('../src/campanhas');
const { tratarMensagemRecebida } = require('../src/bot');

const fluxo = carregarFluxo();
let servidor;
let baseUrl;
let cookie;
const enviadas = [];
let contador = 0;
const sockFalso = {
  sendMessage: async (numero, conteudo) => {
    enviadas.push({ numero, texto: conteudo.text });
    contador += 1;
    return { key: { id: `C${contador}`, fromMe: true } };
  },
};
function segundaAs10() {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}
const msg = (numero, texto) => ({ key: { remoteJid: numero, id: `R${Math.random()}`, fromMe: false }, message: { conversation: texto }, pushName: 'Cliente' });
function post(caminho, campos = {}) {
  const corpo = new URLSearchParams();
  for (const [chave, valor] of Object.entries(campos)) [].concat(valor).forEach((v) => corpo.append(chave, v));
  return fetch(`${baseUrl}${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, body: corpo, redirect: 'manual' });
}
const pagina = async (caminho) => (await fetch(`${baseUrl}${caminho}`, { headers: { cookie } })).text();
async function esvaziarFila() {
  for (let i = 0; i < 20; i += 1) {
    const r = await envios.processarFila({ agora: segundaAs10(), forcar: true });
    if (r.esperando) return;
  }
}

let vip;
let condominio;
const ids = {};

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
  vip = contatos.criarTag('VIP');
  condominio = contatos.criarTag('Condomínio');
  // ana: VIP + condomínio, aceitou; beto: VIP, não aceitou; caio: condomínio, aceitou; dani: VIP, ignorada; edu: VIP, saiu
  const pessoas = [['ana', [vip, condominio], 1], ['beto', [vip], 0], ['caio', [condominio], 1], ['dani', [vip], 1], ['edu', [vip], 1]];
  pessoas.forEach(([nome, tags, aceitou], i) => {
    const c = obterOuCriarConversa(`55819000003${i}@s.whatsapp.net`);
    renomearContato(c.id, nome[0].toUpperCase() + nome.slice(1));
    contatos.salvarContato(c.id, { tags, consentimento_enviado: '1', consentimento: aceitou ? '1' : '' });
    ids[nome] = c.id;
  });
  contatos.definirSituacao(ids.dani, 'ignorado');
  db.prepare("UPDATE conversas SET consentimento = 0, optout_em = ? WHERE id = ?").run(new Date().toISOString(), ids.edu);
});

after(async () => {
  definirSocket(null);
  await new Promise((resolve) => servidor.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('público: tags (qualquer/todas), só quem aceitou, e nunca ignorado, bloqueado ou quem saiu', () => {
  const nomes = (publico) => campanhas.montarPublico({ excluirDias: 7, ...publico }).lista.map((c) => c.nome_contato).sort();
  assert.deepStrictEqual(nomes({ tags: [vip], modoTags: 'qualquer', soConsentiu: false }), ['Ana', 'Beto']);
  assert.deepStrictEqual(nomes({ tags: [vip], modoTags: 'qualquer', soConsentiu: true }), ['Ana']);
  assert.deepStrictEqual(nomes({ tags: [vip, condominio], modoTags: 'todas', soConsentiu: false }), ['Ana']);
  assert.deepStrictEqual(nomes({ tags: [vip, condominio], modoTags: 'qualquer', soConsentiu: true }), ['Ana', 'Caio']);
  assert.deepStrictEqual(nomes({ tags: [], soConsentiu: true }), ['Ana', 'Caio'], 'sem tag = todos (que aceitaram)');
  assert.strictEqual(campanhas.montarPublico({ tags: [vip], modoTags: 'qualquer', soConsentiu: true, excluirDias: 7 }).semConsentimento, 1);
});

test('validação: nome, mensagem, frase-chave proibida e bloco do fluxo', () => {
  const v = (corpo) => campanhas.validar({ nome: 'X', texto: 'Oi', ...corpo }, { blocosDoFluxo: ['menu'], setores: ['Geral'] });
  assert.match(v({ nome: '' }).erro, /nome/);
  assert.match(v({ texto: '' }).erro, /mensagem/);
  assert.match(v({ frase_chave: 'Sair' }).erro, /não pode/);
  assert.match(v({ frase_chave: 'PROMO', acao_frase: 'bloco', bloco_frase: 'nao-existe' }).erro, /bloco/);
  assert.deepStrictEqual(JSON.parse(v({ tags: [String(vip)], so_consentiu: '1', excluir_dias: '3' }).campos.publico), { tags: [vip], modoTags: 'qualquer', soConsentiu: true, excluirDias: 3 });
  assert.strictEqual(campanhas.textoComSair('Oi! Responda SAIR para sair.'), 'Oi! Responda SAIR para sair.', 'já fala em SAIR');
  assert.match(campanhas.textoComSair('Oi!'), /responda SAIR\.\)$/);
});

test('campanha pela tela: cria, testa, começa, manda devagar, pausa, retoma e conclui', async () => {
  let resp = await post('/painel/campanhas/nova', { nome: 'Promo VIP', texto: 'Oi, {{cliente.nome}}! Promoção na {{negocio.nome}}. Responda PROMO.', tags: [String(vip), String(condominio)], modo_tags: 'qualquer', so_consentiu: '1', excluir_dias: '7', frase_chave: 'PROMO', acao_frase: 'atendente', setor_frase: 'Geral' });
  const id = Number(/campanha\/(\d+)/.exec(resp.headers.get('location'))[1]);
  let tela = await pagina(`/painel/campanhas/campanha/${id}`);
  assert.match(tela, /<strong>2<\/strong> clientes vão receber; 1 ficaram de fora/);
  assert.ok(tela.includes('Oi, Maria! Promoção na Gás Exemplo. Responda PROMO.'));

  // teste: sai na hora, não conta nos números
  resp = await post(`/painel/campanhas/campanha/${id}/teste`, { conversa_id: String(ids.beto) });
  assert.strictEqual(resp.headers.get('location'), `/painel/campanhas/campanha/${id}?aviso=teste`);
  assert.match(enviadas.pop().texto, /^Oi, Beto! Promoção na Gás Exemplo\. Responda PROMO\.\n\n\(Para não receber/);
  assert.strictEqual(campanhas.numerosDaCampanha(id).total, 0);

  resp = await post(`/painel/campanhas/campanha/${id}/iniciar`, {});
  assert.strictEqual(resp.headers.get('location'), `/painel/campanhas/campanha/${id}?aviso=iniciada`);
  assert.strictEqual(campanhas.obterCampanha(id).status, 'enviando');
  assert.strictEqual(campanhas.numerosDaCampanha(id).pendentes, 2);
  // rascunho não muda mais
  await post(`/painel/campanhas/campanha/${id}`, { nome: 'Outro nome', texto: 'x' });
  assert.strictEqual(campanhas.obterCampanha(id).nome, 'Promo VIP');

  await post(`/painel/campanhas/campanha/${id}/pausar`);
  assert.deepStrictEqual(await envios.processarFila({ agora: segundaAs10(), forcar: true }), { esperando: 'Nada para mandar' }, 'pausada não manda');
  await post(`/painel/campanhas/campanha/${id}/retomar`);
  await esvaziarFila();
  assert.deepStrictEqual(enviadas.map((e) => e.texto.split('!')[0]).sort(), ['Oi, Ana', 'Oi, Caio']);
  assert.strictEqual(campanhas.obterCampanha(id).status, 'concluida');
  assert.strictEqual(campanhas.numerosDaCampanha(id).enviados, 2);
  assert.ok((await pagina('/painel/campanhas/lista')).includes('Promo VIP'));

  // não repete para quem recebeu nos últimos 7 dias
  assert.strictEqual(campanhas.montarPublico({ tags: [], soConsentiu: true, excluirDias: 7 }).lista.length, 0);
});

test('respostas: frase-chave vai para atendente; outra resposta segue o bot; bloco do fluxo', async () => {
  const numeroAna = db.prepare('SELECT numero FROM conversas WHERE id = ?').get(ids.ana).numero;
  await tratarMensagemRecebida(sockFalso, msg(numeroAna, 'promo!'), { nome: 'Gás Exemplo' }, fluxo);
  const ana = db.prepare('SELECT * FROM conversas WHERE id = ?').get(ids.ana);
  assert.strictEqual(ana.status, 'aguardando');
  assert.ok(listarMensagens(ids.ana).some((m) => m.interna && /frase-chave "PROMO"/.test(m.texto)));

  const numeroCaio = db.prepare('SELECT numero FROM conversas WHERE id = ?').get(ids.caio).numero;
  enviadas.length = 0;
  await tratarMensagemRecebida(sockFalso, msg(numeroCaio, 'quanto custa?'), { nome: 'Gás Exemplo' }, fluxo);
  assert.ok(listarMensagens(ids.caio).some((m) => m.interna && /Respondeu à campanha "Promo VIP"\./.test(m.texto)));
  assert.match(enviadas[0].texto, /Olá! Aqui é o atendimento automático/, 'segue o bot normal');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM envios WHERE tipo = 'campanha' AND respondido_em IS NOT NULL").get().n, 2);

  // frase-chave que começa o bot num bloco do fluxo
  const k = campanhas.criarCampanha({ ...campanhas.validar({ nome: 'Faq', texto: 'Dúvidas? Responda AJUDA', frase_chave: 'Ajuda', acao_frase: 'bloco', bloco_frase: 'faq', so_consentiu: '' }, { blocosDoFluxo: ['faq'], setores: ['Geral'] }).campos });
  const beto = db.prepare('SELECT * FROM conversas WHERE id = ?').get(ids.beto);
  db.prepare("INSERT INTO envios (tipo, referencia_id, conversa_id, texto, status, agendado_para, criado_em, enviado_em) VALUES ('campanha', ?, ?, 'x', 'enviado', ?, ?, ?)").run(k, beto.id, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
  enviadas.length = 0;
  await tratarMensagemRecebida(sockFalso, msg(beto.numero, 'AJUDA'), { nome: 'Gás Exemplo' }, fluxo);
  assert.strictEqual(db.prepare('SELECT no_fluxo_atual FROM conversas WHERE id = ?').get(beto.id).no_fluxo_atual, 'faq');
  assert.ok(enviadas.length, 'o bot respondeu a partir do bloco faq');
});

test('cancelar, duplicar e excluir rascunho', async () => {
  const resp = await post('/painel/campanhas/nova', { nome: 'Para cancelar', texto: 'Oi', so_consentiu: '', excluir_dias: '0' });
  const id = Number(/campanha\/(\d+)/.exec(resp.headers.get('location'))[1]);
  await post(`/painel/campanhas/campanha/${id}/iniciar`, {});
  assert.ok(campanhas.numerosDaCampanha(id).pendentes >= 1);
  await post(`/painel/campanhas/campanha/${id}/cancelar`);
  assert.strictEqual(campanhas.obterCampanha(id).status, 'cancelada');
  assert.strictEqual(campanhas.numerosDaCampanha(id).pendentes, 0);
  assert.ok(campanhas.numerosDaCampanha(id).cancelados >= 1);

  const copia = await post(`/painel/campanhas/campanha/${id}/duplicar`);
  const idCopia = Number(/campanha\/(\d+)/.exec(copia.headers.get('location'))[1]);
  assert.strictEqual(campanhas.obterCampanha(idCopia).nome, 'Para cancelar (cópia)');
  assert.strictEqual(campanhas.obterCampanha(idCopia).status, 'rascunho');
  await post(`/painel/campanhas/campanha/${idCopia}/excluir`);
  assert.strictEqual(campanhas.obterCampanha(idCopia), null);

  // público vazio não começa
  const vazia = await post('/painel/campanhas/nova', { nome: 'Vazia', texto: 'Oi', tags: '9999', so_consentiu: '1', excluir_dias: '7' });
  const idVazia = Number(/campanha\/(\d+)/.exec(vazia.headers.get('location'))[1]);
  assert.match(await (await post(`/painel/campanhas/campanha/${idVazia}/iniciar`, {})).text(), /Ninguém para receber/);
});

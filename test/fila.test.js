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
const { db } = require('../src/db');

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

  resp = await fetch(`${baseUrl}/painel/fila?filtro=fila`, { headers: { cookie: cookieAdmin } });
  let corpo = await resp.text();
  assert.match(corpo, /5511999998888/);
  assert.match(corpo, /Geral/, 'deve casar com o setor "geral" do fluxo, seedado como "Geral" no banco');
  assert.match(corpo, /chip-filtro ativo[^"]*"[^>]*>\s*Na fila/, 'filtro "Na fila" deve estar ativo');
  assert.match(corpo, /class="bolinha bolinha-/, 'ninguém assumiu ainda: é a vez do atendente, tem bolinha'); 

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
  assert.match(corpo, /Atendendo: Paulo Admin/, 'atendente que assumiu deve aparecer no detalhe');
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

  resp = await fetch(`${baseUrl}/painel/fila?filtro=todas`, { headers: { cookie: cookieAdmin } });
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

test('tela dividida: "parado no fluxo" aparece, "puxar pra mim" assume, e transferir muda de setor', async () => {
  let resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  const cookieAdmin = extrairCookie(resp);

  resp = await fetch(`${baseUrl}/painel/setores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieAdmin },
    body: new URLSearchParams({ nome: 'Suporte' }),
  });

  const numeroParado = '5511988887777@s.whatsapp.net';
  await simularMensagemDoCliente(numeroParado, 'oi'); // pergunta o menu e fica esperando — "parado no fluxo"

  resp = await fetch(`${baseUrl}/painel/fila?filtro=bot`, { headers: { cookie: cookieAdmin } });
  let corpo = await resp.text();
  assert.match(corpo, /5511988887777/, 'conversa parada no fluxo deve aparecer no filtro "No bot"');
  assert.match(corpo, /\/puxar" class="item-puxar"/, 'cada conversa no bot tem o botão Puxar na própria linha');

  const idParado = corpo.match(/href="\/painel\/fila\/(\d+)"[^>]*>\s*<span class="item-numero">5511988887777/)[1];

  resp = await fetch(`${baseUrl}/painel/fila/${idParado}/puxar`, {
    method: 'POST',
    headers: { cookie: cookieAdmin },
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 302);

  resp = await fetch(`${baseUrl}/painel/fila/${idParado}`, { headers: { cookie: cookieAdmin } });
  corpo = await resp.text();
  assert.match(corpo, /Atendendo: Paulo Admin/, '"puxar pra mim" deve assumir a conversa direto');

  // o bot não deve mais responder esse número (foi transferido manualmente)
  const respostaAposPuxar = await simularMensagemDoCliente(numeroParado, 'oi de novo');
  assert.strictEqual(respostaAposPuxar, null, 'bot deve ficar em silêncio depois do "puxar pra mim"');

  // transferir pra outro setor
  resp = await fetch(`${baseUrl}/painel/setores`, { headers: { cookie: cookieAdmin } });
  corpo = await resp.text();
  const matchSetor = corpo.match(/action="\/painel\/setores\/(\d+)"[^>]*>\s*<input type="text" name="nome" value="Suporte"/);
  const setorSuporteId = Number(matchSetor[1]);

  resp = await fetch(`${baseUrl}/painel/fila/${idParado}/transferir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieAdmin },
    body: new URLSearchParams({ setor_id: String(setorSuporteId) }),
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 302);

  resp = await fetch(`${baseUrl}/painel/fila/${idParado}`, { headers: { cookie: cookieAdmin } });
  corpo = await resp.text();
  assert.match(corpo, /· Suporte\s*<\/p>/, 'transferir deve mudar o setor da conversa');

  console.log('OK: "parado no fluxo" aparece, "puxar pra mim" assume e silencia o bot, transferir muda o setor');
});

test('"parado no fluxo" sobrevive a reiniciar o processo (não depende da memória do motor de fluxo)', async () => {
  let resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  const cookieAdmin = extrairCookie(resp);

  // grava direto no banco, sem passar pelo flow-engine (simula uma conversa que ficou parada
  // ANTES do processo atual existir — o motor de fluxo não tem esse número na memória)
  const numero = '5511955554444@s.whatsapp.net';
  const agora = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO conversas (numero, status, no_fluxo_atual, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)')
    .run(numero, 'bot', 'pergunta-menu', agora, agora);
  db.prepare('INSERT INTO mensagens (conversa_id, remetente, texto, criado_em) VALUES (?, ?, ?, ?)').run(
    Number(info.lastInsertRowid),
    'cliente',
    'oi',
    agora,
  );

  resp = await fetch(`${baseUrl}/painel/fila?filtro=bot`, { headers: { cookie: cookieAdmin } });
  const corpo = await resp.text();
  assert.match(corpo, /5511955554444/, 'deve aparecer como parada mesmo sem o motor de fluxo ter visto esse número neste processo');

  console.log('OK: "parado no fluxo" funciona a partir do banco, sobrevive a reiniciar o processo');
});

test('responder com imagem/vídeo/áudio: manda pro WhatsApp, salva no histórico e mostra na tela; recusa tipo não suportado', async () => {
  let resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  const cookieAdmin = extrairCookie(resp);
  const admin = db.prepare('SELECT id FROM atendentes WHERE email = ?').get('admin@teste.com');

  const numero = '5511922223333@s.whatsapp.net';
  const agora = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO conversas (numero, status, atendente_id, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)')
    .run(numero, 'atendendo', admin.id, agora, agora);
  const idConversa = Number(info.lastInsertRowid);

  const mensagensEnviadas = [];
  definirSocket({
    sendMessage: async (numeroDestino, conteudo) => {
      mensagensEnviadas.push({ numero: numeroDestino, conteudo });
    },
  });

  const formImagem = new FormData();
  formImagem.append('midia', new Blob([Buffer.from('fake-png-bytes')], { type: 'image/png' }), 'foto.png');
  resp = await fetch(`${baseUrl}/painel/fila/${idConversa}/responder`, {
    method: 'POST',
    headers: { cookie: cookieAdmin },
    body: formImagem,
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 302, 'deve redirecionar de volta pra conversa depois de enviar');

  assert.strictEqual(mensagensEnviadas.length, 1);
  assert.ok(Buffer.isBuffer(mensagensEnviadas[0].conteudo.image), 'deve mandar a imagem de verdade pro Baileys');
  assert.strictEqual(mensagensEnviadas[0].conteudo.image.toString(), 'fake-png-bytes');

  resp = await fetch(`${baseUrl}/painel/fila/${idConversa}`, { headers: { cookie: cookieAdmin } });
  let corpo = await resp.text();
  assert.match(corpo, /<img class="mensagem-midia" src="\/uploads\/[^"]+\.png"/, 'deve mostrar a imagem enviada no histórico');

  // PDF também é aceito: manda como documento e mostra um link de download genérico (a coluna
  // midia_tipo só tem imagem/video/audio, então PDF fica com midia_tipo nulo + midia_url)
  const formPdf = new FormData();
  formPdf.append('midia', new Blob([Buffer.from('%PDF-fake')], { type: 'application/pdf' }), 'nota.pdf');
  resp = await fetch(`${baseUrl}/painel/fila/${idConversa}/responder`, {
    method: 'POST',
    headers: { cookie: cookieAdmin },
    body: formPdf,
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 302);
  assert.strictEqual(mensagensEnviadas.length, 2);
  assert.ok(Buffer.isBuffer(mensagensEnviadas[1].conteudo.document), 'deve mandar o PDF de verdade pro Baileys');
  assert.strictEqual(mensagensEnviadas[1].conteudo.mimetype, 'application/pdf');

  resp = await fetch(`${baseUrl}/painel/fila/${idConversa}`, { headers: { cookie: cookieAdmin } });
  corpo = await resp.text();
  assert.match(corpo, /<a class="mensagem-arquivo" href="\/uploads\/[^"]+" target="_blank"[^>]*>📄 Baixar arquivo<\/a>/, 'deve mostrar o link de download do PDF');

  // tipo de verdade não suportado (ex.: um .zip) deve ser recusado com uma mensagem clara
  const formZip = new FormData();
  formZip.append('midia', new Blob([Buffer.from('PK-fake-zip')], { type: 'application/zip' }), 'arquivo.zip');
  resp = await fetch(`${baseUrl}/painel/fila/${idConversa}/responder`, {
    method: 'POST',
    headers: { cookie: cookieAdmin },
    body: formZip,
  });
  corpo = await resp.text();
  assert.match(corpo, /Só dá pra mandar imagem, vídeo, áudio ou PDF/);
  assert.strictEqual(mensagensEnviadas.length, 2, 'não deve ter mandado nada pro .zip recusado');

  definirSocket(null);
  console.log('OK: responder com mídia (imagem/PDF) envia pro WhatsApp, aparece no histórico, e recusa tipo não suportado');
});

test('histórico mostra o nome de quem respondeu, não só "atendente" genérico', async () => {
  let resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  const cookieAdmin = extrairCookie(resp);
  const admin = db.prepare('SELECT id FROM atendentes WHERE email = ?').get('admin@teste.com');

  const numero = '5511933334444@s.whatsapp.net';
  const agora = new Date().toISOString();
  const idConversa = Number(
    db
      .prepare('INSERT INTO conversas (numero, status, atendente_id, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)')
      .run(numero, 'atendendo', admin.id, agora, agora).lastInsertRowid,
  );
  // mensagem de antes da coluna atendente_id existir — continua mostrando "atendente"
  db.prepare('INSERT INTO mensagens (conversa_id, remetente, texto, criado_em) VALUES (?, ?, ?, ?)').run(
    idConversa,
    'atendente',
    'mensagem antiga sem autor',
    agora,
  );

  definirSocket({ sendMessage: async () => {} });
  resp = await fetch(`${baseUrl}/painel/fila/${idConversa}/responder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieAdmin },
    body: new URLSearchParams({ texto: 'Seu gás sai em 20 minutos' }),
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 302);
  definirSocket(null);

  const gravada = db.prepare('SELECT atendente_id FROM mensagens WHERE conversa_id = ? AND texto = ?').get(idConversa, 'Seu gás sai em 20 minutos');
  assert.strictEqual(gravada.atendente_id, admin.id, 'deve guardar quem mandou a mensagem');

  resp = await fetch(`${baseUrl}/painel/fila/${idConversa}`, { headers: { cookie: cookieAdmin } });
  const corpo = await resp.text();
  assert.match(corpo, /<span class="mensagem-remetente">Paulo Admin<\/span>\s*<p>Seu gás sai em 20 minutos<\/p>/, 'balão deve mostrar o nome do atendente');
  assert.match(corpo, /<span class="mensagem-remetente">atendente<\/span>\s*<p>mensagem antiga sem autor<\/p>/, 'mensagem antiga continua com "atendente"');

  // balão formata como o WhatsApp (*negrito*, quebra de linha), mas texto do cliente nunca vira HTML
  const inserir = db.prepare('INSERT INTO mensagens (conversa_id, remetente, texto, criado_em) VALUES (?, ?, ?, ?)');
  inserir.run(idConversa, 'bot', 'Aqui é a *Nazagas*.\n1. Fazer um pedido', agora);
  inserir.run(idConversa, 'cliente', '<script>alert(1)</script> *<img src=x onerror=alert(1)>*', agora);
  resp = await fetch(`${baseUrl}/painel/fila/${idConversa}`, { headers: { cookie: cookieAdmin } });
  const corpoFormatado = await resp.text();
  assert.match(corpoFormatado, /<p>Aqui é a <strong>Nazagas<\/strong>\.\n1\. Fazer um pedido<\/p>/, 'negrito vira <strong> e a quebra de linha fica');
  assert.doesNotMatch(corpoFormatado, /<script>alert\(1\)<\/script>|<img src=x/, 'HTML do cliente não pode ir cru pra tela');
  assert.match(corpoFormatado, /&lt;script&gt;alert\(1\)&lt;\/script&gt; <strong>&lt;img src=x onerror=alert\(1\)&gt;<\/strong>/);

  console.log('OK: histórico mostra o nome do atendente que respondeu');
});

test('fila: "Minhas" em ordem de espera, bolinha amarela/vermelha pelo tempo, sem bolinha quando a vez é do cliente', async () => {
  let resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  const cookieAdmin = extrairCookie(resp);
  const admin = db.prepare('SELECT id FROM atendentes WHERE email = ?').get('admin@teste.com');

  const minutosAtras = (m) => new Date(Date.now() - m * 60000).toISOString();
  function conversaDoAdmin(numero, mensagens) {
    const id = Number(
      db
        .prepare('INSERT INTO conversas (numero, status, atendente_id, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)')
        .run(numero, 'atendendo', admin.id, minutosAtras(60), minutosAtras(0)).lastInsertRowid,
    );
    for (const [remetente, texto, minutos] of mensagens) {
      db.prepare('INSERT INTO mensagens (conversa_id, remetente, texto, criado_em) VALUES (?, ?, ?, ?)').run(id, remetente, texto, minutosAtras(minutos));
    }
  }
  // padrão (sem nada em Configurações): amarela a partir de 0 min, vermelha a partir de 10 min
  conversaDoAdmin('5511944440002@s.whatsapp.net', [['atendente', 'oi', 20], ['cliente', 'cadê meu gás?', 2]]);
  conversaDoAdmin('5511944440015@s.whatsapp.net', [['atendente', 'oi', 30], ['cliente', 'alô', 15], ['cliente', 'alguém?', 5]]);
  conversaDoAdmin('5511944440099@s.whatsapp.net', [['cliente', 'quero 1 botijão', 9], ['atendente', 'já sai', 1]]);

  resp = await fetch(`${baseUrl}/painel/fila?filtro=minhas`, { headers: { cookie: cookieAdmin } });
  const corpo = await resp.text();
  const ordem = [...corpo.matchAll(/item-numero">(55119444400\d\d)/g)].map((m) => m[1]);
  assert.deepStrictEqual(ordem, ['5511944440015', '5511944440002', '5511944440099'], 'quem espera há mais tempo em cima; quem já foi respondido por último');

  const trecho = (numero) => corpo.slice(corpo.indexOf(`item-numero">${numero}`), corpo.indexOf('</div>', corpo.indexOf(`item-numero">${numero}`)));
  assert.match(trecho('5511944440015'), /bolinha-vermelha/, 'esperando desde a 1a mensagem sem resposta (15 min) — vermelha');
  assert.match(trecho('5511944440015'), /há 15 min/);
  assert.match(trecho('5511944440002'), /bolinha-amarela/, 'esperando há 2 min — amarela');
  assert.doesNotMatch(trecho('5511944440099'), /bolinha/, 'atendente respondeu por último: a vez é do cliente, sem bolinha');
  assert.match(trecho('5511944440099'), /Você: já sai/);

  console.log('OK: fila ordena por tempo de espera e pinta a bolinha conforme os minutos de Configurações');
});

test('nova conversa: cria e assume com número que existe no WhatsApp, recusa número que não existe', async () => {
  let resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  const cookieAdmin = extrairCookie(resp);

  const mensagensEnviadas = [];
  definirSocket({
    onWhatsApp: async (jid) => {
      const numero = jid.replace('@s.whatsapp.net', '');
      return numero === '5511900001111' ? [{ exists: true, jid }] : [{ exists: false, jid }];
    },
    sendMessage: async (numero, msg) => {
      mensagensEnviadas.push({ numero, texto: msg.text });
    },
  });

  // número que não existe no WhatsApp: recusa, sem criar conversa nenhuma
  resp = await fetch(`${baseUrl}/painel/fila/nova`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieAdmin },
    body: new URLSearchParams({ numero: '5511900009999', texto: '' }),
  });
  let corpo = await resp.text();
  assert.match(corpo, /não tem WhatsApp/);
  assert.strictEqual(mensagensEnviadas.length, 0);

  // número real: cria a conversa já "atendendo" com quem criou, manda a mensagem inicial
  resp = await fetch(`${baseUrl}/painel/fila/nova`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieAdmin },
    body: new URLSearchParams({ numero: '(55) 11 90000-1111', texto: 'Oi! Vi que você pediu contato, aqui é a loja.' }),
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 302, 'deve redirecionar pra conversa recém-criada');
  assert.strictEqual(mensagensEnviadas.length, 1);
  assert.strictEqual(mensagensEnviadas[0].numero, '5511900001111@s.whatsapp.net', 'deve limpar a formatação e montar o JID certo');
  assert.strictEqual(mensagensEnviadas[0].texto, 'Oi! Vi que você pediu contato, aqui é a loja.');

  resp = await fetch(`${baseUrl}${resp.headers.get('location')}`, { headers: { cookie: cookieAdmin } });
  corpo = await resp.text();
  assert.match(corpo, /5511900001111/);
  assert.match(corpo, /Atendendo: /, 'conversa já deve nascer assumida por quem a criou, não esperando outro atendente');
  assert.match(corpo, /Oi! Vi que você pediu contato, aqui é a loja\./);

  // regressão: a primeira resposta do cliente não pode acordar o bot do fluxo — a conversa já
  // nasceu "com humano" (o motor de fluxo tem memória própria, separada do banco)
  const respostaDoBot = await processarMensagem({ numero: '5511900001111@s.whatsapp.net', texto: 'oi, chegou minha mensagem?', negocio: {}, fluxo });
  assert.strictEqual(respostaDoBot, null, 'bot deve ficar em silêncio — a conversa já foi iniciada por um atendente humano');

  definirSocket(null);
  console.log('OK: nova conversa cria e assume com número válido, recusa número sem WhatsApp, e não deixa o bot acordar');
});

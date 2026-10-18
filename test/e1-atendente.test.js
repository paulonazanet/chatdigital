const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E1 (atendente no dia a dia): notas internas, protocolo, respostas rápidas e motivo de encerramento.
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e1-teste-'));
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
  formas_pagamento: ['Pix'],
  produtos: [{ id: 'p13', nome: 'Botijão 13kg', preco: 120 }],
  faq: [],
  mensagem_boas_vindas_atendente: 'Oi! Aqui é {{atendente.nome}}. Protocolo {{atendimento.protocolo}}.',
  mensagem_encerramento: 'Fechado por aqui!',
  pesquisa_satisfacao: '',
};
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify(negocio));
const fluxo = carregarFluxo();

let servidor;
let baseUrl;
let cookie;
const enviadas = [];

async function clienteEscreve(numero, texto) {
  registrarMensagem(numero, 'cliente', texto);
  const resposta = await processarMensagem({ numero, texto, negocio, fluxo });
  sincronizarConversa(numero, fluxo);
  if (resposta) registrarMensagem(numero, 'bot', resposta);
}

function post(caminho, campos = {}) {
  return fetch(`${baseUrl}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(campos),
    redirect: 'manual',
  });
}
async function pagina(caminho) {
  return (await fetch(`${baseUrl}${caminho}`, { headers: { cookie } })).text();
}

// cliente pede atendente, admin assume: devolve o id da conversa
async function conversaAssumida(numero) {
  await clienteEscreve(numero, 'oi');
  await clienteEscreve(numero, '3');
  const id = db.prepare('SELECT id FROM conversas WHERE numero = ?').get(numero).id;
  await post(`/painel/fila/${id}/assumir`);
  return id;
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
  definirSocket({ sendMessage: async (numero, msg) => enviadas.push({ numero, texto: msg.text }) });
});

after(async () => {
  definirSocket(null);
  await new Promise((resolve) => servidor.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('protocolo: cada atendimento ganha um, vai na boas-vindas e aparece no topo da conversa', async () => {
  enviadas.length = 0;
  const id = await conversaAssumida('5511900000001@s.whatsapp.net');
  const atendimento = db.prepare('SELECT protocolo FROM atendimentos WHERE conversa_id = ?').get(id);
  assert.match(atendimento.protocolo, /^\d{8}\d{4,}$/);
  assert.strictEqual(enviadas.at(-1).texto, `Oi! Aqui é Carla. Protocolo ${atendimento.protocolo}.`);
  const corpo = await pagina(`/painel/fila/${id}`);
  assert.match(corpo, new RegExp(`Protocolo <span class="protocolo">${atendimento.protocolo}`));
});

test('nota interna: não vai pro cliente, aparece no histórico e não conta como resposta', async () => {
  const id = await conversaAssumida('5511900000002@s.whatsapp.net');
  await clienteEscreve('5511900000002@s.whatsapp.net', 'quero 2 botijões');
  enviadas.length = 0;

  let resp = await post(`/painel/fila/${id}/responder`, { texto: 'Cliente antigo, paga no fiado', interna: '1' });
  assert.strictEqual(resp.status, 302);
  assert.strictEqual(enviadas.length, 0, 'nota interna não pode ser mandada pelo WhatsApp');

  const corpo = await pagina(`/painel/fila/${id}`);
  assert.match(corpo, /mensagem-nota[\s\S]*Nota interna · Carla[\s\S]*Cliente antigo, paga no fiado/);

  const naFila = listarFila().find((c) => c.id === id);
  assert.strictEqual(naFila.ultima_mensagem, 'quero 2 botijões', 'a nota não vira a "última mensagem" da lista');
  assert.strictEqual(naFila.ultima_mensagem_remetente, 'cliente', 'continua sendo a vez do atendente responder');
  const atendimento = db.prepare('SELECT primeira_resposta_em FROM atendimentos WHERE conversa_id = ?').get(id);
  assert.strictEqual(atendimento.primeira_resposta_em, null, 'nota não conta como 1a resposta no Relatório');

  // pela caixa avulsa (conversa que não está com quem escreve) também funciona
  resp = await post(`/painel/fila/${id}/nota`, { texto: 'Segunda nota' });
  assert.strictEqual(resp.status, 302);
  assert.match(await pagina(`/painel/fila/${id}`), /Segunda nota/);
});

test('transferir grava uma nota do sistema dizendo de onde, pra onde e quem transferiu', async () => {
  const id = await conversaAssumida('5511900000003@s.whatsapp.net');
  const setor = db.prepare("INSERT INTO setores (nome) VALUES ('Entregas')").run();
  await post(`/painel/fila/${id}/transferir`, { setor_id: String(setor.lastInsertRowid) });
  const nota = db.prepare('SELECT texto, interna, atendente_id FROM mensagens WHERE conversa_id = ? AND interna = 1').get(id);
  assert.strictEqual(nota.texto, 'Transferida de Geral · Carla para Entregas, por Carla.');
  assert.strictEqual(nota.atendente_id, null);
  assert.match(await pagina(`/painel/fila/${id}`), /Nota interna · sistema/);
});

test('respostas rápidas: cadastro, variáveis trocadas na conversa, setor e validade', async () => {
  let resp = await post('/painel/respostas-rapidas', {
    nome: 'Horário',
    texto: '{{saudacao}}, {{cliente.nome}}! Entregamos até as 18h. Protocolo {{atendimento.protocolo}}.',
    ativa: '1',
  });
  assert.strictEqual(resp.status, 302);
  const outroSetor = db.prepare("INSERT INTO setores (nome) VALUES ('Financeiro')").run().lastInsertRowid;
  await post('/painel/respostas-rapidas', { nome: 'Só financeiro', texto: 'Boleto', ativa: '1', setores: String(outroSetor) });
  await post('/painel/respostas-rapidas', { nome: 'Vencida', texto: 'Promo antiga', ativa: '1', expira_em: '2020-01-01' });
  await post('/painel/respostas-rapidas', { nome: 'Desligada', texto: 'Não usar', expira_em: '' });

  const lista = await pagina('/painel/respostas-rapidas');
  assert.match(lista, /Horário/);
  assert.match(lista, /vencida/);
  assert.match(lista, /inativa/);

  const numero = '5511900000004@s.whatsapp.net';
  const id = await conversaAssumida(numero);
  db.prepare("UPDATE conversas SET nome_contato = 'Maria' WHERE id = ?").run(id);
  const corpo = await pagina(`/painel/fila/${id}`);
  const dados = JSON.parse(/id="respostas-rapidas-dados">([\s\S]*?)<\/script>/.exec(corpo)[1]);
  const protocolo = db.prepare('SELECT protocolo FROM atendimentos WHERE conversa_id = ?').get(id).protocolo;
  assert.deepStrictEqual(dados.map((r) => r.nome), ['Horário'], 'só a ativa, válida e do setor da conversa (ou de todos)');
  assert.match(dados[0].texto, new RegExp(`^(Bom dia|Boa tarde|Boa noite), Maria! Entregamos até as 18h\\. Protocolo ${protocolo}\\.$`));
  assert.match(corpo, /class="botao-respostas"/);

  // duplicar e excluir
  const original = db.prepare("SELECT id FROM respostas_rapidas WHERE nome = 'Horário'").get().id;
  await post(`/painel/respostas-rapidas/${original}/duplicar`);
  assert.ok(db.prepare("SELECT 1 FROM respostas_rapidas WHERE nome = 'Horário (cópia)'").get());
  await post(`/painel/respostas-rapidas/${original}/excluir`);
  assert.ok(!db.prepare('SELECT 1 FROM respostas_rapidas WHERE id = ?').get(original));

  resp = await post('/painel/respostas-rapidas', { nome: '', texto: 'sem nome' });
  assert.match(await resp.text(), /Dê um nome/);
});

test('motivo de encerramento: lista padrão, fica no atendimento, e é exigido quando configurado', async () => {
  const id = await conversaAssumida('5511900000005@s.whatsapp.net');
  const motivo = db
    .prepare("SELECT m.id FROM motivos_encerramento m JOIN motivos_encerramento g ON g.id = m.pai_id WHERE g.nome = 'Resolvido' AND m.nome = 'Pedido feito'")
    .get();
  assert.ok(motivo, 'a lista padrão é criada na 1a vez');
  assert.match(await pagina(`/painel/fila/${id}`), /<optgroup label="Resolvido">/);

  await post(`/painel/fila/${id}/finalizar`, { motivo_id: String(motivo.id) });
  const atendimento = db.prepare('SELECT motivo_texto FROM atendimentos WHERE conversa_id = ? ORDER BY id DESC').get(id);
  assert.strictEqual(atendimento.motivo_texto, 'Resolvido › Pedido feito');

  // exigir motivo ligado em Configurações: sem motivo não finaliza
  fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify({ ...negocio, exigir_motivo_encerramento: true }));
  const id2 = await conversaAssumida('5511900000006@s.whatsapp.net');
  const resp = await post(`/painel/fila/${id2}/finalizar`, {});
  assert.match(await resp.text(), /Escolha o motivo do encerramento/);
  assert.strictEqual(db.prepare('SELECT status FROM conversas WHERE id = ?').get(id2).status, 'atendendo');
  fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify(negocio));

  // tela de cadastro: cria grupo e motivo, desativa
  await post('/painel/configuracoes/motivos', { nome: 'Vendas' });
  const grupo = db.prepare("SELECT id FROM motivos_encerramento WHERE nome = 'Vendas' AND pai_id IS NULL").get();
  await post('/painel/configuracoes/motivos', { nome: 'Orçamento enviado', pai_id: String(grupo.id) });
  const novo = db.prepare("SELECT id FROM motivos_encerramento WHERE nome = 'Orçamento enviado'").get();
  await post(`/painel/configuracoes/motivos/${novo.id}`, { nome: 'Orçamento enviado' }); // sem "ativo" = desativa
  assert.strictEqual(db.prepare('SELECT ativo FROM motivos_encerramento WHERE id = ?').get(novo.id).ativo, 0);
});

test('histórico separa os atendimentos anteriores do atual com faixas', async () => {
  const numero = '5511900000007@s.whatsapp.net';
  const id = await conversaAssumida(numero);
  await post(`/painel/fila/${id}/finalizar`, {});
  await clienteEscreve(numero, 'oi');
  await clienteEscreve(numero, '3');
  const corpo = await pagina(`/painel/fila/${id}`);
  const faixas = corpo.match(/class="faixa-atendimento"/g) || [];
  assert.strictEqual(faixas.length, 2, 'uma faixa pro atendimento anterior e outra pro atual');
  assert.match(corpo, /· finalizado<\/span>/);
  assert.match(corpo, /· atual<\/span>/);
  const depoisDaFaixaAtual = corpo.slice(corpo.indexOf('· atual</span>'));
  assert.match(depoisDaFaixaAtual, /<p>oi<\/p>/, 'o "oi" que abriu o atendimento novo fica dentro da faixa dele, não antes');
});

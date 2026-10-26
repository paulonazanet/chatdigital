const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E2, 1a parte: Auditoria (filtros, detalhe, exportar), metas no Relatório, tabela por atendente e
// reincidências.
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e2gestao-teste-'));
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
const motivos = require('../src/motivos-encerramento');
const { compararComMeta, listarReincidencias, formatarIntervalo, DIA_MS } = require('../src/relatorio');
const auditoria = require('../src/auditoria');

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
let cookie;

async function clienteEscreve(numero, texto) {
  registrarMensagem(numero, 'cliente', texto);
  const resposta = await processarMensagem({ numero, texto, negocio, fluxo });
  sincronizarConversa(numero, fluxo);
  if (resposta) registrarMensagem(numero, 'bot', resposta);
}
function post(caminho, campos = {}, cookieUsado = cookie) {
  return fetch(`${baseUrl}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieUsado },
    body: new URLSearchParams(campos),
    redirect: 'manual',
  });
}
async function pagina(caminho, cookieUsado = cookie) {
  return (await fetch(`${baseUrl}${caminho}`, { headers: { cookie: cookieUsado } })).text();
}

// Um atendimento inteiro pela Fila: cliente chega pelo bot, atendente assume, responde, escreve
// nota interna e finaliza com motivo. Devolve o id do atendimento.
async function atendimentoCompleto(numero, { resposta, nota, motivoId }) {
  await clienteEscreve(numero, 'oi');
  await clienteEscreve(numero, '3'); // "Falar com um atendente" no fluxo de exemplo
  const conversaId = db.prepare('SELECT id FROM conversas WHERE numero = ?').get(numero).id;
  await post(`/painel/fila/${conversaId}/assumir`);
  await post(`/painel/fila/${conversaId}/responder`, { texto: resposta });
  if (nota) await post(`/painel/fila/${conversaId}/nota`, { texto: nota });
  await post(`/painel/fila/${conversaId}/finalizar`, motivoId ? { motivo_id: String(motivoId) } : {});
  return db.prepare('SELECT id FROM atendimentos WHERE conversa_id = ? ORDER BY id DESC LIMIT 1').get(conversaId).id;
}

// muda os horários de um atendimento (os testes precisam de esperas e datas conhecidas)
function ajustarTempos(id, { abertoHaMin, esperaMin, respostaMin, duracaoMin, nota = null }) {
  const aberto = Date.now() - abertoHaMin * 60000;
  const assumido = aberto + esperaMin * 60000;
  db.prepare('UPDATE atendimentos SET aberto_em = ?, assumido_em = ?, primeira_resposta_em = ?, finalizado_em = ?, nota = ? WHERE id = ?').run(
    new Date(aberto).toISOString(),
    new Date(assumido).toISOString(),
    new Date(aberto + respostaMin * 60000).toISOString(),
    new Date(assumido + duracaoMin * 60000).toISOString(),
    nota,
    id,
  );
}

let motivoResolvido;
let motivoNaoResolvido;

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
  definirSocket({ sendMessage: async () => ({ key: { id: `X${Math.random()}`, fromMe: true } }) });
  const arvore = motivos.listarArvore({ soAtivos: true });
  motivoResolvido = arvore.find((g) => g.nome === 'Resolvido').motivos[0];
  motivoNaoResolvido = arvore.find((g) => g.nome === 'Não resolvido').motivos[0];
});

after(async () => {
  definirSocket(null);
  await new Promise((resolve) => servidor.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

const NUMERO_A = '5581911110001@s.whatsapp.net';
const NUMERO_B = '5581911110002@s.whatsapp.net';
let primeiroA;
let segundoA;
let unicoB;

test('Auditoria: lista os finalizados e o detalhe mostra só as mensagens daquele atendimento', async () => {
  primeiroA = await atendimentoCompleto(NUMERO_A, { resposta: 'Primeira resposta da Carla', nota: 'Cliente quer entrega à tarde', motivoId: motivoResolvido.id });
  segundoA = await atendimentoCompleto(NUMERO_A, { resposta: 'Segunda resposta da Carla', motivoId: motivoNaoResolvido.id });
  unicoB = await atendimentoCompleto(NUMERO_B, { resposta: 'Resposta para o cliente B' });

  const lista = await pagina('/painel/relatorio/auditoria');
  assert.match(lista, /3 atendimentos/);
  const protocolo = db.prepare('SELECT protocolo FROM atendimentos WHERE id = ?').get(primeiroA).protocolo;
  assert.ok(lista.includes(protocolo));

  const detalhe = await pagina(`/painel/relatorio/auditoria/${primeiroA}`);
  assert.ok(detalhe.includes('Primeira resposta da Carla'));
  assert.ok(detalhe.includes('Cliente quer entrega à tarde'), 'a nota interna aparece no detalhe');
  assert.ok(detalhe.includes('nota interna'));
  assert.ok(!detalhe.includes('Segunda resposta da Carla'), 'mensagens do atendimento seguinte não entram');
  assert.ok(detalhe.includes(`/painel/relatorio/auditoria/${segundoA}`), 'link para o outro atendimento do cliente');
  assert.ok(detalhe.includes(motivoResolvido.nome));

  const resp = await fetch(`${baseUrl}/painel/relatorio/auditoria/99999`, { headers: { cookie } });
  assert.strictEqual(resp.status, 404);
});

test('Auditoria: exportar lista (Excel), conversa em texto e versão para imprimir', async () => {
  db.prepare("UPDATE conversas SET nome_contato = '=SOMA(1;2)' WHERE numero = ?").run(NUMERO_A);
  const csv = await fetch(`${baseUrl}/painel/relatorio/auditoria/exportar.csv`, { headers: { cookie } });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="auditoria_/);
  const conteudo = await csv.text();
  const linhas = conteudo.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.strictEqual(linhas.length, 4, 'cabeçalho + 3 atendimentos');
  assert.match(linhas[0], /^Protocolo;Cliente;Telefone;Atendente/);
  assert.match(linhas[1], /^="\d+";/, 'protocolo como texto para o Excel');
  assert.ok(conteudo.includes(`;"'=SOMA(1;2)";`), 'nome que parece fórmula é neutralizado');

  const txt = await fetch(`${baseUrl}/painel/relatorio/auditoria/${primeiroA}/conversa.txt`, { headers: { cookie } });
  assert.match(txt.headers.get('content-disposition'), /atendimento_\d+\.txt/);
  const texto = await txt.text();
  assert.match(texto, /Loja Exemplo · Atendimento \d+/);
  assert.match(texto, /Carla \(nota interna\): Cliente quer entrega à tarde/);
  assert.match(texto, /Carla: Primeira resposta da Carla/);
  assert.ok(!texto.includes('Segunda resposta'));

  const impressao = await pagina(`/painel/relatorio/auditoria/${primeiroA}/imprimir`);
  assert.ok(impressao.includes('Primeira resposta da Carla'));
  assert.ok(!impressao.includes('window.print(), 300'), 'só imprime sozinho com ?imprimir=1');
  assert.ok((await pagina(`/painel/relatorio/auditoria/${primeiroA}/imprimir?imprimir=1`)).includes('window.print(), 300'));
  db.prepare("UPDATE conversas SET nome_contato = NULL WHERE numero = ?").run(NUMERO_A);
});

test('Auditoria: filtros por protocolo, cliente, motivo, nota, "finalizado como" e datas', async () => {
  ajustarTempos(primeiroA, { abertoHaMin: 3 * 24 * 60, esperaMin: 2, respostaMin: 3, duracaoMin: 10, nota: 10 });
  ajustarTempos(segundoA, { abertoHaMin: 2 * 24 * 60, esperaMin: 30, respostaMin: 35, duracaoMin: 50, nota: 4 });
  ajustarTempos(unicoB, { abertoHaMin: 60 * 24 * 60, esperaMin: 5, respostaMin: 6, duracaoMin: 8 });

  const ids = (filtros) => auditoria.listarAuditoria(auditoria.lerFiltros(filtros)).itens.map((i) => i.id).sort();
  assert.deepStrictEqual(ids({}), [primeiroA, segundoA].sort(), 'o padrão é últimos 30 dias');
  const protocoloB = db.prepare('SELECT protocolo FROM atendimentos WHERE id = ?').get(unicoB).protocolo;
  assert.deepStrictEqual(ids({ protocolo: protocoloB }), [unicoB], 'protocolo acha mesmo fora das datas');
  assert.deepStrictEqual(ids({ nota: 'ruim' }), [segundoA]);
  assert.deepStrictEqual(ids({ nota: 'boa' }), [primeiroA]);
  const textoMotivo = db.prepare('SELECT motivo_texto FROM atendimentos WHERE id = ?').get(segundoA).motivo_texto;
  assert.deepStrictEqual(ids({ motivo: textoMotivo }), [segundoA]);
  assert.deepStrictEqual(ids({ cliente: '911110001' }), [primeiroA, segundoA].sort(), 'cliente pelo telefone');
  assert.deepStrictEqual(ids({ como: 'automatico' }), []);
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); // dia de Recife
  const anteontem = new Date(Date.now() - 3 * 3600000 - 2 * DIA_MS).toISOString().slice(0, 10);
  assert.deepStrictEqual(ids({ de: anteontem, ate: hoje }), [segundoA]);
  assert.deepStrictEqual(ids({ de: hoje, ate: anteontem }), [segundoA], 'datas invertidas são trocadas');

  const tela = await pagina('/painel/relatorio/auditoria?nota=ruim');
  assert.match(tela, /1 atendimento\b/);
  assert.ok(tela.includes('Limpar filtros'));
});

test('metas: a tela valida e salva, e o Relatório mostra verde e vermelho', async () => {
  let resp = await post('/painel/configuracoes/metas', { meta_espera_minutos: '-3', meta_primeira_resposta_minutos: '0', meta_duracao_minutos: '0', meta_nota: '0', reincidencia_dias: '7' });
  assert.match(await resp.text(), /minutos inteiros/);
  resp = await post('/painel/configuracoes/metas', { meta_espera_minutos: '10', meta_primeira_resposta_minutos: '10', meta_duracao_minutos: '20', meta_nota: '11', reincidencia_dias: '7' });
  assert.match(await resp.text(), /de 0 a 10/);
  resp = await post('/painel/configuracoes/metas', { meta_espera_minutos: '10', meta_primeira_resposta_minutos: '10', meta_duracao_minutos: '60', meta_nota: '8,5', reincidencia_dias: '7' });
  assert.strictEqual(resp.headers.get('location'), '/painel/configuracoes/metas?salvo=1');
  const salvo = JSON.parse(fs.readFileSync(process.env.CHATDIGITAL_NEGOCIO, 'utf8'));
  assert.strictEqual(salvo.meta_nota, 8.5);
  assert.strictEqual(salvo.meta_duracao_minutos, 60);
  assert.strictEqual(salvo.nome, 'Loja Exemplo', 'o resto do negocio.json fica como estava');

  // espera: 2 e 30 min, mediana 16 > 10 (fora, 50% dentro); duração: 10 e 50, mediana 30 <= 60 (dentro)
  const relatorio = await pagina('/painel/relatorio?periodo=7');
  assert.match(relatorio, /cartao cartao-meta-fora">\s*<span class="numero">16 min<\/span><span class="rotulo">Espera na fila/);
  assert.match(relatorio, /meta 10 min · 50% dentro/);
  assert.match(relatorio, /cartao cartao-meta-ok">\s*<span class="numero">30 min<\/span><span class="rotulo">Duração do atendimento/);
  assert.match(relatorio, /cartao cartao-meta-fora">\s*<span class="numero">7,0<\/span>/, 'nota média 7 < meta 8,5');
  assert.ok((await pagina('/painel/configuracoes')).includes('4 metas definidas'));

  assert.deepStrictEqual(compararComMeta([], 10), { texto: '—', meta: 10, dentro: null, ok: null });
  assert.strictEqual(compararComMeta([60000 * 5], 0).ok, null, 'sem meta, sem cor');
});

test('Relatório: tabela por atendente só em "Todos os atendentes"', async () => {
  const todos = await pagina('/painel/relatorio?periodo=7');
  assert.ok(todos.includes('Por atendente'));
  assert.match(todos, /<td><a href="\/painel\/relatorio\?periodo=7&amp;atendente=1">Carla<\/a><\/td>\s*<td>2<\/td>/);
  const soUm = await pagina('/painel/relatorio?periodo=7&atendente=1');
  assert.ok(!soUm.includes('Por atendente'));
});

test('reincidências: cliente que volta dentro do prazo conta; fora do prazo não', async () => {
  // A: 1o finalizado há ~3 dias, 2o aberto há 2 dias → voltou em menos de 1 dia (dentro de 7)
  const agora = Date.now();
  let lista = listarReincidencias({ inicio: agora - 30 * DIA_MS, fim: agora + DIA_MS, dias: 7 });
  assert.deepStrictEqual(lista.map((r) => [r.atendimentoId, r.anteriorId]), [[segundoA, primeiroA]]);
  lista = listarReincidencias({ inicio: agora - 30 * DIA_MS, fim: agora + DIA_MS, dias: 1 });
  assert.strictEqual(lista.length, 1, 'menos de 1 dia de intervalo ainda conta com 1 dia');
  db.prepare('UPDATE atendimentos SET finalizado_em = ? WHERE id = ?').run(new Date(agora - 20 * DIA_MS).toISOString(), primeiroA);
  db.prepare('UPDATE atendimentos SET aberto_em = ? WHERE id = ?').run(new Date(agora - 21 * DIA_MS).toISOString(), primeiroA);
  assert.strictEqual(listarReincidencias({ inicio: agora - 30 * DIA_MS, fim: agora + DIA_MS, dias: 7 }).length, 0, '18 dias depois não é reincidência');
  ajustarTempos(primeiroA, { abertoHaMin: 3 * 24 * 60, esperaMin: 2, respostaMin: 3, duracaoMin: 10, nota: 10 });

  const tela = await pagina('/painel/relatorio/reincidencias?periodo=7');
  assert.match(tela, /1 retorno\b/);
  assert.ok(tela.includes(`/painel/relatorio/auditoria/${primeiroA}`));
  assert.match(await pagina('/painel/relatorio?periodo=7'), /Voltaram em até 7 dias/);

  assert.strictEqual(formatarIntervalo(5 * 60000), '5 min');
  assert.strictEqual(formatarIntervalo(DIA_MS + 3 * 3600000), '1 dia 3h');
  assert.strictEqual(formatarIntervalo(2 * DIA_MS), '2 dias');
});

test('permissão: sem "Ver o Relatório" não entra na Auditoria nem nas Reincidências', async () => {
  await post('/painel/atendentes', { nome: 'Beto', email: 'beto@teste.com', senha: '123456', papel: 'atendente', permissoes: 'responder_conversas' });
  const login = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'beto@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  const cookieBeto = login.headers.get('set-cookie').split(';')[0];
  for (const caminho of ['/painel/relatorio/auditoria', `/painel/relatorio/auditoria/${primeiroA}/conversa.txt`, '/painel/relatorio/reincidencias', '/painel/configuracoes/metas']) {
    const resp = await fetch(`${baseUrl}${caminho}`, { headers: { cookie: cookieBeto } });
    assert.strictEqual(resp.status, 403, caminho);
  }
});

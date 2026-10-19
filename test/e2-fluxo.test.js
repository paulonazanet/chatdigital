const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E2, 3a parte: testar o fluxo no editor (simulador), versões, importar/exportar e fluxos prontos.
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e2fluxo-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.CHATDIGITAL_FLUXO = path.join(diretorioTeste, 'fluxo.json'); // nunca o config/fluxo.json de verdade
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';

fs.copyFileSync(path.join(__dirname, '..', 'config', 'fluxo.json'), process.env.CHATDIGITAL_FLUXO);
fs.writeFileSync(
  process.env.CHATDIGITAL_NEGOCIO,
  JSON.stringify({ nome: 'Loja Exemplo', formas_pagamento: ['Pix', 'Dinheiro'], horario_funcionamento: 'Seg a Sáb, 8h às 18h', endereco: 'Rua X, 1', produtos: [{ id: 'p13', nome: 'Botijão 13kg', preco: 120 }], faq: [] }),
);

const { app } = require('../src/server');
const { db } = require('../src/db');
const { carregarFluxo, validarFluxo } = require('../src/fluxo');
const { simularMensagem, processarMensagem } = require('../src/flow-engine');
const { MODELOS, obterModelo, setoresQueFaltam } = require('../src/modelos-fluxo');
const versoes = require('../src/fluxo-versoes');

let servidor;
let baseUrl;
let cookie;
const fluxoOriginal = JSON.parse(fs.readFileSync(process.env.CHATDIGITAL_FLUXO, 'utf8'));

function postJson(caminho, corpo, cookieUsado = cookie) {
  return fetch(`${baseUrl}${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookieUsado }, body: JSON.stringify(corpo) });
}
function post(caminho, campos = {}) {
  return fetch(`${baseUrl}${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, body: new URLSearchParams(campos), redirect: 'manual' });
}
async function pagina(caminho) {
  return (await fetch(`${baseUrl}${caminho}`, { headers: { cookie } })).text();
}
// conversa inteira no simulador pela rota, guardando o estado como o navegador faz
async function conversar(fluxo, mensagens) {
  let estado = null;
  const saidas = [];
  for (const texto of mensagens) {
    const resp = await (await postJson('/painel/fluxo/testar', { fluxo, estado, texto })).json();
    assert.ok(resp.ok, JSON.stringify(resp));
    estado = resp.estado;
    saidas.push(resp);
  }
  return saidas;
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
});

after(async () => {
  await new Promise((resolve) => servidor.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('simulador: conversa pelo fluxo da tela sem gravar nada e sem mexer nas conversas de verdade', async () => {
  const registrosAntes = db.prepare('SELECT COUNT(*) AS n FROM registros').get().n;
  const conversasAntes = db.prepare('SELECT COUNT(*) AS n FROM conversas').get().n;
  const saidas = await conversar(fluxoOriginal, ['oi', '1', '1', 'Rua A, 10', 'Pix', '1']);
  assert.match(saidas[0].resposta, /Loja Exemplo/);
  assert.strictEqual(saidas[0].no, 'menu');
  assert.match(saidas[1].resposta, /Botijão 13kg - R\$ 120/);
  const ultima = saidas[5];
  assert.match(ultima.resposta, /Pedido registrado/);
  assert.ok(ultima.eventos.some((e) => e.tipo === 'salvar' && /"endereco":"Rua A, 10"/.test(e.texto)), 'conta o que salvaria');
  assert.ok(ultima.eventos.some((e) => e.tipo === 'fim'));
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM registros').get().n, registrosAntes, 'não gravou o pedido');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM conversas').get().n, conversasAntes, 'não criou conversa');

  // resposta que não vale, e transferência
  const outra = await conversar(fluxoOriginal, ['oi', 'xyz', '3', 'alô?']);
  assert.ok(outra[1].eventos.some((e) => e.tipo === 'invalido'));
  assert.match(outra[1].resposta, /Não entendi/);
  assert.ok(outra[2].eventos.some((e) => e.tipo === 'transferir' && /setor "geral"/.test(e.texto)));
  assert.strictEqual(outra[2].estado.humano, true);
  assert.strictEqual(outra[3].resposta, null, 'com atendente o bot fica quieto');

  // o estado das conversas de verdade (memória do motor) não é o do simulador
  const real = await processarMensagem({ numero: 'simulador', texto: 'oi', negocio: { nome: 'X' }, fluxo: fluxoOriginal });
  assert.match(real, /X/);
});

test('simulador: nota, API e salvar viram aviso; fluxo com erro é recusado', async () => {
  const fluxo = {
    inicio: 'inicio',
    nos: {
      inicio: { tipo: 'inicio', proximo: 'nome' },
      nome: { tipo: 'pergunta', texto: 'Seu nome?', variavel: 'nome', proximo: 'api' },
      api: { tipo: 'api', url: 'http://127.0.0.1:1/nao-chama?n={{vars.nome}}', metodo: 'POST', guardar_em: 'r', proximo: 'nota', proximo_erro: 'erro' },
      nota: { tipo: 'nota', texto: 'Cliente {{vars.nome}}', proximo: 'tchau' },
      erro: { tipo: 'fim', texto: 'deu erro' },
      tchau: { tipo: 'fim', texto: 'Tchau, {{vars.nome}}!' },
    },
  };
  const [, segunda] = await conversar(fluxo, ['comecar', 'Ana']);
  assert.strictEqual(segunda.resposta, 'Tchau, Ana!', 'a API segue pelo caminho de sucesso sem ser chamada');
  assert.ok(segunda.eventos.some((e) => e.tipo === 'api' && /POST http:\/\/127\.0\.0\.1:1\/nao-chama\?n=Ana/.test(e.texto)));
  assert.ok(segunda.eventos.some((e) => e.tipo === 'nota' && /Cliente Ana/.test(e.texto)));
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM mensagens WHERE interna = 1").get().n, 0, 'nota não foi gravada');

  const ruim = await postJson('/painel/fluxo/testar', { fluxo: { inicio: 'x', nos: {} }, texto: 'oi' });
  assert.strictEqual(ruim.status, 400);
  assert.match((await ruim.json()).erros[0], /não existe/);

  // estado vindo do navegador com bloco que não existe volta pro início
  const r = await simularMensagem({ estado: { no: 'nao-existe', aguardando: true }, texto: 'oi', negocio: {}, fluxo });
  assert.strictEqual(r.no, 'nome');
});

test('versões: cada Salvar guarda uma versão com quem e de onde veio; voltar atrás vale na hora', async () => {
  let resp = await postJson('/painel/fluxo/salvar', fluxoOriginal);
  assert.ok((await resp.json()).ok);
  let lista = versoes.listarVersoes();
  assert.deepStrictEqual(lista.map((v) => v.origem), ['Salvo no editor', 'Como estava antes do histórico de versões']);
  assert.strictEqual(lista[0].quem, 'Carla');

  const gas = obterModelo('gas');
  resp = await postJson(`/painel/fluxo/salvar?origem=modelo&detalhe=${encodeURIComponent(gas.nome)}`, gas.fluxo);
  assert.ok((await resp.json()).ok);
  assert.strictEqual(carregarFluxo().nos.pedido_item.variavel, 'pedido', 'o bot já usa o fluxo novo');
  lista = versoes.listarVersoes();
  assert.strictEqual(lista[0].origem, 'Fluxo pronto: Revenda de gás');
  assert.strictEqual(lista[0].blocos, Object.keys(gas.fluxo.nos).length);

  resp = await postJson('/painel/fluxo/salvar', { inicio: 'nada', nos: {} });
  assert.strictEqual(resp.status, 400);
  assert.strictEqual(versoes.listarVersoes().length, 3, 'fluxo inválido não vira versão');

  const tela = await pagina('/painel/fluxo/versoes');
  assert.ok(tela.includes('Fluxo pronto: Revenda de gás'));
  assert.ok(tela.includes('em uso'));

  const anterior = lista[1];
  resp = await post(`/painel/fluxo/versoes/${anterior.id}/restaurar`);
  assert.strictEqual(resp.headers.get('location'), '/painel/fluxo/versoes?restaurada=1');
  assert.deepStrictEqual(Object.keys(carregarFluxo().nos).sort(), Object.keys(fluxoOriginal.nos).sort());
  assert.match(versoes.listarVersoes()[0].origem, /^Voltou para a versão de \d{2}\/\d{2}\/\d{4}/);
  resp = await post('/painel/fluxo/versoes/99999/restaurar');
  assert.strictEqual(resp.headers.get('location'), '/painel/fluxo/versoes?erro=1');

  const baixado = await fetch(`${baseUrl}/painel/fluxo/versoes/${lista[0].id}/baixar`, { headers: { cookie } });
  assert.match(baixado.headers.get('content-disposition'), /fluxo_versao_\d+\.json/);
  assert.ok((await baixado.json()).nos.pedido_item);
});

test('versões: fica só as últimas 100', async () => {
  for (let i = 0; i < 105; i += 1) versoes.salvarComVersao(fluxoOriginal, { origem: `teste ${i}` });
  const lista = versoes.listarVersoes();
  assert.strictEqual(lista.length, 100);
  assert.strictEqual(lista[0].origem, 'teste 104');
});

test('exportar e conferir arquivo para importar', async () => {
  const exportado = await fetch(`${baseUrl}/painel/fluxo/exportar`, { headers: { cookie } });
  assert.match(exportado.headers.get('content-disposition'), /attachment; filename="fluxo_loja_exemplo_\d{4}-\d{2}-\d{2}\.json"/);
  assert.deepStrictEqual(Object.keys((await exportado.json()).nos).sort(), Object.keys(fluxoOriginal.nos).sort());

  let conferido = await (await postJson('/painel/fluxo/conferir', obterModelo('provedor').fluxo)).json();
  assert.strictEqual(conferido.ok, true);
  assert.deepStrictEqual(conferido.setoresFaltando.sort(), ['Financeiro', 'Suporte', 'Vendas']);
  conferido = await (await postJson('/painel/fluxo/conferir', { qualquer: 'coisa' })).json();
  assert.strictEqual(conferido.ok, false);
});

test('fluxos prontos: os 5 são válidos, abrem arrumados e funcionam no simulador', async () => {
  const lista = await (await fetch(`${baseUrl}/painel/fluxo/modelos`, { headers: { cookie } })).json();
  assert.deepStrictEqual(lista.map((m) => m.id), ['gas', 'loja', 'clinica', 'provedor', 'delivery']);
  for (const { id } of MODELOS) {
    const modelo = await (await fetch(`${baseUrl}/painel/fluxo/modelos/${id}`, { headers: { cookie } })).json();
    assert.deepStrictEqual(validarFluxo(modelo.fluxo), [], id);
    assert.strictEqual(Object.keys(modelo.fluxo._layout).length, Object.keys(modelo.fluxo.nos).length, `${id}: todo bloco tem posição`);
    const [primeira] = await conversar(modelo.fluxo, ['oi']);
    assert.match(primeira.resposta, /Loja Exemplo/, `${id}: o menu usa o nome do negócio`);
    assert.ok(!/\{\{/.test(primeira.resposta), `${id}: nenhuma variável sobrando`);
  }
  assert.strictEqual((await fetch(`${baseUrl}/painel/fluxo/modelos/nao-existe`, { headers: { cookie } })).status, 404);
  assert.deepStrictEqual(setoresQueFaltam(obterModelo('gas').fluxo, ['Geral']), []);

  // gás: pedido completo até a transferência
  const pedido = await conversar(obterModelo('gas').fluxo, ['oi', '1', '1 botijão de 13 kg', 'Rua B, 20', 'Pix', '1']);
  const fim = pedido[5];
  assert.ok(fim.eventos.some((e) => e.tipo === 'salvar'));
  assert.ok(fim.eventos.some((e) => e.tipo === 'nota' && /1 botijão de 13 kg/.test(e.texto)));
  assert.ok(fim.eventos.some((e) => e.tipo === 'horario'));
  assert.ok(fim.estado.humano);
  // provedor: passo a passo que resolve não chama atendente
  const provedor = await conversar(obterModelo('provedor').fluxo, ['oi', '1', '2', '1']);
  assert.match(provedor[2].resposta, /Tire o roteador/);
  assert.match(provedor[3].resposta, /Que ótimo/);
  assert.strictEqual(provedor[3].estado.humano, false);
});

test('editor: botões novos na tela e permissão', async () => {
  const tela = await pagina('/painel/fluxo');
  for (const texto of ['▶ Testar', 'Fluxos prontos…', 'Importar de arquivo…', 'Exportar (baixar arquivo)', 'Versões salvas']) assert.ok(tela.includes(texto), texto);
  await post('/painel/atendentes', { nome: 'Beto', email: 'beto@teste.com', senha: '123456', papel: 'atendente', permissoes: 'responder_conversas' });
  const login = await fetch(`${baseUrl}/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'beto@teste.com', senha: '123456' }), redirect: 'manual' });
  const cookieBeto = login.headers.get('set-cookie').split(';')[0];
  for (const caminho of ['/painel/fluxo/versoes', '/painel/fluxo/exportar', '/painel/fluxo/modelos']) {
    assert.strictEqual((await fetch(`${baseUrl}${caminho}`, { headers: { cookie: cookieBeto } })).status, 403, caminho);
  }
  assert.strictEqual((await postJson('/painel/fluxo/testar', { fluxo: fluxoOriginal, texto: 'oi' }, cookieBeto)).status, 403);
});

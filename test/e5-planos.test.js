const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E5, 3a parte: planos e limites. A pasta central tem dois clientes de mentira; esta instalação faz o
// papel de um cliente (CHATDIGITAL_PLANO aponta para o plano do "padaria") e também da Eu no Digital.
const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-planos-'));
const central = path.join(diretorio, 'clientes');
for (const nome of ['padaria', 'oficina']) {
  fs.mkdirSync(path.join(central, nome, 'config'), { recursive: true });
  fs.writeFileSync(path.join(central, nome, '.env'), '');
}
fs.writeFileSync(path.join(central, 'padaria', 'config', 'negocio.json'), JSON.stringify({ nome: 'Padaria Teste' }));
fs.mkdirSync(path.join(central, 'sem-env'));
const arquivoPlano = path.join(central, 'padaria', 'config', 'plano.json');
process.env.CHATDIGITAL_DB = path.join(diretorio, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorio, 'negocio.json');
process.env.CHATDIGITAL_PLANO = arquivoPlano;
process.env.CHATDIGITAL_CENTRAL = central;
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';
fs.copyFileSync(path.join(__dirname, '..', 'config', 'modelos', 'negocio.json'), process.env.CHATDIGITAL_NEGOCIO);

const { app } = require('../src/server');
const { db } = require('../src/db');
const { criarAtendente } = require('../src/atendentes');
const planos = require('../src/planos');
const canais = require('../src/canais');
const { gerarLembretes } = require('../src/lembretes');
const { salvarConfiguracoes } = require('../src/negocio');

let servidor;
let baseUrl;
let cookieAdmin;
let cookieAtendente;

async function entrar(email, senha) {
  const r = await fetch(`${baseUrl}/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, senha }), redirect: 'manual' });
  return r.headers.get('set-cookie').split(';')[0];
}
const abrir = (caminho, cookie = cookieAdmin) => fetch(`${baseUrl}${caminho}`, { headers: { cookie }, redirect: 'manual' });
const enviar = (caminho, corpo, cookie = cookieAdmin) => fetch(`${baseUrl}${caminho}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(corpo), redirect: 'manual' });

before(async () => {
  await new Promise((resolve) => {
    servidor = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${servidor.address().port}`;
      resolve();
    });
  });
  criarAtendente({ nome: 'Dono', email: 'dono@teste.com', senha: 'senha-do-dono', papel: 'admin', permissoes: [] });
  criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana', papel: 'atendente', permissoes: ['responder_conversas', 'gerenciar_atendentes'] });
  cookieAdmin = await entrar('dono@teste.com', 'senha-do-dono');
  cookieAtendente = await entrar('ana@teste.com', 'senha-da-ana');
});

after(async () => {
  await new Promise((resolve) => servidor.close(resolve));
  db.close();
  fs.rmSync(diretorio, { recursive: true, force: true });
});

test('sem plano salvo não há limite nenhum', () => {
  assert.strictEqual(planos.planoAtual().semLimites, true);
  assert.strictEqual(planos.temRecurso('instagram'), true);
  assert.deepStrictEqual(planos.podeAtivarAtendente(), { ok: true });
  assert.deepStrictEqual(planos.podeLigarNumero(), { ok: true });
});

test('arquivo de plano estragado não derruba nem limita o cliente', () => {
  fs.writeFileSync(arquivoPlano, '{ estragado');
  assert.strictEqual(planos.planoAtual().semLimites, true);
  fs.rmSync(arquivoPlano);
});

test('Clientes: lista só quem tem .env, um clique troca o plano e vale na hora', async () => {
  const html = await (await abrir('/painel/clientes')).text();
  assert.match(html, /Padaria Teste/);
  assert.match(html, /oficina/);
  assert.doesNotMatch(html, /sem-env/);

  assert.strictEqual((await enviar('/painel/clientes/padaria/plano', { plano: 'essencial' })).status, 302);
  assert.strictEqual(planos.planoAtual().nome, 'Essencial');
  assert.strictEqual(planos.temRecurso('campanhas'), false);
  assert.strictEqual(planos.temRecurso('lembretes'), true);
  assert.match(await (await abrir('/painel/clientes')).text(), /R\$\s49,00/);
});

test('Clientes: só o administrador, e nunca fora da pasta central', async () => {
  assert.strictEqual((await abrir('/painel/clientes', cookieAtendente)).status, 404);
  assert.deepStrictEqual(planos.escolherPlano('../fora', 'empresa'), { erro: 'Cliente não encontrado.' });
  assert.deepStrictEqual(planos.escolherPlano('sem-env', 'empresa'), { erro: 'Cliente não encontrado.' });
  assert.deepStrictEqual(planos.escolherPlano('padaria', 'inventado'), { erro: 'Plano não encontrado.' });
});

test('função fora do plano mostra o aviso e some do menu', async () => {
  const r = await abrir('/painel/campanhas/lista');
  assert.strictEqual(r.status, 403);
  assert.match(await r.text(), /não faz parte do plano Essencial/);
  assert.strictEqual((await abrir('/painel/campanhas/lembretes')).status, 200);
  assert.strictEqual((await abrir('/painel/campanhas')).headers.get('location'), '/painel/campanhas/lembretes');
  assert.strictEqual((await abrir('/painel/configuracoes/metas')).status, 403);
  assert.strictEqual((await abrir('/painel/configuracoes/painel-tv')).status, 403);
  assert.strictEqual((await abrir('/painel/configuracoes/instagram')).status, 403);
  assert.strictEqual((await abrir('/painel/configuracoes/whatsapp/custos')).status, 403);
  assert.match(await (await enviar('/painel/configuracoes/whatsapp/conexao', { whatsapp_conexao: 'oficial' })).text(), /não faz parte do seu plano/);
});

test('link da TV para de abrir quando o plano não tem o painel', async () => {
  salvarConfiguracoes({ painel_tv_token: 'codigo-da-tv' });
  assert.strictEqual((await fetch(`${baseUrl}/tv/codigo-da-tv`)).status, 404);
  planos.escolherPlano('padaria', 'profissional');
  assert.strictEqual((await fetch(`${baseUrl}/tv/codigo-da-tv`)).status, 200);
  planos.escolherPlano('padaria', 'essencial');
});

test('limite de atendentes: no criar e no reativar; quem já existe continua', async () => {
  await enviar('/painel/atendentes', { nome: 'Bia', email: 'bia@teste.com', senha: 'senha-da-bia', papel: 'atendente' });
  const barrado = await (await enviar('/painel/atendentes', { nome: 'Caio', email: 'caio@teste.com', senha: 'senha-do-caio', papel: 'atendente' })).text();
  assert.match(barrado, /vai até 3 atendentes/);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM atendentes WHERE email = 'caio@teste.com'").get().n, 0);

  // desativa a Bia, ocupa a vaga dela com o Caio: reativar a Bia passa do limite
  const bia = db.prepare("SELECT id FROM atendentes WHERE email = 'bia@teste.com'").get().id;
  await enviar(`/painel/atendentes/${bia}/alternar-ativo`, {});
  await enviar('/painel/atendentes', { nome: 'Caio', email: 'caio@teste.com', senha: 'senha-do-caio', papel: 'atendente' });
  assert.strictEqual((await enviar(`/painel/atendentes/${bia}/alternar-ativo`, {})).status, 400);
  const form = await (await enviar(`/painel/atendentes/${bia}`, { nome: 'Bia', papel: 'atendente', ativo: 'on' })).text();
  assert.match(form, /vai até 3 atendentes/);
  assert.strictEqual(db.prepare('SELECT ativo FROM atendentes WHERE id = ?').get(bia).ativo, 0);

  // editar quem já está ativo, no limite, não pode ser barrado
  const caio = db.prepare("SELECT id FROM atendentes WHERE email = 'caio@teste.com'").get().id;
  assert.strictEqual((await enviar(`/painel/atendentes/${caio}`, { nome: 'Caio Silva', papel: 'atendente', ativo: 'on' })).status, 302);
});

test('limite de números: não adiciona nem liga acima do plano', async () => {
  const barrado = await (await enviar('/painel/configuracoes/whatsapp/numeros', { nome: 'Suporte' })).text();
  assert.match(barrado, /vai até 1 número de WhatsApp/);
  assert.strictEqual(canais.listarCanais({ tipo: 'celular' }).length, 1);

  const reserva = canais.criarCanal('Reserva');
  canais.definirAtivo(reserva.id, false);
  await enviar(`/painel/configuracoes/whatsapp/numeros/${reserva.id}/ativo`, {});
  assert.strictEqual(canais.obterCanal(reserva.id).ativo, 0);
});

test('negociado à parte: soma função, atendente e valor, e continua ao trocar de plano', async () => {
  assert.strictEqual((await abrir('/painel/clientes/padaria')).status, 200);
  await enviar('/painel/clientes/padaria', { atendentes_extras: '2', numeros_extras: '1', recursos_extras: 'campanhas', valor_extra: '30,50', obs: 'Campanhas por R$ 30' });
  let plano = planos.planoAtual();
  assert.strictEqual(plano.atendentes, 5);
  assert.strictEqual(plano.numeros, 2);
  assert.strictEqual(plano.total, 79.5);
  assert.strictEqual(planos.temRecurso('campanhas'), true);
  assert.strictEqual((await abrir('/painel/campanhas/lista')).status, 200);

  await enviar('/painel/clientes/padaria/plano', { plano: 'profissional' });
  plano = planos.planoAtual();
  assert.strictEqual(plano.atendentes, 8);
  assert.strictEqual(plano.total, 129.5);
  assert.deepStrictEqual(plano.recursosExtras, []); // campanhas já vem nesse plano
});

test('lembrete não sai se o plano não tem, e a tela Status mostra o plano', async () => {
  assert.match(await (await abrir('/painel/configuracoes/status')).text(), /Seu plano: Profissional/);
  fs.writeFileSync(arquivoPlano, JSON.stringify({ plano: 'essencial' }));
  const original = planos.PLANOS.essencial.recursos;
  planos.PLANOS.essencial.recursos = [];
  try {
    assert.strictEqual(gerarLembretes({ mesmoDesligado: true }), 0);
    assert.strictEqual((await abrir('/painel/relatorio')).status, 403);
  } finally {
    planos.PLANOS.essencial.recursos = original;
  }
});

test('Sem limites apaga o plano; sem CHATDIGITAL_CENTRAL a tela não existe', async () => {
  await enviar('/painel/clientes/padaria/plano', { plano: '' });
  assert.strictEqual(fs.existsSync(arquivoPlano), false);
  assert.strictEqual(planos.planoAtual().semLimites, true);
  delete process.env.CHATDIGITAL_CENTRAL;
  assert.strictEqual((await abrir('/painel/clientes')).status, 404);
  assert.doesNotMatch(await (await abrir('/painel/fila')).text(), /painel\/clientes/);
  process.env.CHATDIGITAL_CENTRAL = central;
});

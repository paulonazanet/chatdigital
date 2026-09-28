const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-config-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.SESSION_SECRET = 'segredo-de-teste';

fs.writeFileSync(
  process.env.CHATDIGITAL_NEGOCIO,
  JSON.stringify({
    nome: 'Loja Original',
    horario_funcionamento: '',
    endereco: '',
    formas_pagamento: [],
    mensagem_boas_vindas_atendente: '',
    mensagem_encerramento: '',
    pesquisa_satisfacao: '',
    produtos: [{ id: 'p1', nome: 'Produto 1', preco: 10 }],
    faq: [],
  }),
);

const { app } = require('../src/server');
const { carregarNegocio } = require('../src/negocio');

let servidor;
let baseUrl;

function extrairCookie(resposta) {
  const bruto = resposta.headers.get('set-cookie');
  return bruto ? bruto.split(';')[0] : null;
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

test('Configurações: admin salva, atendente sem permissão não acessa, produtos/faq ficam intactos', async () => {
  let resp = await fetch(`${baseUrl}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nome: 'Paulo Admin', email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  const cookieAdmin = extrairCookie(resp);

  resp = await fetch(`${baseUrl}/painel/configuracoes`, { headers: { cookie: cookieAdmin } });
  assert.strictEqual(resp.status, 200);
  assert.match(await resp.text(), /Loja Original/);

  resp = await fetch(`${baseUrl}/painel/configuracoes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieAdmin },
    body: new URLSearchParams({
      nome: 'Loja Nova',
      horario_funcionamento: 'Seg-Sex 8h-18h',
      endereco: 'Rua Teste, 1',
      formas_pagamento: 'Pix, Dinheiro',
      mensagem_boas_vindas_atendente: 'Oi, sou {{atendente.nome}}',
      mensagem_encerramento: 'Até mais!',
      pesquisa_satisfacao: 'Nota de 0 a 10?',
    }),
  });
  assert.strictEqual(resp.status, 200);
  assert.match(await resp.text(), /Configurações salvas/);

  const negocio = carregarNegocio();
  assert.strictEqual(negocio.nome, 'Loja Nova');
  assert.deepStrictEqual(negocio.formas_pagamento, ['Pix', 'Dinheiro']);
  assert.strictEqual(negocio.mensagem_encerramento, 'Até mais!');
  assert.deepStrictEqual(negocio.produtos, [{ id: 'p1', nome: 'Produto 1', preco: 10 }], 'produtos não deve ser mexido por essa tela');

  // nome vazio é rejeitado
  resp = await fetch(`${baseUrl}/painel/configuracoes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieAdmin },
    body: new URLSearchParams({ nome: '', horario_funcionamento: '', endereco: '', formas_pagamento: '' }),
  });
  assert.match(await resp.text(), /obrigatório/);
  assert.strictEqual(carregarNegocio().nome, 'Loja Nova', 'não deve ter salvo com nome vazio');

  // atendente comum sem a permissão não acessa
  resp = await fetch(`${baseUrl}/painel/atendentes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieAdmin },
    body: new URLSearchParams({ nome: 'Carlos', email: 'carlos@teste.com', senha: '123456', papel: 'atendente' }),
  });

  resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'carlos@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  const cookieCarlos = extrairCookie(resp);

  resp = await fetch(`${baseUrl}/painel/configuracoes`, { headers: { cookie: cookieCarlos } });
  assert.strictEqual(resp.status, 403, 'atendente sem gerenciar_configuracoes não deve acessar');

  console.log('OK: Configurações — admin salva, sem permissão não acessa, produtos/faq intactos');
});

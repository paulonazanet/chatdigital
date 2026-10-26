const assert = require('node:assert');
const { test, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

// Feriados móveis (Carnaval, Sexta-feira Santa, Corpus Christi) valem todo ano, pela Páscoa. O banco
// começa como na produção antes da mudança: feriados com o ano no nome, de dois anos.
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-feriados-moveis-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify({ nome: 'Loja Exemplo', formas_pagamento: ['Pix'], produtos: [], faq: [] }));

const antigo = new DatabaseSync(process.env.CHATDIGITAL_DB);
antigo.exec(`CREATE TABLE feriados (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, data TEXT NOT NULL, repete_ano INTEGER NOT NULL DEFAULT 1,
  dia_inteiro INTEGER NOT NULL DEFAULT 1, hora_inicio TEXT, hora_fim TEXT, tem_expediente INTEGER NOT NULL DEFAULT 0, mensagem TEXT, ativo INTEGER NOT NULL DEFAULT 1)`);
const inserir = antigo.prepare('INSERT INTO feriados (nome, data, repete_ano, tem_expediente, mensagem) VALUES (?, ?, ?, ?, ?)');
inserir.run('Finados', '2026-11-02', 1, 0, 'Fechados hoje');
inserir.run('Carnaval (segunda) 2026, ponto facultativo', '2026-02-16', 0, 1, null);
inserir.run('Carnaval (segunda) 2027, ponto facultativo', '2027-02-08', 0, 0, 'Fechados no Carnaval');
inserir.run('Carnaval (terça) 2026, ponto facultativo', '2026-02-17', 0, 1, null);
inserir.run('Carnaval (terça) 2027, ponto facultativo', '2027-02-09', 0, 1, null);
inserir.run('Sexta-feira Santa 2026', '2026-04-03', 0, 0, null);
inserir.run('Sexta-feira Santa 2027', '2027-03-26', 0, 0, 'Sexta Santa: fechados');
inserir.run('Corpus Christi 2026, ponto facultativo', '2026-06-04', 0, 1, null);
inserir.run('Corpus Christi 2027, ponto facultativo', '2027-05-27', 0, 1, null);
inserir.run('Inauguração da loja', '2026-03-10', 0, 0, null); // de data única: não mexe
antigo.close();

const { db } = require('../src/db');
const feriados = require('../src/feriados');

after(() => {
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('a conversão junta os de cada ano num só, guardando o abre/fecha e a mensagem do ano que vem', () => {
  const todos = db.prepare('SELECT * FROM feriados ORDER BY id').all();
  assert.strictEqual(todos.length, 1 + 4 + 1);
  const moveis = todos.filter((f) => f.movel);
  assert.deepStrictEqual(moveis.map((f) => f.movel).sort(), ['carnaval_segunda', 'carnaval_terca', 'corpus_christi', 'sexta_santa']);
  const segunda = moveis.find((f) => f.movel === 'carnaval_segunda');
  assert.strictEqual(segunda.nome, 'Carnaval (segunda), ponto facultativo', 'sem o ano no nome');
  assert.strictEqual(segunda.tem_expediente, 0, 'ficou com o do ano que vem (a empresa marcou fechado)');
  assert.strictEqual(segunda.mensagem, 'Fechados no Carnaval');
  assert.strictEqual(moveis.find((f) => f.movel === 'sexta_santa').mensagem, 'Sexta Santa: fechados');
  assert.ok(moveis.every((f) => f.repete_ano === 1));
  assert.ok(todos.some((f) => f.nome === 'Inauguração da loja' && !f.movel), 'feriado de data única fica como estava');
});

test('a data muda sozinha todo ano, pela Páscoa', () => {
  assert.strictEqual(feriados.dataDoMovel('carnaval_terca', 2028), '2028-02-29');
  assert.strictEqual(feriados.dataDoMovel('sexta_santa', 2028), '2028-04-14');
  assert.strictEqual(feriados.dataDoMovel('corpus_christi', 2030), '2030-06-20');
  const sexta = db.prepare("SELECT id FROM feriados WHERE movel = 'sexta_santa'").get();
  assert.strictEqual(feriados.feriadoAgora(new Date(2028, 3, 14, 10))?.id, sexta.id, 'Sexta-feira Santa de 2028 fecha sem ninguém mexer');
  assert.strictEqual(feriados.feriadoAgora(new Date(2030, 3, 19, 10))?.id, sexta.id, 'e a de 2030 também');
  assert.strictEqual(feriados.feriadoAgora(new Date(2028, 3, 13, 10)), null, 'no dia anterior não');
  assert.strictEqual(feriados.feriadoAgora(new Date(2028, 1, 29, 10)), null, 'Carnaval (terça) com expediente não fecha');
  const segunda = db.prepare("SELECT id FROM feriados WHERE movel = 'carnaval_segunda'").get();
  assert.strictEqual(feriados.feriadoAgora(new Date(2029, 1, 12, 9))?.id, segunda.id, 'Carnaval (segunda) marcado fechado vale em 2029');
  assert.strictEqual(feriados.feriadoAgora(new Date(2028, 10, 2, 9))?.nome, 'Finados', 'os de data fixa continuam iguais');
});

test('a lista mostra a próxima data; editar não muda a data; importar não duplica', () => {
  const lista = feriados.listarFeriados(new Date(2026, 10, 1));
  const corpus = lista.find((f) => f.movel === 'corpus_christi');
  assert.strictEqual(corpus.proxima, '2027-05-27');
  assert.strictEqual(feriados.listarFeriados(new Date(2027, 6, 1)).find((f) => f.movel === 'corpus_christi').proxima, '2028-06-15');

  const atual = db.prepare("SELECT * FROM feriados WHERE movel = 'corpus_christi'").get();
  feriados.atualizarFeriado(atual.id, { ...atual, data: '2020-01-01', repete_ano: 0, tem_expediente: 0, mensagem: 'Fechados' });
  const depois = db.prepare('SELECT * FROM feriados WHERE id = ?').get(atual.id);
  assert.strictEqual(depois.data, atual.data, 'a data de um móvel não muda pela tela');
  assert.strictEqual(depois.repete_ano, 1);
  assert.strictEqual(depois.tem_expediente, 0, 'o abre/fecha muda');
  assert.strictEqual(depois.mensagem, 'Fechados');

  assert.strictEqual(feriados.importarNacionais(new Date(2026, 10, 1)), 8, 'só entram os 8 fixos que faltavam');
  assert.strictEqual(feriados.importarNacionais(new Date(2027, 10, 1)), 0, 'e no ano seguinte nada se repete');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM feriados WHERE movel IS NOT NULL').get().n, 4);
});

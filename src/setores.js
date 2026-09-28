const { db } = require('./db');

function listarSetores() {
  return db.prepare('SELECT * FROM setores ORDER BY nome').all();
}

function obterSetorPorId(id) {
  return db.prepare('SELECT * FROM setores WHERE id = ?').get(id);
}

function criarSetor(nome) {
  const info = db.prepare('INSERT INTO setores (nome) VALUES (?)').run(nome);
  return obterSetorPorId(Number(info.lastInsertRowid));
}

function renomearSetor(id, nome) {
  db.prepare('UPDATE setores SET nome = ? WHERE id = ?').run(nome, id);
}

module.exports = { listarSetores, obterSetorPorId, criarSetor, renomearSetor };

const { db } = require('./db');

function salvarRegistro(colecao, registro) {
  db.prepare('INSERT INTO registros (colecao, dados, criado_em) VALUES (?, ?, ?)').run(
    colecao,
    JSON.stringify(registro),
    new Date().toISOString(),
  );
}

module.exports = { salvarRegistro };

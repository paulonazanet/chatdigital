const { db } = require('./db');

function salvarRegistro(colecao, registro) {
  db.prepare('INSERT INTO registros (colecao, dados, criado_em) VALUES (?, ?, ?)').run(
    colecao,
    JSON.stringify(registro),
    new Date().toISOString(),
  );
}

// Total de registros salvos pelo fluxo (pedidos, chamados, agendamentos etc. — o nome da
// "coleção" muda de negócio pra negócio) desde a meia-noite de hoje.
function contarRegistrosHoje() {
  const hoje = new Date().toISOString().slice(0, 10);
  return db.prepare('SELECT COUNT(*) AS total FROM registros WHERE criado_em >= ?').get(hoje).total;
}

module.exports = { salvarRegistro, contarRegistrosHoje };

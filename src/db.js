const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ARQUIVO_DB = process.env.CHATDIGITAL_DB || path.join(__dirname, '..', 'data', 'chatdigital.db');
const DIRETORIO = path.dirname(ARQUIVO_DB);
if (!fs.existsSync(DIRETORIO)) fs.mkdirSync(DIRETORIO, { recursive: true });

const db = new DatabaseSync(ARQUIVO_DB);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS atendentes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    papel TEXT NOT NULL CHECK (papel IN ('admin', 'atendente')),
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS setores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS atendentes_setores (
    atendente_id INTEGER NOT NULL REFERENCES atendentes(id) ON DELETE CASCADE,
    setor_id INTEGER NOT NULL REFERENCES setores(id) ON DELETE CASCADE,
    PRIMARY KEY (atendente_id, setor_id)
  );

  CREATE TABLE IF NOT EXISTS registros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    colecao TEXT NOT NULL,
    dados TEXT NOT NULL,
    criado_em TEXT NOT NULL
  );
`);

module.exports = { db };

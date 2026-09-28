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

  CREATE TABLE IF NOT EXISTS conversas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('bot', 'aguardando', 'atendendo', 'finalizado')) DEFAULT 'bot',
    setor_id INTEGER REFERENCES setores(id),
    atendente_id INTEGER REFERENCES atendentes(id),
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mensagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
    remetente TEXT NOT NULL CHECK (remetente IN ('cliente', 'bot', 'atendente')),
    texto TEXT NOT NULL,
    criado_em TEXT NOT NULL
  );
`);

// Migrações simples: adiciona colunas novas em bancos já existentes (instalações antigas), sem
// mexer nos dados já gravados. CREATE TABLE IF NOT EXISTS não altera tabelas que já existem.
function colunaExiste(tabela, coluna) {
  return db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
}
if (!colunaExiste('atendentes', 'permissoes')) {
  db.exec("ALTER TABLE atendentes ADD COLUMN permissoes TEXT NOT NULL DEFAULT '[]'");
}
if (!colunaExiste('atendentes', 'ultimo_login')) {
  db.exec('ALTER TABLE atendentes ADD COLUMN ultimo_login TEXT');
}
if (!colunaExiste('conversas', 'no_fluxo_atual')) {
  // em qual nó do fluxo o cliente está agora (motor de fluxo só guarda isso em memória) — salvar
  // aqui é o que permite a seção "Parado no fluxo" sobreviver a um reinício do processo.
  db.exec('ALTER TABLE conversas ADD COLUMN no_fluxo_atual TEXT');
}
if (!colunaExiste('conversas', 'lembrete_inatividade_em')) {
  // quando o lembrete de inatividade foi mandado (NULL = nenhum pendente) — usado por
  // src/inatividade.js pra não repetir o lembrete e pra saber quando resetar a conversa parada.
  db.exec('ALTER TABLE conversas ADD COLUMN lembrete_inatividade_em TEXT');
}

// O fluxo padrão (config/fluxo.json) transfere para o setor "Geral" — garante que ele exista
// sem sobrescrever setores que o cliente já tenha criado.
db.prepare('INSERT OR IGNORE INTO setores (nome) VALUES (?)').run('Geral');

module.exports = { db, ARQUIVO_DB };

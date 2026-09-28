const fs = require('fs');
const path = require('path');
const { db, ARQUIVO_DB } = require('./db');

// Backup diário local do banco (decidido com o Paulo: cópia local, 7-30 dias de retenção;
// off-site fica pra uma fase futura). Usa `VACUUM INTO`, que o próprio SQLite garante ser uma
// cópia consistente mesmo com o processo rodando (diferente de copiar o arquivo .db na mão, que
// pode pegar o banco no meio de uma escrita).
const DIRETORIO_BACKUP = process.env.CHATDIGITAL_BACKUP_DIR || path.join(path.dirname(ARQUIVO_DB), 'backups');
const DIAS_RETENCAO = 30;
const INTERVALO_CHECAGEM_MS = 60 * 60 * 1000; // checa de hora em hora (fazerBackup só age 1x por dia)

function nomeArquivoBackup(data = new Date()) {
  return `chatdigital-${data.toISOString().slice(0, 10)}.db`;
}

function limparBackupsAntigos() {
  const limite = Date.now() - DIAS_RETENCAO * 24 * 60 * 60 * 1000;
  for (const nome of fs.readdirSync(DIRETORIO_BACKUP)) {
    const caminho = path.join(DIRETORIO_BACKUP, nome);
    if (fs.statSync(caminho).mtimeMs < limite) fs.unlinkSync(caminho);
  }
}

/** Idempotente: se o backup de hoje já existe, não faz nada. Devolve o caminho do arquivo do dia. */
function fazerBackup() {
  if (!fs.existsSync(DIRETORIO_BACKUP)) fs.mkdirSync(DIRETORIO_BACKUP, { recursive: true });

  const destino = path.join(DIRETORIO_BACKUP, nomeArquivoBackup());
  if (!fs.existsSync(destino)) {
    db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  }

  limparBackupsAntigos();
  return destino;
}

function iniciarBackupDiario() {
  try {
    fazerBackup();
  } catch (erro) {
    console.error('Falha ao fazer backup do banco:', erro);
  }
  return setInterval(() => {
    try {
      fazerBackup();
    } catch (erro) {
      console.error('Falha ao fazer backup do banco:', erro);
    }
  }, INTERVALO_CHECAGEM_MS);
}

module.exports = { fazerBackup, iniciarBackupDiario, DIRETORIO_BACKUP, DIAS_RETENCAO };

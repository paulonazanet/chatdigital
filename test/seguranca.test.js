const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-seguranca-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_BACKUP_DIR = path.join(diretorioTeste, 'backups');
process.env.SESSION_SECRET = 'segredo-de-teste';

const { app } = require('../src/server');
const { db } = require('../src/db');
const { fazerBackup, DIRETORIO_BACKUP, DIAS_RETENCAO } = require('../src/backup');
const { aplicarRetencao, MESES_RETENCAO, PREFIXO_ANONIMO } = require('../src/retencao');
const limiteLogin = require('../src/limite-login');

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

test('rate limit de login: bloqueia depois de 5 erradas, reseta ao acertar, não afeta outro e-mail', async () => {
  let resp = await fetch(`${baseUrl}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nome: 'Paulo Admin', email: 'admin-rl@teste.com', senha: 'senhaCorreta1' }),
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 302);

  for (let i = 0; i < 5; i++) {
    resp = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'admin-rl@teste.com', senha: 'senhaErrada' }),
    });
    assert.strictEqual(resp.status, 200, `tentativa ${i + 1} não deve estar bloqueada ainda`);
  }

  // 6ª tentativa, mesmo com a senha certa, deve estar bloqueada
  resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'admin-rl@teste.com', senha: 'senhaCorreta1' }),
  });
  assert.strictEqual(resp.status, 429);
  assert.match(await resp.text(), /Muitas tentativas/);

  // outro e-mail não é afetado pelo bloqueio deste
  resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'outro@teste.com', senha: 'qualquer' }),
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 200, 'outro e-mail não deve estar bloqueado');
  assert.match(await resp.text(), /inválidos/);

  // limpa o bloqueio manualmente (equivalente a esperar os 15min) e confirma que acertar destrava
  limiteLogin.registrarSucesso('admin-rl@teste.com');
  resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'admin-rl@teste.com', senha: 'senhaCorreta1' }),
    redirect: 'manual',
  });
  assert.strictEqual(resp.status, 302, 'depois de desbloqueado, login certo deve funcionar normalmente');

  console.log('OK: rate limit de login bloqueia após 5 tentativas erradas, sem afetar outros e-mails');
});

test('backup diário: cria um arquivo consistente por dia e limpa backups mais velhos que a retenção', async () => {
  const caminho = fazerBackup();
  assert.ok(fs.existsSync(caminho), 'deve ter criado o arquivo de backup');

  const tamanhoAntes = fs.statSync(caminho).size;
  assert.ok(tamanhoAntes > 0, 'backup não deve ser um arquivo vazio');

  // chamar de novo no mesmo dia não deve falhar nem duplicar (idempotente)
  const caminho2 = fazerBackup();
  assert.strictEqual(caminho2, caminho);

  // simula um backup de dias além da retenção -> deve ser removido na próxima passada
  const arquivoVelho = path.join(DIRETORIO_BACKUP, 'chatdigital-2020-01-01.db');
  fs.writeFileSync(arquivoVelho, 'backup antigo de mentirinha');
  const antigo = new Date(Date.now() - (DIAS_RETENCAO + 5) * 24 * 60 * 60 * 1000);
  fs.utimesSync(arquivoVelho, antigo, antigo);

  fazerBackup();
  assert.ok(!fs.existsSync(arquivoVelho), 'backup mais velho que a retenção deve ter sido apagado');
  assert.ok(fs.existsSync(caminho), 'backup do dia atual deve continuar existindo');

  console.log('OK: backup diário é consistente, idempotente por dia, e limpa backups antigos');
});

test('retenção de dados: anonimiza número e apaga mensagens de conversas inativas há 12 meses+, sem mexer nas recentes', async () => {
  const agora = new Date().toISOString();
  const antigo = new Date();
  antigo.setMonth(antigo.getMonth() - (MESES_RETENCAO + 1));

  const infoAntiga = db
    .prepare('INSERT INTO conversas (numero, status, criado_em, atualizado_em) VALUES (?, ?, ?, ?)')
    .run('5511911112222@s.whatsapp.net', 'finalizado', antigo.toISOString(), antigo.toISOString());
  db.prepare('INSERT INTO mensagens (conversa_id, remetente, texto, criado_em) VALUES (?, ?, ?, ?)').run(
    Number(infoAntiga.lastInsertRowid),
    'cliente',
    'meu endereço é Rua X, 123',
    antigo.toISOString(),
  );

  const infoRecente = db
    .prepare('INSERT INTO conversas (numero, status, criado_em, atualizado_em) VALUES (?, ?, ?, ?)')
    .run('5511933334444@s.whatsapp.net', 'finalizado', agora, agora);
  db.prepare('INSERT INTO mensagens (conversa_id, remetente, texto, criado_em) VALUES (?, ?, ?, ?)').run(
    Number(infoRecente.lastInsertRowid),
    'cliente',
    'oi',
    agora,
  );

  const total = aplicarRetencao();
  assert.strictEqual(total, 1, 'só a conversa antiga deve ter sido processada');

  const conversaAntiga = db.prepare('SELECT * FROM conversas WHERE id = ?').get(Number(infoAntiga.lastInsertRowid));
  assert.ok(conversaAntiga.numero.startsWith(PREFIXO_ANONIMO), 'número da conversa antiga deve estar anonimizado');
  assert.strictEqual(conversaAntiga.status, 'finalizado', 'status deve continuar existindo pra estatística agregada');
  const mensagensAntiga = db.prepare('SELECT * FROM mensagens WHERE conversa_id = ?').all(Number(infoAntiga.lastInsertRowid));
  assert.strictEqual(mensagensAntiga.length, 0, 'mensagens da conversa antiga devem ter sido apagadas');

  const conversaRecente = db.prepare('SELECT * FROM conversas WHERE id = ?').get(Number(infoRecente.lastInsertRowid));
  assert.strictEqual(conversaRecente.numero, '5511933334444@s.whatsapp.net', 'conversa recente não deve ser mexida');
  const mensagensRecente = db.prepare('SELECT * FROM mensagens WHERE conversa_id = ?').all(Number(infoRecente.lastInsertRowid));
  assert.strictEqual(mensagensRecente.length, 1, 'mensagens da conversa recente devem continuar intactas');

  // rodar de novo não deve reprocessar a mesma conversa já anonimizada
  const totalSegundaPassada = aplicarRetencao();
  assert.strictEqual(totalSegundaPassada, 0);

  console.log('OK: retenção de dados anonimiza e apaga mensagens só de conversas inativas há 12+ meses');
});

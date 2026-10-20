const { db } = require('./db');

// Números de WhatsApp da instalação (E4, 3a parte), todos pelo celular (QR Code) e com o mesmo bot.
// O 1o ("Principal") usa a pasta de login "auth" de sempre; os outros, "auth-numero-<id>".
// Desativar um número desliga a conexão dele, mas guarda o histórico das conversas.

function listarCanais({ soAtivos = false } = {}) {
  return db.prepare(`SELECT * FROM canais ${soAtivos ? 'WHERE ativo = 1' : ''} ORDER BY id`).all();
}

function obterCanal(id) {
  return db.prepare('SELECT * FROM canais WHERE id = ?').get(id) || null;
}

const nomeLimpo = (nome) => String(nome || '').trim().slice(0, 40);

/** Cadastra um número novo. Devolve o canal ou { erro } */
function criarCanal(nome) {
  const limpo = nomeLimpo(nome);
  if (!limpo) return { erro: 'Dê um nome para o número (ex.: Suporte 2).' };
  if (listarCanais().some((c) => c.nome.toLowerCase() === limpo.toLowerCase())) return { erro: 'Já existe um número com esse nome.' };
  const id = Number(db.prepare("INSERT INTO canais (nome, pasta, criado_em) VALUES (?, 'temporaria', ?)").run(`${limpo}`, new Date().toISOString()).lastInsertRowid);
  db.prepare('UPDATE canais SET pasta = ? WHERE id = ?').run(`auth-numero-${id}`, id);
  return obterCanal(id);
}

function renomearCanal(id, nome) {
  const limpo = nomeLimpo(nome);
  if (!limpo) return { erro: 'O nome do número não pode ficar em branco.' };
  if (listarCanais().some((c) => c.id !== id && c.nome.toLowerCase() === limpo.toLowerCase())) return { erro: 'Já existe um número com esse nome.' };
  db.prepare('UPDATE canais SET nome = ? WHERE id = ?').run(limpo, id);
  return {};
}

/** Liga ou desliga. O último número ligado não pode ser desligado. Devolve { erro } ou o canal */
function definirAtivo(id, ativo) {
  if (!ativo && listarCanais({ soAtivos: true }).filter((c) => c.id !== id).length === 0) return { erro: 'Pelo menos um número tem que ficar ligado.' };
  db.prepare('UPDATE canais SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, id);
  return obterCanal(id);
}

/** Tem mais de um número ligado? (só então a Fila mostra de qual número veio cada conversa) */
function temVariosNumeros() {
  return listarCanais({ soAtivos: true }).length > 1;
}

module.exports = { listarCanais, obterCanal, criarCanal, renomearCanal, definirAtivo, temVariosNumeros };

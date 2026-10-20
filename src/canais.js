const { db } = require('./db');

// Números de WhatsApp da instalação (E4, 3a parte), todos pelo celular (QR Code) e com o mesmo bot.
// O 1o ("Principal") usa a pasta de login "auth" de sempre; os outros, "auth-numero-<id>".
// Desativar um número desliga a conexão dele, mas guarda o histórico das conversas.
// O Instagram (E4) também é um canal (tipo 'instagram', um por instalação): assim tem etiqueta na
// Fila e fluxo próprio, igual a um número. tipo 'celular' = WhatsApp pelo QR Code.

function listarCanais({ soAtivos = false, tipo = null } = {}) {
  const filtros = [soAtivos ? 'ativo = 1' : null, tipo ? 'tipo = ?' : null].filter(Boolean);
  return db.prepare(`SELECT * FROM canais ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''} ORDER BY id`).all(...(tipo ? [tipo] : []));
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
  if (!ativo && obterCanal(id)?.tipo !== 'instagram' && listarCanais({ soAtivos: true, tipo: 'celular' }).filter((c) => c.id !== id).length === 0) return { erro: 'Pelo menos um número tem que ficar ligado.' };
  db.prepare('UPDATE canais SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, id);
  return obterCanal(id);
}

/** O canal do Instagram (cria na 1a vez que a conta é configurada) */
function canalInstagram({ criar = false } = {}) {
  const existente = db.prepare("SELECT * FROM canais WHERE tipo = 'instagram' ORDER BY id LIMIT 1").get();
  if (existente || !criar) return existente || null;
  const id = Number(db.prepare("INSERT INTO canais (nome, pasta, tipo, criado_em) VALUES ('Instagram', 'instagram', 'instagram', ?)").run(new Date().toISOString()).lastInsertRowid);
  return obterCanal(id);
}

/** Tem mais de um número (ou o Instagram) ligado? (só então a Fila mostra de qual número veio cada conversa) */
function temVariosNumeros() {
  return listarCanais({ soAtivos: true }).length > 1;
}

module.exports = { listarCanais, obterCanal, criarCanal, renomearCanal, definirAtivo, temVariosNumeros, canalInstagram };

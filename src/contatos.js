const { db } = require('./db');
const { conversaCasaComBusca, renomearContato } = require('./conversas');
const { PREFIXO_ANONIMO } = require('./retencao');

// Contatos (menu Contatos): a ficha de cada número que já falou com a gente. Mora na própria
// linha de `conversas` (uma por número pra sempre), ver db.js.

const SITUACOES = ['normal', 'ignorado', 'bloqueado'];
const POR_PAGINA = 50;

function telefoneDe(c) {
  return c.numero_exibicao || String(c.numero).replace(/@.*/, '');
}

// Busca do Contatos: nome ou telefone (mesma regra da fila), e também e-mail e documento
function casaComBusca(c, busca) {
  if (!busca) return true;
  if (conversaCasaComBusca(c, busca)) return true;
  const termo = busca.toLowerCase().trim();
  const digitos = termo.replace(/\D/g, '');
  if (c.email && c.email.toLowerCase().includes(termo)) return true;
  return digitos.length >= 3 && String(c.documento || '').replace(/\D/g, '').includes(digitos);
}

function tagsPorContato(ids) {
  if (!ids.length) return {};
  const linhas = db
    .prepare(
      `SELECT ct.conversa_id, t.id, t.nome FROM conversas_tags ct JOIN tags_contato t ON t.id = ct.tag_id
       WHERE ct.conversa_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.nome COLLATE NOCASE`,
    )
    .all(...ids);
  const resultado = {};
  for (const l of linhas) (resultado[l.conversa_id] ||= []).push({ id: l.id, nome: l.nome });
  return resultado;
}

/** { itens, total, contagens, pagina, paginas } — filtros: busca, situacao, tag (id), pagina (1...) */
function listarContatos({ busca = '', situacao = '', tag = '', pagina = 1 } = {}) {
  const todos = db
    .prepare(
      `SELECT c.*, (SELECT MAX(m.criado_em) FROM mensagens m WHERE m.conversa_id = c.id AND m.interna = 0) AS ultima_mensagem_em
       FROM conversas c WHERE c.numero NOT LIKE '${PREFIXO_ANONIMO}%' ORDER BY c.atualizado_em DESC`,
    )
    .all();
  const contagens = { total: todos.length, normal: 0, ignorado: 0, bloqueado: 0 };
  for (const c of todos) contagens[c.situacao_contato] = (contagens[c.situacao_contato] || 0) + 1;

  const comTag = tag ? new Set(db.prepare('SELECT conversa_id FROM conversas_tags WHERE tag_id = ?').all(Number(tag)).map((l) => l.conversa_id)) : null;
  const filtrados = todos.filter(
    (c) => (!situacao || c.situacao_contato === situacao) && (!comTag || comTag.has(c.id)) && casaComBusca(c, busca),
  );
  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const atual = Math.min(Math.max(1, Number(pagina) || 1), paginas);
  const itens = filtrados.slice((atual - 1) * POR_PAGINA, atual * POR_PAGINA);
  const tags = tagsPorContato(itens.map((c) => c.id));
  return {
    itens: itens.map((c) => ({ ...c, telefone: telefoneDe(c), tags: tags[c.id] || [] })),
    total: filtrados.length,
    contagens,
    pagina: atual,
    paginas,
  };
}

function obterContato(id) {
  const c = db.prepare(`SELECT * FROM conversas WHERE id = ? AND numero NOT LIKE '${PREFIXO_ANONIMO}%'`).get(id);
  if (!c) return null;
  return { ...c, telefone: telefoneDe(c), tags: tagsPorContato([c.id])[c.id] || [] };
}

function limpar(texto, maximo) {
  const t = String(texto ?? '').trim().slice(0, maximo);
  return t || null;
}

/**
 * Grava a ficha (campo que não veio no envio fica como está). Consentimento: o formulário manda
 * `consentimento_enviado` junto, porque checkbox desmarcado não vem; guarda quando aceitou e quando
 * pediu pra sair (opt-out).
 */
function salvarContato(id, campos) {
  const atual = obterContato(id);
  if (!atual) return;
  if (campos.nome !== undefined) renomearContato(id, campos.nome);
  const valor = (campo, maximo) => (campos[campo] === undefined ? atual[campo] : limpar(campos[campo], maximo));
  const situacao = SITUACOES.includes(campos.situacao_contato) ? campos.situacao_contato : atual.situacao_contato;
  const consentimento = campos.consentimento_enviado !== undefined ? (campos.consentimento ? 1 : 0) : atual.consentimento;
  const agora = new Date().toISOString();
  db.prepare(
    `UPDATE conversas SET email = ?, documento = ?, endereco = ?, observacoes = ?, situacao_contato = ?, consentimento = ?,
       consentimento_em = CASE WHEN ? = 1 AND consentimento = 0 THEN ? ELSE consentimento_em END,
       optout_em = CASE WHEN ? = 0 AND consentimento = 1 THEN ? ELSE optout_em END
     WHERE id = ?`,
  ).run(
    valor('email', 120), valor('documento', 30), valor('endereco', 300), valor('observacoes', 2000),
    situacao, consentimento, consentimento, agora, consentimento, agora, id,
  );
  if (campos.tags !== undefined) definirTagsDoContato(id, campos.tags);
}

function definirSituacao(id, situacao) {
  if (SITUACOES.includes(situacao)) db.prepare('UPDATE conversas SET situacao_contato = ? WHERE id = ?').run(situacao, id);
}

/** 'normal' | 'ignorado' | 'bloqueado' do número (usado pelo bot antes de processar a mensagem) */
function situacaoDoNumero(numero) {
  return db.prepare('SELECT situacao_contato FROM conversas WHERE numero = ?').get(numero)?.situacao_contato || 'normal';
}

// Tags
function listarTags() {
  return db
    .prepare('SELECT t.*, (SELECT COUNT(*) FROM conversas_tags ct WHERE ct.tag_id = t.id) AS em_uso FROM tags_contato t ORDER BY t.nome COLLATE NOCASE')
    .all();
}

function criarTag(nome) {
  const limpo = limpar(nome, 40);
  if (!limpo) return null;
  const existente = db.prepare('SELECT id FROM tags_contato WHERE nome = ?').get(limpo);
  if (existente) return existente.id;
  return Number(db.prepare('INSERT INTO tags_contato (nome) VALUES (?)').run(limpo).lastInsertRowid);
}

function renomearTag(id, nome) {
  const limpo = limpar(nome, 40);
  if (!limpo) return false;
  try {
    db.prepare('UPDATE tags_contato SET nome = ? WHERE id = ?').run(limpo, id);
    return true;
  } catch (erro) {
    return false; // já existe outra com esse nome
  }
}

function excluirTag(id) {
  db.prepare('DELETE FROM tags_contato WHERE id = ?').run(id);
}

function tirarTagDeTodos(id) {
  db.prepare('DELETE FROM conversas_tags WHERE tag_id = ?').run(id);
}

function definirTagsDoContato(id, tagIds) {
  const validos = new Set(listarTags().map((t) => t.id));
  db.prepare('DELETE FROM conversas_tags WHERE conversa_id = ?').run(id);
  const inserir = db.prepare('INSERT OR IGNORE INTO conversas_tags (conversa_id, tag_id) VALUES (?, ?)');
  for (const tagId of [].concat(tagIds || []).map(Number)) if (validos.has(tagId)) inserir.run(id, tagId);
}

module.exports = {
  SITUACOES,
  listarContatos,
  obterContato,
  salvarContato,
  definirSituacao,
  situacaoDoNumero,
  listarTags,
  criarTag,
  renomearTag,
  excluirTag,
  tirarTagDeTodos,
  definirTagsDoContato,
};

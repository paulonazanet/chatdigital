const { db } = require('./db');
const { normalizarPermissoes } = require('./permissoes');

// Grupos de permissão (Atendentes > Grupos de permissão), ex.: "Gerente" e "Atendente". Quem está
// num grupo tem exatamente as permissões dele: mudar o grupo muda todo mundo que está nele (as
// permissões são copiadas pra `atendentes.permissoes`, que é o que o resto do sistema lê).

function lerPermissoes(texto) {
  try {
    return normalizarPermissoes(JSON.parse(texto || '[]'));
  } catch (erro) {
    return [];
  }
}

function listarGrupos() {
  return db
    .prepare('SELECT g.*, (SELECT COUNT(*) FROM atendentes a WHERE a.grupo_id = g.id) AS membros FROM grupos_permissao g ORDER BY g.nome COLLATE NOCASE')
    .all()
    .map((g) => ({ ...g, permissoes: lerPermissoes(g.permissoes) }));
}

function obterGrupo(id) {
  const g = db.prepare('SELECT * FROM grupos_permissao WHERE id = ?').get(id);
  return g ? { ...g, permissoes: lerPermissoes(g.permissoes) } : null;
}

// copia as permissões do grupo pra quem está nele (administrador não muda: tem tudo sempre)
function aplicarNosMembros(id) {
  const grupo = obterGrupo(id);
  if (!grupo) return;
  db.prepare("UPDATE atendentes SET permissoes = ? WHERE grupo_id = ? AND papel <> 'admin'").run(JSON.stringify(grupo.permissoes), id);
}

/** Cria o grupo. Devolve { id } ou { erro }. */
function criarGrupo(nome, permissoes) {
  const limpo = String(nome || '').trim().slice(0, 40);
  if (!limpo) return { erro: 'Escreva o nome do grupo.' };
  try {
    const id = Number(db.prepare('INSERT INTO grupos_permissao (nome, permissoes) VALUES (?, ?)').run(limpo, JSON.stringify(normalizarPermissoes(permissoes))).lastInsertRowid);
    return { id };
  } catch (erro) {
    return { erro: 'Já existe um grupo com esse nome.' };
  }
}

/** Renomeia e troca as permissões (vale na hora pra todos do grupo). Devolve { ok } ou { erro }. */
function atualizarGrupo(id, nome, permissoes) {
  const limpo = String(nome || '').trim().slice(0, 40);
  if (!limpo) return { erro: 'Escreva o nome do grupo.' };
  try {
    db.prepare('UPDATE grupos_permissao SET nome = ?, permissoes = ? WHERE id = ?').run(limpo, JSON.stringify(normalizarPermissoes(permissoes)), id);
  } catch (erro) {
    return { erro: 'Já existe um grupo com esse nome.' };
  }
  aplicarNosMembros(id);
  return { ok: true };
}

// Apagar o grupo não tira permissão de ninguém: quem estava nele fica com as mesmas, marcadas à mão.
function excluirGrupo(id) {
  db.prepare('UPDATE atendentes SET grupo_id = NULL WHERE grupo_id = ?').run(id);
  db.prepare('DELETE FROM grupos_permissao WHERE id = ?').run(id);
}

module.exports = { listarGrupos, obterGrupo, criarGrupo, atualizarGrupo, excluirGrupo, aplicarNosMembros };

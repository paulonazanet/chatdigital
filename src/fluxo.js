const fs = require('fs');
const path = require('path');

const TIPOS_VALIDOS = ['inicio', 'mensagem', 'pergunta', 'condicao', 'salvar', 'api', 'transferir', 'transferir_atendente', 'horario', 'aguardar', 'nota', 'fim'];

function caminhoArquivo() {
  return process.env.CHATDIGITAL_FLUXO || path.join(__dirname, '..', 'config', 'fluxo.json');
}

function carregarFluxo() {
  return JSON.parse(fs.readFileSync(caminhoArquivo(), 'utf8'));
}

function coletarReferencias(no) {
  const refs = [];
  if (no.proximo !== undefined) refs.push(no.proximo);
  if (no.proximo_erro !== undefined) refs.push(no.proximo_erro);
  if (no.padrao !== undefined) refs.push(no.padrao);
  if (no.dentro !== undefined) refs.push(no.dentro);
  if (no.fora !== undefined) refs.push(no.fora);
  if (Array.isArray(no.opcoes)) no.opcoes.forEach((o) => refs.push(o.proximo));
  if (Array.isArray(no.casos)) no.casos.forEach((c) => refs.push(c.proximo));
  if (no.opcao_extra) refs.push(no.opcao_extra.proximo);
  return refs.filter((r) => r != null && r !== '');
}

/** Valida a estrutura de um fluxo (sem tocar em disco). Devolve uma lista de erros; vazia = válido. */
function validarFluxo(fluxo) {
  const erros = [];
  if (!fluxo || typeof fluxo !== 'object') return ['Fluxo inválido.'];
  if (!fluxo.nos || typeof fluxo.nos !== 'object') return ['Fluxo sem "nos".'];

  if (!fluxo.inicio) erros.push('Fluxo sem nó inicial definido.');
  else if (!fluxo.nos[fluxo.inicio]) erros.push(`Nó inicial "${fluxo.inicio}" não existe.`);

  const idsValidos = new Set(Object.keys(fluxo.nos));

  for (const [id, no] of Object.entries(fluxo.nos)) {
    if (!TIPOS_VALIDOS.includes(no.tipo)) {
      erros.push(`Nó "${id}" tem tipo desconhecido: "${no.tipo}".`);
      continue;
    }
    for (const ref of coletarReferencias(no)) {
      if (!idsValidos.has(ref)) {
        erros.push(`Nó "${id}" aponta para um nó que não existe: "${ref}".`);
      }
    }
  }

  return erros;
}

/** Valida e grava o fluxo em config/fluxo.json. Lança erro (com .detalhes) se inválido. */
function salvarFluxo(fluxo) {
  const erros = validarFluxo(fluxo);
  if (erros.length > 0) {
    const erro = new Error('Fluxo inválido.');
    erro.detalhes = erros;
    throw erro;
  }
  fs.writeFileSync(caminhoArquivo(), JSON.stringify(fluxo, null, 2) + '\n', 'utf8');
}


// ---- Vários fluxos (E4, 3a parte: cada número pode ter o seu bot) ----
// O fluxo 1 ("Principal") é o arquivo de sempre (config/fluxo.json); os outros ficam na tabela
// `fluxos` do banco. Cada número (canal) escolhe qual usa (canais.fluxo_id; vazio = o Principal).

function banco() {
  return require('./db').db; // aqui: db.js não depende deste arquivo, mas os testes trocam o banco antes
}

// o id do fluxo vai junto no objeto, sem entrar no JSON salvo/exportado
function marcarId(fluxo, id) {
  Object.defineProperty(fluxo, '_id', { value: id, enumerable: false, configurable: true });
  return fluxo;
}

/** O fluxo `id` (1 = o Principal, do arquivo). Fluxo que não existe mais: o Principal. */
function carregarFluxoPorId(id = 1) {
  const numero = Number(id) || 1;
  if (numero !== 1) {
    const linha = banco().prepare('SELECT conteudo FROM fluxos WHERE id = ? AND conteudo IS NOT NULL').get(numero);
    if (linha) {
      try {
        return marcarId(JSON.parse(linha.conteudo), numero);
      } catch (erro) {
        // conteúdo estragado: cai no Principal
      }
    }
  }
  return marcarId(carregarFluxo(), 1);
}

function fluxoIdDoCanal(canalId) {
  return banco().prepare('SELECT fluxo_id FROM canais WHERE id = ?').get(canalId)?.fluxo_id || 1;
}

/** O fluxo do número (canal) */
function carregarFluxoDoCanal(canalId) {
  return carregarFluxoPorId(fluxoIdDoCanal(canalId || 1));
}

/** O fluxo da conversa: o do número por onde o cliente escreveu por último */
function carregarFluxoDaConversa(numeroOuConversa) {
  const conversa = typeof numeroOuConversa === 'object' ? numeroOuConversa : banco().prepare('SELECT canal_id FROM conversas WHERE numero = ?').get(numeroOuConversa);
  return carregarFluxoDoCanal(conversa?.canal_id || 1);
}

/** Pra listas grandes (paradas no bot): lê cada fluxo uma vez só */
function leitorDeFluxos() {
  const cache = new Map();
  return (conversa) => {
    const id = fluxoIdDoCanal(conversa?.canal_id || 1);
    if (!cache.has(id)) cache.set(id, carregarFluxoPorId(id));
    return cache.get(id);
  };
}

/** Salva o fluxo `id` (valida antes; lança erro com .detalhes) */
function salvarFluxoPorId(fluxo, id = 1) {
  const numero = Number(id) || 1;
  if (numero === 1) return salvarFluxo(fluxo);
  const erros = validarFluxo(fluxo);
  if (erros.length > 0) {
    const erro = new Error('Fluxo inválido.');
    erro.detalhes = erros;
    throw erro;
  }
  banco().prepare('UPDATE fluxos SET conteudo = ?, atualizado_em = ? WHERE id = ?').run(JSON.stringify(fluxo), new Date().toISOString(), numero);
}

function listarFluxos() {
  return banco()
    .prepare('SELECT f.id, f.nome, f.atualizado_em, (SELECT COUNT(*) FROM canais c WHERE COALESCE(c.fluxo_id, 1) = f.id) AS numeros FROM fluxos f ORDER BY f.id')
    .all();
}

/** Fluxo novo, começando de `base` (outro fluxo ou um modelo). Devolve o id ou { erro } */
function criarFluxo(nome, base) {
  const limpo = String(nome || '').trim().slice(0, 60);
  if (!limpo) return { erro: 'Dê um nome para o fluxo.' };
  if (listarFluxos().some((f) => f.nome.toLowerCase() === limpo.toLowerCase())) return { erro: 'Já existe um fluxo com esse nome.' };
  if (validarFluxo(base).length) return { erro: 'O fluxo de partida não é válido.' };
  const agora = new Date().toISOString();
  const id = Number(banco().prepare('INSERT INTO fluxos (nome, conteudo, criado_em, atualizado_em) VALUES (?, ?, ?, ?)').run(limpo, JSON.stringify(base), agora, agora).lastInsertRowid);
  return { id };
}

function renomearFluxo(id, nome) {
  const limpo = String(nome || '').trim().slice(0, 60);
  if (!limpo) return { erro: 'O nome do fluxo não pode ficar em branco.' };
  if (listarFluxos().some((f) => f.id !== Number(id) && f.nome.toLowerCase() === limpo.toLowerCase())) return { erro: 'Já existe um fluxo com esse nome.' };
  banco().prepare('UPDATE fluxos SET nome = ? WHERE id = ?').run(limpo, id);
  return {};
}

/** Exclui (o Principal e fluxo usado por algum número não podem). Devolve { erro } ou {} */
function excluirFluxo(id) {
  const numero = Number(id);
  if (numero === 1) return { erro: 'O fluxo Principal não pode ser excluído.' };
  const usado = banco().prepare('SELECT COUNT(*) AS n FROM canais WHERE fluxo_id = ?').get(numero).n;
  if (usado) return { erro: 'Esse fluxo está sendo usado por um número. Troque o fluxo do número antes (Configurações > WhatsApp).' };
  banco().prepare('DELETE FROM fluxos WHERE id = ? AND id <> 1').run(numero);
  return {};
}

module.exports = {
  carregarFluxo,
  salvarFluxo,
  validarFluxo,
  carregarFluxoPorId,
  carregarFluxoDoCanal,
  carregarFluxoDaConversa,
  leitorDeFluxos,
  salvarFluxoPorId,
  listarFluxos,
  criarFluxo,
  renomearFluxo,
  excluirFluxo,
};

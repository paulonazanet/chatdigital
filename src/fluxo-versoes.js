const { db } = require('./db');
const { carregarFluxo, salvarFluxo, validarFluxo } = require('./fluxo');

// Versões do fluxo (E2, 3a parte): o que foi salvo, quando, por quem e de onde veio. Voltar para uma
// versão grava ela de novo como o fluxo atual (e isso também vira uma versão, então dá pra desfazer).

const MAXIMO_VERSOES = 100;

// de onde veio cada versão (o editor manda o tipo; o nome do arquivo/modelo vem junto)
function descreverOrigem(tipo, detalhe = '') {
  const limpo = String(detalhe || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
  if (tipo === 'modelo') return `Fluxo pronto: ${limpo || 'modelo'}`;
  if (tipo === 'importado') return `Importado de arquivo${limpo ? `: ${limpo}` : ''}`;
  if (tipo === 'restaurada') return limpo || 'Voltou para uma versão antiga';
  if (tipo === 'inicial') return 'Como estava antes do histórico de versões';
  return 'Salvo no editor';
}

function contarBlocos(fluxo) {
  return Object.keys((fluxo && fluxo.nos) || {}).length;
}

function registrarVersao(fluxo, { atendente = null, origem = 'Salvo no editor' } = {}) {
  db.prepare('INSERT INTO fluxo_versoes (criado_em, atendente_id, atendente_nome, origem, conteudo) VALUES (?, ?, ?, ?, ?)').run(
    new Date().toISOString(),
    atendente ? atendente.id : null,
    atendente ? atendente.nome : null,
    origem,
    JSON.stringify(fluxo),
  );
  db.prepare('DELETE FROM fluxo_versoes WHERE id NOT IN (SELECT id FROM fluxo_versoes ORDER BY id DESC LIMIT ?)').run(MAXIMO_VERSOES);
}

// Na 1a vez (histórico vazio), guarda o fluxo que já estava em uso, pra ele também ter volta.
function garantirVersaoInicial() {
  if (db.prepare('SELECT 1 FROM fluxo_versoes LIMIT 1').get()) return;
  try {
    registrarVersao(carregarFluxo(), { origem: descreverOrigem('inicial') });
  } catch (erro) {
    // sem fluxo legível não há o que guardar
  }
}

/** Salva o fluxo (valida antes; lança erro com .detalhes) e guarda a versão. */
function salvarComVersao(fluxo, { atendente = null, origem = 'Salvo no editor' } = {}) {
  garantirVersaoInicial();
  salvarFluxo(fluxo);
  registrarVersao(fluxo, { atendente, origem });
}

function listarVersoes() {
  garantirVersaoInicial();
  const linhas = db.prepare('SELECT id, criado_em, atendente_nome, origem, conteudo FROM fluxo_versoes ORDER BY id DESC').all();
  return linhas.map((v, i) => {
    let blocos = 0;
    try {
      blocos = contarBlocos(JSON.parse(v.conteudo));
    } catch (erro) {
      // versão corrompida: mostra sem contagem
    }
    return { id: v.id, criadoEm: v.criado_em, quem: v.atendente_nome || '—', origem: v.origem, blocos, atual: i === 0 };
  });
}

function obterVersao(id) {
  const linha = db.prepare('SELECT * FROM fluxo_versoes WHERE id = ?').get(id);
  if (!linha) return null;
  return { ...linha, fluxo: JSON.parse(linha.conteudo) };
}

/** Volta o fluxo para uma versão antiga. Devolve false se a versão não existe ou não é válida. */
function restaurarVersao(id, { atendente = null, quando = '' } = {}) {
  const versao = obterVersao(id);
  if (!versao || validarFluxo(versao.fluxo).length) return false;
  salvarComVersao(versao.fluxo, { atendente, origem: descreverOrigem('restaurada', `Voltou para a versão de ${quando}`.trim()) });
  return true;
}

module.exports = { descreverOrigem, salvarComVersao, listarVersoes, obterVersao, restaurarVersao, garantirVersaoInicial, contarBlocos, MAXIMO_VERSOES };

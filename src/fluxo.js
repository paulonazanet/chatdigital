const fs = require('fs');
const path = require('path');

const TIPOS_VALIDOS = ['inicio', 'mensagem', 'pergunta', 'condicao', 'salvar', 'api', 'transferir', 'fim'];

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

module.exports = { carregarFluxo, salvarFluxo, validarFluxo };

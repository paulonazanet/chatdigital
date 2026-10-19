const crypto = require('crypto');
const { db } = require('./db');
const contatos = require('./contatos');
const { obterOuCriarConversa, definirNumeroExibicao, renomearContato } = require('./conversas');
const { formaCurtaNumeroBr } = require('./modo-teste');
const { resolverNumeroNoWhatsApp } = require('./whatsapp-numero');
const { PREFIXO_ANONIMO } = require('./retencao');

// Exportar e importar contatos por planilha (E2, 4a parte). A planilha é CSV (abre e salva no Excel
// como "CSV UTF-8" ou "CSV separado por ponto e vírgula"). Importar tem dois passos: confere e mostra
// o que vai acontecer; só depois de confirmar grava. Contato novo só entra se o número tiver WhatsApp
// (confere um por um, como o "Novo contato"); a situação (ignorado/bloqueado) nunca muda por planilha.

const LIMITE_LINHAS = 2000;
const VALIDADE_MS = 30 * 60000;
const ROTULO_SITUACAO = { normal: 'Normal', ignorado: 'Ignorado', bloqueado: 'Bloqueado' };

const doisDigitos = (n) => String(n).padStart(2, '0');
function dataLocal(iso) {
  if (!iso) return '';
  const d = new Date(Date.parse(iso) - 3 * 3600000);
  return `${doisDigitos(d.getUTCDate())}/${doisDigitos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function celula(valor) {
  let texto = valor === null || valor === undefined ? '' : String(valor);
  if (/^[=+\-@]/.test(texto)) texto = `'${texto}`; // não deixar virar fórmula no Excel
  return /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

const CABECALHO = ['Nome', 'Telefone', 'E-mail', 'Documento', 'Endereço', 'Observações', 'Tags', 'Situação', 'Consentimento', 'Consentiu em', 'Última mensagem'];

/** CSV com os contatos dos filtros da tela (";" + BOM; telefone como texto pro Excel não estragar) */
function exportarCsv(filtros) {
  const { itens } = contatos.listarContatos({ ...filtros, pagina: 1, porPagina: 100000 });
  const linhas = itens.map((c) =>
    [
      celula(c.nome_contato || ''),
      `="${String(c.telefone).replace(/\D/g, '')}"`,
      ...[
        c.email,
        c.documento,
        c.endereco,
        c.observacoes,
        c.tags.map((t) => t.nome).join(', '),
        ROTULO_SITUACAO[c.situacao_contato] || c.situacao_contato,
        c.consentimento ? 'sim' : 'não',
        dataLocal(c.consentimento_em),
        dataLocal(c.ultima_mensagem_em),
      ].map(celula),
    ].join(';'),
  );
  return '\uFEFF' + [CABECALHO.join(';'), ...linhas].join('\r\n') + '\r\n';
}

// ---- ler a planilha ----

// CSV com aspas; separador ";" ou "," (o que aparecer mais na 1a linha)
function lerCsv(texto) {
  const limpo = String(texto || '').replace(/^\uFEFF/, '');
  const primeira = limpo.split(/\r?\n/, 1)[0] || '';
  const separador = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < limpo.length; i += 1) {
    const ch = limpo[i];
    if (aspas) {
      if (ch === '"' && limpo[i + 1] === '"') {
        campo += '"';
        i += 1;
      } else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === separador) {
      linha.push(campo);
      campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && limpo[i + 1] === '\n') i += 1;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += ch;
  }
  if (campo || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas.filter((l) => l.some((c) => c.trim()));
}

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const COLUNAS = {
  nome: ['nome', 'cliente', 'nome do cliente', 'contato'],
  telefone: ['telefone', 'celular', 'whatsapp', 'fone', 'numero', 'telefone/whatsapp'],
  email: ['e-mail', 'email'],
  documento: ['documento', 'cpf', 'cnpj', 'cpf/cnpj'],
  endereco: ['endereco', 'endereço'],
  observacoes: ['observacoes', 'observacao', 'obs'],
  tags: ['tags', 'tag', 'etiquetas'],
  consentimento: ['consentimento', 'aceita mensagens', 'opt-in'],
};
// ="5581..." (como o exportar grava) e 'texto (proteção de fórmula) voltam ao normal
const valorDaCelula = (v) => String(v ?? '').trim().replace(/^="(.*)"$/, '$1').replace(/^'(?=[=+\-@])/, '').trim();

/** Linhas da planilha em objetos { linha, nome, telefone, ... }, ou { erro } */
function lerPlanilha(texto) {
  const linhas = lerCsv(texto);
  if (linhas.length < 2) return { erro: 'A planilha está vazia (precisa da linha de títulos e pelo menos um contato).' };
  const titulos = linhas[0].map(semAcento);
  const indice = {};
  for (const [campo, nomes] of Object.entries(COLUNAS)) {
    const i = titulos.findIndex((t) => nomes.includes(t));
    if (i >= 0) indice[campo] = i;
  }
  if (indice.telefone === undefined) return { erro: 'Não achei a coluna do telefone. A 1ª linha precisa ter os títulos, com uma coluna "Telefone".' };
  if (linhas.length - 1 > LIMITE_LINHAS) return { erro: `A planilha tem ${linhas.length - 1} linhas; o máximo por vez é ${LIMITE_LINHAS}. Divida em partes.` };
  return {
    linhas: linhas.slice(1).map((l, i) => {
      const item = { linha: i + 2 };
      for (const [campo, pos] of Object.entries(indice)) item[campo] = valorDaCelula(l[pos]);
      return item;
    }),
    colunas: Object.keys(indice),
  };
}

// ---- conferir (passo 1) ----

function normalizarTelefone(texto) {
  const digitos = String(texto || '').replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) return digitos;
  return null;
}

function indicePorTelefone() {
  const mapa = new Map();
  const linhas = db.prepare(`SELECT id, numero, numero_exibicao FROM conversas WHERE numero NOT LIKE '${PREFIXO_ANONIMO}%'`).all();
  for (const c of linhas) {
    for (const bruto of [c.numero_exibicao, String(c.numero).replace(/@.*/, '')]) {
      const digitos = String(bruto || '').replace(/\D/g, '');
      if (digitos.length >= 12) mapa.set(formaCurtaNumeroBr(digitos), c.id);
    }
  }
  return mapa;
}

/** O que vai acontecer com cada linha: atualizar (já existe), novo, ou erro (com o motivo) */
function conferir(linhas) {
  const existentes = indicePorTelefone();
  const vistos = new Set();
  return linhas.map((l) => {
    const telefone = normalizarTelefone(l.telefone);
    if (!telefone) return { ...l, acao: 'erro', motivo: 'Telefone inválido (precisa do DDD)' };
    const curto = formaCurtaNumeroBr(telefone);
    if (vistos.has(curto)) return { ...l, telefone, acao: 'erro', motivo: 'Telefone repetido na planilha' };
    vistos.add(curto);
    const contatoId = existentes.get(curto);
    return contatoId ? { ...l, telefone, acao: 'atualizar', contatoId } : { ...l, telefone, acao: 'novo' };
  });
}

// conferências guardadas entre o passo 1 e o 2 (em memória, por 30 min)
const pendentes = new Map();
function guardarConferencia(atendenteId, itens, nomeArquivo) {
  const agora = Date.now();
  for (const [token, p] of pendentes) if (agora - p.criado > VALIDADE_MS) pendentes.delete(token);
  const token = crypto.randomBytes(12).toString('hex');
  pendentes.set(token, { atendenteId, itens, nomeArquivo, criado: agora });
  return token;
}
function pegarConferencia(token, atendenteId) {
  const p = pendentes.get(String(token || ''));
  if (!p || p.atendenteId !== atendenteId || Date.now() - p.criado > VALIDADE_MS) return null;
  pendentes.delete(token);
  return p;
}

// ---- gravar (passo 2) ----

const SIM = new Set(['sim', 's', 'x', '1', 'true', 'yes', 'aceito', 'aceitou']);

// preenche a ficha: só os campos vazios, ou todos com `substituir`; tags são somadas
function gravarFicha(contatoId, item, substituir) {
  const atual = contatos.obterContato(contatoId);
  if (!atual) return;
  if (item.nome && (substituir || !atual.nome_editado)) renomearContato(contatoId, item.nome);
  const campos = {};
  for (const [campo, maximo] of [['email', 120], ['documento', 30], ['endereco', 300], ['observacoes', 2000]]) {
    if (item[campo] && (substituir || !atual[campo])) campos[campo] = String(item[campo]).slice(0, maximo);
  }
  if (SIM.has(semAcento(item.consentimento)) && !atual.consentimento) {
    campos.consentimento = '1';
    campos.consentimento_enviado = '1';
  }
  if (item.tags) {
    const novas = item.tags.split(/[,;|]/).map((t) => t.trim()).filter(Boolean).map((nome) => contatos.criarTag(nome)).filter(Boolean);
    campos.tags = [...new Set([...atual.tags.map((t) => t.id), ...novas])];
  }
  contatos.salvarContato(contatoId, campos);
}

/**
 * Grava a conferência. `sock` (WhatsApp conectado) é preciso pros contatos novos.
 * Devolve { atualizados, criados, semWhatsapp, naoCriados, erros }.
 */
async function aplicar(itens, { substituir = false, sock = null } = {}) {
  const resultado = { atualizados: 0, criados: 0, semWhatsapp: [], naoCriados: 0, erros: itens.filter((i) => i.acao === 'erro').length };
  for (const item of itens) {
    if (item.acao === 'atualizar') {
      gravarFicha(item.contatoId, item, substituir);
      resultado.atualizados += 1;
    } else if (item.acao === 'novo') {
      if (!sock) {
        resultado.naoCriados += 1;
        continue;
      }
      let numero = null;
      try {
        numero = await resolverNumeroNoWhatsApp(sock, item.telefone);
      } catch (erro) {
        numero = null;
      }
      if (!numero) {
        resultado.semWhatsapp.push(item.telefone);
        continue;
      }
      const conversa = obterOuCriarConversa(numero);
      definirNumeroExibicao(numero, item.telefone);
      gravarFicha(conversa.id, item, true);
      resultado.criados += 1;
    }
  }
  return resultado;
}

module.exports = { exportarCsv, lerCsv, lerPlanilha, conferir, guardarConferencia, pegarConferencia, aplicar, normalizarTelefone, LIMITE_LINHAS };

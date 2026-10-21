const { db } = require('./db');
const { carregarNegocio, salvarConfiguracoes } = require('./negocio');

// Custos da Meta (E4, 4a parte). Pela API oficial a Meta cobra por modelo (template) entregue, com
// preço por tipo: marketing, utilidade e autenticação. Responder o cliente dentro das 24 h não é
// cobrado, e modelo de utilidade dentro das 24 h também não. A tabela de preços muda, então o
// preço por mensagem é a empresa que preenche (Configurações > WhatsApp > Custos da Meta), em reais.

const CATEGORIAS = [
  { chave: 'MARKETING', campo: 'marketing', rotulo: 'Marketing', texto: 'Promoções, campanhas, novidades' },
  { chave: 'UTILITY', campo: 'utilidade', rotulo: 'Utilidade', texto: 'Lembretes, avisos de pedido, cobranças' },
  { chave: 'AUTHENTICATION', campo: 'autenticacao', rotulo: 'Autenticação', texto: 'Códigos de confirmação' },
];
const ORIGENS = { fila: 'Pela Fila', lembrete: 'Lembretes', campanha: 'Campanhas', retorno: 'Retornos', teste: 'Testes' };

function lerPrecos() {
  const salvos = carregarNegocio().precos_meta || {};
  return Object.fromEntries(CATEGORIAS.map((c) => [c.campo, Number(salvos[c.campo]) > 0 ? Number(salvos[c.campo]) : null]));
}

/** Grava os preços por mensagem (texto "0,35" ou "0.35"; em branco = sem preço). Devolve { erro } ou {} */
function salvarPrecos(campos) {
  const precos = {};
  for (const c of CATEGORIAS) {
    const bruto = String(campos[c.campo] ?? '').trim().replace(/^R\$\s*/i, '').replace(',', '.');
    if (!bruto) continue;
    const valor = Number(bruto);
    if (!Number.isFinite(valor) || valor < 0 || valor > 100) return { erro: `O preço de ${c.rotulo} tem que ser um valor em reais, por exemplo 0,35.` };
    precos[c.campo] = Math.round(valor * 10000) / 10000;
  }
  salvarConfiguracoes({ precos_meta: precos });
  return {};
}

// mês no horário de Recife (UTC-3): "2026-10" → [início, fim) em ISO
function limitesDoMes(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const inicio = new Date(Date.UTC(ano, m - 1, 1, 3));
  const fim = new Date(Date.UTC(ano, m, 1, 3));
  return [inicio.toISOString(), fim.toISOString()];
}

function mesAtual(agora = new Date()) {
  const local = new Date(agora.getTime() - 3 * 3600000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

function mesAnterior(mes) {
  const [ano, m] = mes.split('-').map(Number);
  return m === 1 ? `${ano - 1}-12` : `${ano}-${String(m - 1).padStart(2, '0')}`;
}

/** Resumo de um mês ("AAAA-MM"): por tipo, por origem e a estimativa em reais */
function resumoDoMes(mes = mesAtual()) {
  const [inicio, fim] = limitesDoMes(mes);
  const precos = lerPrecos();
  const linhas = db.prepare('SELECT categoria, origem, gratis, COUNT(*) AS n FROM modelos_enviados WHERE enviado_em >= ? AND enviado_em < ? GROUP BY categoria, origem, gratis').all(inicio, fim);
  const categorias = [...CATEGORIAS, { chave: null, campo: null, rotulo: 'Sem tipo', texto: 'Modelo que não está mais na lista da Meta' }].map((c) => {
    const daqui = linhas.filter((l) => (c.chave ? l.categoria === c.chave : !CATEGORIAS.some((k) => k.chave === l.categoria)));
    const total = daqui.reduce((s, l) => s + l.n, 0);
    const gratis = daqui.filter((l) => l.gratis).reduce((s, l) => s + l.n, 0);
    const preco = c.campo ? precos[c.campo] : null;
    return { ...c, total, gratis, cobradas: total - gratis, preco, estimativa: preco == null ? null : (total - gratis) * preco };
  });
  const porOrigem = Object.entries(
    linhas.reduce((acc, l) => {
      acc[l.origem] = (acc[l.origem] || 0) + l.n;
      return acc;
    }, {}),
  ).map(([origem, n]) => ({ origem, rotulo: ORIGENS[origem] || origem, n }));
  const visiveis = categorias.filter((c) => c.chave || c.total);
  const semPreco = visiveis.some((c) => c.cobradas > 0 && c.preco == null);
  return {
    mes,
    categorias: visiveis,
    porOrigem,
    total: visiveis.reduce((s, c) => s + c.total, 0),
    cobradas: visiveis.reduce((s, c) => s + c.cobradas, 0),
    estimativa: visiveis.reduce((s, c) => s + (c.estimativa || 0), 0),
    semPreco,
  };
}

/** Quanto custaria mandar `quantidade` modelos de uma categoria (pra campanha), ou null sem preço */
function estimarEnvio(categoria, quantidade) {
  const c = CATEGORIAS.find((k) => k.chave === categoria);
  const preco = c ? lerPrecos()[c.campo] : null;
  return preco == null ? null : { preco, total: preco * quantidade, rotulo: c.rotulo };
}

const formatarReais = (valor) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

module.exports = { CATEGORIAS, lerPrecos, salvarPrecos, resumoDoMes, estimarEnvio, mesAtual, mesAnterior, formatarReais };

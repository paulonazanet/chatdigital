const { db } = require('./db');
const { carregarNegocio } = require('./negocio');
const { resumoDePausas } = require('./equipe');

// Números do menu Relatório, lidos do livro de atendimentos (atendimentos.js). Tudo em horário de
// Brasília/Recife: UTC-3 fixo (o Brasil não tem mais horário de verão desde 2019).
const FUSO_MS = -3 * 3600000;
const DIA_MS = 24 * 3600000;

// lista (não objeto): chave numérica num objeto vai pra frente e bagunçava a ordem dos botões
const PERIODOS = [
  ['hoje', 'Hoje'],
  ['7', '7 dias'],
  ['30', '30 dias'],
  ['mes-passado', 'Mês passado'],
];
const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

// "hora local" representada como um Date em UTC: getUTCHours() etc. dão a hora de Recife
const paraLocal = (ms) => new Date(ms + FUSO_MS);
const meiaNoiteLocal = (ms) => {
  const local = paraLocal(ms);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - FUSO_MS;
};

/** Início (inclusive) e fim (exclusive) do período, em milissegundos UTC. */
function intervaloDoPeriodo(periodo, agoraMs = Date.now()) {
  const hoje = meiaNoiteLocal(agoraMs);
  if (periodo === 'hoje') return { inicio: hoje, fim: hoje + DIA_MS };
  if (periodo === 'mes-passado') {
    const local = paraLocal(agoraMs);
    const inicio = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1) - FUSO_MS;
    const fim = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - FUSO_MS;
    return { inicio, fim };
  }
  const dias = periodo === '7' ? 7 : 30;
  return { inicio: hoje - (dias - 1) * DIA_MS, fim: hoje + DIA_MS };
}

// Mediana e não média: um cliente que escreve às 22h e só é atendido às 8h puxaria a média pra
// horas e esconderia o dia a dia. "Metade esperou menos que isso" é o que interessa.
function mediana(valores) {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

function formatarDuracao(ms) {
  if (ms === null || ms === undefined) return '—';
  const minutos = Math.round(ms / 60000);
  if (minutos < 1) return 'menos de 1 min';
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas}h ${resto}min` : `${horas}h`;
}

// intervalos longos (reincidência): "2 dias 3h" em vez de "51h"
function formatarIntervalo(ms) {
  if (ms < DIA_MS) return formatarDuracao(ms);
  const dias = Math.floor(ms / DIA_MS);
  const horas = Math.floor((ms % DIA_MS) / 3600000);
  return `${dias} dia${dias === 1 ? '' : 's'}${horas ? ` ${horas}h` : ''}`;
}

const doisDigitos = (n) => String(n).padStart(2, '0');
function formatarDataHora(iso) {
  const local = paraLocal(Date.parse(iso));
  return `${doisDigitos(local.getUTCDate())}/${doisDigitos(local.getUTCMonth() + 1)} ${doisDigitos(local.getUTCHours())}:${doisDigitos(local.getUTCMinutes())}`;
}
// com o ano (Auditoria, conversa exportada)
function formatarDataHoraCompleta(iso) {
  if (!iso) return '—';
  const local = paraLocal(Date.parse(iso));
  return `${doisDigitos(local.getUTCDate())}/${doisDigitos(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ${doisDigitos(local.getUTCHours())}:${doisDigitos(local.getUTCMinutes())}`;
}

// Telefone legível: 5581996850663 → (81) 99685-0663
function formatarTelefone(numero) {
  const digitos = String(numero || '').split('@')[0].replace(/\D/g, '');
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digitos);
  return br ? `(${br[1]}) ${br[2]}-${br[3]}` : digitos || 'cliente';
}

// Tempos de um atendimento, em ms (null quando não dá pra medir). Espera e 1a resposta só contam
// pra quem veio do cliente (origem 'cliente'); o atendimento começado pelo atendente não tem fila.
// Duração (TMA) = de quando alguém assumiu até finalizar.
function temposDoAtendimento(t) {
  const doCliente = t.origem === 'cliente';
  return {
    espera: doCliente && t.assumido_em ? Date.parse(t.assumido_em) - Date.parse(t.aberto_em) : null,
    resposta: doCliente && t.primeira_resposta_em ? Date.parse(t.primeira_resposta_em) - Date.parse(t.aberto_em) : null,
    duracao: t.assumido_em && t.finalizado_em ? Math.max(0, Date.parse(t.finalizado_em) - Date.parse(t.assumido_em)) : null,
  };
}

const formatarNota = (valor) => (valor === null ? '—' : valor.toFixed(1).replace('.', ','));
const mediaDasNotas = (lista) => {
  const comNota = lista.filter((t) => t.nota !== null);
  return comNota.length ? comNota.reduce((s, t) => s + t.nota, 0) / comNota.length : null;
};

/** Metas do Relatório (Configurações > Metas): minutos, 0 = sem meta; a nota é a média mínima. */
function lerMetas(negocio = carregarNegocio()) {
  const numero = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  return {
    espera: numero(negocio.meta_espera_minutos),
    resposta: numero(negocio.meta_primeira_resposta_minutos),
    duracao: numero(negocio.meta_duracao_minutos),
    nota: numero(negocio.meta_nota),
    reincidenciaDias: numero(negocio.reincidencia_dias) || 7,
  };
}

// Compara um tempo com a meta: o tempo típico (mediana) e quantos % ficaram dentro dela.
function compararComMeta(valores, metaMinutos) {
  const tipico = mediana(valores);
  if (!metaMinutos || !valores.length) return { texto: formatarDuracao(tipico), meta: metaMinutos || 0, dentro: null, ok: null };
  const limite = metaMinutos * 60000;
  const dentro = Math.round((valores.filter((v) => v <= limite).length / valores.length) * 100);
  return { texto: formatarDuracao(tipico), meta: metaMinutos, dentro, ok: tipico <= limite };
}

/**
 * Reincidências: atendimentos que o cliente abriu (origem 'cliente') até `dias` dias depois de outro
 * atendimento dele ter sido finalizado. Sinal de que o problema não foi resolvido de primeira.
 * Com `atendenteId`, só os que voltaram depois de um atendimento dele. Do mais recente ao mais antigo.
 */
function listarReincidencias({ inicio, fim, dias, atendenteId = null }) {
  const limiteMs = dias * DIA_MS;
  const lista = db
    .prepare(
      `SELECT t.*, c.nome_contato, c.numero, c.numero_exibicao,
              ant.id AS anterior_id, ant.protocolo AS anterior_protocolo, ant.finalizado_em AS anterior_finalizado_em,
              ant.motivo_texto AS anterior_motivo, aa.nome AS anterior_atendente
       FROM atendimentos t
       JOIN conversas c ON c.id = t.conversa_id
       JOIN atendimentos ant ON ant.id = (
         SELECT p.id FROM atendimentos p
         WHERE p.conversa_id = t.conversa_id AND p.id <> t.id AND p.finalizado_em IS NOT NULL AND p.finalizado_em <= t.aberto_em
         ORDER BY p.finalizado_em DESC LIMIT 1
       )
       LEFT JOIN atendentes aa ON aa.id = ant.atendente_id
       WHERE t.origem = 'cliente' AND t.aberto_em >= ? AND t.aberto_em < ?
         AND (? IS NULL OR ant.atendente_id = ?)
       ORDER BY t.aberto_em DESC`,
    )
    .all(new Date(inicio).toISOString(), new Date(fim).toISOString(), atendenteId, atendenteId);
  return lista
    .filter((t) => Date.parse(t.aberto_em) - Date.parse(t.anterior_finalizado_em) <= limiteMs)
    .map((t) => ({
      atendimentoId: t.id,
      anteriorId: t.anterior_id,
      conversaId: t.conversa_id,
      cliente: t.nome_contato || formatarTelefone(t.numero_exibicao || t.numero),
      protocolo: t.protocolo,
      voltouEm: formatarDataHora(t.aberto_em),
      anteriorProtocolo: t.anterior_protocolo,
      anteriorFinalizado: formatarDataHora(t.anterior_finalizado_em),
      anteriorMotivo: t.anterior_motivo || '—',
      anteriorAtendente: t.anterior_atendente || '—',
      intervalo: formatarIntervalo(Date.parse(t.aberto_em) - Date.parse(t.anterior_finalizado_em)),
    }));
}

// Uma linha por atendente (quem ficou com o atendimento): só na visão "Todos os atendentes".
function tabelaPorAtendente(lista, metas) {
  const grupos = new Map();
  for (const t of lista) {
    const chave = t.atendente_id || 0;
    if (!grupos.has(chave)) grupos.set(chave, { nome: t.atendente_nome || 'Sem atendente', atendenteId: t.atendente_id || null, itens: [] });
    grupos.get(chave).itens.push(t);
  }
  return [...grupos.values()]
    .map((g) => {
      const tempos = g.itens.map(temposDoAtendimento);
      const valores = (campo) => tempos.map((x) => x[campo]).filter((v) => v !== null);
      const nota = mediaDasNotas(g.itens);
      return {
        nome: g.nome,
        atendenteId: g.atendenteId,
        total: g.itens.length,
        finalizados: g.itens.filter((t) => t.finalizado_em).length,
        semResposta: g.itens.filter((t) => t.origem === 'cliente' && t.finalizado_em && !t.primeira_resposta_em).length,
        espera: compararComMeta(valores('espera'), metas.espera),
        resposta: compararComMeta(valores('resposta'), metas.resposta),
        duracao: compararComMeta(valores('duracao'), metas.duracao),
        nota: formatarNota(nota),
        notaOk: nota === null || !metas.nota ? null : nota >= metas.nota,
      };
    })
    .sort((a, b) => b.total - a.total);
}

function montarRelatorio({ periodo = '30', atendenteId = null, agoraMs = Date.now() } = {}) {
  if (!PERIODOS.some(([valor]) => valor === periodo)) periodo = '30';
  const { inicio, fim } = intervaloDoPeriodo(periodo, agoraMs);

  const lista = db
    .prepare(
      `SELECT t.*, c.nome_contato, c.numero, c.numero_exibicao, a.nome AS atendente_nome
       FROM atendimentos t
       JOIN conversas c ON c.id = t.conversa_id
       LEFT JOIN atendentes a ON a.id = t.atendente_id
       WHERE t.aberto_em >= ? AND t.aberto_em < ? AND (? IS NULL OR t.atendente_id = ?)
       ORDER BY t.aberto_em`,
    )
    .all(new Date(inicio).toISOString(), new Date(fim).toISOString(), atendenteId, atendenteId);

  const doCliente = lista.filter((t) => t.origem === 'cliente');
  const tempos = lista.map(temposDoAtendimento);
  const valores = (campo) => tempos.map((x) => x[campo]).filter((v) => v !== null);
  const semResposta = doCliente.filter((t) => t.finalizado_em && !t.primeira_resposta_em).length;
  const comNota = lista.filter((t) => t.nota !== null);
  const metas = lerMetas();
  const notaMedia = mediaDasNotas(lista);
  const reincidencias = listarReincidencias({ inicio, fim, dias: metas.reincidenciaDias, atendenteId });

  // barras: por hora quando o período é um dia só, senão por dia
  const umDia = fim - inicio <= DIA_MS;
  const barras = [];
  if (umDia) {
    for (let h = 0; h < 24; h += 1) barras.push({ rotulo: `${h}h`, total: 0 });
  } else {
    for (let d = inicio; d < fim; d += DIA_MS) {
      const local = paraLocal(d);
      barras.push({ rotulo: `${doisDigitos(local.getUTCDate())}/${doisDigitos(local.getUTCMonth() + 1)}`, total: 0 });
    }
  }
  // com muitas barras os rótulos encavalam: mostra 1 a cada N (o título da barra tem todos)
  const passo = Math.ceil(barras.length / 12);
  barras.forEach((b, i) => {
    b.mostrarRotulo = i % passo === 0;
  });
  for (const t of lista) {
    const ms = Date.parse(t.aberto_em);
    const indice = umDia ? paraLocal(ms).getUTCHours() : Math.floor((meiaNoiteLocal(ms) - inicio) / DIA_MS);
    if (barras[indice]) barras[indice].total += 1;
  }

  // horários de pico: clientes que chegaram, por dia da semana e hora (7h às 19h, ou mais se
  // chegou cliente fora disso)
  const pico = DIAS_SEMANA.map(() => Array(24).fill(0));
  for (const t of doCliente) {
    const local = paraLocal(Date.parse(t.aberto_em));
    pico[(local.getUTCDay() + 6) % 7][local.getUTCHours()] += 1;
  }
  const horasComCliente = [];
  pico.forEach((linha) => linha.forEach((n, h) => n && horasComCliente.push(h)));
  const primeiraHora = Math.min(7, ...horasComCliente);
  const ultimaHora = Math.max(19, ...horasComCliente);
  const horas = [];
  for (let h = primeiraHora; h <= ultimaHora; h += 1) horas.push(h);
  const maiorPico = Math.max(0, ...pico.flat());

  return {
    periodo,
    periodos: PERIODOS,
    total: lista.length,
    semResposta,
    metas,
    esperaFila: compararComMeta(valores('espera'), metas.espera),
    primeiraResposta: compararComMeta(valores('resposta'), metas.resposta),
    duracao: compararComMeta(valores('duracao'), metas.duracao),
    notaMedia: formatarNota(notaMedia),
    notaOk: notaMedia === null || !metas.nota ? null : notaMedia >= metas.nota,
    totalNotas: comNota.length,
    reincidencias: reincidencias.length,
    reincidenciasPct: doCliente.length ? Math.round((reincidencias.length / doCliente.length) * 100) : 0,
    porAtendente: atendenteId ? [] : tabelaPorAtendente(lista, metas),
    pausas: resumoDePausas({ inicio, fim, atendenteId, agoraMs }).map((p) => ({
      nome: p.nome,
      quantidade: p.quantidade,
      total: formatarDuracao(p.totalMs),
      maior: formatarDuracao(p.maiorMs),
      passaram: p.passaram,
      motivos: p.motivos.map(([motivo, ms]) => `${motivo} ${formatarDuracao(ms)}`).join(' · '),
    })),
    barras,
    maiorBarra: Math.max(1, ...barras.map((b) => b.total)),
    porHora: umDia,
    pico: {
      dias: DIAS_SEMANA.map((nome, i) => ({ nome, valores: horas.map((h) => pico[i][h]) })),
      horas,
      maior: maiorPico,
    },
    notas: comNota
      .sort((a, b) => (b.finalizado_em || '').localeCompare(a.finalizado_em || ''))
      .slice(0, 100)
      .map((t) => ({
        conversaId: t.conversa_id,
        quando: formatarDataHora(t.finalizado_em || t.aberto_em),
        cliente: t.nome_contato || formatarTelefone(t.numero_exibicao || t.numero),
        atendente: t.atendente_nome || '—',
        nota: t.nota,
      })),
  };
}

module.exports = {
  montarRelatorio,
  intervaloDoPeriodo,
  mediana,
  formatarDuracao,
  formatarIntervalo,
  formatarDataHora,
  formatarDataHoraCompleta,
  formatarTelefone,
  temposDoAtendimento,
  lerMetas,
  compararComMeta,
  listarReincidencias,
  paraLocal,
  FUSO_MS,
  DIA_MS,
  PERIODOS,
};

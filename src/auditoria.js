const { db } = require('./db');
const atendimentos = require('./atendimentos');
const { listarMensagens } = require('./conversas');
const {
  formatarDataHoraCompleta,
  formatarDuracao,
  formatarTelefone,
  temposDoAtendimento,
  FUSO_MS,
  DIA_MS,
  paraLocal,
} = require('./relatorio');

// Auditoria (Relatório > Auditoria): os atendimentos finalizados com filtros, o detalhe de um
// atendimento com as mensagens dele e a conversa exportada (para imprimir/PDF ou em texto).

const POR_PAGINA = 50;
const LIMITE_EXPORTACAO = 5000;

const FINALIZADO_COMO = [
  ['atendente', 'Pelo atendente'],
  ['automatico', 'Fechamento automático'],
  ['outro', 'Outro (sistema)'],
];
const FAIXAS_DE_NOTA = [
  ['com', 'Com nota'],
  ['sem', 'Sem nota'],
  ['ruim', '0 a 6'],
  ['media', '7 e 8'],
  ['boa', '9 e 10'],
];

const doisDigitos = (n) => String(n).padStart(2, '0');
// 'AAAA-MM-DD' (dia de Recife) → ms UTC da meia-noite desse dia; null se a data não vale
function inicioDoDia(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto || ''));
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - FUSO_MS;
  return Number.isNaN(ms) ? null : ms;
}
function dataDoDia(ms) {
  const local = paraLocal(ms);
  return `${local.getUTCFullYear()}-${doisDigitos(local.getUTCMonth() + 1)}-${doisDigitos(local.getUTCDate())}`;
}

/** Lê os filtros da URL (com valores padrão: últimos 30 dias). */
function lerFiltros(query = {}, agoraMs = Date.now()) {
  const hoje = inicioDoDia(dataDoDia(agoraMs));
  let de = inicioDoDia(query.de) ?? hoje - 29 * DIA_MS;
  let ate = inicioDoDia(query.ate) ?? hoje;
  if (ate < de) [de, ate] = [ate, de];
  const texto = (v) => String(v || '').trim().slice(0, 80);
  const numero = (v) => (/^\d+$/.test(String(v || '')) ? Number(v) : null);
  return {
    de: dataDoDia(de),
    ate: dataDoDia(ate),
    inicioMs: de,
    fimMs: ate + DIA_MS,
    protocolo: texto(query.protocolo).replace(/\D/g, ''),
    cliente: texto(query.cliente),
    atendente: numero(query.atendente),
    setor: numero(query.setor),
    motivo: texto(query.motivo),
    como: FINALIZADO_COMO.some(([v]) => v === query.como) ? query.como : '',
    nota: FAIXAS_DE_NOTA.some(([v]) => v === query.nota) ? query.nota : '',
    marcador: numero(query.marcador),
    pagina: Math.max(1, numero(query.pagina) || 1),
  };
}

// WHERE dos filtros. Com protocolo, a data não conta (quem tem o protocolo quer aquele atendimento).
function montarCondicoes(f) {
  const condicoes = ['t.finalizado_em IS NOT NULL'];
  const parametros = [];
  if (f.protocolo) {
    condicoes.push('t.protocolo LIKE ?');
    parametros.push(`%${f.protocolo}%`);
  } else {
    condicoes.push('t.finalizado_em >= ? AND t.finalizado_em < ?');
    parametros.push(new Date(f.inicioMs).toISOString(), new Date(f.fimMs).toISOString());
  }
  if (f.cliente) {
    const digitos = f.cliente.replace(/\D/g, '');
    condicoes.push(`(c.nome_contato LIKE ? ${digitos ? 'OR c.numero LIKE ? OR c.numero_exibicao LIKE ?' : ''})`);
    parametros.push(`%${f.cliente}%`);
    if (digitos) parametros.push(`%${digitos}%`, `%${digitos}%`);
  }
  if (f.atendente) {
    condicoes.push('t.atendente_id = ?');
    parametros.push(f.atendente);
  }
  if (f.setor) {
    condicoes.push('t.setor_id = ?');
    parametros.push(f.setor);
  }
  if (f.motivo === '-') {
    condicoes.push('t.motivo_texto IS NULL');
  } else if (f.motivo) {
    condicoes.push('t.motivo_texto = ?');
    parametros.push(f.motivo);
  }
  if (f.como) {
    condicoes.push('t.finalizado_como = ?');
    parametros.push(f.como);
  }
  const notas = {
    com: 't.nota IS NOT NULL',
    sem: 't.nota IS NULL',
    ruim: 't.nota <= 6',
    media: 't.nota IN (7, 8)',
    boa: 't.nota >= 9',
  };
  if (f.nota) condicoes.push(notas[f.nota]);
  if (f.marcador) {
    // marcador é da conversa (fica até alguém tirar): filtra por quem tem ele agora
    condicoes.push('EXISTS (SELECT 1 FROM conversas_marcadores cm WHERE cm.conversa_id = t.conversa_id AND cm.marcador_id = ?)');
    parametros.push(f.marcador);
  }
  return { where: condicoes.join(' AND '), parametros };
}

const SELECT_BASE = `
  SELECT t.*, c.nome_contato, c.numero, c.numero_exibicao, a.nome AS atendente_nome, s.nome AS setor_nome
  FROM atendimentos t
  JOIN conversas c ON c.id = t.conversa_id
  LEFT JOIN atendentes a ON a.id = t.atendente_id
  LEFT JOIN setores s ON s.id = t.setor_id`;

function paraItem(t) {
  const tempos = temposDoAtendimento(t);
  return {
    id: t.id,
    conversaId: t.conversa_id,
    protocolo: t.protocolo || '',
    cliente: t.nome_contato || formatarTelefone(t.numero_exibicao || t.numero),
    telefone: formatarTelefone(t.numero_exibicao || t.numero),
    atendente: t.atendente_nome || '—',
    setor: t.setor_nome || '—',
    origem: t.origem === 'cliente' ? 'Cliente (pelo bot)' : 'Atendente (ativo)',
    abertoEm: formatarDataHoraCompleta(t.aberto_em),
    assumidoEm: formatarDataHoraCompleta(t.assumido_em),
    primeiraRespostaEm: formatarDataHoraCompleta(t.primeira_resposta_em),
    finalizadoEm: formatarDataHoraCompleta(t.finalizado_em),
    espera: formatarDuracao(tempos.espera),
    resposta: formatarDuracao(tempos.resposta),
    duracao: formatarDuracao(tempos.duracao),
    motivo: t.motivo_texto || '—',
    como: (FINALIZADO_COMO.find(([v]) => v === t.finalizado_como) || [null, '—'])[1],
    nota: t.nota,
  };
}

/** Uma página da Auditoria: itens, total e páginas. */
function listarAuditoria(filtros) {
  const { where, parametros } = montarCondicoes(filtros);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM atendimentos t JOIN conversas c ON c.id = t.conversa_id WHERE ${where}`).get(...parametros).n;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pagina = Math.min(filtros.pagina, paginas);
  const linhas = db
    .prepare(`${SELECT_BASE} WHERE ${where} ORDER BY t.finalizado_em DESC, t.id DESC LIMIT ? OFFSET ?`)
    .all(...parametros, POR_PAGINA, (pagina - 1) * POR_PAGINA);
  return { itens: linhas.map(paraItem), total, pagina, paginas };
}

// Planilha (CSV com ";" e BOM, que o Excel abre direto com acento certo)
function exportarAuditoriaCsv(filtros) {
  const { where, parametros } = montarCondicoes(filtros);
  const linhas = db.prepare(`${SELECT_BASE} WHERE ${where} ORDER BY t.finalizado_em DESC, t.id DESC LIMIT ?`).all(...parametros, LIMITE_EXPORTACAO);
  const celula = (v) => {
    let texto = v === null || v === undefined ? '' : String(v);
    // nome do cliente vem do WhatsApp: começando com = + - @ o Excel acharia que é fórmula
    if (/^[=+\-@]/.test(texto)) texto = `'${texto}`;
    return /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const cabecalho = ['Protocolo', 'Cliente', 'Telefone', 'Atendente', 'Setor', 'Origem', 'Aberto em', 'Assumido em', '1ª resposta em', 'Finalizado em', 'Espera na fila', '1ª resposta', 'Duração', 'Motivo', 'Finalizado', 'Nota'];
  // protocolo como ="...": sem isso o Excel mostra o número comprido como 2,02E+11
  const corpo = linhas.map(paraItem).map((i) =>
    [i.protocolo ? `="${i.protocolo}"` : '', ...[i.cliente, i.telefone, i.atendente, i.setor, i.origem, i.abertoEm, i.assumidoEm, i.primeiraRespostaEm, i.finalizadoEm, i.espera, i.resposta, i.duracao, i.motivo, i.como, i.nota ?? ''].map(celula)].join(';'),
  );
  return '\uFEFF' + [cabecalho.join(';'), ...corpo].join('\r\n') + '\r\n';
}

/** Opções dos filtros: motivos já usados (pelo texto gravado, que não muda se o motivo for renomeado). */
function motivosUsados() {
  return db.prepare('SELECT DISTINCT motivo_texto FROM atendimentos WHERE motivo_texto IS NOT NULL ORDER BY motivo_texto').all().map((r) => r.motivo_texto);
}

/**
 * Um atendimento com as mensagens dele (as mesmas faixas da Fila decidem o que é de qual
 * atendimento) e os outros atendimentos do mesmo cliente. null se não existe.
 */
function detalheDoAtendimento(id) {
  const linha = db.prepare(`${SELECT_BASE} WHERE t.id = ?`).get(id);
  if (!linha) return null;
  const lista = atendimentos.listarAtendimentosDaConversa(linha.conversa_id);
  const mensagens = atendimentos
    .marcarFaixasDeAtendimento(listarMensagens(linha.conversa_id), lista)
    .filter((m) => m.atendimentoId === linha.id)
    .map((m) => ({
      id: m.id,
      quando: formatarDataHoraCompleta(m.criado_em),
      quem: quemEscreveu(m),
      remetente: m.remetente,
      interna: !!m.interna,
      falha: !!m.falha,
      texto: m.texto,
      midiaTipo: m.midia_tipo,
      midiaUrl: m.midia_url,
      citada: m.citada_texto || null,
      reacaoCliente: m.reacao_cliente,
      reacaoAtendente: m.reacao_atendente,
    }));
  return {
    ...paraItem(linha),
    mensagens,
    outros: lista
      .filter((t) => t.id !== linha.id)
      .reverse()
      .map((t) => ({ id: t.id, protocolo: t.protocolo, abertoEm: formatarDataHoraCompleta(t.aberto_em), finalizado: !!t.finalizado_em, motivo: t.motivo_texto || '—' })),
  };
}

function quemEscreveu(m) {
  if (m.remetente === 'cliente') return 'Cliente';
  if (m.remetente === 'bot') return 'Bot';
  if (m.interna && !m.atendente_id) return 'Sistema';
  return m.atendente_nome || 'Atendente';
}

const ROTULO_MIDIA = { imagem: '[imagem]', video: '[vídeo]', audio: '[áudio]' };

/** A conversa do atendimento em texto puro (.txt), com o cabeçalho do atendimento. */
function conversaEmTexto(detalhe, nomeNegocio = '') {
  const linhas = [
    `${nomeNegocio ? `${nomeNegocio} · ` : ''}Atendimento ${detalhe.protocolo}`,
    `Cliente: ${detalhe.cliente} ${detalhe.telefone !== detalhe.cliente ? `(${detalhe.telefone})` : ''}`.trim(),
    `Atendente: ${detalhe.atendente} · Setor: ${detalhe.setor}`,
    `Aberto em ${detalhe.abertoEm} · Finalizado em ${detalhe.finalizadoEm} (${detalhe.como.toLowerCase()})`,
    `Motivo: ${detalhe.motivo} · Nota: ${detalhe.nota ?? '—'}`,
    '',
  ];
  for (const m of detalhe.mensagens) {
    const midia = m.midiaTipo ? `${ROTULO_MIDIA[m.midiaTipo] || '[arquivo]'} ` : '';
    const prefixo = m.interna ? `${m.quem} (nota interna)` : m.quem;
    const extras = [m.falha ? '(não enviada)' : '', m.reacaoCliente ? `(reação do cliente: ${m.reacaoCliente})` : ''].filter(Boolean).join(' ');
    // mensagem de várias linhas (ex.: menu do bot): continua recuada, sem linhas em branco soltas
    const texto = String(m.texto || '').trim().replace(/\s*\r?\n\s*/g, '\r\n    ');
    linhas.push(`[${m.quando}] ${prefixo}: ${midia}${texto}${extras ? ` ${extras}` : ''}`);
  }
  return linhas.join('\r\n') + '\r\n';
}

module.exports = {
  lerFiltros,
  listarAuditoria,
  exportarAuditoriaCsv,
  motivosUsados,
  detalheDoAtendimento,
  conversaEmTexto,
  FINALIZADO_COMO,
  FAIXAS_DE_NOTA,
  POR_PAGINA,
};

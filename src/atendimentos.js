const { db } = require('./db');

// Livro de atendimentos (tabela `atendimentos`, base do menu Relatório). Os pontos do sistema que
// mudam o estado de uma conversa (entrar na fila, assumir, responder, transferir, finalizar, nota
// da pesquisa) chamam as funções daqui. Só grava: quem lê é relatorio.js.

function agora() {
  return new Date().toISOString();
}

// AAAAMMDD (data local do servidor) + id com 4 dígitos — o id já garante que não repete
function gerarProtocolo(id, abertoEm) {
  const d = new Date(abertoEm);
  const data = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${data}${String(id).padStart(4, '0')}`;
}

function inserirAtendimento(sql, parametros, abertoEm) {
  const id = Number(db.prepare(sql).run(...parametros).lastInsertRowid);
  db.prepare('UPDATE atendimentos SET protocolo = ? WHERE id = ?').run(gerarProtocolo(id, abertoEm), id);
  return id;
}

function atendimentoAberto(conversaId) {
  return db
    .prepare('SELECT * FROM atendimentos WHERE conversa_id = ? AND finalizado_em IS NULL ORDER BY id DESC LIMIT 1')
    .get(conversaId);
}

/**
 * Cliente entrou na fila pelo bot. Se sobrou um atendimento aberto (não devia: a conversa estava
 * com o bot ou finalizada), ele é fechado antes, pra não emendar dois atendimentos num só.
 */
function abrirAtendimentoDoCliente(conversaId, setorId) {
  const sobra = atendimentoAberto(conversaId);
  if (sobra) fecharAtendimento(conversaId, 'outro');
  const momento = agora();
  inserirAtendimento("INSERT INTO atendimentos (conversa_id, origem, setor_id, aberto_em) VALUES (?, 'cliente', ?, ?)", [conversaId, setorId || null, momento], momento);
}

// Atendente mexeu numa conversa sem atendimento aberto (Nova conversa, Puxar, transferir ou
// responder uma finalizada): o atendimento começa por ele, sem espera de fila pra medir.
function garantirAtendimento(conversaId) {
  const aberto = atendimentoAberto(conversaId);
  if (aberto) return aberto;
  const momento = agora();
  const id = inserirAtendimento("INSERT INTO atendimentos (conversa_id, origem, aberto_em) VALUES (?, 'ativo', ?)", [conversaId, momento], momento);
  return db.prepare('SELECT * FROM atendimentos WHERE id = ?').get(id);
}

function registrarAssumido(conversaId, atendenteId) {
  const atendimento = garantirAtendimento(conversaId);
  db.prepare('UPDATE atendimentos SET atendente_id = ?, assumido_em = COALESCE(assumido_em, ?) WHERE id = ?').run(
    atendenteId,
    agora(),
    atendimento.id,
  );
}

// 1a mensagem de um atendente de verdade (a boas-vindas automática ao assumir não conta).
// Responder também conta como assumir, pra quem responde sem clicar em Assumir.
function registrarRespostaDoAtendente(conversaId, atendenteId) {
  const atendimento = garantirAtendimento(conversaId);
  const momento = agora();
  db.prepare(
    `UPDATE atendimentos SET atendente_id = COALESCE(atendente_id, ?), assumido_em = COALESCE(assumido_em, ?),
            primeira_resposta_em = COALESCE(primeira_resposta_em, ?) WHERE id = ?`,
  ).run(atendenteId || null, momento, momento, atendimento.id);
}

function registrarTransferencia(conversaId, { setorId, atendenteId }) {
  const atendimento = garantirAtendimento(conversaId);
  db.prepare('UPDATE atendimentos SET setor_id = ?, atendente_id = COALESCE(?, atendente_id) WHERE id = ?').run(
    setorId || null,
    atendenteId || null,
    atendimento.id,
  );
}

/**
 * `como`: 'atendente' (botão Finalizar), 'automatico' (fechamento automático) ou 'outro'.
 * `motivo`: { id, texto } escolhido no Finalizar (opcional).
 */
function fecharAtendimento(conversaId, como, motivo = null) {
  db.prepare(
    'UPDATE atendimentos SET finalizado_em = ?, finalizado_como = ?, motivo_id = ?, motivo_texto = ? WHERE conversa_id = ? AND finalizado_em IS NULL',
  ).run(agora(), como, motivo?.id || null, motivo?.texto || null, conversaId);
}

/** Atendimentos da conversa, do mais antigo ao mais novo (faixas no histórico da Fila). */
function listarAtendimentosDaConversa(conversaId) {
  return db
    .prepare(
      `SELECT t.*, a.nome AS atendente_nome, s.nome AS setor_nome FROM atendimentos t
       LEFT JOIN atendentes a ON a.id = t.atendente_id
       LEFT JOIN setores s ON s.id = t.setor_id
       WHERE t.conversa_id = ? ORDER BY t.aberto_em ASC, t.id ASC`,
    )
    .all(conversaId);
}

// O cliente responde a pesquisa do jeito que quiser ("10", "nota 9", "dez!") — pega o 1o número de
// 0 a 10; sem número, a resposta fica só no registro de avaliações, sem nota no relatório.
const NUMEROS_POR_EXTENSO = { zero: 0, um: 1, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
function lerNota(texto) {
  const limpo = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const numero = /(?:^|\D)(10|\d)(?!\d)/.exec(limpo);
  if (numero) return Number(numero[1]);
  const palavra = /\b(zero|um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/.exec(limpo);
  return palavra ? NUMEROS_POR_EXTENSO[palavra[1]] : null;
}

// A nota é da pesquisa mandada ao finalizar: vai pro último atendimento finalizado dessa conversa
// (o motor de fluxo já só aceita a nota dentro do prazo).
function registrarNota(numero, texto) {
  const nota = lerNota(texto);
  if (nota === null) return;
  const conversa = db.prepare('SELECT id FROM conversas WHERE numero = ?').get(numero);
  if (!conversa) return;
  db.prepare(
    `UPDATE atendimentos SET nota = ? WHERE id = (
       SELECT id FROM atendimentos WHERE conversa_id = ? AND finalizado_em IS NOT NULL ORDER BY finalizado_em DESC LIMIT 1
     )`,
  ).run(nota, conversa.id);
}

/**
 * No boot, enquanto o livro está vazio (1o boot com o Relatório): monta os atendimentos de antes dela a partir
 * das mensagens salvas (marcados com reconstruido = 1). Um atendimento termina na mensagem de
 * encerramento/pesquisa/fechamento automático, ou quando passa do prazo do fechamento automático.
 * Só entra quem teve resposta de atendente (ou está em andamento agora): sem isso, conversas só com
 * o bot virariam atendimento. "Assumido" de antes não foi guardado: usa a 1a resposta.
 */
function reconstruirAtendimentosAntigos({ textosFinalizacao = [], textosFechamentoAutomatico = [], horasLimite = 24 } = {}) {
  const finalizacao = new Set(textosFinalizacao.filter(Boolean).map((t) => t.trim()));
  const automatico = new Set(textosFechamentoAutomatico.filter(Boolean).map((t) => t.trim()));
  const ehPesquisa = (texto) => /^de 0 a 10\b/i.test(texto.trim());
  const pareceNota = (texto) => texto.trim().length <= 20 && lerNota(texto) !== null;
  const limiteMs = (Number(horasLimite) || 24) * 3600000;

  const inserir = db.prepare(
    `INSERT INTO atendimentos (conversa_id, origem, setor_id, atendente_id, aberto_em, assumido_em, primeira_resposta_em,
                               finalizado_em, finalizado_como, reconstruido)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  let total = 0;

  for (const conversa of db.prepare('SELECT * FROM conversas').all()) {
    const mensagens = db.prepare('SELECT * FROM mensagens WHERE conversa_id = ? AND interna = 0 ORDER BY id').all(conversa.id);
    const sessoes = [];
    let atual = null;
    let fechadaEm = null; // pra não abrir atendimento novo com a nota da pesquisa

    const fechar = (momento, como) => {
      atual.finalizado_em = momento;
      atual.finalizado_como = como;
      sessoes.push(atual);
      fechadaEm = momento;
      atual = null;
    };

    for (const m of mensagens) {
      const t = Date.parse(m.criado_em);
      if (atual && t - Date.parse(atual.aberto_em) > limiteMs) fechar(atual.ultima_em, 'automatico');

      if (m.remetente === 'bot') {
        if (!atual) continue;
        atual.ultima_em = m.criado_em;
        if (automatico.has(m.texto.trim())) fechar(m.criado_em, 'automatico');
        else if (finalizacao.has(m.texto.trim()) || ehPesquisa(m.texto)) fechar(m.criado_em, 'atendente');
        continue;
      }

      if (!atual) {
        const respondendoPesquisa = m.remetente === 'cliente' && fechadaEm && t - Date.parse(fechadaEm) <= 30 * 60000 && pareceNota(m.texto);
        if (respondendoPesquisa) continue;
        atual = {
          origem: m.remetente === 'cliente' ? 'cliente' : 'ativo',
          aberto_em: m.criado_em,
          atendente_id: null,
          primeira_resposta_em: null,
        };
      }
      atual.ultima_em = m.criado_em;
      if (m.remetente === 'atendente') {
        atual.primeira_resposta_em = atual.primeira_resposta_em || m.criado_em;
        if (m.atendente_id) atual.atendente_id = m.atendente_id;
      }
    }

    const emAndamento = conversa.status === 'aguardando' || conversa.status === 'atendendo';
    if (atual) {
      if (emAndamento) sessoes.push({ ...atual, finalizado_em: null, finalizado_como: null, aoVivo: true });
      else fechar(atual.ultima_em, 'outro');
    }

    for (const s of sessoes) {
      if (!s.primeira_resposta_em && !s.aoVivo) continue;
      inserir.run(
        conversa.id,
        s.origem,
        conversa.setor_id || null,
        s.atendente_id || (s.aoVivo ? conversa.atendente_id : null) || null,
        s.aberto_em,
        s.primeira_resposta_em,
        s.primeira_resposta_em,
        s.finalizado_em,
        s.finalizado_como,
      );
      total += 1;
    }
  }

  // notas da pesquisa já guardadas (registros 'avaliacoes', só têm o número): vão pro atendimento
  // daquela conversa finalizado até 2h antes da resposta
  const avaliacoes = db.prepare("SELECT dados, criado_em FROM registros WHERE colecao = 'avaliacoes' ORDER BY id").all();
  for (const a of avaliacoes) {
    let dados;
    try {
      dados = JSON.parse(a.dados);
    } catch (erro) {
      continue;
    }
    const nota = lerNota(dados.nota);
    const conversa = dados.numero && db.prepare('SELECT id FROM conversas WHERE numero = ?').get(dados.numero);
    if (nota === null || !conversa) continue;
    const desde = new Date(Date.parse(a.criado_em) - 2 * 3600000).toISOString();
    db.prepare(
      `UPDATE atendimentos SET nota = ? WHERE id = (
         SELECT id FROM atendimentos WHERE conversa_id = ? AND finalizado_em BETWEEN ? AND ? ORDER BY finalizado_em DESC LIMIT 1
       )`,
    ).run(nota, conversa.id, desde, a.criado_em);
  }

  db.prepare(
    "UPDATE atendimentos SET protocolo = strftime('%Y%m%d', aberto_em, 'localtime') || printf('%04d', id) WHERE protocolo IS NULL",
  ).run();
  return total;
}

function livroDeAtendimentosVazio() {
  return !db.prepare('SELECT 1 FROM atendimentos LIMIT 1').get();
}

module.exports = {
  livroDeAtendimentosVazio,
  atendimentoAberto,
  listarAtendimentosDaConversa,
  gerarProtocolo,
  abrirAtendimentoDoCliente,
  registrarAssumido,
  registrarRespostaDoAtendente,
  registrarTransferencia,
  fecharAtendimento,
  registrarNota,
  lerNota,
  reconstruirAtendimentosAntigos,
};

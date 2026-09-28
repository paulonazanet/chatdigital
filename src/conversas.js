const { db } = require('./db');
const { obterEstadoConversa } = require('./flow-engine');
const { barramento } = require('./eventos');
const { haAtendenteDisponivel } = require('./atendentes');

function obterOuCriarConversa(numero) {
  const existente = db.prepare('SELECT * FROM conversas WHERE numero = ?').get(numero);
  if (existente) return existente;

  const agora = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO conversas (numero, status, criado_em, atualizado_em) VALUES (?, ?, ?, ?)')
    .run(numero, 'bot', agora, agora);
  return db.prepare('SELECT * FROM conversas WHERE id = ?').get(Number(info.lastInsertRowid));
}

/**
 * Guarda o número de telefone legível pra mostrar na fila, sem mexer no `numero` usado de fato
 * pra mandar mensagem (importante pra conversas em @lid, onde o "numero" que funciona pra enviar
 * não é um número de telefone visível). Chamar toda vez que o Baileys mandar essa informação
 * junto de uma mensagem — não custa nada gravar de novo se já for a mesma.
 */
function definirNumeroExibicao(numero, numeroExibicao) {
  if (!numeroExibicao) return;
  db.prepare(
    'UPDATE conversas SET numero_exibicao = ? WHERE numero = ? AND (numero_exibicao IS NULL OR numero_exibicao != ?)',
  ).run(numeroExibicao, numero, numeroExibicao);
}

function registrarMensagem(numero, remetente, texto, midia = null) {
  const conversa = obterOuCriarConversa(numero);
  const agora = new Date().toISOString();
  db.prepare(
    'INSERT INTO mensagens (conversa_id, remetente, texto, criado_em, midia_tipo, midia_url) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(conversa.id, remetente, texto, agora, midia?.tipo || null, midia?.url || null);
  db.prepare('UPDATE conversas SET atualizado_em = ? WHERE id = ?').run(agora, conversa.id);
  // Cliente voltou a escrever — se tinha lembrete de inatividade pendente, não faz mais sentido.
  if (remetente === 'cliente') {
    db.prepare('UPDATE conversas SET lembrete_inatividade_em = NULL WHERE id = ?').run(conversa.id);
  }

  // Cliente escreveu de novo numa conversa que já está com um humano (não é a mensagem que
  // dispara a transferência em si — essa é avisada por sincronizarConversa logo abaixo).
  if (remetente === 'cliente' && conversa.status !== 'bot' && conversa.status !== 'finalizado') {
    barramento.emit('atencao', { motivo: 'mensagem', numero, texto });
  }
}

/**
 * Sincroniza a tabela `conversas` com o estado em memória do motor de fluxo (obterEstadoConversa),
 * depois de processarMensagem. Chame sempre que uma conversa puder ter mudado de "bot" para
 * "aguardando atendente" (ou vice-versa, ao digitar "menu" de novo).
 */
function sincronizarConversa(numero, fluxo) {
  const estado = obterEstadoConversa(numero, fluxo);
  const conversa = obterOuCriarConversa(numero);

  let setorId = null;
  if (estado.setor) {
    const setor = db.prepare('SELECT id FROM setores WHERE nome = ? COLLATE NOCASE').get(estado.setor);
    setorId = setor ? setor.id : null;
  }

  let status = 'bot';
  if (estado.humano) {
    status = conversa.status === 'atendendo' || conversa.status === 'finalizado' ? conversa.status : 'aguardando';
  }

  db.prepare('UPDATE conversas SET status = ?, setor_id = ?, no_fluxo_atual = ?, atualizado_em = ? WHERE id = ?').run(
    status,
    setorId,
    estado.no,
    new Date().toISOString(),
    conversa.id,
  );

  const acabouDeEntrarNaFila = status === 'aguardando' && conversa.status !== 'aguardando' && conversa.status !== 'atendendo';
  if (acabouDeEntrarNaFila) {
    barramento.emit('atencao', { motivo: 'novo-atendimento', numero });
  }

  return { semAtendenteDisponivel: acabouDeEntrarNaFila && !haAtendenteDisponivel(setorId) };
}

function listarFila() {
  return db
    .prepare(
      `SELECT c.*, s.nome AS setor_nome, a.nome AS atendente_nome,
              (SELECT texto FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem,
              (SELECT remetente FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem_remetente
       FROM conversas c
       LEFT JOIN setores s ON s.id = c.setor_id
       LEFT JOIN atendentes a ON a.id = c.atendente_id
       WHERE c.status IN ('aguardando', 'atendendo')
       ORDER BY c.atualizado_em DESC`,
    )
    .all();
}

/**
 * Conversas ainda com o bot (não transferidas) que já têm pelo menos uma mensagem — candidatas a
 * estar "paradas no fluxo" (o filtro por nó atual do fluxo é feito na rota, que tem acesso ao
 * flow-engine). Ordenado da mais parada (atualizada há mais tempo) pra mais recente.
 */
function listarConversasComBot() {
  return db
    .prepare(
      `SELECT c.*, (SELECT texto FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem
       FROM conversas c WHERE c.status = 'bot' ORDER BY c.atualizado_em ASC`,
    )
    .all();
}

function transferirConversa(id, { setorId, atendenteId }) {
  // com atendente específico, já entra "atendendo" (foi endereçada); só o setor, volta pra fila
  // desse setor esperando alguém assumir.
  const status = atendenteId ? 'atendendo' : 'aguardando';
  db.prepare('UPDATE conversas SET setor_id = ?, atendente_id = ?, status = ?, atualizado_em = ? WHERE id = ?').run(
    setorId,
    atendenteId || null,
    status,
    new Date().toISOString(),
    id,
  );
}

function obterConversaPorId(id) {
  return db
    .prepare(
      `SELECT c.*, s.nome AS setor_nome, a.nome AS atendente_nome
       FROM conversas c
       LEFT JOIN setores s ON s.id = c.setor_id
       LEFT JOIN atendentes a ON a.id = c.atendente_id
       WHERE c.id = ?`,
    )
    .get(id);
}

function listarMensagens(conversaId) {
  return db.prepare('SELECT * FROM mensagens WHERE conversa_id = ? ORDER BY id ASC').all(conversaId);
}

function assumirConversa(id, atendenteId) {
  db.prepare("UPDATE conversas SET atendente_id = ?, status = 'atendendo', atualizado_em = ? WHERE id = ?").run(
    atendenteId,
    new Date().toISOString(),
    id,
  );
}

function finalizarConversa(id) {
  db.prepare("UPDATE conversas SET status = 'finalizado', atualizado_em = ? WHERE id = ?").run(
    new Date().toISOString(),
    id,
  );
}

module.exports = {
  obterOuCriarConversa,
  registrarMensagem,
  definirNumeroExibicao,
  sincronizarConversa,
  listarFila,
  listarConversasComBot,
  obterConversaPorId,
  listarMensagens,
  assumirConversa,
  finalizarConversa,
  transferirConversa,
};

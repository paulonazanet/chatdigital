const { db } = require('./db');
const { obterEstadoConversa, transferirParaHumano } = require('./flow-engine');
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

/** Nome do perfil do WhatsApp (pushName) — só grava se nenhum atendente corrigiu o nome na mão. */
function definirNomeDoPerfil(numero, nome) {
  const limpo = String(nome || '').trim();
  if (!limpo) return;
  db.prepare(
    'UPDATE conversas SET nome_contato = ? WHERE numero = ? AND nome_editado = 0 AND (nome_contato IS NULL OR nome_contato != ?)',
  ).run(limpo, numero, limpo);
}

/**
 * Nome corrigido pelo atendente (lápis no topo da conversa) — pode trocar quantas vezes quiser.
 * Vazio apaga a correção e volta a valer o nome do perfil do WhatsApp na próxima mensagem.
 */
function renomearContato(id, nome) {
  const limpo = String(nome || '').trim().slice(0, 80);
  db.prepare('UPDATE conversas SET nome_contato = ?, nome_editado = ? WHERE id = ?').run(limpo || null, limpo ? 1 : 0, id);
}

function registrarMensagem(numero, remetente, texto, midia = null, atendenteId = null) {
  const conversa = obterOuCriarConversa(numero);
  const agora = new Date().toISOString();
  db.prepare(
    'INSERT INTO mensagens (conversa_id, remetente, texto, criado_em, midia_tipo, midia_url, atendente_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(conversa.id, remetente, texto, agora, midia?.tipo || null, midia?.url || null, atendenteId);
  db.prepare('UPDATE conversas SET atualizado_em = ? WHERE id = ?').run(agora, conversa.id);
  // mensagem de gente (cliente ou atendente) abre um atendimento, se não tinha um aberto;
  // mensagem do bot não — senão o "atendimento encerrado" mandado ao finalizar reabriria
  if (remetente !== 'bot') {
    db.prepare('UPDATE conversas SET aberta_em = COALESCE(aberta_em, ?) WHERE id = ?').run(agora, conversa.id);
  }
  // Cliente voltou a escrever — se tinha lembrete de inatividade pendente, não faz mais sentido.
  if (remetente === 'cliente') {
    db.prepare('UPDATE conversas SET lembrete_inatividade_em = NULL WHERE id = ?').run(conversa.id);
  }

  // Cliente escreveu de novo numa conversa que já está com um humano (não é a mensagem que
  // dispara a transferência em si — essa é avisada por sincronizarConversa logo abaixo).
  if (remetente === 'cliente' && conversa.status !== 'bot' && conversa.status !== 'finalizado') {
    barramento.emit('atencao', { motivo: 'mensagem', numero, texto, setorId: conversa.setor_id, numeroExibicao: conversa.numero_exibicao });
  }
}

/**
 * Sincroniza a tabela `conversas` com o estado em memória do motor de fluxo (obterEstadoConversa),
 * depois de processarMensagem. Chame sempre que uma conversa puder ter mudado de "bot" para
 * "aguardando atendente" (ou vice-versa, ao digitar "menu" de novo).
 * `vinhaDoBot`: antes desta mensagem o motor ainda não tinha passado a conversa pra um humano — se
 * agora passou, é uma transferência nova e a conversa volta pra fila mesmo que estivesse finalizada
 * (senão, num fluxo que transfere logo depois da boas-vindas, o cliente que volta depois de uma
 * finalização fica mudo e invisível na fila).
 */
function sincronizarConversa(numero, fluxo, { vinhaDoBot = false } = {}) {
  const estado = obterEstadoConversa(numero, fluxo);
  const conversa = obterOuCriarConversa(numero);

  let setorId = null;
  if (estado.setor) {
    const setor = db.prepare('SELECT id FROM setores WHERE nome = ? COLLATE NOCASE').get(estado.setor);
    setorId = setor ? setor.id : null;
  }

  let status = 'bot';
  if (estado.humano) {
    const mantem = conversa.status === 'atendendo' || (conversa.status === 'finalizado' && !vinhaDoBot);
    status = mantem ? conversa.status : 'aguardando';
  }

  // de volta ao início do fluxo sem ninguém atendendo = atendimento encerrado (ex.: o fluxo chegou
  // num nó "fim", ou era a nota da pesquisa) — o próximo "oi" abre um novo
  const ocioso = status === 'bot' && estado.no === fluxo.inicio && !estado.aguardando;
  db.prepare(
    'UPDATE conversas SET status = ?, setor_id = ?, no_fluxo_atual = ?, atualizado_em = ?, aberta_em = CASE WHEN ? THEN NULL ELSE aberta_em END WHERE id = ?',
  ).run(status, setorId, estado.no, new Date().toISOString(), ocioso ? 1 : 0, conversa.id);

  const acabouDeEntrarNaFila = status === 'aguardando' && conversa.status !== 'aguardando' && conversa.status !== 'atendendo';
  if (acabouDeEntrarNaFila) {
    barramento.emit('atencao', { motivo: 'novo-atendimento', numero, setorId, numeroExibicao: conversa.numero_exibicao });
  }

  return { semAtendenteDisponivel: acabouDeEntrarNaFila && !haAtendenteDisponivel(setorId) };
}

function listarFila() {
  return db
    .prepare(
      `SELECT c.*, s.nome AS setor_nome, a.nome AS atendente_nome,
              (SELECT texto FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem,
              (SELECT remetente FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem_remetente,
              (SELECT criado_em FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem_em,
              -- desde quando o cliente espera: a 1a mensagem dele depois da última resposta de um
              -- atendente (é isso que a cor da bolinha na fila mede)
              (SELECT MIN(m.criado_em) FROM mensagens m WHERE m.conversa_id = c.id AND m.remetente = 'cliente'
                 AND m.id > COALESCE((SELECT MAX(a2.id) FROM mensagens a2 WHERE a2.conversa_id = c.id AND a2.remetente = 'atendente'), 0)
              ) AS esperando_desde
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
      `SELECT c.*, (SELECT texto FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem,
              (SELECT criado_em FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem_em
       FROM conversas c WHERE c.status = 'bot' ORDER BY c.atualizado_em ASC`,
    )
    .all();
}

/**
 * Reconstrói, no boot, o estado "com atendente" do motor de fluxo a partir do banco. Esse estado
 * vive só na memória (flow-engine.js), então sem isso todo reinício do servidor "esquecia" quem
 * estava com humano — a próxima mensagem do cliente caía no menu do bot e sincronizarConversa
 * ainda rebaixava a conversa pra status 'bot', tirando ela da fila. Chamar antes de começar a
 * escutar mensagens do WhatsApp. Devolve quantas conversas foram restauradas.
 */
function restaurarAtendimentosEmAndamento(fluxo) {
  const conversasComHumano = db
    .prepare(
      `SELECT c.numero, s.nome AS setor_nome FROM conversas c
       LEFT JOIN setores s ON s.id = c.setor_id
       WHERE c.status IN ('aguardando', 'atendendo')`,
    )
    .all();
  // passa o nome do setor junto — sem ele, sincronizarConversa gravaria setor_id = NULL na
  // próxima mensagem do cliente e a conversa sumiria da fila do setor dela.
  for (const conversa of conversasComHumano) transferirParaHumano(conversa.numero, fluxo, conversa.setor_nome || null);
  return conversasComHumano.length;
}

// Busca por número (qualquer pedaço dos dígitos, com ou sem 55/DDD) ou nome do cliente, sem
// diferenciar maiúscula nem acento — mesma regra de public/js/fila-lista.js pra busca instantânea.
function normalizarBusca(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
// O WhatsApp às vezes guarda o celular sem o nono dígito (558196850663 em vez de 5581996850663),
// então quem busca "99685" também tem que achar — tenta com e sem esse 9.
function variantesDoNumeroBuscado(digitos) {
  const variantes = [digitos];
  const comDdd = /^(55)?(\d{2})9(\d{8})$/.exec(digitos);
  if (comDdd) variantes.push(`${comDdd[1] || ''}${comDdd[2]}${comDdd[3]}`);
  else if (digitos.length >= 5 && digitos[0] === '9') variantes.push(digitos.slice(1));
  return variantes;
}
function conversaCasaComBusca(c, busca) {
  const termo = normalizarBusca(busca);
  if (!termo) return true;
  const soNumero = /^[\d\s()+-]+$/.test(termo);
  if (soNumero) {
    const numeros = `${c.numero} ${c.numero_exibicao || ''}`.replace(/\D/g, '');
    return variantesDoNumeroBuscado(termo.replace(/\D/g, '')).some((v) => numeros.includes(v));
  }
  return normalizarBusca(c.nome_contato).includes(termo);
}

/**
 * Conversas finalizadas, mais recentes primeiro. Sem busca, só as últimas `limite` (a lista
 * cresce pra sempre); com busca, procura em todas — pra achar o cliente que volta meses depois.
 */
function listarFinalizadas({ busca = '', limite = 50 } = {}) {
  const todas = db
    .prepare(
      `SELECT c.*, s.nome AS setor_nome, a.nome AS atendente_nome,
              (SELECT texto FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem,
              (SELECT remetente FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem_remetente,
              (SELECT criado_em FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem_em
       FROM conversas c
       LEFT JOIN setores s ON s.id = c.setor_id
       LEFT JOIN atendentes a ON a.id = c.atendente_id
       WHERE c.status = 'finalizado'
       ORDER BY c.atualizado_em DESC`,
    )
    .all();
  return busca ? todas.filter((c) => conversaCasaComBusca(c, busca)) : todas.slice(0, limite);
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
  return db
    .prepare(
      `SELECT m.*, a.nome AS atendente_nome FROM mensagens m
       LEFT JOIN atendentes a ON a.id = m.atendente_id
       WHERE m.conversa_id = ? ORDER BY m.id ASC`,
    )
    .all(conversaId);
}

function assumirConversa(id, atendenteId) {
  const agora = new Date().toISOString();
  db.prepare("UPDATE conversas SET atendente_id = ?, status = 'atendendo', atualizado_em = ?, aberta_em = COALESCE(aberta_em, ?) WHERE id = ?").run(
    atendenteId,
    agora,
    agora,
    id,
  );
}

function finalizarConversa(id) {
  db.prepare("UPDATE conversas SET status = 'finalizado', atualizado_em = ?, aberta_em = NULL, lembrete_inatividade_em = NULL WHERE id = ?").run(
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
  restaurarAtendimentosEmAndamento,
  definirNomeDoPerfil,
  renomearContato,
  listarFinalizadas,
  conversaCasaComBusca,
};

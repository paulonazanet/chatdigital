const { db } = require('./db');
const envios = require('./envios');
const { carregarNegocio } = require('./negocio');
const { substituirVariaveis } = require('./flow-engine');
const { obterSocket } = require('./socket-atual');
const { podeEnviarAutomatico } = require('./modo-teste');
const { PREFIXO_ANONIMO } = require('./retencao');

// Campanhas (E3, 2a parte): uma mensagem para um público (por tag), mandada devagar pela fila de
// envios (envios.js). Rascunho → enviando (pode pausar e retomar) → concluída, ou cancelada. O texto
// sempre termina com o "responda SAIR". Frase-chave: quem responde com ela vai para um atendente ou
// para um bloco do fluxo (resposta-envio.js).

const AVISO_SAIR = '(Para não receber mais mensagens como esta, responda SAIR.)';
const normalizar = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function lerPublico(campanha) {
  try {
    const p = JSON.parse(campanha?.publico || '{}');
    return {
      tags: Array.isArray(p.tags) ? p.tags.map(Number).filter(Boolean) : [],
      modoTags: p.modoTags === 'todas' ? 'todas' : 'qualquer',
      soConsentiu: p.soConsentiu !== false,
      excluirDias: Number.isInteger(p.excluirDias) && p.excluirDias >= 0 ? p.excluirDias : 7,
    };
  } catch (erro) {
    return { tags: [], modoTags: 'qualquer', soConsentiu: true, excluirDias: 7 };
  }
}

/**
 * Quem recebe: contatos normais (não ignorado, não bloqueado, não apagado), que não pediram para
 * sair, com as tags escolhidas (nenhuma tag = todos), só quem aceitou receber (se marcado), e que não
 * receberam campanha nos últimos N dias. Devolve { lista, semConsentimento } — o 2º é quantos ficaram
 * de fora só por não terem aceitado (pra mostrar).
 */
function montarPublico(publico, { agoraMs = Date.now() } = {}) {
  const candidatos = db
    .prepare(`SELECT * FROM conversas WHERE numero NOT LIKE '${PREFIXO_ANONIMO}%' AND situacao_contato = 'normal' ORDER BY id`)
    .all()
    .filter((c) => !envios.saiuDasMensagens(c));
  let lista = candidatos;
  if (publico.tags.length) {
    const tagsPorConversa = new Map();
    for (const l of db.prepare(`SELECT conversa_id, tag_id FROM conversas_tags WHERE tag_id IN (${publico.tags.map(() => '?').join(',')})`).all(...publico.tags)) {
      if (!tagsPorConversa.has(l.conversa_id)) tagsPorConversa.set(l.conversa_id, new Set());
      tagsPorConversa.get(l.conversa_id).add(l.tag_id);
    }
    lista = lista.filter((c) => {
      const tags = tagsPorConversa.get(c.id);
      if (!tags) return false;
      return publico.modoTags === 'todas' ? publico.tags.every((t) => tags.has(t)) : true;
    });
  }
  if (publico.excluirDias > 0) {
    const desde = new Date(agoraMs - publico.excluirDias * 86400000).toISOString();
    const recentes = new Set(db.prepare("SELECT DISTINCT conversa_id FROM envios WHERE tipo = 'campanha' AND status = 'enviado' AND enviado_em >= ?").all(desde).map((r) => r.conversa_id));
    lista = lista.filter((c) => !recentes.has(c.id));
  }
  const semConsentimento = publico.soConsentiu ? lista.filter((c) => !c.consentimento).length : 0;
  if (publico.soConsentiu) lista = lista.filter((c) => c.consentimento);
  return { lista, semConsentimento };
}

function textoComSair(texto) {
  const limpo = String(texto || '').trim();
  return /\bSAIR\b/.test(limpo) ? limpo : `${limpo}\n\n${AVISO_SAIR}`;
}

function textoParaCliente(campanha, conversa, negocio = carregarNegocio()) {
  const texto = substituirVariaveis(textoComSair(campanha.texto), { negocio, cliente: { nome: conversa.nome_contato || '' } });
  return texto.replace(/,\s*([!?.])/g, '$1').replace(/[ \t]+([!?.,])/g, '$1');
}

/** Confere os campos. Devolve { campos } ou { erro } */
function validar(corpo, { blocosDoFluxo = [], setores = [] } = {}) {
  const nome = String(corpo.nome || '').trim().slice(0, 80);
  const texto = String(corpo.texto || '').trim();
  if (!nome) return { erro: 'Dê um nome para a campanha (só a equipe vê).' };
  if (!texto) return { erro: 'Escreva a mensagem da campanha.' };
  if (texto.length > 1000) return { erro: 'A mensagem pode ter até 1000 letras.' };
  const frase = String(corpo.frase_chave || '').trim().slice(0, 30);
  if (frase && normalizar(frase).split(' ').length > 3) return { erro: 'A frase-chave tem que ser curta (até 3 palavras), ex.: PROMO.' };
  if (frase && ['sair', 'parar', 'stop', 'cancelar', 'menu', 'oi'].includes(normalizar(frase))) return { erro: 'Essa frase-chave não pode: ela já tem outro uso. Escolha outra, ex.: PROMO.' };
  const acao = corpo.acao_frase === 'bloco' ? 'bloco' : 'atendente';
  if (frase && acao === 'bloco' && !blocosDoFluxo.includes(corpo.bloco_frase)) return { erro: 'Escolha o bloco do fluxo para onde vai quem responder a frase-chave.' };
  const excluirDias = Number(corpo.excluir_dias);
  const publico = {
    tags: [].concat(corpo.tags || []).map(Number).filter(Boolean),
    modoTags: corpo.modo_tags === 'todas' ? 'todas' : 'qualquer',
    soConsentiu: corpo.so_consentiu === '1',
    excluirDias: Number.isInteger(excluirDias) && excluirDias >= 0 && excluirDias <= 365 ? excluirDias : 7,
  };
  return {
    campos: {
      nome,
      texto,
      publico: JSON.stringify(publico),
      frase_chave: frase || null,
      acao_frase: frase ? acao : null,
      setor_frase: frase && acao === 'atendente' ? (setores.includes(corpo.setor_frase) ? corpo.setor_frase : 'Geral') : null,
      bloco_frase: frase && acao === 'bloco' ? corpo.bloco_frase : null,
    },
  };
}

function criarCampanha(campos, criadoPor) {
  return Number(
    db
      .prepare('INSERT INTO campanhas (nome, texto, publico, frase_chave, acao_frase, setor_frase, bloco_frase, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(campos.nome, campos.texto, campos.publico, campos.frase_chave, campos.acao_frase, campos.setor_frase, campos.bloco_frase, criadoPor || null, new Date().toISOString()).lastInsertRowid,
  );
}

function atualizarCampanha(id, campos) {
  return db
    .prepare("UPDATE campanhas SET nome = ?, texto = ?, publico = ?, frase_chave = ?, acao_frase = ?, setor_frase = ?, bloco_frase = ? WHERE id = ? AND status = 'rascunho'")
    .run(campos.nome, campos.texto, campos.publico, campos.frase_chave, campos.acao_frase, campos.setor_frase, campos.bloco_frase, id).changes > 0;
}

function obterCampanha(id) {
  return db.prepare('SELECT k.*, a.nome AS criador FROM campanhas k LEFT JOIN atendentes a ON a.id = k.criado_por WHERE k.id = ?').get(id) || null;
}

function listarCampanhas() {
  return db.prepare('SELECT k.*, a.nome AS criador FROM campanhas k LEFT JOIN atendentes a ON a.id = k.criado_por ORDER BY k.id DESC').all().map((k) => ({ ...k, numeros: numerosDaCampanha(k.id) }));
}

function numerosDaCampanha(id) {
  return envios.resumoDeEnvios("tipo = 'campanha' AND referencia_id = ?", [id]);
}

/** Começa: põe cada cliente do público na fila (a partir de `comecarEm`). Devolve { total } ou { erro } */
function iniciarCampanha(id, { comecarEm = new Date(), negocio = carregarNegocio() } = {}) {
  const campanha = obterCampanha(id);
  if (!campanha || campanha.status !== 'rascunho') return { erro: 'Essa campanha já começou.' };
  const { lista } = montarPublico(lerPublico(campanha));
  if (!lista.length) return { erro: 'Ninguém para receber com esse público. Mude as tags ou as opções.' };
  for (const conversa of lista) {
    envios.enfileirar({ tipo: 'campanha', referenciaId: id, conversaId: conversa.id, texto: textoParaCliente(campanha, conversa, negocio), agendadoPara: comecarEm });
  }
  db.prepare("UPDATE campanhas SET status = 'enviando', iniciada_em = ?, comecar_em = ? WHERE id = ?").run(new Date().toISOString(), new Date(comecarEm).toISOString(), id);
  return { total: lista.length };
}

function pausarCampanha(id) {
  return db.prepare("UPDATE campanhas SET status = 'pausada' WHERE id = ? AND status = 'enviando'").run(id).changes > 0;
}
function retomarCampanha(id) {
  return db.prepare("UPDATE campanhas SET status = 'enviando' WHERE id = ? AND status = 'pausada'").run(id).changes > 0;
}
function cancelarCampanha(id) {
  const ok = db.prepare("UPDATE campanhas SET status = 'cancelada', concluida_em = ? WHERE id = ? AND status IN ('enviando', 'pausada', 'rascunho')").run(new Date().toISOString(), id).changes > 0;
  if (ok) db.prepare("UPDATE envios SET status = 'cancelado', motivo = 'Campanha cancelada' WHERE tipo = 'campanha' AND referencia_id = ? AND status = 'pendente'").run(id);
  return ok;
}
function excluirRascunho(id) {
  return db.prepare("DELETE FROM campanhas WHERE id = ? AND status = 'rascunho'").run(id).changes > 0;
}
function duplicarCampanha(id, criadoPor) {
  const k = obterCampanha(id);
  if (!k) return null;
  return criarCampanha({ ...k, nome: `${k.nome} (cópia)`.slice(0, 80) }, criadoPor);
}

/** Manda a mensagem da campanha agora para um contato (teste), fora da fila. { ok } ou { erro } */
async function enviarTeste(id, conversaId) {
  const campanha = obterCampanha(id);
  const conversa = db.prepare('SELECT * FROM conversas WHERE id = ?').get(conversaId);
  if (!campanha || !conversa) return { erro: 'Escolha um contato para o teste.' };
  const sock = obterSocket();
  if (!sock) return { erro: 'O WhatsApp está desconectado.' };
  if (!podeEnviarAutomatico(conversa.numero)) return { erro: 'Modo de teste: esse número não está na lista de números de teste.' };
  const texto = textoParaCliente(campanha, conversa);
  try {
    const resposta = await sock.sendMessage(conversa.numero, { text: texto });
    const { registrarMensagem } = require('./conversas');
    registrarMensagem(conversa.numero, 'bot', texto, null, null, { waId: resposta?.key?.id, deMim: true });
    db.prepare("INSERT INTO envios (tipo, referencia_id, conversa_id, texto, status, agendado_para, criado_em, enviado_em, wa_id) VALUES ('teste', ?, ?, ?, 'enviado', ?, ?, ?, ?)").run(
      id, conversa.id, texto, new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), resposta?.key?.id || null,
    );
    return { ok: true };
  } catch (erro) {
    return { erro: 'O WhatsApp não mandou agora. Tente de novo.' };
  }
}

/** A resposta do cliente é a frase-chave da campanha? (sem acento, maiúscula ou pontuação) */
function fraseConfere(campanha, texto) {
  return !!campanha.frase_chave && normalizar(texto) === normalizar(campanha.frase_chave);
}

module.exports = {
  lerPublico,
  montarPublico,
  textoComSair,
  textoParaCliente,
  validar,
  criarCampanha,
  atualizarCampanha,
  obterCampanha,
  listarCampanhas,
  numerosDaCampanha,
  iniciarCampanha,
  pausarCampanha,
  retomarCampanha,
  cancelarCampanha,
  excluirRascunho,
  duplicarCampanha,
  enviarTeste,
  fraseConfere,
  AVISO_SAIR,
};

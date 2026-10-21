const { db } = require('./db');
const { carregarNegocio } = require('./negocio');
const { obterSocket } = require('./socket-atual');
const { dentroDasJanelas } = require('./horario');
const { feriadoAgora } = require('./feriados');
const { podeEnviarAutomatico } = require('./modo-teste');
const { PREFIXO_ANONIMO } = require('./retencao');
const { modoAtual } = require('./socket-atual');
const oficial = require('./whatsapp-oficial');

// Fila de envios automáticos (E3): lembrete de recompra e campanhas. Nada sai na hora: cada envio
// entra como "pendente" e a checagem (a cada 10 s) manda UM por vez, só dentro da janela de horário,
// fora de feriado, com um intervalo sorteado entre um envio e outro e um limite por dia. É o que
// diminui o risco de o WhatsApp (não oficial) bloquear o número por disparo em massa.

const INTERVALO_CHECAGEM_MS = 10 * 1000;

// Regras de envio (Campanhas > Regras de envio); padrões em negocio.js
function regrasDeEnvio(negocio = carregarNegocio()) {
  const inteiro = (v, padrao, min, max) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : padrao;
  };
  const minimo = inteiro(negocio.envio_intervalo_min, 45, 10, 3600);
  return {
    janelas: Array.isArray(negocio.envio_janelas) && negocio.envio_janelas.length ? negocio.envio_janelas : ['1,2,3,4,5,6 08:00-19:00'],
    intervaloMin: minimo,
    intervaloMax: Math.max(minimo, inteiro(negocio.envio_intervalo_max, 90, 10, 3600)),
    limiteDia: inteiro(negocio.envio_limite_dia, 100, 1, 1000),
    pularFeriados: negocio.envio_pular_feriados !== false,
  };
}

function inicioDoDiaLocal(agora = new Date()) {
  const d = new Date(agora);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function enviadosHoje(agora = new Date()) {
  return db.prepare("SELECT COUNT(*) AS n FROM envios WHERE status = 'enviado' AND tipo IN ('lembrete', 'campanha') AND enviado_em >= ?").get(inicioDoDiaLocal(agora)).n;
}

/** Pode mandar envio automático agora? { ok } ou { ok: false, motivo } (pra mostrar na tela) */
function situacaoDaFila(agora = new Date(), negocio = carregarNegocio()) {
  const regras = regrasDeEnvio(negocio);
  if (!obterSocket()) return { ok: false, motivo: 'WhatsApp desconectado' };
  if (regras.pularFeriados && feriadoAgora(agora)) return { ok: false, motivo: 'Hoje é feriado' };
  if (!dentroDasJanelas(regras.janelas, agora)) return { ok: false, motivo: 'Fora do horário de envio' };
  const hoje = enviadosHoje(agora);
  if (hoje >= regras.limiteDia) return { ok: false, motivo: `Chegou ao limite do dia (${regras.limiteDia})` };
  return { ok: true, enviadosHoje: hoje };
}

// `modelo` (API oficial): { nome, idioma, parametros } do modelo aprovado que vai no lugar do texto
function enfileirar({ tipo, referenciaId = null, conversaId, texto, agendadoPara = new Date(), modelo = null }) {
  const agora = new Date().toISOString();
  return Number(
    db
      .prepare('INSERT INTO envios (tipo, referencia_id, conversa_id, texto, agendado_para, criado_em, modelo) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(tipo, referenciaId, conversaId, texto, new Date(agendadoPara).toISOString(), agora, modelo ? JSON.stringify(modelo) : null).lastInsertRowid,
  );
}

// Quem pediu pra sair: tirou o consentimento (optout_em preenchido e consentimento 0)
const saiuDasMensagens = (c) => !!c.optout_em && !c.consentimento;

/** Por que esse cliente não deve receber agora (texto), ou null se pode. */
function motivoParaNaoMandar(conversa, { emAtendimentoConta = true } = {}) {
  if (!conversa) return 'Contato não existe mais';
  if (String(conversa.numero).startsWith(PREFIXO_ANONIMO)) return 'Contato apagado pela limpeza automática';
  if (conversa.situacao_contato === 'bloqueado') return 'Contato bloqueado';
  if (conversa.situacao_contato === 'ignorado') return 'Contato ignorado';
  if (saiuDasMensagens(conversa)) return 'Pediu para não receber mensagens';
  if (emAtendimentoConta && (conversa.status === 'aguardando' || conversa.status === 'atendendo')) return 'Está em atendimento agora';
  if (!podeEnviarAutomatico(conversa.numero)) return 'Modo de teste: número fora da lista';
  return null;
}

let proximoEnvioEm = 0; // memória: o sorteio do intervalo entre um envio e o próximo

function sortearIntervalo(regras) {
  return (regras.intervaloMin + Math.random() * (regras.intervaloMax - regras.intervaloMin)) * 1000;
}

/**
 * Manda o próximo envio pendente, se puder. Devolve o que fez: { enviado: id } | { pulado: id } |
 * { esperando: motivo }. `forcar` ignora o intervalo (testes).
 */
async function processarFila({ agora = new Date(), forcar = false } = {}) {
  const negocio = carregarNegocio();
  const situacao = situacaoDaFila(agora, negocio);
  if (!situacao.ok) return { esperando: situacao.motivo };
  if (!forcar && Date.now() < proximoEnvioEm) return { esperando: 'Intervalo entre envios' };

  const envio = db
    .prepare(
      `SELECT e.* FROM envios e LEFT JOIN campanhas c ON c.id = e.referencia_id AND e.tipo = 'campanha'
       WHERE e.status = 'pendente' AND e.agendado_para <= ? AND e.tipo IN ('lembrete', 'campanha')
         AND (e.tipo <> 'campanha' OR c.status = 'enviando')
       ORDER BY e.agendado_para, e.id LIMIT 1`,
    )
    .get(agora.toISOString());
  if (!envio) return { esperando: 'Nada para mandar' };

  const conversa = db.prepare('SELECT * FROM conversas WHERE id = ?').get(envio.conversa_id);
  const motivo = motivoParaNaoMandar(conversa);
  if (motivo) {
    db.prepare("UPDATE envios SET status = 'pulado', motivo = ? WHERE id = ?").run(motivo, envio.id);
    return { pulado: envio.id, motivo };
  }

  // Instagram (E4): a empresa não começa conversa; só vai se o cliente escreveu nas últimas 24 h
  if (String(conversa.numero).endsWith('@instagram') && !oficial.dentroDaJanela(conversa.id)) {
    db.prepare("UPDATE envios SET status = 'pulado', motivo = ? WHERE id = ?").run('Instagram: passaram 24 h sem o cliente escrever', envio.id);
    return { pulado: envio.id, motivo: 'Instagram fora das 24 h' };
  }
  // API oficial: com modelo vai o modelo; sem modelo, texto só dentro das 24 h do cliente
  const viaOficial = modoAtual() === 'oficial' && !String(conversa.numero).endsWith('@instagram');
  const modelo = envio.modelo ? JSON.parse(envio.modelo) : null;
  if (viaOficial && !modelo && !oficial.dentroDaJanela(conversa.id)) {
    db.prepare("UPDATE envios SET status = 'pulado', motivo = ? WHERE id = ?").run('API oficial: passaram 24 h sem o cliente escrever; precisa de um modelo aprovado', envio.id);
    return { pulado: envio.id, motivo: 'API oficial sem modelo' };
  }

  const regras = regrasDeEnvio(negocio);
  proximoEnvioEm = Date.now() + sortearIntervalo(regras);
  const { registrarMensagem } = require('./conversas'); // aqui: conversas usa módulos que usam este
  try {
    const canal = obterSocket();
    const resposta = viaOficial && modelo ? await canal.enviarModelo(conversa.numero, modelo, { origem: envio.tipo }) : await canal.sendMessage(conversa.numero, { text: envio.texto });
    db.prepare("UPDATE envios SET status = 'enviado', enviado_em = ?, wa_id = ? WHERE id = ?").run(new Date().toISOString(), resposta?.key?.id || null, envio.id);
    registrarMensagem(conversa.numero, 'bot', envio.texto, null, null, { waId: resposta?.key?.id, deMim: true });
    concluirCampanhaSeAcabou(envio);
    return { enviado: envio.id };
  } catch (erro) {
    db.prepare("UPDATE envios SET status = 'falhou', motivo = ? WHERE id = ?").run(String(erro.message || erro).slice(0, 200), envio.id);
    return { falhou: envio.id };
  }
}

function concluirCampanhaSeAcabou(envio) {
  if (envio.tipo !== 'campanha') return;
  const resta = db.prepare("SELECT COUNT(*) AS n FROM envios WHERE tipo = 'campanha' AND referencia_id = ? AND status = 'pendente'").get(envio.referencia_id).n;
  if (!resta) db.prepare("UPDATE campanhas SET status = 'concluida', concluida_em = ? WHERE id = ? AND status = 'enviando'").run(new Date().toISOString(), envio.referencia_id);
}

// Recibos do WhatsApp (evento messages.update do Baileys): 3 = entregue, 4 = lido, 5 = ouvido
function atualizarRecibos(atualizacoes) {
  const agora = new Date().toISOString();
  for (const item of atualizacoes || []) {
    const id = item?.key?.id;
    const status = item?.update?.status;
    if (!id || typeof status !== 'number') continue;
    if (status >= 3) db.prepare('UPDATE envios SET entregue_em = COALESCE(entregue_em, ?) WHERE wa_id = ?').run(agora, id);
    if (status >= 4) db.prepare('UPDATE envios SET lido_em = COALESCE(lido_em, ?) WHERE wa_id = ?').run(agora, id);
  }
}

// ---- Quando o cliente responde ----

const PALAVRAS_SAIR = ['sair', 'parar', 'pare', 'stop', 'cancelar', 'descadastrar', 'nao quero mais', 'nao quero receber'];
const normalizar = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[!.?]+$/g, '').trim();
const MENSAGEM_SAIU =
  'Pronto, você não vai mais receber nossas mensagens automáticas. Se precisar de alguma coisa, é só mandar mensagem por aqui. 🙂';

/**
 * O cliente mandou `texto`: marca como respondido o último envio automático dele (até 3 dias) e
 * descobre se é um "SAIR" (até 7 dias depois de um envio). Devolve { envio, saiu } — envio é o
 * envio respondido (com a campanha, se for), pra quem chamou decidir o que fazer.
 */
function registrarResposta(conversa, texto, agora = new Date()) {
  const tresDias = new Date(agora.getTime() - 3 * 86400000).toISOString();
  const seteDias = new Date(agora.getTime() - 7 * 86400000).toISOString();
  const ultimo = db
    .prepare("SELECT * FROM envios WHERE conversa_id = ? AND status = 'enviado' AND tipo IN ('lembrete', 'campanha') AND enviado_em >= ? ORDER BY enviado_em DESC LIMIT 1")
    .get(conversa.id, seteDias);
  if (!ultimo) return { envio: null, saiu: false };

  const comAtendente = conversa.status === 'aguardando' || conversa.status === 'atendendo';
  if (!comAtendente && PALAVRAS_SAIR.includes(normalizar(texto))) {
    db.prepare("UPDATE conversas SET consentimento = 0, optout_em = ? WHERE id = ?").run(agora.toISOString(), conversa.id);
    db.prepare('UPDATE envios SET saiu_em = COALESCE(saiu_em, ?), respondido_em = COALESCE(respondido_em, ?) WHERE id = ?').run(agora.toISOString(), agora.toISOString(), ultimo.id);
    // os pendentes desse cliente não saem mais
    db.prepare("UPDATE envios SET status = 'cancelado', motivo = 'Pediu para não receber mensagens' WHERE conversa_id = ? AND status = 'pendente'").run(conversa.id);
    return { envio: ultimo, saiu: true, mensagem: MENSAGEM_SAIU };
  }
  if (ultimo.respondido_em || ultimo.enviado_em < tresDias) return { envio: null, saiu: false };
  db.prepare('UPDATE envios SET respondido_em = ? WHERE id = ?').run(agora.toISOString(), ultimo.id);
  return { envio: ultimo, saiu: false };
}

function iniciarFilaDeEnvios() {
  setInterval(() => {
    processarFila().catch((erro) => console.error('Erro na fila de envios:', erro.message));
  }, INTERVALO_CHECAGEM_MS).unref();
}

// Números de um conjunto de envios (Lembretes, Campanhas)
function resumoDeEnvios(where, parametros = []) {
  const linha = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(status = 'pendente') AS pendentes, SUM(status = 'enviado') AS enviados,
              SUM(status = 'pulado') AS pulados, SUM(status = 'falhou') AS falhas, SUM(status = 'cancelado') AS cancelados,
              SUM(entregue_em IS NOT NULL) AS entregues, SUM(lido_em IS NOT NULL) AS lidos,
              SUM(respondido_em IS NOT NULL) AS respondidos, SUM(saiu_em IS NOT NULL) AS sairam
       FROM envios WHERE ${where}`,
    )
    .get(...parametros);
  const resultado = {};
  for (const [chave, valor] of Object.entries(linha)) resultado[chave] = valor || 0;
  return resultado;
}

function zerarIntervalo() {
  proximoEnvioEm = 0;
}

module.exports = {
  regrasDeEnvio,
  situacaoDaFila,
  enfileirar,
  motivoParaNaoMandar,
  saiuDasMensagens,
  processarFila,
  atualizarRecibos,
  registrarResposta,
  iniciarFilaDeEnvios,
  resumoDeEnvios,
  enviadosHoje,
  zerarIntervalo,
  PALAVRAS_SAIR,
  MENSAGEM_SAIU,
};

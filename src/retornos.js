const { db } = require('./db');
const { barramento } = require('./eventos');
const { obterSocket } = require('./socket-atual');
const { podeEnviarAutomatico } = require('./modo-teste');
const { carregarFluxo } = require('./fluxo');
const { transferirParaHumano } = require('./flow-engine');

// Retorno agendado (E3, 1a parte): o atendente marca "chamar este cliente dia 25 às 10h". Na hora,
// a conversa vai para ele (fica "Atendendo: <pessoa>"), entra uma nota interna com o motivo e ele
// recebe o aviso; se foi escrita uma mensagem, ela vai para o cliente na hora.

const INTERVALO_MS = 60 * 1000;

/** Agenda. `quando` em ISO. Devolve { id } ou { erro }. */
function agendarRetorno({ conversaId, atendenteId, criadoPor, quando, nota = '', mensagem = '' }) {
  const ms = Date.parse(quando);
  if (!Number.isFinite(ms)) return { erro: 'Escolha o dia e a hora do retorno.' };
  if (ms < Date.now() - 60000) return { erro: 'O dia e a hora do retorno já passaram.' };
  if (ms > Date.now() + 366 * 86400000) return { erro: 'O retorno pode ser marcado para até 1 ano.' };
  const id = Number(
    db
      .prepare('INSERT INTO retornos (conversa_id, atendente_id, criado_por, quando, nota, mensagem, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(conversaId, atendenteId || null, criadoPor || null, new Date(ms).toISOString(), String(nota || '').trim().slice(0, 500) || null, String(mensagem || '').trim().slice(0, 2000) || null, new Date().toISOString())
      .lastInsertRowid,
  );
  return { id };
}

function cancelarRetorno(id) {
  return db.prepare("UPDATE retornos SET status = 'cancelado' WHERE id = ? AND status = 'pendente'").run(id).changes > 0;
}

const SELECT = `SELECT r.*, a.nome AS atendente_nome, c.numero, c.numero_exibicao, c.nome_contato
  FROM retornos r JOIN conversas c ON c.id = r.conversa_id LEFT JOIN atendentes a ON a.id = r.atendente_id`;

function retornosDaConversa(conversaId) {
  return db.prepare(`${SELECT} WHERE r.conversa_id = ? AND r.status = 'pendente' ORDER BY r.quando`).all(conversaId);
}

function listarRetornos({ status = 'pendente', limite = 200 } = {}) {
  const ordem = status === 'pendente' ? 'r.quando ASC' : 'r.quando DESC';
  return db.prepare(`${SELECT} WHERE r.status = ? ORDER BY ${ordem} LIMIT ?`).all(status, limite);
}

/** Faz os retornos que chegaram na hora. Devolve quantos fez. */
async function processarRetornos(agora = new Date()) {
  const { obterConversaPorId, assumirConversa, registrarNotaInterna, registrarMensagem } = require('./conversas');
  const vencidos = db.prepare("SELECT * FROM retornos WHERE status = 'pendente' AND quando <= ? ORDER BY quando").all(agora.toISOString());
  for (const r of vencidos) {
    db.prepare("UPDATE retornos SET status = 'feito', feito_em = ? WHERE id = ?").run(agora.toISOString(), r.id);
    const conversa = obterConversaPorId(r.conversa_id);
    if (!conversa) continue;
    const atendente = r.atendente_id ? db.prepare('SELECT id, nome, ativo FROM atendentes WHERE id = ?').get(r.atendente_id) : null;
    // vai pra pessoa marcada, a não ser que outra pessoa já esteja atendendo agora
    if (atendente && atendente.ativo && !(conversa.status === 'atendendo' && conversa.atendente_id && conversa.atendente_id !== atendente.id)) {
      transferirParaHumano(conversa.numero, carregarFluxo());
      assumirConversa(conversa.id, atendente.id);
    }
    registrarNotaInterna(conversa.id, `📅 Retorno agendado${atendente ? ` para ${atendente.nome}` : ''}${r.nota ? `: ${r.nota}` : '.'}`);

    if (r.mensagem) {
      const sock = obterSocket();
      const situacao = db.prepare('SELECT situacao_contato FROM conversas WHERE id = ?').get(conversa.id)?.situacao_contato;
      if (sock && situacao !== 'bloqueado' && podeEnviarAutomatico(conversa.numero)) {
        try {
          const resposta = await sock.sendMessage(conversa.numero, { text: r.mensagem });
          registrarMensagem(conversa.numero, 'atendente', r.mensagem, null, atendente ? atendente.id : null, { waId: resposta?.key?.id, deMim: true });
        } catch (erro) {
          registrarNotaInterna(conversa.id, 'A mensagem do retorno não foi enviada (falha no WhatsApp). Mande pela conversa.');
        }
      } else {
        registrarNotaInterna(conversa.id, 'A mensagem do retorno não foi enviada (WhatsApp desconectado ou contato bloqueado). Mande pela conversa.');
      }
    }
    barramento.emit('atencao', { motivo: 'retorno', numero: conversa.numero, numeroExibicao: conversa.numero_exibicao });
  }
  return vencidos.length;
}

function iniciarRetornos() {
  setInterval(() => {
    processarRetornos().catch((erro) => console.error('Erro nos retornos agendados:', erro.message));
  }, INTERVALO_MS).unref();
}

module.exports = { agendarRetorno, cancelarRetorno, retornosDaConversa, listarRetornos, processarRetornos, iniciarRetornos };

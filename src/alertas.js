const { listarFila } = require('./conversas');
const { carregarNegocio } = require('./negocio');
const { situacaoDaEquipe } = require('./equipe');
const { barramento } = require('./eventos');

// Alertas de fila (E2, 2a parte), configurados em Configurações > Pausas e alertas:
// - cliente esperando na fila há mais de X min (alerta_fila_minutos);
// - fila cheia: mais de N clientes esperando (alerta_fila_quantidade);
// - atendente com cliente sem resposta há mais de X min (alerta_sem_resposta_minutos);
// - pausa que passou do limite do motivo.
// 0 desliga cada um. Aparecem numa faixa na Fila, no Painel e no painel da TV, e a checagem a cada
// minuto avisa (bipe + aviso do Windows) quando um alerta aparece ou piora.

const MINUTO = 60000;
const INTERVALO_MS = 60 * 1000;
const REPETIR_APOS_MS = 15 * MINUTO; // alerta que continua de pé avisa de novo depois disso

const plural = (n, um, varios) => (n === 1 ? um : varios);

// Desde quando o cliente espera: a 1a mensagem dele sem resposta (esperando_desde da Fila), mas
// nunca antes de o atendimento atual abrir (uma mensagem solta de um atendimento antigo, como um
// "obrigado" depois de finalizar, não conta).
function inicioDaEspera(c) {
  const candidatos = [c.esperando_desde, c.aberta_em].filter(Boolean);
  if (!candidatos.length) return c.atualizado_em;
  return candidatos.sort().pop();
}

/**
 * Alertas de agora. Cada um: { chave, tipo, gravidade ('atencao' | 'grave'), texto (painel),
 * textoTv (sem dados de cliente), para ('todos' | 'gestao' | id do atendente), nivel (número que
 * cresce quando o alerta piora) }.
 */
function calcularAlertas({ negocio = carregarNegocio(), agoraMs = Date.now() } = {}) {
  const alertas = [];
  const fila = listarFila();
  const minutosDesde = (iso) => (iso ? Math.floor((agoraMs - Date.parse(iso)) / MINUTO) : 0);

  const aguardando = fila.filter((c) => c.status === 'aguardando');
  const limiteEspera = Number(negocio.alerta_fila_minutos) || 0;
  if (limiteEspera) {
    const atrasados = aguardando.map((c) => minutosDesde(inicioDaEspera(c))).filter((m) => m >= limiteEspera);
    if (atrasados.length) {
      const maior = Math.max(...atrasados);
      const texto = `${atrasados.length} ${plural(atrasados.length, 'cliente esperando', 'clientes esperando')} na fila há mais de ${limiteEspera} min (o mais antigo há ${maior} min)`;
      alertas.push({ chave: 'fila_espera', tipo: 'fila_espera', gravidade: maior >= limiteEspera * 2 ? 'grave' : 'atencao', texto, textoTv: texto, para: 'todos', nivel: atrasados.length });
    }
  }

  const limiteQuantidade = Number(negocio.alerta_fila_quantidade) || 0;
  if (limiteQuantidade && aguardando.length >= limiteQuantidade) {
    const texto = `Fila cheia: ${aguardando.length} ${plural(aguardando.length, 'cliente esperando', 'clientes esperando')} (alerta a partir de ${limiteQuantidade})`;
    alertas.push({ chave: 'fila_cheia', tipo: 'fila_cheia', gravidade: 'grave', texto, textoTv: texto, para: 'todos', nivel: aguardando.length });
  }

  const limiteResposta = Number(negocio.alerta_sem_resposta_minutos) || 0;
  if (limiteResposta) {
    const porAtendente = new Map();
    for (const c of fila) {
      if (c.status !== 'atendendo' || !c.atendente_id || !c.esperando_desde) continue;
      if (minutosDesde(inicioDaEspera(c)) < limiteResposta) continue;
      if (!porAtendente.has(c.atendente_id)) porAtendente.set(c.atendente_id, { nome: c.atendente_nome, total: 0 });
      porAtendente.get(c.atendente_id).total += 1;
    }
    for (const [id, { nome, total }] of porAtendente) {
      const texto = `${nome} tem ${total} ${plural(total, 'cliente', 'clientes')} sem resposta há mais de ${limiteResposta} min`;
      alertas.push({ chave: `sem_resposta_${id}`, tipo: 'sem_resposta', gravidade: 'atencao', texto, textoTv: texto, para: 'todos', nivel: total });
    }
  }

  for (const pessoa of situacaoDaEquipe(agoraMs)) {
    if (!pessoa.pausa || !pessoa.pausa.passou) continue;
    const texto = `${pessoa.nome} está em pausa (${pessoa.pausa.motivo}) há ${pessoa.pausa.minutos} min; o limite é ${pessoa.pausa.limite} min`;
    alertas.push({ chave: `pausa_${pessoa.pausa.id}`, tipo: 'pausa_longa', gravidade: 'atencao', texto, textoTv: texto, para: 'gestao', atendenteId: pessoa.id, nivel: 1 });
  }
  return alertas;
}

/** O alerta é pra essa pessoa? (pausa longa: gestão e a própria pessoa) */
function alertaParaAtendente(alerta, atendente, temPermissao) {
  if (alerta.para === 'todos') return true;
  if (alerta.atendenteId === atendente.id) return true;
  return alerta.para === 'gestao' && temPermissao(atendente, 'ver_painel');
}

// Avisa (evento "alerta" pro navegador) quando um alerta aparece, piora, ou continua de pé há 15 min.
const avisados = new Map(); // chave -> { nivel, em }
function checarAlertas(agoraMs = Date.now()) {
  const atuais = calcularAlertas({ agoraMs });
  const chavesAtuais = new Set();
  for (const alerta of atuais) {
    chavesAtuais.add(alerta.chave);
    const anterior = avisados.get(alerta.chave);
    if (!anterior || alerta.nivel > anterior.nivel || agoraMs - anterior.em >= REPETIR_APOS_MS) {
      avisados.set(alerta.chave, { nivel: alerta.nivel, em: agoraMs });
      barramento.emit('alerta', alerta);
    }
  }
  for (const chave of avisados.keys()) if (!chavesAtuais.has(chave)) avisados.delete(chave);
  return atuais;
}

function iniciarChecagemAlertas() {
  setInterval(() => {
    try {
      checarAlertas();
    } catch (erro) {
      console.error('Erro na checagem de alertas:', erro.message);
    }
  }, INTERVALO_MS).unref();
}

module.exports = { inicioDaEspera, calcularAlertas, alertaParaAtendente, checarAlertas, iniciarChecagemAlertas };

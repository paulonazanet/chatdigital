// Quem está online agora: conta quantas conexões SSE (/painel/eventos) cada atendente tem
// abertas — se tiver pelo menos uma aba do painel aberta, está "online". Tudo em memória (não
// precisa persistir; some se o processo reiniciar, o que é o comportamento certo).
const { barramento } = require('./eventos');

const contagem = new Map(); // atendenteId -> nº de conexões abertas

function listarOnline() {
  return [...contagem.keys()];
}

function estaOnline(atendenteId) {
  return contagem.has(atendenteId);
}

function conectou(atendenteId) {
  contagem.set(atendenteId, (contagem.get(atendenteId) || 0) + 1);
  barramento.emit('presenca', { online: listarOnline() });
}

function desconectou(atendenteId) {
  const restante = (contagem.get(atendenteId) || 1) - 1;
  if (restante <= 0) contagem.delete(atendenteId);
  else contagem.set(atendenteId, restante);
  barramento.emit('presenca', { online: listarOnline() });
}

module.exports = { conectou, desconectou, estaOnline, listarOnline };

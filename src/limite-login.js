// Rate limit de login (decidido com o Paulo: 5 tentativas erradas -> bloqueia 15 min), por
// e-mail. Em memória (como presenca.js) — some se o processo reiniciar, o que é aceitável aqui:
// pior caso é o contador zerar, nunca travar alguém indevidamente por mais tempo.
const MAX_TENTATIVAS = 5;
const JANELA_MS = 15 * 60 * 1000;

const tentativasPorEmail = new Map(); // email normalizado -> [timestamps das falhas na janela]

function normalizar(email) {
  return String(email || '').trim().toLowerCase();
}

function tentativasNaJanela(email) {
  const agora = Date.now();
  const lista = (tentativasPorEmail.get(normalizar(email)) || []).filter((t) => agora - t < JANELA_MS);
  tentativasPorEmail.set(normalizar(email), lista);
  return lista;
}

function bloqueado(email) {
  return tentativasNaJanela(email).length >= MAX_TENTATIVAS;
}

function registrarFalha(email) {
  const lista = tentativasNaJanela(email);
  lista.push(Date.now());
  tentativasPorEmail.set(normalizar(email), lista);
}

function registrarSucesso(email) {
  tentativasPorEmail.delete(normalizar(email));
}

function minutosParaTentarDeNovo(email) {
  const lista = tentativasNaJanela(email);
  if (lista.length === 0) return 0;
  const maisAntiga = Math.min(...lista);
  return Math.max(1, Math.ceil((JANELA_MS - (Date.now() - maisAntiga)) / 60000));
}

module.exports = { bloqueado, registrarFalha, registrarSucesso, minutosParaTentarDeNovo, MAX_TENTATIVAS };

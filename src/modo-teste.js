const { db } = require('./db');

// Modo de teste: quando NUMEROS_TESTE está preenchido no .env (números separados por vírgula),
// o sistema só conversa sozinho com esses números — nos dois sentidos:
// - chegando: o bot só responde pra eles (os outros continuam chegando no celular normalmente,
//   dá pra responder na mão) — ver src/bot.js;
// - saindo: mensagem automática que o sistema manda por conta própria (lembrete de inatividade,
//   transferência por inatividade, fechamento automático, aviso de avaliação vencida) só vai pra
//   eles — senão um teste podia mandar mensagem pra número simulado/de gente de fora.
// Sem essa variável (produção), vale pra todo mundo como sempre. Ações que o atendente faz na
// mão no painel (responder, finalizar...) não passam por aqui.

// Celular brasileiro tem um "nono dígito" ambíguo: o WhatsApp às vezes manda o número sem ele
// (55 81 96850663, 8 dígitos depois do DDD) mesmo quando o número de verdade tem 9 (55 81
// 996850663) — vimos isso acontecer de verdade num teste, e sem essa normalização a comparação
// simplesmente nunca batia, sem erro nenhum, só silêncio. Isso tira esse 9 (quando presente) pra
// comparar sempre na forma curta.
function formaCurtaNumeroBr(digitos) {
  const m = /^55(\d{2})(\d{8,9})$/.exec(digitos);
  if (!m) return digitos;
  const [, ddd, resto] = m;
  return '55' + ddd + (resto.length === 9 && resto[0] === '9' ? resto.slice(1) : resto);
}

function construirVerificadorNumeroPermitido(listaPermitidos) {
  const permitidosNaFormaCurta = listaPermitidos.map(formaCurtaNumeroBr);
  return function numeroPermitido(numero, senderPn) {
    if (listaPermitidos.length === 0) return true;
    const candidato = String(senderPn || numero).replace('@s.whatsapp.net', '').replace('@lid', '');
    const candidatoCurto = formaCurtaNumeroBr(candidato);
    return permitidosNaFormaCurta.some((permitido) => candidatoCurto === permitido);
  };
}

// lida a cada chamada (e não uma vez só ao carregar) pra valer o .env carregado depois e os testes
function numerosTeste() {
  return (process.env.NUMEROS_TESTE || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
}

/** Chegando: `senderPn` é o número de verdade por trás de um JID @lid (msg.key.remoteJidAlt). */
function numeroPermitido(numero, senderPn) {
  return construirVerificadorNumeroPermitido(numerosTeste())(numero, senderPn);
}

/** Saindo: pode mandar mensagem automática pra essa conversa? (em @lid, usa o número guardado) */
function podeEnviarAutomatico(numero) {
  const lista = numerosTeste();
  if (lista.length === 0) return true;
  const conversa = db.prepare('SELECT numero_exibicao FROM conversas WHERE numero = ?').get(numero);
  const numeroDeVerdade = conversa && conversa.numero_exibicao ? `${conversa.numero_exibicao}@s.whatsapp.net` : undefined;
  return construirVerificadorNumeroPermitido(lista)(numero, numeroDeVerdade);
}

module.exports = { formaCurtaNumeroBr, construirVerificadorNumeroPermitido, numeroPermitido, podeEnviarAutomatico };

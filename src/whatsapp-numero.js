/**
 * Confere no WhatsApp se o número digitado existe e devolve o endereço certo pra conversa (ou
 * null se o número não tem WhatsApp). Usado pela "+ Nova conversa" e pelo "Novo contato".
 *
 * Quando o cliente responder, a mensagem chega com o JID @lid (não o @s.whatsapp.net que o
 * onWhatsApp devolve) — se a conversa fosse criada com o JID errado, a resposta do cliente
 * cairia numa conversa "fantasma" diferente e o bot achava que era gente nova conversando.
 */
async function resolverNumeroNoWhatsApp(sock, digitos) {
  const [resultado] = await sock.onWhatsApp(`${digitos}@s.whatsapp.net`);
  if (!resultado?.exists) return null;
  const lid = await sock.signalRepository?.lidMapping?.getLIDForPN(resultado.jid).catch(() => null);
  return lid || resultado.jid;
}

module.exports = { resolverNumeroNoWhatsApp };

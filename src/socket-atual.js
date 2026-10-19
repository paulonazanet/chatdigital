// Central de envio (E4, 1a parte): a conexão ativa do WhatsApp, compartilhada entre o bot e as rotas
// do painel dentro do mesmo processo. Pode ser o WhatsApp do celular (Baileys, QR Code) ou a API
// oficial da Meta (whatsapp-oficial.js). As duas têm o mesmo jeito de mandar: sendMessage(numero,
// conteudo, opcoes) devolvendo { key: { id } }, então quem manda mensagem não precisa saber qual é.
//
// O tipo da conexão é decidido quando o sistema liga (app.js lê Configurações > WhatsApp); trocar na
// tela só vale depois de reiniciar, pra nunca ficar recebendo por uma e mandando por outra.

const MODOS = ['celular', 'oficial'];

let socketCelular = null; // Baileys
let canalOficial = null; // adaptador da API oficial
let modoEmUso = 'celular';

function definirSocket(sock) {
  socketCelular = sock;
}

function definirCanalOficial(canal) {
  canalOficial = canal;
}

function definirModo(modo) {
  modoEmUso = MODOS.includes(modo) ? modo : 'celular';
}

function modoAtual() {
  return modoEmUso;
}

/** A conexão por onde as mensagens saem agora (ou null se não há nenhuma). */
function obterSocket() {
  return modoEmUso === 'oficial' ? canalOficial : socketCelular;
}

module.exports = { definirSocket, definirCanalOficial, definirModo, modoAtual, obterSocket, MODOS };

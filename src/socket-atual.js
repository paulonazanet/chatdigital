// Referência à conexão ativa do WhatsApp (Baileys), compartilhada entre o bot e as rotas do
// painel dentro do mesmo processo — é o que permite o atendente responder direto pela tela.
let socketAtual = null;

function definirSocket(sock) {
  socketAtual = sock;
}

function obterSocket() {
  return socketAtual;
}

module.exports = { definirSocket, obterSocket };

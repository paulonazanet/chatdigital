const { barramento } = require('./eventos');

// Estado da conexão do WhatsApp (Baileys), compartilhado entre o bot e a tela de Configurações >
// WhatsApp — permite mostrar o QR Code (e saber quando ele expirou/mudou) sem depender do
// terminal do servidor. `conectado` só vira true no evento "open" de verdade (diferente de
// `obterSocket()`, que existe desde a criação do socket, antes de a conexão abrir).
let estado = { conectado: false, qr: null };

function definirQr(qr) {
  estado = { conectado: false, qr };
  barramento.emit('whatsapp-status', { conectado: false, temQr: true });
}

function definirConectado() {
  estado = { conectado: true, qr: null };
  barramento.emit('whatsapp-status', { conectado: true, temQr: false });
}

function definirDesconectado() {
  estado = { conectado: false, qr: null };
  barramento.emit('whatsapp-status', { conectado: false, temQr: false });
}

function obterEstado() {
  return estado;
}

module.exports = { definirQr, definirConectado, definirDesconectado, obterEstado };

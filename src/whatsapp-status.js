const { barramento } = require('./eventos');

// Estado da conexão do WhatsApp, compartilhado entre o bot e a tela de Configurações > WhatsApp —
// permite mostrar o QR Code (e saber quando ele expirou/mudou) sem depender do terminal do servidor.
// `conectado` só vira true no evento "open" de verdade (diferente de `obterSocket()`, que existe
// desde a criação do socket, antes de a conexão abrir).
//
// E4, 3a parte: um estado por número (canal). Sem o número, vale o 1o (o "Principal") pra gravar, e
// a leitura sem número junta todos: conectado só se TODOS os números ligados estão conectados.

const estados = new Map(); // canalId -> { conectado, qr }

function definir(canalId, estado) {
  estados.set(canalId, estado);
  barramento.emit('whatsapp-status', { canalId, conectado: estado.conectado, temQr: !!estado.qr });
}

function definirQr(qr, canalId = 1) {
  definir(canalId, { conectado: false, qr });
}

function definirConectado(canalId = 1) {
  definir(canalId, { conectado: true, qr: null });
}

function definirDesconectado(canalId = 1) {
  definir(canalId, { conectado: false, qr: null });
}

// número que parou de ser usado (desativado): sai da conta do "todos conectados"
function esquecer(canalId) {
  estados.delete(canalId);
  barramento.emit('whatsapp-status', { canalId, conectado: false, temQr: false });
}

/** Com `canalId`: o estado daquele número. Sem: o resumo de todos (e o QR do 1o). */
function obterEstado(canalId) {
  if (canalId !== undefined) return estados.get(canalId) || { conectado: false, qr: null };
  const todos = [...estados.values()];
  return { conectado: todos.length > 0 && todos.every((e) => e.conectado), qr: (estados.get(1) || {}).qr || null };
}

module.exports = { definirQr, definirConectado, definirDesconectado, esquecer, obterEstado };

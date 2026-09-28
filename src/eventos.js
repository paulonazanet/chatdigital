const { EventEmitter } = require('events');

// Canal de eventos em memória: conversas.js emite quando algo precisa da atenção de um atendente,
// e a rota /painel/eventos (Server-Sent Events) repassa isso pro navegador em tempo real.
const barramento = new EventEmitter();

module.exports = { barramento };

const express = require('express');
const router = express.Router();

const { barramento } = require('../eventos');

const INTERVALO_PING_MS = 25000;

// Server-Sent Events: mantém uma conexão aberta com o navegador do atendente e empurra um
// evento "atencao" toda vez que uma conversa precisa de alguém (nova transferência ou nova
// mensagem do cliente numa conversa já em atendimento humano).
router.get('/', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const enviar = (dados) => {
    res.write(`event: atencao\ndata: ${JSON.stringify(dados)}\n\n`);
  };
  barramento.on('atencao', enviar);

  const manterViva = setInterval(() => res.write(': ping\n\n'), INTERVALO_PING_MS);

  req.on('close', () => {
    barramento.off('atencao', enviar);
    clearInterval(manterViva);
  });
});

module.exports = router;

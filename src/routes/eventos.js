const express = require('express');
const router = express.Router();

const { barramento } = require('../eventos');
const presenca = require('../presenca');

const INTERVALO_PING_MS = 25000;

// Server-Sent Events: mantém uma conexão aberta com o navegador do atendente e empurra um
// evento "atencao" toda vez que uma conversa precisa de alguém (nova transferência ou nova
// mensagem do cliente numa conversa já em atendimento humano), além de "presenca" com quem está
// online (uma aba do painel aberta já conta como online).
router.get('/', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const enviarAtencao = (dados) => {
    res.write(`event: atencao\ndata: ${JSON.stringify(dados)}\n\n`);
  };
  const enviarPresenca = (dados) => {
    res.write(`event: presenca\ndata: ${JSON.stringify(dados)}\n\n`);
  };
  barramento.on('atencao', enviarAtencao);
  barramento.on('presenca', enviarPresenca);
  presenca.conectou(req.atendente.id); // emite "presenca" já com esta conexão contando

  const manterViva = setInterval(() => res.write(': ping\n\n'), INTERVALO_PING_MS);

  req.on('close', () => {
    barramento.off('atencao', enviarAtencao);
    barramento.off('presenca', enviarPresenca);
    presenca.desconectou(req.atendente.id);
    clearInterval(manterViva);
  });
});

module.exports = router;

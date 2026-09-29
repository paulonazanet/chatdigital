const express = require('express');
const router = express.Router();

const { barramento } = require('../eventos');
const presenca = require('../presenca');

const INTERVALO_PING_MS = 25000;

// Cada aba aberta do painel tem sua própria conexão e recebe o mesmo evento — o id (igual pra
// todas as abas, porque o barramento entrega o MESMO objeto pra cada ouvinte) deixa o navegador
// tocar o bipe e mostrar a notificação do Windows uma vez só, em vez de uma por aba.
const idsDeAtencao = new WeakMap();
const INICIO_PROCESSO = Date.now().toString(36);
let proximoIdAtencao = 1;
function idDoEvento(dados) {
  // prefixo do boot: depois de reiniciar o contador volta pra 1, e sem isso o evento novo teria
  // o mesmo id (e a mesma "tag") de uma notificação antiga ainda aberta, substituindo ela.
  if (!idsDeAtencao.has(dados)) idsDeAtencao.set(dados, `${INICIO_PROCESSO}-${proximoIdAtencao++}`);
  return idsDeAtencao.get(dados);
}

// Server-Sent Events: mantém uma conexão aberta com o navegador do atendente e empurra um
// evento "atencao" toda vez que uma conversa precisa de alguém (nova transferência ou nova
// mensagem do cliente numa conversa já em atendimento humano), "presenca" com quem está online
// (uma aba do painel aberta já conta como online), e "whatsapp-status" quando a conexão do
// WhatsApp muda (novo QR Code, conectou, caiu) — usado pela tela Configurações > WhatsApp.
router.get('/', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const enviarAtencao = (dados) => {
    res.write(`event: atencao\ndata: ${JSON.stringify({ ...dados, id: idDoEvento(dados) })}\n\n`);
  };
  const enviarPresenca = (dados) => {
    res.write(`event: presenca\ndata: ${JSON.stringify(dados)}\n\n`);
  };
  const enviarStatusWhatsapp = (dados) => {
    res.write(`event: whatsapp-status\ndata: ${JSON.stringify(dados)}\n\n`);
  };
  barramento.on('atencao', enviarAtencao);
  barramento.on('presenca', enviarPresenca);
  barramento.on('whatsapp-status', enviarStatusWhatsapp);
  presenca.conectou(req.atendente.id); // emite "presenca" já com esta conexão contando

  const manterViva = setInterval(() => res.write(': ping\n\n'), INTERVALO_PING_MS);

  req.on('close', () => {
    barramento.off('atencao', enviarAtencao);
    barramento.off('presenca', enviarPresenca);
    barramento.off('whatsapp-status', enviarStatusWhatsapp);
    presenca.desconectou(req.atendente.id);
    clearInterval(manterViva);
  });
});

module.exports = router;

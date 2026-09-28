const express = require('express');
const router = express.Router();

const { listarFila, obterConversaPorId, listarMensagens, assumirConversa, finalizarConversa } = require('../conversas');

router.get('/', (req, res) => {
  res.render('fila/lista', { atendenteLogado: req.atendente, conversas: listarFila() });
});

router.get('/:id', (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa) return res.redirect('/painel/fila');
  res.render('fila/detalhe', {
    atendenteLogado: req.atendente,
    conversa,
    mensagens: listarMensagens(conversa.id),
  });
});

router.post('/:id/assumir', (req, res) => {
  assumirConversa(Number(req.params.id), req.atendente.id);
  res.redirect(`/painel/fila/${req.params.id}`);
});

router.post('/:id/finalizar', (req, res) => {
  finalizarConversa(Number(req.params.id));
  res.redirect('/painel/fila');
});

module.exports = router;

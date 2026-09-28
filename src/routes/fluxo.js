const express = require('express');
const router = express.Router();

const { carregarFluxo, salvarFluxo } = require('../fluxo');

router.get('/', (req, res) => {
  res.render('fluxo/editor', { atendenteLogado: req.atendente });
});

router.get('/dados', (req, res) => {
  res.json(carregarFluxo());
});

router.post('/salvar', express.json({ limit: '2mb' }), (req, res) => {
  try {
    salvarFluxo(req.body);
    res.json({ ok: true });
  } catch (erro) {
    res.status(400).json({ ok: false, erros: erro.detalhes || [erro.message] });
  }
});

module.exports = router;

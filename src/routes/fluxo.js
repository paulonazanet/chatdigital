const express = require('express');
const router = express.Router();

const { carregarFluxo, salvarFluxo } = require('../fluxo');
const { listarAtendentes } = require('../atendentes');
const { listarSetores } = require('../setores');

router.get('/', (req, res) => {
  res.render('fluxo/editor', { atendenteLogado: req.atendente });
});

router.get('/dados', (req, res) => {
  res.json(carregarFluxo());
});

// listas pros campos de escolha do editor (bloco "Transferir para atendente")
router.get('/opcoes', (req, res) => {
  res.json({
    atendentes: listarAtendentes().filter((a) => a.ativo).map((a) => ({ id: a.id, nome: a.nome })),
    setores: listarSetores().map((s) => s.nome),
  });
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

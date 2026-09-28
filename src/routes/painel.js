const express = require('express');
const router = express.Router();

const { listarAtendentes } = require('../atendentes');
const { listarSetores } = require('../setores');

router.get('/', (req, res) => {
  res.render('dashboard', {
    atendenteLogado: req.atendente,
    totalAtendentes: listarAtendentes().length,
    totalSetores: listarSetores().length,
  });
});

module.exports = router;

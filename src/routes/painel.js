const express = require('express');
const router = express.Router();

const { listarAtendentes } = require('../atendentes');
const { listarSetores } = require('../setores');
const { temPermissao } = require('../permissoes');

router.get('/', (req, res) => {
  if (!temPermissao(req.atendente, 'ver_painel')) return res.redirect('/painel/fila');
  res.render('dashboard', {
    atendenteLogado: req.atendente,
    totalAtendentes: listarAtendentes().length,
    totalSetores: listarSetores().length,
  });
});

module.exports = router;

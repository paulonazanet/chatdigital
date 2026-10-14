const express = require('express');
const router = express.Router();

const { montarRelatorio } = require('../relatorio');
const { listarAtendentes } = require('../atendentes');

// Menu Relatório (só admin, ou quem ganhar a permissão "ver_relatorio" em Atendentes).
router.get('/', (req, res) => {
  const atendentes = listarAtendentes();
  const atendenteId = atendentes.some((a) => String(a.id) === req.query.atendente) ? Number(req.query.atendente) : null;
  const relatorio = montarRelatorio({ periodo: String(req.query.periodo || '30'), atendenteId });
  res.render('relatorio', { atendenteLogado: req.atendente, relatorio, atendentes, atendenteId });
});

module.exports = router;

const express = require('express');
const router = express.Router();

const { listarAtendentes } = require('../atendentes');
const { listarSetores } = require('../setores');
const { listarFila, listarConversasComBot } = require('../conversas');
const { contarRegistrosHoje } = require('../registros');
const { carregarFluxo } = require('../fluxo');
const whatsappStatus = require('../whatsapp-status');
const { listarOnline } = require('../presenca');
const { temPermissao } = require('../permissoes');

router.get('/', (req, res) => {
  if (!temPermissao(req.atendente, 'ver_painel')) return res.redirect('/painel/fila');

  const fila = listarFila();
  const fluxo = carregarFluxo();
  const paradas = listarConversasComBot().filter((c) => c.no_fluxo_atual && c.no_fluxo_atual !== fluxo.inicio);
  const atendentes = listarAtendentes();
  const idsOnline = new Set(listarOnline());

  res.render('dashboard', {
    atendenteLogado: req.atendente,
    totalAtendentes: atendentes.length,
    totalSetores: listarSetores().length,
    aguardando: fila.filter((c) => c.status === 'aguardando').length,
    atendendo: fila.filter((c) => c.status === 'atendendo').length,
    paradas: paradas.length,
    registrosHoje: contarRegistrosHoje(),
    whatsappConectado: whatsappStatus.obterEstado().conectado,
    atendentesOnline: atendentes.filter((a) => a.ativo && idsOnline.has(a.id)),
  });
});

module.exports = router;

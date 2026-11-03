const express = require('express');
const router = express.Router();

const planos = require('../planos');

// Tela Clientes (E5, 3a parte): a Eu no Digital escolhe o plano de cada cliente com um clique e anota o
// que negociou à parte. Só existe na instalação com CHATDIGITAL_CENTRAL no .env, só para administrador.

router.use((req, res, next) => {
  if (!planos.pastaCentral() || req.atendente.papel !== 'admin') return res.status(404).send('Página não encontrada.');
  next();
});

router.get('/', (req, res) => {
  const clientes = planos.listarClientes();
  res.render('clientes/lista', {
    atendenteLogado: req.atendente,
    clientes,
    planos: planos.PLANOS,
    totalMensal: clientes.reduce((soma, c) => soma + c.plano.total, 0),
    erro: req.query.erro ? 'Não consegui trocar o plano.' : null,
  });
});

router.post('/:nome/plano', (req, res) => {
  const resultado = planos.escolherPlano(req.params.nome, req.body.plano);
  res.redirect(`/painel/clientes${resultado.erro ? '?erro=1' : ''}`);
});

router.get('/:nome', (req, res) => {
  const cliente = planos.obterCliente(req.params.nome);
  if (!cliente || cliente.plano.semLimites) return res.redirect('/painel/clientes');
  res.render('clientes/editar', { atendenteLogado: req.atendente, cliente, recursos: planos.RECURSOS, base: planos.PLANOS[cliente.plano.plano] });
});

router.post('/:nome', (req, res) => {
  const resultado = planos.salvarNegociado(req.params.nome, req.body);
  res.redirect(`/painel/clientes${resultado.erro ? '?erro=1' : ''}`);
});

module.exports = router;

const express = require('express');
const router = express.Router();

const { listarSetores, criarSetor, renomearSetor } = require('../setores');

router.get('/', (req, res) => {
  res.render('setores/lista', { atendenteLogado: req.atendente, setores: listarSetores(), erro: null });
});

router.post('/', (req, res) => {
  const nome = (req.body.nome || '').trim();
  if (!nome) {
    return res.render('setores/lista', { atendenteLogado: req.atendente, setores: listarSetores(), erro: 'Informe um nome para o setor.' });
  }
  try {
    criarSetor(nome);
  } catch (erro) {
    return res.render('setores/lista', { atendenteLogado: req.atendente, setores: listarSetores(), erro: 'Já existe um setor com esse nome.' });
  }
  res.redirect('/painel/setores');
});

router.post('/:id', (req, res) => {
  const nome = (req.body.nome || '').trim();
  if (nome) renomearSetor(Number(req.params.id), nome);
  res.redirect('/painel/setores');
});

module.exports = router;

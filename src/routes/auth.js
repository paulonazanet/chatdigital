const express = require('express');
const router = express.Router();

const { contarAtendentes, criarAtendente, autenticar } = require('../atendentes');
const { definirSessao, limparSessao } = require('../sessao');

router.get('/setup', (req, res) => {
  if (contarAtendentes() > 0) return res.redirect('/login');
  res.render('setup', { erro: null });
});

router.post('/setup', (req, res) => {
  if (contarAtendentes() > 0) return res.redirect('/login');
  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha) {
    return res.render('setup', { erro: 'Preencha todos os campos.' });
  }
  const admin = criarAtendente({ nome, email, senha, papel: 'admin' });
  definirSessao(res, admin.id);
  res.redirect('/painel');
});

router.get('/login', (req, res) => {
  if (contarAtendentes() === 0) return res.redirect('/setup');
  if (req.atendente) return res.redirect('/painel');
  res.render('login', { erro: null });
});

router.post('/login', (req, res) => {
  const { email, senha } = req.body;
  const atendente = autenticar(email || '', senha || '');
  if (!atendente) return res.render('login', { erro: 'E-mail ou senha inválidos.' });
  definirSessao(res, atendente.id);
  res.redirect('/painel');
});

router.post('/logout', (req, res) => {
  limparSessao(res);
  res.redirect('/login');
});

module.exports = router;

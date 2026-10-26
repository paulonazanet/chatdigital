const express = require('express');
const router = express.Router();

const { contarAtendentes, criarAtendente, autenticar, registrarUltimoLogin } = require('../atendentes');
const { definirSessao, limparSessao } = require('../sessao');
const limiteLogin = require('../limite-login');
const { encerrarPausa } = require('../equipe');
const { obterAtendentePorEmail } = require('../atendentes');
const acesso = require('../acesso');

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
  registrarUltimoLogin(admin.id);
  definirSessao(res, admin.id);
  res.redirect('/painel');
});

router.get('/login', (req, res) => {
  if (contarAtendentes() === 0) return res.redirect('/setup');
  if (req.atendente) return res.redirect('/painel');
  res.render('login', { erro: req.query.fora ? 'Você foi desconectado: acabou o seu horário de acesso ao painel (ou este local não está liberado).' : null });
});

router.post('/login', (req, res) => {
  const { email, senha } = req.body;

  acesso.limparAcessosAntigos();
  const conhecido = obterAtendentePorEmail(email || '');
  if (limiteLogin.bloqueado(email)) {
    acesso.registrarAcesso({ atendenteId: conhecido?.id, email, evento: 'bloqueado_tentativas', req });
    return res.status(429).render('login', {
      erro: `Muitas tentativas erradas. Aguarde ${limiteLogin.minutosParaTentarDeNovo(email)} minuto(s) e tente de novo.`,
    });
  }

  const atendente = autenticar(email || '', senha || '');
  if (!atendente) {
    limiteLogin.registrarFalha(email);
    acesso.registrarAcesso({ atendenteId: conhecido?.id, email, evento: 'senha_errada', req });
    return res.render('login', { erro: 'E-mail ou senha inválidos.' });
  }
  const permitido = acesso.verificarAcesso(atendente, { ip: req.ip });
  if (!permitido.ok) {
    acesso.registrarAcesso({ atendenteId: atendente.id, email, evento: /IP/.test(permitido.motivo) ? 'bloqueado_ip' : 'bloqueado_horario', detalhe: permitido.motivo, req });
    return res.status(403).render('login', { erro: permitido.motivo });
  }
  acesso.registrarAcesso({ atendenteId: atendente.id, email, evento: 'entrou', req });

  limiteLogin.registrarSucesso(email);
  registrarUltimoLogin(atendente.id);
  definirSessao(res, atendente.id);
  res.redirect('/painel');
});

router.post('/logout', (req, res) => {
  // saiu do sistema = a pausa acaba (senão ela ficaria correndo até o próximo login)
  if (req.atendente) {
    encerrarPausa(req.atendente.id);
    acesso.registrarAcesso({ atendenteId: req.atendente.id, email: req.atendente.email, evento: 'saiu', req });
  }
  limparSessao(res);
  res.redirect('/login');
});

module.exports = router;

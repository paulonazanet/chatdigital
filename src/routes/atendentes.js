const express = require('express');
const router = express.Router();

const {
  listarAtendentes,
  obterAtendentePorId,
  obterAtendentePorEmail,
  criarAtendente,
  atualizarAtendente,
  contarAdminsAtivos,
  definirSetoresDoAtendente,
  listarSetoresDoAtendente,
} = require('../atendentes');
const { listarSetores } = require('../setores');

router.get('/', (req, res) => {
  res.render('atendentes/lista', { atendenteLogado: req.atendente, atendentes: listarAtendentes() });
});

router.get('/novo', (req, res) => {
  res.render('atendentes/form', {
    atendenteLogado: req.atendente,
    alvo: null,
    setoresDoAlvo: [],
    setores: listarSetores(),
    erro: null,
  });
});

router.post('/', (req, res) => {
  const { nome, email, senha, papel } = req.body;
  const setorIds = [].concat(req.body.setores || []).map(Number);

  if (!nome || !email || !senha || !papel) {
    return res.render('atendentes/form', {
      atendenteLogado: req.atendente,
      alvo: null,
      setoresDoAlvo: setorIds,
      setores: listarSetores(),
      erro: 'Preencha todos os campos obrigatórios.',
    });
  }
  if (obterAtendentePorEmail(email)) {
    return res.render('atendentes/form', {
      atendenteLogado: req.atendente,
      alvo: null,
      setoresDoAlvo: setorIds,
      setores: listarSetores(),
      erro: 'Já existe um atendente com esse e-mail.',
    });
  }

  const novo = criarAtendente({ nome, email, senha, papel });
  definirSetoresDoAtendente(novo.id, setorIds);
  res.redirect('/painel/atendentes');
});

router.get('/:id/editar', (req, res) => {
  const alvo = obterAtendentePorId(Number(req.params.id));
  if (!alvo) return res.redirect('/painel/atendentes');
  res.render('atendentes/form', {
    atendenteLogado: req.atendente,
    alvo,
    setoresDoAlvo: listarSetoresDoAtendente(alvo.id).map((s) => s.id),
    setores: listarSetores(),
    erro: null,
  });
});

router.post('/:id', (req, res) => {
  const id = Number(req.params.id);
  const alvoAtual = obterAtendentePorId(id);
  if (!alvoAtual) return res.redirect('/painel/atendentes');

  const { nome, papel, senha } = req.body;
  const ativo = req.body.ativo === 'on';
  const setorIds = [].concat(req.body.setores || []).map(Number);

  const eraAdminAtivo = alvoAtual.papel === 'admin' && alvoAtual.ativo;
  const continuaAdminAtivo = papel === 'admin' && ativo;
  if (eraAdminAtivo && !continuaAdminAtivo && contarAdminsAtivos(id) === 0) {
    return res.render('atendentes/form', {
      atendenteLogado: req.atendente,
      alvo: alvoAtual,
      setoresDoAlvo: setorIds,
      setores: listarSetores(),
      erro: 'Não é possível remover o último administrador ativo do sistema.',
    });
  }

  atualizarAtendente(id, { nome, papel, ativo, novaSenha: senha || null });
  definirSetoresDoAtendente(id, setorIds);
  res.redirect('/painel/atendentes');
});

module.exports = router;

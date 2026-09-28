const express = require('express');
const router = express.Router();

const {
  listarAtendentes,
  obterAtendentePorId,
  obterAtendentePorEmail,
  criarAtendente,
  atualizarAtendente,
  alternarAtivo,
  contarAdminsAtivos,
  definirSetoresDoAtendente,
  listarSetoresDoAtendente,
} = require('../atendentes');
const { listarSetores } = require('../setores');
const { CHAVES, ROTULOS, listaPermissoes, permissoesPadraoAtendente } = require('../permissoes');
const { estaOnline } = require('../presenca');

function dadosComuns(req) {
  return { atendenteLogado: req.atendente, chavesPermissao: CHAVES, rotulosPermissao: ROTULOS };
}

router.get('/', (req, res) => {
  const atendentes = listarAtendentes().map((a) => ({ ...a, online: estaOnline(a.id) }));
  res.render('atendentes/lista', { ...dadosComuns(req), atendentes });
});

router.get('/novo', (req, res) => {
  res.render('atendentes/form', {
    ...dadosComuns(req),
    alvo: null,
    setoresDoAlvo: [],
    permissoesDoAlvo: permissoesPadraoAtendente(),
    setores: listarSetores(),
    erro: null,
  });
});

router.post('/', (req, res) => {
  const { nome, email, senha } = req.body;
  // atendente comum com permissão de gerenciar atendentes não pode criar outro admin
  const papel = req.atendente.papel === 'admin' ? req.body.papel : 'atendente';
  const setorIds = [].concat(req.body.setores || []).map(Number);
  const permissoes = [].concat(req.body.permissoes || []);

  if (!nome || !email || !senha || !papel) {
    return res.render('atendentes/form', {
      ...dadosComuns(req),
      alvo: null,
      setoresDoAlvo: setorIds,
      permissoesDoAlvo: permissoes,
      setores: listarSetores(),
      erro: 'Preencha todos os campos obrigatórios.',
    });
  }
  if (obterAtendentePorEmail(email)) {
    return res.render('atendentes/form', {
      ...dadosComuns(req),
      alvo: null,
      setoresDoAlvo: setorIds,
      permissoesDoAlvo: permissoes,
      setores: listarSetores(),
      erro: 'Já existe um atendente com esse e-mail.',
    });
  }

  const novo = criarAtendente({ nome, email, senha, papel, permissoes });
  definirSetoresDoAtendente(novo.id, setorIds);
  res.redirect('/painel/atendentes');
});

router.get('/:id/editar', (req, res) => {
  const alvo = obterAtendentePorId(Number(req.params.id));
  if (!alvo) return res.redirect('/painel/atendentes');
  res.render('atendentes/form', {
    ...dadosComuns(req),
    alvo,
    setoresDoAlvo: listarSetoresDoAtendente(alvo.id).map((s) => s.id),
    permissoesDoAlvo: listaPermissoes(alvo),
    setores: listarSetores(),
    erro: null,
  });
});

router.post('/:id', (req, res) => {
  const id = Number(req.params.id);
  const alvoAtual = obterAtendentePorId(id);
  if (!alvoAtual) return res.redirect('/painel/atendentes');

  // só admin pode promover alguém a admin, editar quem já é admin, ou mudar as permissões de
  // outro atendente (senão um atendente com "gerenciar atendentes" poderia se auto-promover)
  if (req.atendente.papel !== 'admin' && (alvoAtual.papel === 'admin' || req.body.papel === 'admin')) {
    return res.status(403).send('Só um administrador pode gerenciar contas de administrador.');
  }

  const { nome, senha } = req.body;
  const papel = req.atendente.papel === 'admin' ? req.body.papel : alvoAtual.papel;
  const ativo = req.body.ativo === 'on';
  const setorIds = [].concat(req.body.setores || []).map(Number);
  const permissoesSubmetidas = req.atendente.papel === 'admin' ? [].concat(req.body.permissoes || []) : listaPermissoes(alvoAtual);

  const eraAdminAtivo = alvoAtual.papel === 'admin' && alvoAtual.ativo;
  const continuaAdminAtivo = papel === 'admin' && ativo;
  if (eraAdminAtivo && !continuaAdminAtivo && contarAdminsAtivos(id) === 0) {
    return res.render('atendentes/form', {
      ...dadosComuns(req),
      alvo: alvoAtual,
      setoresDoAlvo: setorIds,
      permissoesDoAlvo: permissoesSubmetidas,
      setores: listarSetores(),
      erro: 'Não é possível remover o último administrador ativo do sistema.',
    });
  }

  atualizarAtendente(id, { nome, papel, ativo, novaSenha: senha || null, permissoes: permissoesSubmetidas });
  definirSetoresDoAtendente(id, setorIds);
  res.redirect('/painel/atendentes');
});

router.post('/:id/alternar-ativo', (req, res) => {
  const id = Number(req.params.id);
  const alvo = obterAtendentePorId(id);
  if (!alvo) return res.redirect('/painel/atendentes');

  if (alvo.papel === 'admin' && alvo.ativo && contarAdminsAtivos(id) === 0) {
    return res.status(400).send('Não é possível desativar o último administrador ativo do sistema.');
  }

  alternarAtivo(id);
  res.redirect('/painel/atendentes');
});

module.exports = router;

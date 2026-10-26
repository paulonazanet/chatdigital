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
const { listarSetores, janelasDoFormulario } = require('../setores');
const { CHAVES, ROTULOS, listaPermissoes, permissoesPadraoAtendente } = require('../permissoes');
const { estaOnline } = require('../presenca');
const { situacaoDaEquipe } = require('../equipe');
const grupos = require('../grupos-permissao');
const acesso = require('../acesso');
const { horarioDoCorpo, horarioDasJanelas } = require('../horario');
const { formatarDataHoraCompleta } = require('../relatorio');

function dadosComuns(req) {
  return { atendenteLogado: req.atendente, chavesPermissao: CHAVES, rotulosPermissao: ROTULOS, grupos: grupos.listarGrupos() };
}

// o que o formulário precisa pra (re)mostrar o cadastro; `corpo` = o que foi digitado, quando volta com erro
function dadosDoFormulario(req, alvo, { corpo = null, erro = null } = {}) {
  const setoresDoAlvo = corpo ? [].concat(corpo.setores || []).map(Number) : alvo ? listarSetoresDoAtendente(alvo.id).map((s) => s.id) : [];
  const permissoesDoAlvo = corpo ? [].concat(corpo.permissoes || []) : alvo ? listaPermissoes(alvo) : permissoesPadraoAtendente();
  return {
    ...dadosComuns(req),
    alvo,
    setoresDoAlvo,
    permissoesDoAlvo,
    setores: listarSetores(),
    grupoDoAlvo: corpo ? Number(corpo.grupo_id) || null : alvo ? alvo.grupo_id || null : null,
    acessoPorDia: corpo ? horarioDoCorpo(corpo) : horarioDasJanelas(acesso.janelasDeAcesso(alvo)),
    acessoIps: corpo ? String(corpo.acesso_ips || '') : alvo ? alvo.acesso_ips || '' : '',
    limiteDigitado: corpo ? corpo.limite_conversas : undefined,
    erro,
  };
}

// grupo, horário e IPs de acesso: só o administrador mexe (como nas permissões)
function lerAcessoDoFormulario(req) {
  if (req.atendente.papel !== 'admin') return { campos: {} };
  const { janelas, erro } = janelasDoFormulario(horarioDoCorpo(req.body));
  if (erro) return { erro: `Horário de acesso: ${erro}` };
  const grupoId = Number(req.body.grupo_id) || null;
  return { campos: { grupoId: grupoId && grupos.obterGrupo(grupoId) ? grupoId : null, acessoHorario: janelas, acessoIps: req.body.acesso_ips || '' } };
}

router.get('/', (req, res) => {
  const situacoes = new Map(situacaoDaEquipe().map((p) => [p.id, p]));
  const nomesDosGrupos = new Map(grupos.listarGrupos().map((g) => [g.id, g.nome]));
  const atendentes = listarAtendentes().map((a) => ({
    ...a,
    online: estaOnline(a.id),
    situacao: situacoes.get(a.id) || null,
    grupoNome: a.grupo_id ? nomesDosGrupos.get(a.grupo_id) || null : null,
    restricoes: [acesso.resumoDoHorario(a) ? `horário: ${acesso.resumoDoHorario(a)}` : '', acesso.ipsPermitidos(a).length ? 'IP liberado' : ''].filter(Boolean).join(' · '),
  }));
  res.render('atendentes/lista', { ...dadosComuns(req), atendentes });
});

router.get('/novo', (req, res) => {
  res.render('atendentes/form', dadosDoFormulario(req, null));
});

router.post('/', (req, res) => {
  const { nome, email, senha } = req.body;
  // atendente comum com permissão de gerenciar atendentes não pode criar outro admin
  const papel = req.atendente.papel === 'admin' ? req.body.papel : 'atendente';
  const setorIds = [].concat(req.body.setores || []).map(Number);
  const permissoes = [].concat(req.body.permissoes || []);
  const reexibir = (erro) => res.render('atendentes/form', dadosDoFormulario(req, null, { corpo: req.body, erro }));

  if (!nome || !email || !senha || !papel) return reexibir('Preencha todos os campos obrigatórios.');
  if (obterAtendentePorEmail(email)) return reexibir('Já existe um atendente com esse e-mail.');
  const lido = lerAcessoDoFormulario(req);
  if (lido.erro) return reexibir(lido.erro);

  const novo = criarAtendente({ nome, email, senha, papel, permissoes, limiteConversas: req.body.limite_conversas, ...lido.campos });
  definirSetoresDoAtendente(novo.id, setorIds);
  res.redirect('/painel/atendentes');
});

// ---- Grupos de permissão (antes de /:id) ----
function renderizarGrupos(req, res, { erro = null, editando = null } = {}) {
  res.render('atendentes/grupos', { ...dadosComuns(req), erro, editando, salvo: !!req.query.salvo });
}
function soAdmin(req, res, next) {
  if (req.atendente.papel !== 'admin') return res.status(403).send('Só um administrador mexe nos grupos de permissão.');
  next();
}
router.get('/grupos', (req, res) => renderizarGrupos(req, res));
router.post('/grupos', soAdmin, (req, res) => {
  const resultado = grupos.criarGrupo(req.body.nome, [].concat(req.body.permissoes || []));
  if (resultado.erro) return renderizarGrupos(req, res, { erro: resultado.erro });
  res.redirect('/painel/atendentes/grupos?salvo=1');
});
router.post('/grupos/:id', soAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!grupos.obterGrupo(id)) return res.redirect('/painel/atendentes/grupos');
  const resultado = grupos.atualizarGrupo(id, req.body.nome, [].concat(req.body.permissoes || []));
  if (resultado.erro) return renderizarGrupos(req, res, { erro: resultado.erro, editando: id });
  res.redirect('/painel/atendentes/grupos?salvo=1');
});
router.post('/grupos/:id/excluir', soAdmin, (req, res) => {
  grupos.excluirGrupo(Number(req.params.id));
  res.redirect('/painel/atendentes/grupos');
});

// ---- Histórico de acessos ----
router.get('/acessos', (req, res) => {
  const atendentes = listarAtendentes();
  const atendenteId = atendentes.some((a) => String(a.id) === req.query.atendente) ? Number(req.query.atendente) : null;
  const lista = acesso.listarAcessos({ atendenteId }).map((x) => ({ ...x, quando: formatarDataHoraCompleta(x.criado_em) }));
  res.render('atendentes/acessos', { ...dadosComuns(req), atendentes, atendenteId, acessos: lista, dias: acesso.DIAS_GUARDADOS });
});

router.get('/:id/editar', (req, res) => {
  const alvo = obterAtendentePorId(Number(req.params.id));
  if (!alvo) return res.redirect('/painel/atendentes');
  res.render('atendentes/form', dadosDoFormulario(req, alvo));
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
  const reexibir = (erro) => res.render('atendentes/form', dadosDoFormulario(req, alvoAtual, { corpo: req.body, erro }));

  const eraAdminAtivo = alvoAtual.papel === 'admin' && alvoAtual.ativo;
  const continuaAdminAtivo = papel === 'admin' && ativo;
  if (eraAdminAtivo && !continuaAdminAtivo && contarAdminsAtivos(id) === 0) {
    return reexibir('Não é possível remover o último administrador ativo do sistema.');
  }
  const lido = lerAcessoDoFormulario(req);
  if (lido.erro) return reexibir(lido.erro);

  atualizarAtendente(id, {
    nome,
    papel,
    ativo,
    novaSenha: senha || null,
    permissoes: permissoesSubmetidas,
    limiteConversas: req.body.limite_conversas,
    ...lido.campos,
  });
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

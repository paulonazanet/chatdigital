const { obterAtendentePorId } = require('./atendentes');
const { temPermissao } = require('./permissoes');
const { verificarAcesso, registrarAcesso } = require('./acesso');

const DURACAO_COOKIE_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

// em produção o cookie de login só trafega por HTTPS (secure) — em http://localhost não daria
// pra logar se fosse sempre assim
function opcoesDoCookie() {
  return { signed: true, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' };
}

function definirSessao(res, atendenteId) {
  res.cookie('sessao', String(atendenteId), { ...opcoesDoCookie(), maxAge: DURACAO_COOKIE_MS });
}

function limparSessao(res) {
  res.clearCookie('sessao', opcoesDoCookie());
}

function carregarAtendenteLogado(req, res, next) {
  req.atendente = null;
  const id = req.signedCookies.sessao;
  if (id) {
    const atendente = obterAtendentePorId(Number(id));
    if (atendente && atendente.ativo) {
      // horário de acesso acabou (ou mudou de IP não liberado): desconecta e volta pro login
      const acesso = verificarAcesso(atendente, { ip: req.ip });
      if (acesso.ok) {
        req.atendente = atendente;
      } else {
        limparSessao(res);
        registrarAcesso({ atendenteId: atendente.id, email: atendente.email, evento: 'desconectado', detalhe: acesso.motivo, req });
        req.acessoNegado = acesso.motivo;
      }
    }
  }
  next();
}

function exigirLogin(req, res, next) {
  if (!req.atendente) return res.redirect(req.acessoNegado ? '/login?fora=1' : '/login');
  next();
}

function exigirPermissao(chave) {
  return (req, res, next) => {
    if (!temPermissao(req.atendente, chave)) {
      return res.status(403).send('Você não tem permissão para acessar esta área.');
    }
    next();
  };
}

module.exports = {
  definirSessao,
  limparSessao,
  carregarAtendenteLogado,
  exigirLogin,
  exigirPermissao,
};

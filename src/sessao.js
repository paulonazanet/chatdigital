const { obterAtendentePorId } = require('./atendentes');

const DURACAO_COOKIE_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

function definirSessao(res, atendenteId) {
  res.cookie('sessao', String(atendenteId), {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: DURACAO_COOKIE_MS,
  });
}

function limparSessao(res) {
  res.clearCookie('sessao');
}

function carregarAtendenteLogado(req, res, next) {
  req.atendente = null;
  const id = req.signedCookies.sessao;
  if (id) {
    const atendente = obterAtendentePorId(Number(id));
    if (atendente && atendente.ativo) req.atendente = atendente;
  }
  next();
}

function exigirLogin(req, res, next) {
  if (!req.atendente) return res.redirect('/login');
  next();
}

function exigirAdmin(req, res, next) {
  if (!req.atendente || req.atendente.papel !== 'admin') {
    return res.status(403).send('Acesso restrito a administradores.');
  }
  next();
}

module.exports = { definirSessao, limparSessao, carregarAtendenteLogado, exigirLogin, exigirAdmin };

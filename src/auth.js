const crypto = require('crypto');

function gerarHashSenha(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, sal, 64).toString('hex');
  return `${sal}:${hash}`;
}

function conferirSenha(senha, senhaHash) {
  const [sal, hash] = senhaHash.split(':');
  const hashTentativa = crypto.scryptSync(senha, sal, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(hashTentativa, 'hex'));
}

module.exports = { gerarHashSenha, conferirSenha };

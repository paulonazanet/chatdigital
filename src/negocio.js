const fs = require('fs');
const path = require('path');

function carregarNegocio() {
  const caminho = path.join(__dirname, '..', 'config', 'negocio.json');
  return JSON.parse(fs.readFileSync(caminho, 'utf8'));
}

module.exports = { carregarNegocio };

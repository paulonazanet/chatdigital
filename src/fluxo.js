const fs = require('fs');
const path = require('path');

function carregarFluxo() {
  const caminho = path.join(__dirname, '..', 'config', 'fluxo.json');
  return JSON.parse(fs.readFileSync(caminho, 'utf8'));
}

module.exports = { carregarFluxo };

const fs = require('fs');
const path = require('path');

function caminhoArquivo() {
  return process.env.CHATDIGITAL_NEGOCIO || path.join(__dirname, '..', 'config', 'negocio.json');
}

function carregarNegocio() {
  return JSON.parse(fs.readFileSync(caminhoArquivo(), 'utf8'));
}

/**
 * Atualiza só os campos "de configuração" (textos e dados de contato) do negocio.json, mantendo
 * produtos/faq como estão (essa tela ainda não edita produtos/FAQ — fica pra depois).
 */
function salvarConfiguracoes(campos) {
  const atual = carregarNegocio();
  const atualizado = {
    ...atual,
    nome: campos.nome,
    horario_funcionamento: campos.horario_funcionamento,
    endereco: campos.endereco,
    formas_pagamento: campos.formas_pagamento,
    mensagem_boas_vindas_atendente: campos.mensagem_boas_vindas_atendente,
    mensagem_encerramento: campos.mensagem_encerramento,
    pesquisa_satisfacao: campos.pesquisa_satisfacao,
  };
  fs.writeFileSync(caminhoArquivo(), JSON.stringify(atualizado, null, 2) + '\n', 'utf8');
  return atualizado;
}

module.exports = { carregarNegocio, salvarConfiguracoes };

const fs = require('fs');
const path = require('path');

function caminhoArquivo() {
  return process.env.CHATDIGITAL_NEGOCIO || path.join(__dirname, '..', 'config', 'negocio.json');
}

// Valores usados quando o negocio.json ainda não tem o campo (instalações de antes dele existir).
const PADROES = {
  fila_minutos_amarelo: 0, // bolinha da fila fica amarela assim que o cliente escreve...
  fila_minutos_vermelho: 10, // ...e vermelha depois de 10 min sem resposta
};

function carregarNegocio() {
  return { ...PADROES, ...JSON.parse(fs.readFileSync(caminhoArquivo(), 'utf8')) };
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
    mensagem_sem_atendente_disponivel: campos.mensagem_sem_atendente_disponivel,
    mensagem_inatividade: campos.mensagem_inatividade,
    mensagem_avaliacao_nao_respondida: campos.mensagem_avaliacao_nao_respondida,
    fila_minutos_amarelo: campos.fila_minutos_amarelo,
    fila_minutos_vermelho: campos.fila_minutos_vermelho,
  };
  fs.writeFileSync(caminhoArquivo(), JSON.stringify(atualizado, null, 2) + '\n', 'utf8');
  return atualizado;
}

module.exports = { carregarNegocio, salvarConfiguracoes };

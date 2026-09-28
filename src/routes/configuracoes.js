const express = require('express');
const router = express.Router();

const { carregarNegocio, salvarConfiguracoes } = require('../negocio');

function paraFormasPagamentoArray(texto) {
  return String(texto || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

router.get('/', (req, res) => {
  res.render('configuracoes/editar', { atendenteLogado: req.atendente, negocio: carregarNegocio(), erro: null, salvo: false });
});

router.post('/', (req, res) => {
  const { nome, horario_funcionamento, endereco, formas_pagamento, mensagem_boas_vindas_atendente, mensagem_encerramento, pesquisa_satisfacao } =
    req.body;

  if (!nome || !nome.trim()) {
    return res.render('configuracoes/editar', {
      atendenteLogado: req.atendente,
      negocio: { ...carregarNegocio(), ...req.body, formas_pagamento: paraFormasPagamentoArray(formas_pagamento) },
      erro: 'O nome do negócio é obrigatório.',
      salvo: false,
    });
  }

  const negocio = salvarConfiguracoes({
    nome: nome.trim(),
    horario_funcionamento: (horario_funcionamento || '').trim(),
    endereco: (endereco || '').trim(),
    formas_pagamento: paraFormasPagamentoArray(formas_pagamento),
    mensagem_boas_vindas_atendente: (mensagem_boas_vindas_atendente || '').trim(),
    mensagem_encerramento: (mensagem_encerramento || '').trim(),
    pesquisa_satisfacao: (pesquisa_satisfacao || '').trim(),
  });

  res.render('configuracoes/editar', { atendenteLogado: req.atendente, negocio, erro: null, salvo: true });
});

module.exports = router;

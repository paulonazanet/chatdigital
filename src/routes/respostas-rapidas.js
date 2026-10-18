const express = require('express');
const router = express.Router();

const respostas = require('../respostas-rapidas');
const { listarSetores } = require('../setores');

// Variáveis que o atendente pode pôr no texto (botões do formulário). Trocadas na hora em que a
// resposta aparece na conversa (ver contextoDaConversa em routes/fila.js).
const VARIAVEIS = [
  ['{{saudacao}}', 'Saudação (bom dia/tarde/noite)'],
  ['{{cliente.nome}}', 'Nome do cliente'],
  ['{{cliente.telefone}}', 'Telefone do cliente'],
  ['{{atendente.nome}}', 'Seu nome'],
  ['{{atendimento.protocolo}}', 'Protocolo'],
  ['{{setor.nome}}', 'Setor'],
  ['{{negocio.nome}}', 'Nome do negócio'],
  ['{{negocio.horario_funcionamento}}', 'Horário'],
  ['{{negocio.endereco}}', 'Endereço'],
  ['{{negocio.formas_pagamento}}', 'Formas de pagamento'],
];

function lerFormulario(corpo) {
  const setoresValidos = new Set(listarSetores().map((s) => s.id));
  const marcados = [].concat(corpo.setores || []).map(Number).filter((id) => setoresValidos.has(id));
  return {
    nome: String(corpo.nome || '').trim(),
    texto: String(corpo.texto || '').replace(/\r\n/g, '\n').trim(),
    expira_em: String(corpo.expira_em || '').trim(),
    ativa: !!corpo.ativa,
    setores: marcados,
  };
}

function renderizarLista(req, res, extra = {}) {
  res.render('respostas-rapidas/lista', {
    atendenteLogado: req.atendente,
    respostas: respostas.listarRespostas(),
    setores: listarSetores(),
    ...extra,
  });
}

function renderizarForm(req, res, resposta, erro = null) {
  res.render('respostas-rapidas/form', {
    atendenteLogado: req.atendente,
    resposta,
    setores: listarSetores(),
    variaveis: VARIAVEIS,
    erro,
  });
}

router.get('/', (req, res) => renderizarLista(req, res));

router.get('/nova', (req, res) => renderizarForm(req, res, { nome: '', texto: '', expira_em: '', ativa: 1, setores: [] }));

router.get('/:id', (req, res) => {
  const resposta = respostas.obterResposta(Number(req.params.id));
  if (!resposta) return res.redirect('/painel/respostas-rapidas');
  renderizarForm(req, res, resposta);
});

router.post('/', (req, res) => {
  const dados = lerFormulario(req.body);
  const erro = respostas.validar(dados);
  if (erro) return renderizarForm(req, res, dados, erro);
  respostas.salvarResposta(null, dados, req.atendente.id);
  res.redirect('/painel/respostas-rapidas');
});

router.post('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!respostas.obterResposta(id)) return res.redirect('/painel/respostas-rapidas');
  const dados = lerFormulario(req.body);
  const erro = respostas.validar(dados);
  if (erro) return renderizarForm(req, res, { ...dados, id }, erro);
  respostas.salvarResposta(id, dados);
  res.redirect('/painel/respostas-rapidas');
});

router.post('/:id/duplicar', (req, res) => {
  const original = respostas.obterResposta(Number(req.params.id));
  if (original) {
    respostas.salvarResposta(null, { ...original, nome: `${original.nome} (cópia)`, ativa: original.ativa }, req.atendente.id);
  }
  res.redirect('/painel/respostas-rapidas');
});

router.post('/:id/excluir', (req, res) => {
  respostas.excluirResposta(Number(req.params.id));
  res.redirect('/painel/respostas-rapidas');
});

module.exports = router;

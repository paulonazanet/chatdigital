const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');

const { carregarNegocio, salvarConfiguracoes } = require('../negocio');
const whatsappStatus = require('../whatsapp-status');
const { listarSetores } = require('../setores');

function paraFormasPagamentoArray(texto) {
  return String(texto || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Campos de texto das mensagens automáticas. Campo que não veio no envio (formulário antigo ainda
// aberto numa aba) mantém o valor atual em vez de virar vazio.
const CAMPOS_DE_TEXTO = [
  'horario_funcionamento',
  'endereco',
  'mensagem_boas_vindas_atendente',
  'mensagem_encerramento',
  'pesquisa_satisfacao',
  'mensagem_sem_atendente_disponivel',
  'mensagem_inatividade',
  'mensagem_avaliacao_nao_respondida',
  'mensagem_inatividade_transferencia',
  'mensagem_fechamento_automatico',
];

// Números inteiros das configurações de tempo: [campo, mínimo, máximo, nome pra mensagem de erro]
const CAMPOS_NUMERICOS = [
  ['fila_minutos_amarelo', 0, 1440, 'Os tempos da fila'],
  ['fila_minutos_vermelho', 0, 1440, 'Os tempos da fila'],
  ['inatividade_minutos_lembrete', 1, 1440, 'Os tempos de inatividade'],
  ['inatividade_minutos_limite', 1, 1440, 'Os tempos de inatividade'],
  ['fechamento_automatico_horas', 0, 720, 'As horas do fechamento automático'],
];

function renderizar(req, res, extra) {
  res.render('configuracoes/editar', { atendenteLogado: req.atendente, setores: listarSetores(), erro: null, salvo: false, ...extra });
}

router.get('/', (req, res) => renderizar(req, res, { negocio: carregarNegocio() }));

router.post('/', (req, res) => {
  const atual = carregarNegocio();
  const corpo = req.body;
  const campos = { formas_pagamento: corpo.formas_pagamento === undefined ? atual.formas_pagamento : paraFormasPagamentoArray(corpo.formas_pagamento) };
  for (const campo of CAMPOS_DE_TEXTO) {
    campos[campo] = corpo[campo] === undefined ? atual[campo] : String(corpo[campo]).trim();
  }

  let erro = !corpo.nome || !corpo.nome.trim() ? 'O nome do negócio é obrigatório.' : null;
  for (const [campo, minimo, maximo, rotulo] of CAMPOS_NUMERICOS) {
    const valor = corpo[campo] === undefined ? atual[campo] : Number(corpo[campo]);
    if (!erro && (!Number.isInteger(valor) || valor < minimo || valor > maximo)) {
      erro = `${rotulo} precisam ser números inteiros entre ${minimo} e ${maximo}.`;
    }
    campos[campo] = valor;
  }
  if (!erro && campos.fila_minutos_vermelho < campos.fila_minutos_amarelo) {
    erro = 'O tempo da bolinha vermelha não pode ser menor que o da amarela.';
  }
  if (!erro && campos.inatividade_minutos_limite <= campos.inatividade_minutos_lembrete) {
    erro = 'O tempo pra desistir tem que ser maior que o tempo do lembrete de inatividade.';
  }

  campos.inatividade_acao = corpo.inatividade_acao === undefined ? atual.inatividade_acao : corpo.inatividade_acao === 'transferir' ? 'transferir' : 'reiniciar';
  if (corpo.inatividade_setor_id === undefined) {
    campos.inatividade_setor_id = atual.inatividade_setor_id;
  } else {
    const setor = corpo.inatividade_setor_id ? listarSetores().find((s) => String(s.id) === String(corpo.inatividade_setor_id)) : null;
    campos.inatividade_setor_id = setor ? setor.id : null;
  }

  if (erro) {
    return renderizar(req, res, { negocio: { ...atual, ...corpo, formas_pagamento: campos.formas_pagamento }, erro });
  }
  const negocio = salvarConfiguracoes({ nome: corpo.nome.trim(), ...campos });
  renderizar(req, res, { negocio, salvo: true });
});

router.get('/whatsapp', (req, res) => {
  const { conectado, qr } = whatsappStatus.obterEstado();
  res.render('configuracoes/whatsapp', { atendenteLogado: req.atendente, conectado, temQr: !!qr });
});

// Imagem do QR Code atual, gerada a partir da string que o Baileys manda — sem cache, porque o
// QR muda (o WhatsApp expira e reenvia um novo) toda vez que o painel recarrega essa tag <img>.
router.get('/whatsapp/qr.png', async (req, res) => {
  const { qr } = whatsappStatus.obterEstado();
  if (!qr) return res.status(404).end();

  res.set('Cache-Control', 'no-store');
  try {
    const png = await QRCode.toBuffer(qr, { width: 320, margin: 1 });
    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch (erro) {
    console.error('Falha ao gerar imagem do QR Code:', erro);
    res.status(500).end();
  }
});

module.exports = router;

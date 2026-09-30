const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');

const { carregarNegocio, salvarConfiguracoes } = require('../negocio');
const whatsappStatus = require('../whatsapp-status');

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
  const {
    nome,
    horario_funcionamento,
    endereco,
    formas_pagamento,
    mensagem_boas_vindas_atendente,
    mensagem_encerramento,
    pesquisa_satisfacao,
    mensagem_sem_atendente_disponivel,
    mensagem_inatividade,
    mensagem_avaliacao_nao_respondida,
    fila_minutos_amarelo,
    fila_minutos_vermelho,
  } = req.body;

  // campo ausente no envio (ex.: formulário antigo ainda aberto numa aba) mantém o valor atual
  const atual = carregarNegocio();
  const minutosAmarelo = fila_minutos_amarelo === undefined ? atual.fila_minutos_amarelo : Number(fila_minutos_amarelo);
  const minutosVermelho = fila_minutos_vermelho === undefined ? atual.fila_minutos_vermelho : Number(fila_minutos_vermelho);
  const erroMinutos = [minutosAmarelo, minutosVermelho].some((m) => !Number.isInteger(m) || m < 0 || m > 1440)
    ? 'Os tempos da fila precisam ser minutos inteiros entre 0 e 1440.'
    : minutosVermelho < minutosAmarelo
      ? 'O tempo da bolinha vermelha não pode ser menor que o da amarela.'
      : null;

  const erro = !nome || !nome.trim() ? 'O nome do negócio é obrigatório.' : erroMinutos;
  if (erro) {
    return res.render('configuracoes/editar', {
      atendenteLogado: req.atendente,
      negocio: { ...carregarNegocio(), ...req.body, formas_pagamento: paraFormasPagamentoArray(formas_pagamento) },
      erro,
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
    mensagem_sem_atendente_disponivel: (mensagem_sem_atendente_disponivel || '').trim(),
    mensagem_inatividade: (mensagem_inatividade || '').trim(),
    mensagem_avaliacao_nao_respondida: (mensagem_avaliacao_nao_respondida || '').trim(),
    fila_minutos_amarelo: minutosAmarelo,
    fila_minutos_vermelho: minutosVermelho,
  });

  res.render('configuracoes/editar', { atendenteLogado: req.atendente, negocio, erro: null, salvo: true });
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

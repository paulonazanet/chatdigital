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

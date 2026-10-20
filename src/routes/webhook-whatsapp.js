const express = require('express');
const router = express.Router();

const oficial = require('../whatsapp-oficial');
const { modoAtual, obterSocket } = require('../socket-atual');
const { carregarNegocio } = require('../negocio');
const { carregarFluxoDoCanal } = require('../fluxo');
const { atualizarRecibos } = require('../envios');
const { db } = require('../db');

// Webhook da API oficial (E4): a Meta chama /webhook/whatsapp (sem login). GET = a Meta confere o
// endereço com o código de verificação; POST = mensagens e recibos, assinados com o segredo do app
// (X-Hub-Signature-256). Responde 200 na hora e trata depois (a Meta reenvia se demorar).

router.get('/', (req, res) => {
  const config = oficial.lerConfig();
  if (req.query['hub.mode'] === 'subscribe' && config.codigo_verificacao && req.query['hub.verify_token'] === config.codigo_verificacao) {
    return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
  }
  res.sendStatus(403);
});

/** Trata o que a Meta mandou (separado da rota pra dar pra testar) */
async function tratarWebhook(corpo) {
  const { tratarMensagemRecebida } = require('../bot'); // aqui: bot.js usa módulos que usam este
  const canal = obterSocket();
  const negocio = carregarNegocio();
  const fluxo = carregarFluxoDoCanal(1); // a API oficial é o número Principal
  for (const item of oficial.lerWebhook(corpo)) {
    try {
      if (item.mensagem) await tratarMensagemRecebida(canal, item.mensagem, negocio, fluxo);
      else if (item.recibo) atualizarRecibos([item.recibo]);
      else if (item.falha) {
        // mensagem que a Meta não entregou: fica com o aviso e o botão Reenviar no histórico
        db.prepare('UPDATE mensagens SET falha = 1 WHERE wa_id = ?').run(item.falha.id);
        db.prepare("UPDATE envios SET status = 'falhou', motivo = ? WHERE wa_id = ?").run(item.falha.motivo.slice(0, 200), item.falha.id);
      }
    } catch (erro) {
      console.error('Erro ao tratar o webhook da API oficial:', erro.message);
    }
  }
}

router.post('/', express.raw({ type: 'application/json', limit: '2mb' }), (req, res) => {
  const bruto = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!oficial.conferirAssinatura(bruto, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  res.sendStatus(200);
  if (modoAtual() !== 'oficial') return; // configurado mas o sistema está ligado pelo celular
  let corpo;
  try {
    corpo = JSON.parse(bruto.toString('utf8'));
  } catch (erro) {
    return;
  }
  tratarWebhook(corpo).catch((erro) => console.error('Erro no webhook da API oficial:', erro.message));
});

module.exports = { router, tratarWebhook };

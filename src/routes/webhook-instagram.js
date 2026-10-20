const express = require('express');
const router = express.Router();

const instagram = require('../instagram');
const { obterSocket } = require('../socket-atual');
const { carregarNegocio } = require('../negocio');
const { canalInstagram } = require('../canais');
const { definirNumeroExibicao } = require('../conversas');
const { db } = require('../db');

// Webhook do Instagram (E4): a Meta chama /webhook/instagram (sem login). GET = a Meta confere o
// endereço com o código de verificação; POST = mensagens e reações do Direct, assinadas com o
// segredo do app (X-Hub-Signature-256). Responde 200 na hora e trata depois.

router.get('/', (req, res) => {
  const config = instagram.lerConfig();
  if (req.query['hub.mode'] === 'subscribe' && config.codigo_verificacao && req.query['hub.verify_token'] === config.codigo_verificacao) {
    return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
  }
  res.sendStatus(403);
});

/** Trata o que a Meta mandou (separado da rota pra dar pra testar) */
async function tratarWebhook(corpo) {
  const { tratarMensagemRecebida } = require('../bot'); // aqui: bot.js usa módulos que usam este
  const canal = canalInstagram();
  if (!canal || !canal.ativo || !instagram.configurado()) return; // desligado em Configurações › Instagram
  const negocio = carregarNegocio();
  const fluxo = require('../fluxo').carregarFluxoDoCanal(canal.id);
  for (const item of instagram.lerWebhook(corpo)) {
    try {
      const numero = item.mensagem.key.remoteJid;
      // nome e @ do perfil só na 1a mensagem (depois o atendente pode ter corrigido o nome)
      const conhecida = db.prepare('SELECT numero_exibicao FROM conversas WHERE numero = ?').get(numero);
      const perfil = conhecida?.numero_exibicao ? null : await instagram.perfilDe(item.igsid);
      if (perfil?.nome) item.mensagem.pushName = perfil.nome;
      await tratarMensagemRecebida(obterSocket(), item.mensagem, negocio, fluxo, { canalId: canal.id });
      if (perfil?.usuario) definirNumeroExibicao(numero, `@${perfil.usuario}`);
    } catch (erro) {
      console.error('Erro ao tratar o webhook do Instagram:', erro.message);
    }
  }
}

router.post('/', express.raw({ type: 'application/json', limit: '2mb' }), (req, res) => {
  const bruto = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!instagram.conferirAssinatura(bruto, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  res.sendStatus(200);
  let corpo;
  try {
    corpo = JSON.parse(bruto.toString('utf8'));
  } catch (erro) {
    return;
  }
  tratarWebhook(corpo).catch((erro) => console.error('Erro no webhook do Instagram:', erro.message));
});

module.exports = { router, tratarWebhook };

require('dotenv').config();
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const { carregarNegocio } = require('./negocio');
const { carregarFluxo } = require('./fluxo');
const { processarMensagem } = require('./flow-engine');

const AUTH_DIR = path.join(__dirname, '..', 'auth');
const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

async function iniciar() {
  const negocio = carregarNegocio();
  const fluxo = carregarFluxo();
  if (process.env.NUMERO_ATENDENTE) {
    negocio.numero_atendente_legivel = process.env.NUMERO_ATENDENTE;
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nEscaneie este QR Code no WhatsApp do número RESERVA (Aparelhos conectados > Conectar):\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const deveReconectar =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexão fechada.', deveReconectar ? 'Reconectando...' : 'Sessão encerrada (faça login de novo).');
      if (deveReconectar) iniciar();
    } else if (connection === 'open') {
      console.log(`Bot da ${negocio.nome} conectado e pronto para atender.`);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const numero = msg.key.remoteJid;
      if (!numero || numero.endsWith('@g.us')) continue; // ignora grupos

      const texto =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';
      if (!texto) continue;

      const resposta = await processarMensagem({ numero, texto, negocio, fluxo });
      if (resposta) {
        await sock.sendMessage(numero, { text: resposta });
      }
    }
  });
}

iniciar().catch((err) => {
  console.error('Erro ao iniciar o bot:', err);
  process.exit(1);
});

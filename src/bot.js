const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const { processarMensagem } = require('./flow-engine');
const { registrarMensagem, sincronizarConversa } = require('./conversas');
const { definirSocket } = require('./socket-atual');

const AUTH_DIR = path.join(__dirname, '..', 'auth');
const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

async function iniciarBot(negocio, fluxo) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
  });
  definirSocket(sock);

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
      console.log('Conexão do WhatsApp fechada.', deveReconectar ? 'Reconectando...' : 'Sessão encerrada (escaneie o QR de novo).');
      if (deveReconectar) iniciarBot(negocio, fluxo);
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

      registrarMensagem(numero, 'cliente', texto);
      const resposta = await processarMensagem({ numero, texto, negocio, fluxo });
      sincronizarConversa(numero, fluxo);
      if (resposta) {
        registrarMensagem(numero, 'bot', resposta);
        await sock.sendMessage(numero, { text: resposta });
      }
    }
  });

  return sock;
}

module.exports = { iniciarBot };

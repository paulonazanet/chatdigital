const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const { processarMensagem, transferirParaHumano } = require('./flow-engine');
const { registrarMensagem, sincronizarConversa } = require('./conversas');
const { definirSocket } = require('./socket-atual');
const whatsappStatus = require('./whatsapp-status');

const AUTH_DIR = path.join(__dirname, '..', 'auth');
const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

const AVISO_MIDIA_NAO_SUPORTADA =
  (tipo) =>
    `Recebemos ${tipo} sua! No momento não conseguimos abrir esse tipo de arquivo automaticamente, mas um atendente já foi avisado e já já te responde por aqui. 🙂`;

function descreverMidia(mensagem) {
  if (mensagem.imageMessage) return 'a imagem';
  if (mensagem.videoMessage) return 'o vídeo';
  if (mensagem.audioMessage) return 'o áudio';
  if (mensagem.stickerMessage) return 'a figurinha';
  if (mensagem.documentMessage) return 'o documento';
  return null;
}

async function avisarSeSemAtendente(sock, numero, negocio, sincronizacao) {
  if (!sincronizacao?.semAtendenteDisponivel || !negocio.mensagem_sem_atendente_disponivel) return;
  if (await enviarComSeguranca(sock, numero, negocio.mensagem_sem_atendente_disponivel)) {
    registrarMensagem(numero, 'bot', negocio.mensagem_sem_atendente_disponivel);
  }
}

async function enviarComSeguranca(sock, numero, texto) {
  try {
    await sock.sendMessage(numero, { text: texto });
    return true;
  } catch (erro) {
    console.error(`Falha ao enviar mensagem para ${numero}:`, erro);
    return false;
  }
}

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
      console.log('\nEscaneie este QR Code no WhatsApp do número RESERVA (Aparelhos conectados > Conectar) — ou pela tela Configurações > WhatsApp do painel:\n');
      qrcode.generate(qr, { small: true });
      whatsappStatus.definirQr(qr);
    }

    if (connection === 'close') {
      const deveReconectar =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexão do WhatsApp fechada.', deveReconectar ? 'Reconectando...' : 'Sessão encerrada (escaneie o QR de novo).');
      whatsappStatus.definirDesconectado();
      if (deveReconectar) iniciarBot(negocio, fluxo);
    } else if (connection === 'open') {
      console.log(`Bot da ${negocio.nome} conectado e pronto para atender.`);
      whatsappStatus.definirConectado();
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

      if (!texto) {
        const tipoMidia = descreverMidia(msg.message);
        if (!tipoMidia) continue; // outro tipo de evento sem conteúdo processável (ex.: reação)

        registrarMensagem(numero, 'cliente', `[cliente enviou ${tipoMidia}]`);
        transferirParaHumano(numero, fluxo);
        const sincronizacao = sincronizarConversa(numero, fluxo);
        const aviso = AVISO_MIDIA_NAO_SUPORTADA(tipoMidia);
        if (await enviarComSeguranca(sock, numero, aviso)) {
          registrarMensagem(numero, 'bot', aviso);
        }
        await avisarSeSemAtendente(sock, numero, negocio, sincronizacao);
        continue;
      }

      registrarMensagem(numero, 'cliente', texto);
      const resposta = await processarMensagem({ numero, texto, negocio, fluxo });
      const sincronizacao = sincronizarConversa(numero, fluxo);
      if (resposta) {
        registrarMensagem(numero, 'bot', resposta);
        await enviarComSeguranca(sock, numero, resposta);
      }
      await avisarSeSemAtendente(sock, numero, negocio, sincronizacao);
    }
  });

  return sock;
}

module.exports = { iniciarBot };

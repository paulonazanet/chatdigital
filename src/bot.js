const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const { processarMensagem, transferirParaHumano } = require('./flow-engine');
const { registrarMensagem, sincronizarConversa, definirNumeroExibicao } = require('./conversas');
const { definirSocket } = require('./socket-atual');
const { salvarBufferDeMidia } = require('./midia');
const whatsappStatus = require('./whatsapp-status');

const AUTH_DIR = path.join(__dirname, '..', 'auth');
const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

const AVISO_MIDIA_RECEBIDA =
  (rotulo) => `Recebemos ${rotulo} sua! Um atendente já foi avisado e já já te responde por aqui. 🙂`;
const AVISO_MIDIA_NAO_SUPORTADA =
  (rotulo) =>
    `Recebemos ${rotulo} sua! No momento não conseguimos abrir esse tipo de arquivo automaticamente, mas um atendente já foi avisado e já já te responde por aqui. 🙂`;

// Só processa conversa 1:1 de verdade. `@s.whatsapp.net` é o formato clássico (número de
// telefone); `@lid` é o formato mais novo do WhatsApp (Linked ID, usado com contatos que não têm
// o número salvo/visível) — vimos isso acontecer de verdade num teste. Tudo o mais (grupos
// `@g.us`, o Status/stories em `status@broadcast`, listas de transmissão, canais `@newsletter`)
// não é uma conversa com um cliente e não deve virar atendimento.
function ehConversaDeCliente(numero) {
  return Boolean(numero) && (numero.endsWith('@s.whatsapp.net') || numero.endsWith('@lid'));
}

// Modo de teste: quando NUMEROS_TESTE está preenchido no .env (números separados por vírgula),
// o bot só responde pra esses números — todo mundo que mandar mensagem pro WhatsApp conectado
// não recebe o menu automático (o bot fica em silêncio, mas a mensagem continua chegando no
// celular normalmente, dá pra responder na mão). Útil pra testar com o número principal sem o
// fluxo aparecer pra quem não devia. Sem essa variável (produção), atende todo mundo como sempre.
function construirVerificadorNumeroPermitido(listaPermitidos) {
  return function numeroPermitido(numero, senderPn) {
    if (listaPermitidos.length === 0) return true;
    const candidato = String(senderPn || numero).replace('@s.whatsapp.net', '').replace('@lid', '');
    return listaPermitidos.some((permitido) => candidato.includes(permitido));
  };
}

const NUMEROS_TESTE = (process.env.NUMEROS_TESTE || '')
  .split(',')
  .map((n) => n.trim())
  .filter(Boolean);
const numeroPermitido = construirVerificadorNumeroPermitido(NUMEROS_TESTE);

// Imagem/vídeo/áudio (e figurinha, que é só uma imagem) a gente baixa de verdade e mostra pro
// atendente no histórico da fila. Documento em geral pode ser qualquer tipo de arquivo — mostrar/
// baixar automaticamente merece mais cuidado (segurança) do que deu pra fazer nesta rodada — mas
// PDF é comum o bastante (nota, comprovante) que vale a exceção.
const TIPOS_MIDIA_SUPORTADOS = [
  { chave: 'imageMessage', tipo: 'imagem', rotulo: 'a imagem' },
  { chave: 'videoMessage', tipo: 'video', rotulo: 'o vídeo' },
  { chave: 'audioMessage', tipo: 'audio', rotulo: 'o áudio' },
  { chave: 'stickerMessage', tipo: 'imagem', rotulo: 'a figurinha' },
];

function identificarMidia(mensagem) {
  for (const item of TIPOS_MIDIA_SUPORTADOS) {
    if (mensagem[item.chave]) return item;
  }
  if (mensagem.documentMessage) {
    // `tipo` fica null mesmo sendo PDF pra caber na coluna midia_tipo do banco (só aceita
    // imagem/video/audio) — o arquivo ainda é baixado e mostrado como link genérico no histórico
    // graças ao `baixavel` abaixo, ver routes/fila.js pro mesmo padrão do lado de enviar.
    const ehPdf = mensagem.documentMessage.mimetype === 'application/pdf';
    return { chave: 'documentMessage', tipo: null, baixavel: ehPdf, rotulo: 'o documento' };
  }
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
      if (!ehConversaDeCliente(numero)) continue; // ignora grupos, Status, canais etc.
      if (!numeroPermitido(numero, msg.key.senderPn)) continue; // modo de teste: ignora quem não está na lista

      const texto =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';

      if (!texto) {
        const midiaInfo = identificarMidia(msg.message);
        if (!midiaInfo) continue; // outro tipo de evento sem conteúdo processável (ex.: reação)

        let midiaBaixada = null;
        if (midiaInfo.tipo || midiaInfo.baixavel) {
          try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
            const mimetype = msg.message[midiaInfo.chave]?.mimetype;
            midiaBaixada = { tipo: midiaInfo.tipo, url: salvarBufferDeMidia(buffer, mimetype) };
          } catch (erro) {
            console.error(`Falha ao baixar ${midiaInfo.rotulo} de ${numero}:`, erro);
          }
        }

        registrarMensagem(numero, 'cliente', `[cliente enviou ${midiaInfo.rotulo}]`, midiaBaixada);
        if (msg.key.senderPn) definirNumeroExibicao(numero, msg.key.senderPn.replace('@s.whatsapp.net', ''));
        transferirParaHumano(numero, fluxo);
        const sincronizacao = sincronizarConversa(numero, fluxo);
        const aviso = midiaBaixada ? AVISO_MIDIA_RECEBIDA(midiaInfo.rotulo) : AVISO_MIDIA_NAO_SUPORTADA(midiaInfo.rotulo);
        if (await enviarComSeguranca(sock, numero, aviso)) {
          registrarMensagem(numero, 'bot', aviso);
        }
        await avisarSeSemAtendente(sock, numero, negocio, sincronizacao);
        continue;
      }

      registrarMensagem(numero, 'cliente', texto);
      if (msg.key.senderPn) definirNumeroExibicao(numero, msg.key.senderPn.replace('@s.whatsapp.net', ''));
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

module.exports = { iniciarBot, ehConversaDeCliente, construirVerificadorNumeroPermitido };

const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const { processarMensagem, transferirParaHumano, obterEstadoConversa, iniciarFluxo } = require('./flow-engine');
const { tratarRespostaAEnvio } = require('./resposta-envio');
const { atualizarRecibos } = require('./envios');
const { carregarFluxo } = require('./fluxo');
const {
  registrarMensagem,
  sincronizarConversa,
  definirNumeroExibicao,
  definirNomeDoPerfil,
  acharMensagemPorWaId,
  registrarReacao,
} = require('./conversas');
const { definirSocket } = require('./socket-atual');
const { situacaoDoNumero } = require('./contatos');
const { salvarBufferDeMidia } = require('./midia');
const whatsappStatus = require('./whatsapp-status');
const { numeroPermitido, construirVerificadorNumeroPermitido } = require('./modo-teste');

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

// Modo de teste (NUMEROS_TESTE no .env): regra em src/modo-teste.js, que também vale pras
// mensagens automáticas que o sistema manda sozinho.

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

// O cliente respondeu citando uma mensagem: o contextInfo vem no tipo da mensagem (texto, imagem...)
function mensagemCitada(numero, mensagem) {
  const conteudo = Object.values(mensagem).find((v) => v && typeof v === 'object' && v.contextInfo?.stanzaId);
  return conteudo ? acharMensagemPorWaId(numero, conteudo.contextInfo.stanzaId) : null;
}

async function avisarSeSemAtendente(sock, numero, negocio, sincronizacao) {
  // setor fora do horário próprio (ou feriado): manda o aviso do setor
  if (sincronizacao?.mensagemForaDoHorario) {
    if (await enviarComSeguranca(sock, numero, sincronizacao.mensagemForaDoHorario)) {
      registrarMensagem(numero, 'bot', sincronizacao.mensagemForaDoHorario);
    }
    return;
  }
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

/**
 * Trata uma mensagem que chegou do WhatsApp (cliente escreveu, mandou mídia ou reagiu). Separado do
 * evento do Baileys pra dar pra testar sem conexão de verdade.
 */
async function tratarMensagemRecebida(sock, msg, negocio, fluxo) {
  if (!msg.message || msg.key.fromMe) return;
  const numero = msg.key.remoteJid;
  if (!ehConversaDeCliente(numero)) return; // ignora grupos, Status, canais etc.
  if (!numeroPermitido(numero, msg.key.remoteJidAlt)) return; // modo de teste: ignora quem não está na lista

  // Contatos: bloqueado = nada é guardado nem respondido; ignorado = guarda no histórico, mas o
  // bot não responde e não abre atendimento (ex.: família, fornecedor)
  const situacao = situacaoDoNumero(numero);
  if (situacao === 'bloqueado') return;

  // reação do cliente (emoji numa mensagem): marca na mensagem do histórico, não abre atendimento
  if (msg.message.reactionMessage) {
    const alvo = acharMensagemPorWaId(numero, msg.message.reactionMessage.key?.id);
    if (alvo) registrarReacao(alvo.id, 'cliente', msg.message.reactionMessage.text);
    return;
  }

  const texto =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    '';
  // id no WhatsApp (pra citar/reagir depois) e a mensagem que o cliente citou, se citou
  const extra = { waId: msg.key.id, citadaId: mensagemCitada(numero, msg.message)?.id };

  if (situacao === 'ignorado') {
    const rotulo = texto ? null : identificarMidia(msg.message)?.rotulo;
    if (texto || rotulo) {
      registrarMensagem(numero, 'cliente', texto || `[cliente enviou ${rotulo}]`, null, null, { ...extra, semAtendimento: true });
    }
    return;
  }

  if (!texto) {
    const midiaInfo = identificarMidia(msg.message);
    if (!midiaInfo) return; // outro tipo de evento sem conteúdo processável (ex.: reação)

    let midiaBaixada = null;
    if (midiaInfo.tipo || midiaInfo.baixavel) {
      try {
        // API oficial (E4): a mídia vem com o próprio jeito de baixar; no celular, pelo Baileys
        const buffer = msg.baixarMidia
          ? await msg.baixarMidia()
          : await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
        const mimetype = msg.message[midiaInfo.chave]?.mimetype;
        midiaBaixada = { tipo: midiaInfo.tipo, url: salvarBufferDeMidia(buffer, mimetype) };
      } catch (erro) {
        console.error(`Falha ao baixar ${midiaInfo.rotulo} de ${numero}:`, erro);
      }
    }

    registrarMensagem(numero, 'cliente', `[cliente enviou ${midiaInfo.rotulo}]`, midiaBaixada, null, extra);
    if (msg.key.remoteJidAlt) definirNumeroExibicao(numero, msg.key.remoteJidAlt.replace('@s.whatsapp.net', ''));
    definirNomeDoPerfil(numero, msg.pushName);
    const vinhaDoBot = !obterEstadoConversa(numero, fluxo).humano;
    transferirParaHumano(numero, fluxo);
    const sincronizacao = sincronizarConversa(numero, fluxo, { vinhaDoBot });
    // o aviso só vai quando é a mídia que tira o cliente do bot; se a conversa já está com
    // atendente (aguardando ou atendendo), ele vê a mídia na tela e o aviso só alongava a
    // conversa (pedido do Carlos, 13/10)
    if (vinhaDoBot) {
      const aviso = midiaBaixada ? AVISO_MIDIA_RECEBIDA(midiaInfo.rotulo) : AVISO_MIDIA_NAO_SUPORTADA(midiaInfo.rotulo);
      if (await enviarComSeguranca(sock, numero, aviso)) {
        registrarMensagem(numero, 'bot', aviso);
      }
    }
    await avisarSeSemAtendente(sock, numero, negocio, sincronizacao);
    return;
  }

  registrarMensagem(numero, 'cliente', texto, null, null, extra);
  if (msg.key.remoteJidAlt) definirNumeroExibicao(numero, msg.key.remoteJidAlt.replace('@s.whatsapp.net', ''));
  definirNomeDoPerfil(numero, msg.pushName);
  const vinhaDoBot = !obterEstadoConversa(numero, fluxo).humano;
  // resposta a um lembrete ou campanha (E3): SAIR, passar para atendente ou frase-chave
  const automatica = tratarRespostaAEnvio(numero, texto, { negocio, fluxo });
  if (automatica?.resposta) {
    if (await enviarComSeguranca(sock, numero, automatica.resposta)) registrarMensagem(numero, 'bot', automatica.resposta);
    return;
  }
  let resposta = null;
  if (automatica?.bloco) resposta = await iniciarFluxo({ numero, negocio, fluxo, bloco: automatica.bloco });
  else if (!automatica?.transferiu) resposta = await processarMensagem({ numero, texto, negocio, fluxo });
  const sincronizacao = sincronizarConversa(numero, fluxo, { vinhaDoBot });
  if (resposta) {
    registrarMensagem(numero, 'bot', resposta);
    await enviarComSeguranca(sock, numero, resposta);
  }
  await avisarSeSemAtendente(sock, numero, negocio, sincronizacao);
}

async function iniciarBot(negocio, fluxoDoBoot) {
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
      if (deveReconectar) iniciarBot(negocio, fluxoDoBoot);
    } else if (connection === 'open') {
      console.log(`Bot da ${negocio.nome} conectado e pronto para atender.`);
      whatsappStatus.definirConectado();
    }
  });

  // recibos de entregue/lido dos envios automáticos (E3)
  sock.ev.on('messages.update', (atualizacoes) => {
    try {
      atualizarRecibos(atualizacoes);
    } catch (erro) {
      console.error('Erro ao ler recibos de leitura:', erro.message);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    // relê o fluxo a cada lote de mensagens: o editor do painel só grava o arquivo, então sem isto
    // uma edição só valeria depois de reiniciar o serviço
    let fluxo = fluxoDoBoot;
    try {
      fluxo = carregarFluxo();
    } catch (erro) {
      console.error('Não consegui reler o fluxo, usando o último carregado:', erro.message);
    }

    for (const msg of messages) {
      await tratarMensagemRecebida(sock, msg, negocio, fluxo);
    }
  });

  return sock;
}

module.exports = { iniciarBot, tratarMensagemRecebida, ehConversaDeCliente, construirVerificadorNumeroPermitido };

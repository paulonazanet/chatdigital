// Central de envio (E4): a conexão do WhatsApp, compartilhada entre o bot e as rotas do painel dentro
// do mesmo processo. Pode ser o WhatsApp do celular (Baileys, QR Code; um ou mais números, 3a parte)
// ou a API oficial da Meta (whatsapp-oficial.js). As duas têm o mesmo jeito de mandar:
// sendMessage(numero, conteudo, opcoes) devolvendo { key: { id } }, então quem manda mensagem não
// precisa saber qual é.
//
// O tipo da conexão é decidido quando o sistema liga (app.js lê Configurações > WhatsApp); trocar na
// tela só vale depois de reiniciar, pra nunca ficar recebendo por uma e mandando por outra.

// 'misto' (E4, 4a parte): números pelo celular e um número pela API oficial na mesma instalação. O
// número oficial é um canal (canais.tipo = 'oficial'); a conversa sai pelo canal por onde o cliente
// escreveu por último, e as regras da Meta (24 h, modelos, botões) valem só nas conversas dele.
const MODOS = ['celular', 'oficial', 'misto'];

const socketsCelular = new Map(); // canalId -> socket do Baileys (1 = o número "Principal")
let canalOficial = null; // adaptador da API oficial
let modoEmUso = 'celular';
let iniciadorDeCanal = null; // app.js registra como ligar um número novo sem reiniciar

function definirSocket(sock, canalId = 1) {
  if (sock) socketsCelular.set(canalId, sock);
  else socketsCelular.delete(canalId);
}

function definirCanalOficial(canal) {
  canalOficial = canal;
}

function definirModo(modo) {
  modoEmUso = MODOS.includes(modo) ? modo : 'celular';
}

function modoAtual() {
  return modoEmUso;
}

function socketDoCanal(canalId) {
  return socketsCelular.get(canalId) || null;
}

// o número da conversa (canal por onde o cliente escreveu por último)
function canalDaConversa(numero) {
  const { db } = require('./db');
  return db.prepare('SELECT canal_id FROM conversas WHERE numero = ?').get(numero)?.canal_id || null;
}

function conversaNoCanalOficial(numero) {
  const { db } = require('./db');
  return db.prepare("SELECT 1 FROM conversas c JOIN canais k ON k.id = c.canal_id WHERE c.numero = ? AND k.tipo = 'oficial'").get(numero) != null;
}

/** A instalação tem API oficial ligada (sozinha ou junto com o celular)? */
function temOficial() {
  return modoEmUso === 'oficial' || modoEmUso === 'misto';
}

/**
 * Esta conversa é pela API oficial? (regra das 24 h, modelos, botões). No modo misto, só a conversa
 * cujo cliente escreveu por último no número oficial. Instagram nunca.
 */
function usaOficial(numero) {
  if (String(numero || '').endsWith('@instagram')) return false;
  if (modoEmUso === 'oficial') return true;
  return modoEmUso === 'misto' && !!numero && conversaNoCanalOficial(numero);
}

function socketPrincipal() {
  return socketsCelular.get(1) || socketsCelular.values().next().value || null;
}

/** O celular por onde sai a mensagem pra esse cliente: o número por onde ele escreveu por último */
function socketParaNumero(numero) {
  const canal = numero ? canalDaConversa(numero) : null;
  return (canal && socketsCelular.get(canal)) || socketPrincipal();
}

// Pelo celular, quem manda mensagem recebe este "roteador": ele escolhe o celular certo pelo número
// do cliente, então os lugares que mandam mensagem não precisam saber quantos números existem.
const roteador = {
  tipo: 'celular',
  sendMessage(numero, conteudo, opcoes) {
    if (modoEmUso === 'misto' && canalOficial && conversaNoCanalOficial(numero)) return canalOficial.sendMessage(numero, conteudo, opcoes);
    const sock = socketParaNumero(numero);
    if (!sock) throw new Error('Nenhum número de WhatsApp conectado.');
    return sock.sendMessage(numero, conteudo, opcoes);
  },
  // modelo aprovado: só existe no número oficial (modo misto)
  get enviarModelo() {
    return modoEmUso === 'misto' && canalOficial ? canalOficial.enviarModelo : undefined;
  },
  onWhatsApp(...args) {
    return (socketPrincipal() || canalOficial).onWhatsApp(...args);
  },
  get signalRepository() {
    return socketPrincipal()?.signalRepository;
  },
  updateMediaMessage(...args) {
    return socketPrincipal().updateMediaMessage(...args);
  },
};

/**
 * A conexão por onde as mensagens saem agora (null se não há nenhuma). Pelo celular, o roteador acima;
 * pela API oficial, o adaptador dela.
 */
function obterSocketWhatsapp() {
  if (modoEmUso === 'oficial') return canalOficial;
  if (modoEmUso === 'misto') return socketsCelular.size || canalOficial ? roteador : null;
  return socketsCelular.size ? roteador : null;
}

// Instagram (E4): a conversa "<IGSID>@instagram" sai pelo Instagram, seja qual for a conexão do
// WhatsApp. Só entra no caminho quando o Instagram está configurado (senão nada muda).
function comInstagram(whatsapp) {
  const sendMessage = (numero, conteudo, opcoes) => {
    if (String(numero || '').endsWith('@instagram')) return require('./instagram').criarAdaptador().sendMessage(numero, conteudo, opcoes);
    if (!whatsapp) throw new Error('Nenhum número de WhatsApp conectado.');
    return whatsapp.sendMessage(numero, conteudo, opcoes);
  };
  if (!whatsapp) return { tipo: 'instagram', sendMessage };
  // o resto (enviarModelo da API oficial, onWhatsApp, signalRepository...) continua o do WhatsApp
  return new Proxy(whatsapp, { get: (alvo, nome) => (nome === 'sendMessage' ? sendMessage : alvo[nome]) });
}

function obterSocket() {
  const whatsapp = obterSocketWhatsapp();
  let instagramLigado = false;
  try {
    instagramLigado = require('./instagram').configurado();
  } catch (erro) {
    // banco ainda não carregado
  }
  return instagramLigado ? comInstagram(whatsapp) : whatsapp;
}

function definirIniciadorDeCanal(funcao) {
  iniciadorDeCanal = funcao;
}

/** Liga um número agora (Configurações > WhatsApp > Adicionar número). false se o sistema não pode (teste). */
async function ligarCanal(canal) {
  if (!iniciadorDeCanal) return false;
  await iniciadorDeCanal(canal);
  return true;
}

/** Desliga a conexão de um número (desativado na tela), sem deslogar o celular. */
function desligarCanal(canalId) {
  const sock = socketsCelular.get(canalId);
  socketsCelular.delete(canalId);
  if (sock && typeof sock.end === 'function') {
    try {
      sock.end(undefined);
    } catch (erro) {
      // já estava fechado
    }
  }
}

module.exports = {
  obterSocketWhatsapp,
  temOficial,
  usaOficial,
  definirSocket,
  definirCanalOficial,
  definirModo,
  modoAtual,
  obterSocket,
  socketDoCanal,
  socketParaNumero,
  definirIniciadorDeCanal,
  ligarCanal,
  desligarCanal,
  MODOS,
};

const crypto = require('crypto');
const { db } = require('./db');

// Instagram (Direct) pela API do Instagram com login do Instagram (graph.instagram.com), E4.
// Não precisa de página do Facebook: só a conta profissional (comercial ou de criador). Faz:
// 1. a configuração (código da conta, chave de acesso, segredo do app, endereço público do sistema);
// 2. um adaptador com o mesmo jeito de mandar do Baileys (sendMessage(numero, conteudo, opcoes)),
//    pra Fila, bot e respostas funcionarem igual;
// 3. a leitura do webhook (mensagens e reações) no formato que o bot já entende.
// A conversa usa "<IGSID>@instagram" como número. O Instagram só deixa responder até 24 h depois da
// última mensagem do cliente, e a empresa não pode começar conversa.
// Endereço da API: CHATDIGITAL_INSTAGRAM_URL (testes) ou graph.instagram.com.

const SUFIXO = '@instagram';
const ehInstagram = (numero) => String(numero || '').endsWith(SUFIXO);
const igsidDe = (numero) => String(numero || '').slice(0, -SUFIXO.length);

function lerConfig() {
  return db.prepare('SELECT * FROM instagram_config WHERE id = 1').get();
}

const configurado = (c = lerConfig()) => !!(c && c.conta_id && c.chave);

function configParaTela() {
  const c = lerConfig();
  const mascarar = (v) => (v ? `••••••••${String(v).slice(-4)}` : '');
  return { ...c, chave: mascarar(c.chave), segredo_app: mascarar(c.segredo_app), temChave: !!c.chave, temSegredo: !!c.segredo_app };
}

/** Grava (chave e segredo em branco = mantém). Devolve { erro } ou {} */
function salvarConfig(campos) {
  const atual = lerConfig();
  const limpo = (v) => String(v || '').trim();
  const contaId = limpo(campos.conta_id);
  if (contaId && !/^\d{5,30}$/.test(contaId)) return { erro: 'O código da conta do Instagram (Instagram account ID) é só números.' };
  const endereco = limpo(campos.endereco_publico).replace(/\/+$/, '');
  if (endereco && !/^https:\/\/[^\s/]+/.test(endereco)) return { erro: 'O endereço do sistema tem que começar com https:// (ex.: https://empresa.eunodigital.com).' };
  const versao = /^v\d{1,2}\.\d$/.test(limpo(campos.versao)) ? limpo(campos.versao) : atual.versao || 'v26.0';
  const novaChave = limpo(campos.chave);
  db.prepare('UPDATE instagram_config SET conta_id = ?, chave = ?, chave_renovada_em = ?, segredo_app = ?, versao = ?, endereco_publico = ? WHERE id = 1').run(
    contaId || null,
    novaChave || atual.chave,
    novaChave ? new Date().toISOString() : atual.chave_renovada_em,
    limpo(campos.segredo_app) || atual.segredo_app,
    versao,
    endereco || null,
  );
  return {};
}

// ---- Pela central do Instagram (um app só na Meta para todas as instalações) ----

const usaCentral = (c = lerConfig()) => !!(c.central_url && c.central_instalacao && c.segredo_app);

/** Grava o endereço da central, o código desta instalação e o segredo combinado. Devolve { erro } ou {} */
function salvarCentral(campos) {
  const atual = lerConfig();
  const limpo = (v) => String(v || '').trim();
  const url = limpo(campos.central_url).replace(/\/+$/, '');
  if (url && !/^https?:\/\/[^\s/]+/.test(url)) return { erro: 'O endereço da central tem que começar com https:// (ex.: https://chat.eunodigital.com).' };
  const instalacao = limpo(campos.central_instalacao);
  if (instalacao && !/^[a-z0-9-]{2,40}$/.test(instalacao)) return { erro: 'O código desta instalação na central é em letras minúsculas, números e hífen (ex.: nazagas).' };
  db.prepare('UPDATE instagram_config SET central_url = ?, central_instalacao = ?, segredo_app = ? WHERE id = 1').run(url || null, instalacao || null, limpo(campos.segredo_app) || atual.segredo_app);
  return {};
}

/** Endereço do "Entrar com Instagram": a central, com um pedido assinado que vale 10 minutos */
function linkDeConexao(agoraMs = Date.now()) {
  const c = lerConfig();
  if (!usaCentral(c)) return null;
  const { assinarPedidoDeConexao } = require('./central-instagram');
  const pedido = assinarPedidoDeConexao(c.central_instalacao, c.segredo_app, agoraMs);
  return `${c.central_url}/instagram/conectar?${new URLSearchParams(pedido)}`;
}

/** A central entregou a conta conectada (já conferida e inscrita no webhook) */
function receberContaDaCentral({ conta_id: contaId, usuario, chave, endereco_publico: endereco }) {
  if (!/^\d{5,30}$/.test(String(contaId || '')) || !chave) return { erro: 'dados incompletos' };
  const agora = new Date().toISOString();
  db.prepare('UPDATE instagram_config SET conta_id = ?, usuario = ?, chave = ?, chave_renovada_em = ?, testado_em = ?, erro = NULL, endereco_publico = COALESCE(endereco_publico, ?) WHERE id = 1').run(
    String(contaId),
    usuario || null,
    String(chave),
    agora,
    agora,
    /^https:\/\//.test(String(endereco || '')) ? String(endereco).replace(/\/+$/, '') : null,
  );
  return {};
}

/** Tira a conta (a configuração da central fica, pra conectar de novo) */
function desconectar() {
  db.prepare('UPDATE instagram_config SET conta_id = NULL, usuario = NULL, chave = NULL, chave_renovada_em = NULL, testado_em = NULL, erro = NULL WHERE id = 1').run();
}

function trocarCodigoVerificacao() {
  db.prepare('UPDATE instagram_config SET codigo_verificacao = ? WHERE id = 1').run(crypto.randomBytes(16).toString('hex'));
}

function base() {
  return (process.env.CHATDIGITAL_INSTAGRAM_URL || 'https://graph.instagram.com').replace(/\/$/, '');
}

function traduzirErro(erro) {
  const codigo = erro?.code;
  if (codigo === 190) return 'A chave de acesso do Instagram não vale mais (venceu ou foi trocada). Gere uma nova na Meta.';
  if (codigo === 10 || codigo === 200) return 'O Instagram não deu permissão para isso (confira as permissões do app na Meta e se a conta é profissional).';
  if (codigo === 551 || /24/.test(String(erro?.message || '')) && /window|janela/i.test(String(erro?.message || ''))) return 'Passaram 24 horas desde a última mensagem do cliente: pelo Instagram não dá mais para responder.';
  return erro?.message ? `O Instagram respondeu: ${erro.message}` : 'O Instagram não respondeu como esperado.';
}

async function chamarApi(metodo, caminho, { json, semVersao = false } = {}) {
  const config = lerConfig();
  if (!configurado(config)) throw new Error('O Instagram não está configurado.');
  const url = `${base()}/${semVersao ? '' : `${config.versao || 'v26.0'}/`}${caminho.replace(/^\//, '')}`;
  const resposta = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${config.chave}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(traduzirErro(dados?.error));
  return dados;
}

/** Confere a conta na Meta e guarda o @ do Instagram (ou o erro) */
async function testarConexao() {
  try {
    const dados = await chamarApi('GET', 'me?fields=user_id,username,name');
    db.prepare('UPDATE instagram_config SET usuario = ?, testado_em = ?, erro = NULL WHERE id = 1').run(dados.username || null, new Date().toISOString());
    return { ok: true, usuario: dados.username };
  } catch (erro) {
    db.prepare('UPDATE instagram_config SET testado_em = ?, erro = ? WHERE id = 1').run(new Date().toISOString(), erro.message);
    return { ok: false, erro: erro.message };
  }
}

/** A chave de longa duração vale 60 dias: renova quando tem mais de 30 (o sistema faz 1 vez por dia) */
async function renovarChaveSePrecisar(agoraMs = Date.now()) {
  const c = lerConfig();
  if (!configurado(c)) return { renovou: false };
  if (c.chave_renovada_em && agoraMs - Date.parse(c.chave_renovada_em) < 30 * 86400000) return { renovou: false };
  try {
    const dados = await chamarApi('GET', `refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(c.chave)}`, { semVersao: true });
    if (!dados.access_token) return { renovou: false };
    db.prepare('UPDATE instagram_config SET chave = ?, chave_renovada_em = ? WHERE id = 1').run(dados.access_token, new Date(agoraMs).toISOString());
    return { renovou: true };
  } catch (erro) {
    db.prepare('UPDATE instagram_config SET erro = ? WHERE id = 1').run(`Não consegui renovar a chave: ${erro.message}`);
    return { renovou: false, erro: erro.message };
  }
}

function iniciarRenovacaoDaChave() {
  const rodar = () => renovarChaveSePrecisar().catch(() => {});
  rodar();
  setInterval(rodar, 24 * 3600000).unref();
}

// O Instagram não recebe arquivo direto: precisa de um endereço público da mídia. O sistema já serve
// os arquivos enviados em /uploads, então manda o endereço público + o caminho.
function enderecoDaMidia(urlLocal) {
  const endereco = lerConfig().endereco_publico;
  if (!endereco) throw new Error('Para mandar foto, vídeo ou PDF pelo Instagram, preencha o endereço do sistema em Configurações › Instagram.');
  return `${endereco}${urlLocal}`;
}

/** Corpo da mensagem pro Instagram a partir do conteúdo no jeito do Baileys */
function montarMensagem(numero, conteudo, opcoes = {}) {
  const recipient = { id: igsidDe(numero) };
  if (conteudo.react) {
    const mid = conteudo.react.key?.id;
    return conteudo.react.text ? { recipient, sender_action: 'react', payload: { message_id: mid, reaction: conteudo.react.text } } : { recipient, sender_action: 'unreact', payload: { message_id: mid } };
  }
  const citada = opcoes?.quoted?.key?.id;
  const comCitacao = (corpo) => (citada ? { ...corpo, reply_to: { mid: citada } } : corpo);
  if (conteudo.text !== undefined) {
    // o Instagram aceita até 1000 bytes por mensagem
    const texto = Buffer.from(String(conteudo.text)).length > 1000 ? `${Buffer.from(String(conteudo.text)).subarray(0, 990).toString().replace(/�+$/, '')}…` : String(conteudo.text);
    return comCitacao({ recipient, message: { text: texto } });
  }
  if (conteudo.audio) throw new Error('Áudio gravado não vai pelo Instagram. Mande por texto.');
  const tipo = conteudo.image ? 'image' : conteudo.video ? 'video' : conteudo.document ? 'file' : null;
  if (!tipo) throw new Error('Esse tipo de mensagem não vai pelo Instagram.');
  if (!conteudo.urlLocal) throw new Error('Mídia sem arquivo salvo.');
  return comCitacao({ recipient, message: { attachment: { type: tipo, payload: { url: enderecoDaMidia(conteudo.urlLocal) } } } });
}

function criarAdaptador() {
  return {
    tipo: 'instagram',
    async sendMessage(numero, conteudo, opcoes) {
      const mandar = (corpo) => chamarApi('POST', `${lerConfig().conta_id}/messages`, { json: corpo });
      const dados = await mandar(montarMensagem(numero, conteudo, opcoes));
      // o Instagram não tem legenda em foto/vídeo/PDF: o texto vai logo depois, numa mensagem sua
      const legenda = !conteudo.text && !conteudo.react ? String(conteudo.caption || '').trim() : '';
      if (legenda) await mandar(montarMensagem(numero, { text: legenda }));
      return { key: { id: dados?.message_id || null, fromMe: true, remoteJid: numero } };
    },
  };
}

/** Nome e @ de quem escreveu (só existe depois que a pessoa mandou mensagem) */
async function perfilDe(igsid) {
  try {
    const dados = await chamarApi('GET', `${igsid}?fields=name,username`);
    return { nome: dados.name || dados.username || null, usuario: dados.username || null };
  } catch (erro) {
    return { nome: null, usuario: null };
  }
}

function conferirAssinatura(corpoBruto, cabecalho) {
  const segredo = lerConfig().segredo_app;
  if (!segredo || !cabecalho) return false;
  const esperado = `sha256=${crypto.createHmac('sha256', segredo).update(corpoBruto).digest('hex')}`;
  const a = Buffer.from(String(cabecalho));
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function baixar(url) {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error('Não consegui baixar a mídia do Instagram.');
  return Buffer.from(await resposta.arrayBuffer());
}

/**
 * Corpo do webhook → mensagens no formato do Baileys (pro bot). Ignora o eco (o que a própria conta
 * mandou) e o que não é da conta configurada. Reação vira reactionMessage.
 */
function lerWebhook(corpo) {
  const config = lerConfig();
  const saida = [];
  if (corpo?.object !== 'instagram') return saida;
  for (const entrada of corpo.entry || []) {
    if (config.conta_id && entrada.id && String(entrada.id) !== String(config.conta_id)) continue;
    for (const evento of entrada.messaging || []) {
      const de = evento.sender?.id;
      if (!de || (config.conta_id && String(de) === String(config.conta_id))) continue; // eco
      const remoteJid = `${de}${SUFIXO}`;
      const chave = { remoteJid, fromMe: false };
      if (evento.reaction) {
        saida.push({ igsid: de, mensagem: { key: { ...chave, id: `reacao-${evento.reaction.mid}-${evento.timestamp}` }, message: { reactionMessage: { key: { id: evento.reaction.mid }, text: evento.reaction.action === 'unreact' ? '' : evento.reaction.emoji || '' } } } });
        continue;
      }
      const m = evento.message;
      if (!m || m.is_echo || m.is_deleted || m.is_unsupported) continue;
      const contexto = m.reply_to?.mid ? { contextInfo: { stanzaId: m.reply_to.mid } } : {};
      let message = null;
      let urlMidia = null;
      if (m.text) message = contexto.contextInfo ? { extendedTextMessage: { text: m.text, ...contexto } } : { conversation: m.text };
      else if (m.quick_reply?.payload) message = { conversation: m.quick_reply.payload };
      else if (Array.isArray(m.attachments) && m.attachments.length) {
        const anexo = m.attachments[0];
        const tipo = { image: 'imageMessage', video: 'videoMessage', audio: 'audioMessage', file: 'documentMessage' }[anexo.type];
        if (tipo && anexo.payload?.url) {
          urlMidia = anexo.payload.url;
          message = { [tipo]: { mimetype: { image: 'image/jpeg', video: 'video/mp4', audio: 'audio/mp4', file: 'application/pdf' }[anexo.type], ...contexto } };
        } else {
          // post, reels, story compartilhados: vira texto com o link pra equipe ver
          message = { conversation: `[o cliente compartilhou ${anexo.type === 'story_mention' ? 'uma menção no story' : 'um conteúdo do Instagram'}${anexo.payload?.url ? `: ${anexo.payload.url}` : ''}]` };
        }
      }
      if (!message) continue;
      const mensagem = { key: { ...chave, id: m.mid }, message, messageTimestamp: Math.floor(Number(evento.timestamp || 0) / 1000) || undefined };
      if (urlMidia) mensagem.baixarMidia = () => baixar(urlMidia);
      saida.push({ igsid: de, mensagem });
    }
  }
  return saida;
}

module.exports = {
  SUFIXO,
  ehInstagram,
  igsidDe,
  lerConfig,
  configurado,
  configParaTela,
  salvarConfig,
  usaCentral,
  salvarCentral,
  linkDeConexao,
  receberContaDaCentral,
  desconectar,
  trocarCodigoVerificacao,
  testarConexao,
  renovarChaveSePrecisar,
  iniciarRenovacaoDaChave,
  montarMensagem,
  criarAdaptador,
  perfilDe,
  conferirAssinatura,
  lerWebhook,
};

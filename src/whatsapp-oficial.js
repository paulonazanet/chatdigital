const crypto = require('crypto');
const { db } = require('./db');

// API oficial do WhatsApp (Cloud API da Meta), E4 2a parte. Faz três coisas:
// 1. guarda a configuração (código do número, da conta, chave de acesso, segredo do app);
// 2. um "adaptador" com o mesmo jeito de mandar do Baileys (sendMessage(numero, conteudo, opcoes)
//    → { key: { id } }), pra o resto do sistema mandar mensagem sem saber qual conexão é;
// 3. traduz o que a Meta manda no webhook (mensagens e recibos) pro formato que o bot já entende.
// Endereço da API: CHATDIGITAL_META_URL (testes usam uma Meta de mentira), senão graph.facebook.com.

const VERSAO_PADRAO = 'v23.0';

function lerConfig() {
  return db.prepare('SELECT * FROM whatsapp_oficial WHERE id = 1').get();
}

const configurado = (c = lerConfig()) => !!(c && c.numero_id && c.chave);

/** Pra mostrar na tela: a chave e o segredo só com o final */
function configParaTela() {
  const c = lerConfig();
  const mascarar = (v) => (v ? `••••••••${String(v).slice(-4)}` : '');
  return { ...c, chave: mascarar(c.chave), segredo_app: mascarar(c.segredo_app), temChave: !!c.chave, temSegredo: !!c.segredo_app };
}

/** Grava os campos (chave e segredo em branco = mantém os de antes). Devolve { erro } ou {} */
function salvarConfig(campos) {
  const atual = lerConfig();
  const limpo = (v) => String(v || '').trim();
  const numeroId = limpo(campos.numero_id);
  const contaId = limpo(campos.conta_id);
  if (numeroId && !/^\d{5,25}$/.test(numeroId)) return { erro: 'O código do número (Phone number ID) é só números.' };
  if (contaId && !/^\d{5,25}$/.test(contaId)) return { erro: 'O código da conta (WhatsApp Business Account ID) é só números.' };
  const versao = /^v\d{1,2}\.\d$/.test(limpo(campos.versao)) ? limpo(campos.versao) : atual.versao || VERSAO_PADRAO;
  db.prepare('UPDATE whatsapp_oficial SET numero_id = ?, conta_id = ?, chave = ?, segredo_app = ?, versao = ? WHERE id = 1').run(
    numeroId || null,
    contaId || null,
    limpo(campos.chave) || atual.chave,
    limpo(campos.segredo_app) || atual.segredo_app,
    versao,
  );
  return {};
}

function trocarCodigoVerificacao() {
  db.prepare('UPDATE whatsapp_oficial SET codigo_verificacao = ? WHERE id = 1').run(crypto.randomBytes(16).toString('hex'));
}

function baseUrl() {
  return `${(process.env.CHATDIGITAL_META_URL || 'https://graph.facebook.com').replace(/\/$/, '')}/${lerConfig().versao || VERSAO_PADRAO}`;
}

class ErroDaMeta extends Error {
  constructor(mensagem, codigo) {
    super(mensagem);
    this.codigo = codigo;
  }
}

// Erros mais comuns em português (o resto vai com o texto da Meta)
function traduzirErro(erro) {
  const codigo = erro?.code;
  if (codigo === 190) return 'A chave de acesso não vale mais (expirou ou foi trocada). Gere uma nova na Meta.';
  if (codigo === 131047 || codigo === 131026) return 'Passaram 24 horas desde a última mensagem do cliente: só dá para mandar um modelo aprovado.';
  if (codigo === 132001) return 'Esse modelo não existe ou não está aprovado na Meta.';
  if (codigo === 131056) return 'Mensagens demais para este cliente em pouco tempo. Espere um pouco.';
  if (codigo === 100) return `A Meta não aceitou: ${erro.error_data?.details || erro.message || 'parâmetro inválido'}.`;
  return erro?.message ? `A Meta respondeu: ${erro.message}` : 'A Meta não respondeu como esperado.';
}

async function chamarApi(metodo, caminho, { json, form } = {}) {
  const config = lerConfig();
  if (!configurado(config)) throw new ErroDaMeta('A API oficial não está configurada.');
  const resposta = await fetch(`${baseUrl()}/${caminho.replace(/^\//, '')}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${config.chave}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : form,
  });
  const tipo = resposta.headers.get('content-type') || '';
  const dados = tipo.includes('json') ? await resposta.json().catch(() => ({})) : null;
  if (!resposta.ok) throw new ErroDaMeta(traduzirErro(dados?.error), dados?.error?.code);
  return dados;
}

/** Confere a configuração na Meta (número, nome verificado, qualidade) e guarda o resultado. */
async function testarConexao() {
  try {
    const config = lerConfig();
    const dados = await chamarApi('GET', `${config.numero_id}?fields=display_phone_number,verified_name,quality_rating`);
    db.prepare('UPDATE whatsapp_oficial SET numero_exibicao = ?, nome_verificado = ?, qualidade = ?, testado_em = ?, erro = NULL WHERE id = 1').run(
      dados.display_phone_number || null,
      dados.verified_name || null,
      dados.quality_rating || null,
      new Date().toISOString(),
    );
    return { ok: true, numero: dados.display_phone_number, nome: dados.verified_name, qualidade: dados.quality_rating };
  } catch (erro) {
    db.prepare('UPDATE whatsapp_oficial SET testado_em = ?, erro = ? WHERE id = 1').run(new Date().toISOString(), erro.message);
    return { ok: false, erro: erro.message };
  }
}

// "5581999990000@s.whatsapp.net" → "5581999990000" (a API oficial usa só o número)
const paraNumero = (jid) => String(jid || '').split('@')[0].replace(/\D/g, '');

async function subirMidia(buffer, mimetype, nome = 'arquivo') {
  const config = lerConfig();
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', String(mimetype).split(';')[0]);
  form.append('file', new Blob([buffer], { type: String(mimetype).split(';')[0] }), nome);
  const dados = await chamarApi('POST', `${config.numero_id}/media`, { form });
  return dados.id;
}

/** Monta o corpo da mensagem da Meta a partir do conteúdo no jeito do Baileys */
async function montarMensagem(numero, conteudo, opcoes = {}) {
  const corpo = { messaging_product: 'whatsapp', recipient_type: 'individual', to: paraNumero(numero) };
  const citada = opcoes?.quoted?.key?.id;
  if (citada) corpo.context = { message_id: citada };
  if (conteudo.react) {
    return { ...corpo, type: 'reaction', reaction: { message_id: conteudo.react.key?.id, emoji: conteudo.react.text || '' } };
  }
  if (conteudo.text !== undefined) {
    // opções do bot como botões ou lista (E4, 4a parte); se não couber, vai o texto numerado
    const interativo = conteudo.interativo && require('./opcoes-interativas').paraWhatsapp(conteudo.interativo);
    if (interativo) return { ...corpo, type: 'interactive', interactive: interativo };
    return { ...corpo, type: 'text', text: { body: String(conteudo.text), preview_url: false } };
  }
  for (const [chave, tipo, mime, nome] of [
    ['image', 'image', 'image/jpeg', 'imagem.jpg'],
    ['video', 'video', 'video/mp4', 'video.mp4'],
    ['audio', 'audio', 'audio/ogg', 'audio.ogg'],
    ['document', 'document', 'application/pdf', 'documento.pdf'],
  ]) {
    if (!conteudo[chave]) continue;
    const buffer = Buffer.isBuffer(conteudo[chave]) ? conteudo[chave] : null;
    if (!buffer) throw new ErroDaMeta('Mídia sem arquivo.');
    const id = await subirMidia(buffer, conteudo.mimetype || mime, conteudo.fileName || nome);
    const midia = { id };
    if (conteudo.caption && tipo !== 'audio') midia.caption = conteudo.caption;
    if (tipo === 'document') midia.filename = conteudo.fileName || nome;
    return { ...corpo, type: tipo, [tipo]: midia };
  }
  throw new ErroDaMeta('Tipo de mensagem que a API oficial não manda por aqui.');
}

/** Corpo do modelo com as variáveis trocadas (pra guardar no histórico) */
function textoDoModelo(modelo, parametros = []) {
  const salvo = db.prepare('SELECT corpo FROM modelos_oficiais WHERE nome = ? AND idioma = ?').get(modelo.nome, modelo.idioma);
  const corpo = salvo?.corpo || `[modelo ${modelo.nome}]`;
  return corpo.replace(/\{\{(\d+)\}\}/g, (_, n) => parametros[Number(n) - 1] ?? '');
}

async function enviarModelo(numero, { nome, idioma, parametros = [] }) {
  const config = lerConfig();
  const corpo = {
    messaging_product: 'whatsapp',
    to: paraNumero(numero),
    type: 'template',
    template: { name: nome, language: { code: idioma }, ...(parametros.length ? { components: [{ type: 'body', parameters: parametros.map((p) => ({ type: 'text', text: String(p) })) }] } : {}) },
  };
  const dados = await chamarApi('POST', `${config.numero_id}/messages`, { json: corpo });
  return { key: { id: dados?.messages?.[0]?.id || null, fromMe: true } };
}

/** O adaptador: igual ao socket do Baileys pra quem manda mensagem */
function criarAdaptador() {
  return {
    tipo: 'oficial',
    async sendMessage(numero, conteudo, opcoes) {
      const config = lerConfig();
      const corpo = await montarMensagem(numero, conteudo, opcoes);
      const dados = await chamarApi('POST', `${config.numero_id}/messages`, { json: corpo });
      return { key: { id: dados?.messages?.[0]?.id || null, fromMe: true, remoteJid: numero } };
    },
    enviarModelo,
    // a API oficial não confere se o número tem WhatsApp: considera que tem (a Meta avisa se não tiver)
    async onWhatsApp(jid) {
      return [{ exists: true, jid: `${paraNumero(jid)}@s.whatsapp.net` }];
    },
    signalRepository: null,
  };
}

// ---- Modelos (templates) ----

function variaveisDoCorpo(texto) {
  const numeros = [...String(texto || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return numeros.length ? Math.max(...numeros) : 0;
}

/** Busca na Meta os modelos da conta e guarda. Devolve { total } ou { erro } */
async function sincronizarModelos() {
  const config = lerConfig();
  if (!config.conta_id) return { erro: 'Falta o código da conta (WhatsApp Business Account ID).' };
  try {
    let caminho = `${config.conta_id}/message_templates?fields=name,language,status,category,components&limit=100`;
    const vistos = [];
    for (let pagina = 0; pagina < 10 && caminho; pagina += 1) {
      const dados = await chamarApi('GET', caminho);
      for (const m of dados.data || []) vistos.push(m);
      const proximo = dados.paging?.next;
      caminho = proximo ? proximo.replace(/^https?:\/\/[^/]+\/v\d+\.\d+\//, '') : null;
    }
    const agora = new Date().toISOString();
    db.exec('DELETE FROM modelos_oficiais');
    const inserir = db.prepare('INSERT OR REPLACE INTO modelos_oficiais (nome, idioma, categoria, situacao, corpo, variaveis, componentes, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const m of vistos) {
      const corpo = (m.components || []).find((c) => c.type === 'BODY')?.text || '';
      inserir.run(m.name, m.language, m.category || null, m.status || null, corpo, variaveisDoCorpo(corpo), JSON.stringify(m.components || []), agora);
    }
    return { total: vistos.length };
  } catch (erro) {
    return { erro: erro.message };
  }
}

function listarModelos({ soAprovados = false } = {}) {
  return db
    .prepare(`SELECT * FROM modelos_oficiais ${soAprovados ? "WHERE situacao = 'APPROVED'" : ''} ORDER BY nome, idioma`)
    .all();
}

function obterModelo(nome, idioma) {
  return db.prepare('SELECT * FROM modelos_oficiais WHERE nome = ? AND idioma = ?').get(nome, idioma) || null;
}

// ---- Janela de 24 horas ----

/** Pela API oficial, texto livre só até 24 h depois da última mensagem do cliente. */
function dentroDaJanela(conversaId, agoraMs = Date.now()) {
  const ultima = db.prepare("SELECT MAX(criado_em) AS em FROM mensagens WHERE conversa_id = ? AND remetente = 'cliente'").get(conversaId)?.em;
  return !!ultima && agoraMs - Date.parse(ultima) < 24 * 3600000;
}

// ---- Webhook (o que a Meta manda) ----

function conferirAssinatura(corpoBruto, cabecalho) {
  const segredo = lerConfig().segredo_app;
  if (!segredo || !cabecalho) return false;
  const esperado = `sha256=${crypto.createHmac('sha256', segredo).update(corpoBruto).digest('hex')}`;
  const a = Buffer.from(String(cabecalho));
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function baixarMidia(midiaId) {
  const info = await chamarApi('GET', midiaId);
  const resposta = await fetch(info.url, { headers: { Authorization: `Bearer ${lerConfig().chave}` } });
  if (!resposta.ok) throw new ErroDaMeta('Não consegui baixar a mídia da Meta.');
  return Buffer.from(await resposta.arrayBuffer());
}

/**
 * Corpo do webhook → lista de { mensagem } (no formato do Baileys, pro bot) e { recibo } (entregue,
 * lido, falhou). Mensagem de outro número (phone_number_id diferente) é ignorada.
 */
function lerWebhook(corpo) {
  const config = lerConfig();
  const saida = [];
  for (const entrada of corpo?.entry || []) {
    for (const mudanca of entrada.changes || []) {
      const valor = mudanca.value || {};
      if (valor.metadata?.phone_number_id && config.numero_id && valor.metadata.phone_number_id !== config.numero_id) continue;
      const nomes = new Map((valor.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of valor.messages || []) {
        const remoteJid = `${m.from}@s.whatsapp.net`;
        const base = { key: { remoteJid, id: m.id, fromMe: false }, pushName: nomes.get(m.from) || undefined, messageTimestamp: Number(m.timestamp) || undefined };
        const contexto = m.context?.id ? { contextInfo: { stanzaId: m.context.id } } : {};
        let message = null;
        let midiaId = null;
        let mime = null;
        if (m.type === 'text') message = contexto.contextInfo ? { extendedTextMessage: { text: m.text?.body || '', ...contexto } } : { conversation: m.text?.body || '' };
        else if (m.type === 'button') message = { conversation: m.button?.text || m.button?.payload || '' };
        // botão ou item de lista (E4, 4a parte): o id é o número da opção; o título vai pro histórico
        else if (m.type === 'interactive') {
          const escolha = m.interactive?.button_reply || m.interactive?.list_reply || {};
          message = { conversation: escolha.id || escolha.title || '' };
          if (escolha.title && escolha.id) base.textoParaHistorico = escolha.title;
        }
        else if (m.type === 'reaction') message = { reactionMessage: { key: { id: m.reaction?.message_id }, text: m.reaction?.emoji || '' } };
        else {
          const chave = { image: 'imageMessage', video: 'videoMessage', audio: 'audioMessage', sticker: 'stickerMessage', document: 'documentMessage' }[m.type];
          if (chave && m[m.type]) {
            midiaId = m[m.type].id;
            mime = m[m.type].mime_type;
            message = { [chave]: { mimetype: mime, caption: m[m.type].caption, fileName: m[m.type].filename, ...contexto } };
          }
        }
        if (!message) continue;
        const mensagem = { ...base, message };
        if (midiaId) mensagem.baixarMidia = () => baixarMidia(midiaId);
        saida.push({ mensagem });
      }
      for (const s of valor.statuses || []) {
        const status = { sent: 2, delivered: 3, read: 4 }[s.status];
        if (status) saida.push({ recibo: { key: { id: s.id }, update: { status } } });
        else if (s.status === 'failed') saida.push({ falha: { id: s.id, motivo: traduzirErro(s.errors?.[0]) } });
      }
    }
  }
  return saida;
}

module.exports = {
  lerConfig,
  configurado,
  configParaTela,
  salvarConfig,
  trocarCodigoVerificacao,
  testarConexao,
  criarAdaptador,
  montarMensagem,
  enviarModelo,
  textoDoModelo,
  sincronizarModelos,
  listarModelos,
  obterModelo,
  variaveisDoCorpo,
  dentroDaJanela,
  conferirAssinatura,
  lerWebhook,
  baixarMidia,
  paraNumero,
  ErroDaMeta,
  VERSAO_PADRAO,
};

// Central do Instagram (E4): um app só na Meta para todas as instalações do ChatDigital.
//
// A Meta entrega as mensagens de um app num endereço só, e cada empresa tem a sua instalação
// (nazagas.eunodigital.com, novanet..., nazanet...). A central fica num endereço próprio e:
// 1. faz o "Entrar com Instagram" (login do Instagram para empresas): a instalação manda a pessoa
//    para cá, o Instagram devolve um código, a central troca pela chave de 60 dias, inscreve a conta
//    no webhook e entrega a chave para a instalação (servidor com servidor, assinado);
// 2. recebe o webhook do app e repassa cada mensagem para a instalação dona daquela conta, assinada
//    com o segredo combinado com ela (a instalação confere como se viesse da Meta).
// Depois disso a instalação manda as mensagens direto para o Instagram com a chave dela; a central
// só recebe e repassa. O dono do app na Meta (hoje a Nazanet, depois a Eu no Digital) muda só aqui.
//
// Configuração (variáveis de ambiente; nada disso vai para o repositório):
//   CENTRAL_APP_ID, CENTRAL_APP_SECRET  app do Instagram na Meta (Instagram app ID e app secret)
//   CENTRAL_VERIFY_TOKEN                token de verificação do webhook (qualquer texto longo)
//   CENTRAL_ENDERECO                    endereço https desta central (ex.: https://chat.eunodigital.com)
//   CENTRAL_INSTALACOES                 arquivo JSON: [{ "id": "nazagas", "nome": "Naza Gás",
//                                       "endereco": "https://nazagas.eunodigital.com", "segredo": "..." }]
//   CENTRAL_DADOS                       arquivo JSON onde a central anota qual conta é de qual instalação
//   CENTRAL_PORTA (padrão 3100), HOST
// Rodar: npm run central-instagram

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const ESCOPOS = 'instagram_business_basic,instagram_business_manage_messages';
const CAMPOS_WEBHOOK = 'messages,message_reactions';
const VALIDADE_LINK_MS = 10 * 60000;

const hmac = (segredo, texto) => crypto.createHmac('sha256', segredo).update(texto).digest('hex');
function iguais(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Link que a instalação monta para mandar a pessoa à central (assinado com o segredo dela) */
function assinarPedidoDeConexao(instalacaoId, segredo, agoraMs = Date.now()) {
  return { instalacao: instalacaoId, t: String(agoraMs), sig: hmac(segredo, `${instalacaoId}.${agoraMs}`) };
}

function criarCentral(opcoes = {}) {
  const cfg = {
    appId: opcoes.appId ?? process.env.CENTRAL_APP_ID,
    appSecret: opcoes.appSecret ?? process.env.CENTRAL_APP_SECRET,
    verifyToken: opcoes.verifyToken ?? process.env.CENTRAL_VERIFY_TOKEN,
    endereco: String(opcoes.endereco ?? process.env.CENTRAL_ENDERECO ?? '').replace(/\/+$/, ''),
    instalacoes: opcoes.instalacoes ?? JSON.parse(fs.readFileSync(process.env.CENTRAL_INSTALACOES, 'utf8')),
    arquivoDados: opcoes.arquivoDados ?? process.env.CENTRAL_DADOS ?? path.join(__dirname, '..', 'data', 'central-instagram.json'),
    versao: opcoes.versao ?? 'v26.0',
  };
  const graph = () => (process.env.CHATDIGITAL_INSTAGRAM_URL || 'https://graph.instagram.com').replace(/\/$/, '');
  const apiOauth = () => (process.env.CHATDIGITAL_INSTAGRAM_OAUTH_URL || 'https://api.instagram.com').replace(/\/$/, '');
  const login = () => (process.env.CHATDIGITAL_INSTAGRAM_LOGIN_URL || 'https://www.instagram.com').replace(/\/$/, '');
  const instalacao = (id) => cfg.instalacoes.find((i) => i.id === id) || null;
  const voltar = (inst, aviso) => `${inst.endereco.replace(/\/+$/, '')}/painel/configuracoes/instagram?aviso=${aviso}`;
  const retorno = () => `${cfg.endereco}/instagram/retorno`;

  // qual conta do Instagram é de qual instalação
  function lerDados() {
    try {
      return JSON.parse(fs.readFileSync(cfg.arquivoDados, 'utf8'));
    } catch (erro) {
      return { contas: {} };
    }
  }
  function anotarConta(contaId, instalacaoId, usuario) {
    const dados = lerDados();
    dados.contas[String(contaId)] = { instalacao: instalacaoId, usuario, em: new Date().toISOString() };
    fs.mkdirSync(path.dirname(cfg.arquivoDados), { recursive: true });
    fs.writeFileSync(cfg.arquivoDados, JSON.stringify(dados, null, 2));
  }

  async function pedirJson(url, opcoesFetch) {
    const resposta = await fetch(url, opcoesFetch);
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(dados?.error?.message || dados?.error_message || `o Instagram respondeu ${resposta.status}`);
    return dados;
  }

  async function entregar(inst, caminho, corpo) {
    const bruto = JSON.stringify(corpo);
    const resposta = await fetch(`${inst.endereco.replace(/\/+$/, '')}${caminho}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${hmac(inst.segredo, bruto)}` },
      body: bruto,
    });
    if (!resposta.ok) throw new Error(`a instalação ${inst.id} respondeu ${resposta.status}`);
  }

  const app = express();
  app.disable('x-powered-by');

  app.get('/', (req, res) => res.type('text/plain').send('ChatDigital: central do Instagram.'));

  // 1. a instalação manda a pessoa para cá (link assinado) e daqui ela vai para o login do Instagram
  app.get('/instagram/conectar', (req, res) => {
    const inst = instalacao(String(req.query.instalacao || ''));
    const t = Number(req.query.t);
    if (!inst || !t || Math.abs(Date.now() - t) > VALIDADE_LINK_MS || !iguais(req.query.sig, hmac(inst.segredo, `${inst.id}.${t}`))) {
      return res.status(403).type('text/plain').send('Link de conexão inválido ou vencido. Volte ao ChatDigital e clique em "Entrar com Instagram" de novo.');
    }
    const estado = `${inst.id}.${t}.${hmac(cfg.appSecret, `${inst.id}.${t}`)}`;
    const url = new URL(`${login()}/oauth/authorize`);
    url.searchParams.set('enable_fb_login', '0');
    url.searchParams.set('force_authentication', '1');
    url.searchParams.set('client_id', cfg.appId);
    url.searchParams.set('redirect_uri', retorno());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', ESCOPOS);
    url.searchParams.set('state', estado);
    res.redirect(url.toString());
  });

  // 2. o Instagram volta com o código: troca pela chave, inscreve no webhook e entrega à instalação
  app.get('/instagram/retorno', async (req, res) => {
    const [id, t, sig] = String(req.query.state || '').split('.');
    const inst = instalacao(id);
    if (!inst || !iguais(sig, hmac(cfg.appSecret, `${id}.${t}`)) || Math.abs(Date.now() - Number(t)) > 2 * VALIDADE_LINK_MS) {
      return res.status(403).type('text/plain').send('Retorno do Instagram inválido ou vencido. Volte ao ChatDigital e tente de novo.');
    }
    if (req.query.error || !req.query.code) return res.redirect(voltar(inst, 'cancelado'));
    try {
      const curta = await pedirJson(`${apiOauth()}/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.appSecret, grant_type: 'authorization_code', redirect_uri: retorno(), code: String(req.query.code).replace(/#_$/, '') }),
      });
      const chaveCurta = curta.access_token || curta.data?.[0]?.access_token;
      if (!chaveCurta) throw new Error('o Instagram não devolveu a chave');
      const longa = await pedirJson(`${graph()}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(cfg.appSecret)}&access_token=${encodeURIComponent(chaveCurta)}`);
      const chave = longa.access_token;
      const autorizacao = { headers: { Authorization: `Bearer ${chave}` } };
      const conta = await pedirJson(`${graph()}/${cfg.versao}/me?fields=user_id,username`, autorizacao);
      await pedirJson(`${graph()}/${cfg.versao}/me/subscribed_apps?subscribed_fields=${CAMPOS_WEBHOOK}`, { method: 'POST', ...autorizacao });
      anotarConta(conta.user_id, inst.id, conta.username);
      await entregar(inst, '/webhook/instagram/conta', { conta_id: String(conta.user_id), usuario: conta.username || null, chave, central: cfg.endereco, endereco_publico: inst.endereco });
      res.redirect(voltar(inst, 'conectado'));
    } catch (erro) {
      console.error(`Central do Instagram: falha ao conectar a instalação ${inst.id}:`, erro.message);
      res.redirect(voltar(inst, 'falhou-central'));
    }
  });

  // 3. webhook do app: a Meta confere o endereço; as mensagens vão para a instalação dona da conta
  app.get('/webhook/instagram', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && cfg.verifyToken && req.query['hub.verify_token'] === cfg.verifyToken) {
      return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
    }
    res.sendStatus(403);
  });

  app.post('/webhook/instagram', express.raw({ type: 'application/json', limit: '2mb' }), (req, res) => {
    const bruto = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!cfg.appSecret || !iguais(req.get('x-hub-signature-256'), `sha256=${hmac(cfg.appSecret, bruto)}`)) return res.sendStatus(401);
    res.sendStatus(200);
    let corpo;
    try {
      corpo = JSON.parse(bruto.toString('utf8'));
    } catch (erro) {
      return;
    }
    repassar(corpo).catch((erro) => console.error('Central do Instagram: erro ao repassar:', erro.message));
  });

  /** Separa as entradas por instalação e entrega cada grupo (devolve quantas foram para cada uma) */
  async function repassar(corpo) {
    const contas = lerDados().contas;
    const porInstalacao = new Map();
    for (const entrada of corpo?.entry || []) {
      const inst = instalacao(contas[String(entrada.id)]?.instalacao);
      if (!inst) continue; // conta que ninguém conectou por aqui
      if (!porInstalacao.has(inst)) porInstalacao.set(inst, []);
      porInstalacao.get(inst).push(entrada);
    }
    const entregues = {};
    for (const [inst, entradas] of porInstalacao) {
      try {
        await entregar(inst, '/webhook/instagram', { object: corpo.object, entry: entradas });
        entregues[inst.id] = entradas.length;
      } catch (erro) {
        console.error(`Central do Instagram: não entreguei para ${inst.id}:`, erro.message);
      }
    }
    return entregues;
  }

  return { app, repassar, lerDados };
}

module.exports = { criarCentral, assinarPedidoDeConexao };

if (require.main === module) {
  require('dotenv').config();
  const { app } = criarCentral();
  const porta = process.env.CENTRAL_PORTA || 3100;
  const host = process.env.HOST || '0.0.0.0';
  app.listen(porta, host, () => console.log(`Central do Instagram do ChatDigital em http://${host}:${porta}`));
}

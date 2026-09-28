const express = require('express');
const router = express.Router();

const {
  listarFila,
  obterConversaPorId,
  listarMensagens,
  assumirConversa,
  finalizarConversa,
  registrarMensagem,
} = require('../conversas');
const { listarSetoresDoAtendente } = require('../atendentes');
const { obterSocket } = require('../socket-atual');
const { carregarFluxo } = require('../fluxo');
const { carregarNegocio } = require('../negocio');
const { encerrarAtendimento, substituirVariaveis } = require('../flow-engine');
const { temPermissao } = require('../permissoes');

const MENSAGEM_ENCERRAMENTO_PADRAO =
  'Atendimento encerrado. Se precisar de mais alguma coisa, é só mandar uma mensagem por aqui. 👋';

async function enviarComSeguranca(sock, numero, texto) {
  if (!texto) return false;
  try {
    await sock.sendMessage(numero, { text: texto });
    return true;
  } catch (erro) {
    console.error(`Falha ao enviar mensagem para ${numero}:`, erro);
    return false;
  }
}

// Um atendente sem "ver_fila_outros_setores" só vê conversas do(s) setor(es) dele (ou sem setor
// definido, ou que ele mesmo já assumiu) — admin e quem tem a permissão veem tudo.
function podeVerConversa(atendente, conversa) {
  if (temPermissao(atendente, 'ver_fila_outros_setores')) return true;
  if (conversa.atendente_id === atendente.id) return true;
  if (!conversa.setor_id) return true;
  const meusSetores = listarSetoresDoAtendente(atendente.id).map((s) => s.id);
  return meusSetores.includes(conversa.setor_id);
}

router.get('/', (req, res) => {
  const conversas = listarFila().filter((c) => podeVerConversa(req.atendente, c));
  res.render('fila/lista', { atendenteLogado: req.atendente, conversas });
});

router.get('/:id', (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  res.render('fila/detalhe', {
    atendenteLogado: req.atendente,
    conversa,
    mensagens: listarMensagens(conversa.id),
    erro: null,
  });
});

router.post('/:id/assumir', async (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  assumirConversa(conversa.id, req.atendente.id);

  const negocio = carregarNegocio();
  const boasVindas = substituirVariaveis(negocio.mensagem_boas_vindas_atendente, {
    negocio,
    atendente: { nome: req.atendente.nome },
  });
  const sock = obterSocket();
  if (sock && (await enviarComSeguranca(sock, conversa.numero, boasVindas))) {
    registrarMensagem(conversa.numero, 'bot', boasVindas);
  }

  res.redirect(`/painel/fila/${conversa.id}`);
});

router.post('/:id/finalizar', async (req, res) => {
  if (!temPermissao(req.atendente, 'finalizar_conversas')) {
    return res.status(403).send('Você não tem permissão para finalizar conversas.');
  }
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');

  finalizarConversa(conversa.id);
  encerrarAtendimento(conversa.numero, carregarFluxo());

  const negocio = carregarNegocio();
  const mensagemEncerramento = negocio.mensagem_encerramento || MENSAGEM_ENCERRAMENTO_PADRAO;
  const sock = obterSocket();
  if (sock) {
    if (await enviarComSeguranca(sock, conversa.numero, mensagemEncerramento)) {
      registrarMensagem(conversa.numero, 'bot', mensagemEncerramento);
    }
    if (negocio.pesquisa_satisfacao && (await enviarComSeguranca(sock, conversa.numero, negocio.pesquisa_satisfacao))) {
      registrarMensagem(conversa.numero, 'bot', negocio.pesquisa_satisfacao);
    }
  }

  res.redirect('/painel/fila');
});

router.post('/:id/responder', async (req, res) => {
  if (!temPermissao(req.atendente, 'responder_conversas')) {
    return res.status(403).send('Você não tem permissão para responder conversas.');
  }
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');

  const texto = (req.body.texto || '').trim();
  const sock = obterSocket();

  function reexibirComErro(erro) {
    res.render('fila/detalhe', {
      atendenteLogado: req.atendente,
      conversa,
      mensagens: listarMensagens(conversa.id),
      erro,
    });
  }

  if (!sock) {
    return reexibirComErro('O bot não está conectado ao WhatsApp agora — não dá pra enviar por aqui.');
  }
  if (!texto) {
    return reexibirComErro('Escreva alguma coisa antes de enviar.');
  }

  try {
    await sock.sendMessage(conversa.numero, { text: texto });
    registrarMensagem(conversa.numero, 'atendente', texto);
    res.redirect(`/painel/fila/${conversa.id}`);
  } catch (erro) {
    reexibirComErro('Não consegui enviar pelo WhatsApp agora. Tente de novo em instantes.');
  }
});

module.exports = router;

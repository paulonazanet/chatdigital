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
const { obterSocket } = require('../socket-atual');
const { carregarFluxo } = require('../fluxo');
const { encerrarAtendimento } = require('../flow-engine');

const MENSAGEM_ENCERRAMENTO =
  'Atendimento encerrado. Se precisar de mais alguma coisa, é só mandar uma mensagem por aqui. 👋';

router.get('/', (req, res) => {
  res.render('fila/lista', { atendenteLogado: req.atendente, conversas: listarFila() });
});

router.get('/:id', (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa) return res.redirect('/painel/fila');
  res.render('fila/detalhe', {
    atendenteLogado: req.atendente,
    conversa,
    mensagens: listarMensagens(conversa.id),
    erro: null,
  });
});

router.post('/:id/assumir', (req, res) => {
  assumirConversa(Number(req.params.id), req.atendente.id);
  res.redirect(`/painel/fila/${req.params.id}`);
});

router.post('/:id/finalizar', async (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa) return res.redirect('/painel/fila');

  finalizarConversa(conversa.id);
  encerrarAtendimento(conversa.numero, carregarFluxo());

  const sock = obterSocket();
  if (sock) {
    try {
      await sock.sendMessage(conversa.numero, { text: MENSAGEM_ENCERRAMENTO });
      registrarMensagem(conversa.numero, 'bot', MENSAGEM_ENCERRAMENTO);
    } catch (erro) {
      console.error(`Falha ao enviar mensagem de encerramento para ${conversa.numero}:`, erro);
    }
  }

  res.redirect('/painel/fila');
});

router.post('/:id/responder', async (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa) return res.redirect('/painel/fila');

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

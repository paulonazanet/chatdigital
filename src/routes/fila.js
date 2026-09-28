const express = require('express');
const multer = require('multer');
const router = express.Router();

const {
  listarFila,
  listarConversasComBot,
  obterConversaPorId,
  obterOuCriarConversa,
  listarMensagens,
  assumirConversa,
  finalizarConversa,
  transferirConversa,
  registrarMensagem,
} = require('../conversas');
const { listarSetoresDoAtendente, listarAtendentes } = require('../atendentes');
const { listarSetores } = require('../setores');
const { obterSocket } = require('../socket-atual');
const { carregarFluxo } = require('../fluxo');
const { carregarNegocio } = require('../negocio');
const { encerrarAtendimento, transferirParaHumano, substituirVariaveis } = require('../flow-engine');
const { temPermissao } = require('../permissoes');
const { barramento } = require('../eventos');
const { tipoPorMimetype, salvarBufferDeMidia, converterParaOggOpus } = require('../midia');

const LEGENDA_PADRAO = { imagem: '[imagem enviada]', video: '[vídeo enviado]', audio: '[áudio enviado]' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

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

// Agrupa a fila (já transferida) por setor e, dentro de cada setor, em duas pilhas: 🔴 aguardando
// sua resposta (ainda não assumida, ou o cliente acabou de escrever de novo) e 🟡 aguardando o
// cliente responder (o atendente já respondeu e está esperando).
function agruparPorSetor(conversas) {
  const grupos = new Map();
  for (const c of conversas) {
    const chave = c.setor_id || 'sem-setor';
    if (!grupos.has(chave)) {
      grupos.set(chave, { chave, nome: c.setor_nome || 'Sem setor', vermelho: [], amarelo: [] });
    }
    const grupo = grupos.get(chave);
    const aguardandoSuaResposta = c.status === 'aguardando' || c.ultima_mensagem_remetente === 'cliente';
    (aguardandoSuaResposta ? grupo.vermelho : grupo.amarelo).push(c);
  }
  return [...grupos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// Conversas que o cliente começou a falar com o bot mas não terminaram no início do fluxo (ex.:
// pararam de responder no meio de uma pergunta) — ninguém vê isso hoje a não ser por aqui.
// Usa `no_fluxo_atual` salvo no banco (não a memória do motor de fluxo), então continua
// funcionando certinho mesmo depois de reiniciar o processo.
function listarParadasNoFluxo(atendente, fluxo) {
  return listarConversasComBot()
    .filter((c) => podeVerConversa(atendente, c))
    .filter((c) => c.no_fluxo_atual && c.no_fluxo_atual !== fluxo.inicio);
}

function renderizarFila(req, res, { conversaSelecionada = null, mensagens = [], erro = null, erroNovaConversa = null } = {}) {
  const fluxo = carregarFluxo();
  const conversas = listarFila().filter((c) => podeVerConversa(req.atendente, c));
  res.render('fila/lista', {
    atendenteLogado: req.atendente,
    grupos: agruparPorSetor(conversas),
    paradas: listarParadasNoFluxo(req.atendente, fluxo),
    conversaSelecionada,
    mensagens,
    erro,
    erroNovaConversa,
    setores: listarSetores(),
    atendentes: listarAtendentes().filter((a) => a.ativo),
  });
}

router.get('/', (req, res) => renderizarFila(req, res));

// Iniciar conversa com um número que ainda não escreveu pra gente (ex.: cliente pediu contato
// por outro canal). Confere no próprio WhatsApp se o número existe antes de criar a conversa —
// evita "conversa fantasma" com número digitado errado.
router.post('/nova', async (req, res) => {
  if (!temPermissao(req.atendente, 'responder_conversas')) {
    return res.status(403).send('Você não tem permissão para iniciar conversas.');
  }

  const numeroDigitado = (req.body.numero || '').replace(/\D/g, '');
  const texto = (req.body.texto || '').trim();
  const sock = obterSocket();

  if (!numeroDigitado) {
    return renderizarFila(req, res, { erroNovaConversa: 'Informe um número de telefone (com DDD e DDI).' });
  }
  if (!sock) {
    return renderizarFila(req, res, { erroNovaConversa: 'O bot não está conectado ao WhatsApp agora — não dá pra iniciar conversa.' });
  }

  try {
    const [resultado] = await sock.onWhatsApp(`${numeroDigitado}@s.whatsapp.net`);
    if (!resultado?.exists) {
      return renderizarFila(req, res, { erroNovaConversa: 'Esse número não tem WhatsApp, ou está digitado errado.' });
    }

    const numero = resultado.jid; // o Baileys devolve o JID já no formato certo (às vezes normaliza)
    const conversa = obterOuCriarConversa(numero);
    assumirConversa(conversa.id, req.atendente.id);

    if (texto && (await enviarComSeguranca(sock, numero, texto))) {
      registrarMensagem(numero, 'atendente', texto);
    }

    res.redirect(`/painel/fila/${conversa.id}`);
  } catch (erro) {
    renderizarFila(req, res, { erroNovaConversa: 'Não consegui iniciar a conversa agora. Tente de novo em instantes.' });
  }
});

router.get('/:id', (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  renderizarFila(req, res, { conversaSelecionada: conversa, mensagens: listarMensagens(conversa.id) });
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

// "Puxar pra mim": pra conversas paradas no fluxo (ainda com o bot) — assume manualmente e
// silencia o bot pra esse número, igual uma transferência normal faria.
router.post('/:id/puxar', (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa) return res.redirect('/painel/fila');
  transferirParaHumano(conversa.numero, carregarFluxo());
  assumirConversa(conversa.id, req.atendente.id);
  res.redirect(`/painel/fila/${conversa.id}`);
});

router.post('/:id/transferir', (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');

  const setorId = req.body.setor_id ? Number(req.body.setor_id) : null;
  const atendenteId = req.body.atendente_id ? Number(req.body.atendente_id) : null;
  if (!setorId) {
    return renderizarFila(req, res, {
      conversaSelecionada: conversa,
      mensagens: listarMensagens(conversa.id),
      erro: 'Escolha um setor para transferir.',
    });
  }

  transferirConversa(conversa.id, { setorId, atendenteId });
  barramento.emit('atencao', { motivo: 'transferencia', numero: conversa.numero, setorId });
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

router.post('/:id/responder', (req, res) => {
  upload.single('midia')(req, res, async (erroUpload) => {
    if (!temPermissao(req.atendente, 'responder_conversas')) {
      return res.status(403).send('Você não tem permissão para responder conversas.');
    }
    const conversa = obterConversaPorId(Number(req.params.id));
    if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');

    const texto = (req.body.texto || '').trim();
    const arquivo = req.file;
    const sock = obterSocket();

    function reexibirComErro(erro) {
      renderizarFila(req, res, { conversaSelecionada: conversa, mensagens: listarMensagens(conversa.id), erro });
    }

    if (erroUpload) {
      return reexibirComErro(
        erroUpload.code === 'LIMIT_FILE_SIZE' ? 'Arquivo maior que o limite de 16MB.' : 'Não consegui processar o arquivo enviado.',
      );
    }
    if (!sock) {
      return reexibirComErro('O bot não está conectado ao WhatsApp agora — não dá pra enviar por aqui.');
    }
    if (!arquivo && !texto) {
      return reexibirComErro('Escreva alguma coisa ou anexe uma imagem, vídeo, áudio ou PDF antes de enviar.');
    }

    try {
      if (arquivo) {
        const tipo = tipoPorMimetype(arquivo.mimetype);
        const ehPdf = arquivo.mimetype === 'application/pdf';
        if (!tipo && !ehPdf) return reexibirComErro('Só dá pra mandar imagem, vídeo, áudio ou PDF por aqui.');

        let bufferParaEnviar = arquivo.buffer;
        let mimetypeParaEnviar = arquivo.mimetype;
        if (tipo === 'audio' && !arquivo.mimetype.startsWith('audio/ogg')) {
          // O WhatsApp só reproduz áudio de verdade em ogg/opus — outros formatos (webm gravado
          // no navegador, mp3, m4a...) às vezes "enviam" sem erro nenhum aqui, mas não chegam no
          // destinatário. converterParaOggOpus nunca rejeita: se o ffmpeg falhar/não existir,
          // cai pro buffer original (ver midia.js) — mandar do jeito que veio ainda é melhor que
          // travar o envio inteiro por causa da conversão.
          bufferParaEnviar = await converterParaOggOpus(arquivo.buffer);
          mimetypeParaEnviar = 'audio/ogg; codecs=opus';
        }

        const conteudo =
          tipo === 'imagem'
            ? { image: bufferParaEnviar, caption: texto || undefined }
            : tipo === 'video'
              ? { video: bufferParaEnviar, caption: texto || undefined }
              : tipo === 'audio'
                ? { audio: bufferParaEnviar, mimetype: mimetypeParaEnviar }
                : { document: bufferParaEnviar, mimetype: 'application/pdf', fileName: arquivo.originalname || 'documento.pdf', caption: texto || undefined };

        await sock.sendMessage(conversa.numero, conteudo);
        const url = salvarBufferDeMidia(bufferParaEnviar, mimetypeParaEnviar);
        // PDF fica com midia_tipo nulo (a coluna só aceita imagem/video/audio) — o link genérico
        // de download na tela usa midia_url mesmo sem tipo, ver fila/lista.ejs.
        registrarMensagem(conversa.numero, 'atendente', texto || (tipo ? LEGENDA_PADRAO[tipo] : '[PDF enviado]'), { tipo, url });
      } else {
        await sock.sendMessage(conversa.numero, { text: texto });
        registrarMensagem(conversa.numero, 'atendente', texto);
      }
      res.redirect(`/painel/fila/${conversa.id}`);
    } catch (erro) {
      reexibirComErro('Não consegui enviar pelo WhatsApp agora. Tente de novo em instantes.');
    }
  });
});

module.exports = router;

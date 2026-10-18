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
  listarFinalizadas,
  conversaCasaComBusca,
  renomearContato,
  registrarNotaInterna,
} = require('../conversas');
const atendimentos = require('../atendimentos');
const respostasRapidas = require('../respostas-rapidas');
const motivosEncerramento = require('../motivos-encerramento');
const { listarSetoresDoAtendente, listarAtendentes } = require('../atendentes');
const { listarSetores } = require('../setores');
const { obterSocket } = require('../socket-atual');
const { carregarFluxo } = require('../fluxo');
const { carregarNegocio } = require('../negocio');
const { encerrarAtendimento, transferirParaHumano, aguardarAvaliacao, substituirVariaveis } = require('../flow-engine');
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

const FILTROS = ['minhas', 'fila', 'bot', 'finalizadas', 'todas'];

// Conversas que o cliente começou a falar com o bot mas não terminaram no início do fluxo (ex.:
// pararam de responder no meio de uma pergunta) — aparecem no filtro "No bot", com botão Puxar.
// Usa `no_fluxo_atual` salvo no banco (não a memória do motor de fluxo), então continua
// funcionando certinho mesmo depois de reiniciar o processo.
function listarParadasNoFluxo(atendente, fluxo) {
  return listarConversasComBot()
    .filter((c) => podeVerConversa(atendente, c))
    .filter((c) => c.no_fluxo_atual && c.no_fluxo_atual !== fluxo.inicio);
}

// Filtro e setor escolhidos: vêm da URL quando o atendente clica, e ficam num cookie pra
// sobreviver aos redirecionamentos (responder, assumir...) que voltam pra /painel/fila/:id.
function lerFiltros(req, res) {
  const salvo = req.cookies?.filtroFila ? String(req.cookies.filtroFila).split('|') : [];
  const filtro = FILTROS.includes(req.query.filtro) ? req.query.filtro : FILTROS.includes(salvo[0]) ? salvo[0] : 'minhas';
  const setor = req.query.setor !== undefined ? String(req.query.setor) : salvo[1] || '';
  if (req.query.filtro !== undefined || req.query.setor !== undefined) {
    res.cookie('filtroFila', `${filtro}|${setor}`, { httpOnly: true, sameSite: 'lax' });
  }
  // a busca não fica no cookie: é de momento, trocar de filtro já limpa
  return { filtro, setor, busca: String(req.query.q || '').trim().slice(0, 60) };
}

// Uma lista só (opção "A ajustada" aprovada pelo Paulo): quem está esperando resposta há mais
// tempo em cima; `esperandoResposta` = a vez é do atendente (conversa ainda na fila, ou o
// cliente escreveu depois da última resposta) — é quem ganha a bolinha amarela/vermelha.
function montarListaFila(atendente, fluxo, { filtro, setor, busca }) {
  const naFila = listarFila()
    .filter((c) => podeVerConversa(atendente, c))
    .map((c) => ({
      ...c,
      tipo: c.status === 'aguardando' ? 'fila' : 'atendendo',
      esperandoResposta: c.status === 'aguardando' || c.ultima_mensagem_remetente === 'cliente',
    }));
  const noBot = listarParadasNoFluxo(atendente, fluxo).map((c) => ({ ...c, tipo: 'bot', esperandoResposta: false }));

  const doSetor = (c) => !setor || (setor === 'sem' ? !c.setor_id : String(c.setor_id) === setor);
  const porFiltro = {
    minhas: naFila.filter((c) => c.tipo === 'atendendo' && c.atendente_id === atendente.id),
    fila: naFila.filter((c) => c.tipo === 'fila'),
    bot: noBot,
    todas: [...naFila, ...noBot], // em andamento: finalizadas ficam no filtro delas
  };
  // finalizadas só são lidas quando o filtro é esse (a tabela cresce pra sempre) e não têm contador
  porFiltro.finalizadas =
    filtro === 'finalizadas'
      ? listarFinalizadas({ busca }).filter((c) => podeVerConversa(atendente, c)).map((c) => ({ ...c, tipo: 'finalizada', esperandoResposta: false }))
      : [];
  const contagens = Object.fromEntries(['minhas', 'fila', 'bot', 'todas'].map((f) => [f, porFiltro[f].filter(doSetor).length]));

  const desde = (c) => (c.esperandoResposta ? c.esperando_desde || c.ultima_mensagem_em : c.ultima_mensagem_em) || c.atualizado_em;
  const itens = porFiltro[filtro].filter(doSetor).filter((c) => conversaCasaComBusca(c, busca)).sort((a, b) => {
    if (a.esperandoResposta !== b.esperandoResposta) return a.esperandoResposta ? -1 : 1;
    // esperando: quem espera há mais tempo primeiro; o resto: atividade mais recente primeiro
    return a.esperandoResposta ? desde(a).localeCompare(desde(b)) : desde(b).localeCompare(desde(a));
  });
  return { itens: itens.map((c) => ({ ...c, desde: desde(c) })), contagens };
}

// Variáveis que as respostas rápidas e a boas-vindas do atendente podem usar.
function contextoDaConversa(conversa, atendente, negocio) {
  const atual = atendimentos.atendimentoAberto(conversa.id);
  return {
    negocio,
    atendente: { nome: atendente.nome },
    cliente: {
      nome: conversa.nome_contato || '',
      telefone: conversa.numero_exibicao || conversa.numero.replace(/@.*/, ''),
    },
    atendimento: { protocolo: atual?.protocolo || '' },
    setor: { nome: conversa.setor_nome || '' },
    saudacao: respostasRapidas.saudacao(),
  };
}

// Marca a 1a mensagem de cada atendimento com a faixa dele ("Atendimento 202610180012 · ..."),
// pra separar no histórico os atendimentos anteriores do atual. Cada mensagem é do último
// atendimento aberto até a hora dela (a mensagem de encerramento fica no que acabou de fechar).
// O atendimento só é aberto DEPOIS da mensagem que o causou (o cliente escreve, o bot transfere),
// então a mensagem do cliente que chega com o anterior já finalizado já é do próximo — menos a
// nota da pesquisa, que ainda é do anterior.
function marcarFaixasDeAtendimento(mensagens, lista) {
  let indice = -1;
  let ultimaFaixa = null;
  return mensagens.map((m) => {
    while (indice + 1 < lista.length && lista[indice + 1].aberto_em <= m.criado_em) indice += 1;
    const anterior = lista[indice];
    const proximo = lista[indice + 1];
    const fechouAntes = !anterior || (anterior.finalizado_em && anterior.finalizado_em <= m.criado_em);
    const ehNotaDaPesquisa =
      anterior && m.texto.trim().length <= 20 && atendimentos.lerNota(m.texto) !== null &&
      Date.parse(m.criado_em) - Date.parse(anterior.finalizado_em) <= 30 * 60000;
    // (até 6 h antes de abrir: conversa só com o bot dias antes não entra no atendimento seguinte)
    const pertoDoProximo = proximo && Date.parse(proximo.aberto_em) - Date.parse(m.criado_em) <= 6 * 3600000;
    if (pertoDoProximo && fechouAntes && m.remetente === 'cliente' && !m.interna && !ehNotaDaPesquisa) indice += 1;
    const atendimento = indice >= 0 ? lista[indice] : null;
    const faixa = atendimento && atendimento.id !== ultimaFaixa ? atendimento : null;
    if (atendimento) ultimaFaixa = atendimento.id;
    return { ...m, faixa };
  });
}

function renderizarFila(req, res, { conversaSelecionada = null, mensagens = [], erro = null, erroNovaConversa = null } = {}) {
  const fluxo = carregarFluxo();
  const negocio = carregarNegocio();
  let respostas = [];
  let protocoloAtual = null;
  if (conversaSelecionada) {
    const lista = atendimentos.listarAtendimentosDaConversa(conversaSelecionada.id);
    mensagens = marcarFaixasDeAtendimento(mensagens, lista);
    protocoloAtual = lista.length ? lista[lista.length - 1].protocolo : null;
    const contexto = contextoDaConversa(conversaSelecionada, req.atendente, negocio);
    respostas = respostasRapidas
      .respostasParaConversa(conversaSelecionada.setor_id || null)
      .map((r) => ({ nome: r.nome, texto: substituirVariaveis(r.texto, contexto) }));
  }
  const filtros = lerFiltros(req, res);
  const { itens, contagens } = montarListaFila(req.atendente, fluxo, filtros);
  res.render('fila/lista', {
    atendenteLogado: req.atendente,
    itens,
    contagens,
    filtro: filtros.filtro,
    setorFiltro: filtros.setor,
    busca: filtros.busca,
    minutosAmarelo: negocio.fila_minutos_amarelo,
    minutosVermelho: negocio.fila_minutos_vermelho,
    conversaSelecionada,
    mensagens,
    erro,
    erroNovaConversa,
    setores: listarSetores(),
    atendentes: listarAtendentes().filter((a) => a.ativo),
    respostas,
    protocoloAtual,
    motivos: motivosEncerramento.listarArvore({ soAtivos: true }).filter((g) => g.motivos.length),
    exigirMotivo: !!negocio.exigir_motivo_encerramento,
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

    // Quando o cliente responder, a mensagem chega com o JID @lid (não o @s.whatsapp.net que o
    // onWhatsApp devolve) — se a conversa fosse criada com o JID errado, a resposta do cliente
    // cairia numa conversa "fantasma" diferente e o bot achava que era gente nova conversando.
    const lid = await sock.signalRepository?.lidMapping?.getLIDForPN(resultado.jid).catch(() => null);
    const numero = lid || resultado.jid;
    const conversa = obterOuCriarConversa(numero);
    assumirConversa(conversa.id, req.atendente.id);
    // Sem isso, o motor de fluxo (memória separada do banco) não sabe que essa conversa já está
    // com um atendente, e o bot mostra o menu automático assim que o cliente responder.
    transferirParaHumano(numero, carregarFluxo());

    if (texto && (await enviarComSeguranca(sock, numero, texto))) {
      registrarMensagem(numero, 'atendente', texto, null, req.atendente.id);
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
  const boasVindas = substituirVariaveis(
    negocio.mensagem_boas_vindas_atendente,
    contextoDaConversa(obterConversaPorId(conversa.id), req.atendente, negocio),
  );
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
  const setorNome = listarSetores().find((x) => x.id === setorId)?.nome || 'setor';
  const destinoNome = atendenteId ? listarAtendentes().find((a) => a.id === atendenteId)?.nome : null;
  const origem = [conversa.setor_nome, conversa.atendente_nome].filter(Boolean).join(' · ') || 'sem setor';
  registrarNotaInterna(
    conversa.id,
    `Transferida de ${origem} para ${setorNome}${destinoNome ? ` · ${destinoNome}` : ''}, por ${req.atendente.nome}.`,
  );
  barramento.emit('atencao', { motivo: 'transferencia', numero: conversa.numero, setorId, numeroExibicao: conversa.numero_exibicao });
  res.redirect(`/painel/fila/${conversa.id}`);
});

// Nota interna: só a equipe vê, o cliente não recebe. Vale em qualquer situação da conversa
// (na fila, com o bot, finalizada), pra quem pode responder.
router.post('/:id/nota', (req, res) => {
  if (!temPermissao(req.atendente, 'responder_conversas')) {
    return res.status(403).send('Você não tem permissão para escrever nas conversas.');
  }
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  registrarNotaInterna(conversa.id, req.body.texto, req.atendente.id);
  res.redirect(`/painel/fila/${conversa.id}`);
});

// Lápis no topo da conversa: corrige o nome do cliente (vale até trocar de novo; vazio volta a
// usar o nome do perfil do WhatsApp).
router.post('/:id/nome', (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  renomearContato(conversa.id, req.body.nome);
  res.redirect(`/painel/fila/${conversa.id}`);
});

router.post('/:id/finalizar', async (req, res) => {
  if (!temPermissao(req.atendente, 'finalizar_conversas')) {
    return res.status(403).send('Você não tem permissão para finalizar conversas.');
  }
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');

  const fluxo = carregarFluxo();
  const negocio = carregarNegocio();
  const motivo = req.body.motivo_id ? motivosEncerramento.resolverMotivo(Number(req.body.motivo_id)) : null;
  const temMotivos = motivosEncerramento.listarArvore({ soAtivos: true }).some((g) => g.motivos.length);
  if (!motivo && negocio.exigir_motivo_encerramento && temMotivos) {
    return renderizarFila(req, res, {
      conversaSelecionada: conversa,
      mensagens: listarMensagens(conversa.id),
      erro: 'Escolha o motivo do encerramento para finalizar.',
    });
  }
  finalizarConversa(conversa.id, 'atendente', motivo);

  const mensagemEncerramento = negocio.mensagem_encerramento || MENSAGEM_ENCERRAMENTO_PADRAO;
  const sock = obterSocket();
  let pesquisaEnviada = false;
  if (sock) {
    if (await enviarComSeguranca(sock, conversa.numero, mensagemEncerramento)) {
      registrarMensagem(conversa.numero, 'bot', mensagemEncerramento);
    }
    if (negocio.pesquisa_satisfacao && (await enviarComSeguranca(sock, conversa.numero, negocio.pesquisa_satisfacao))) {
      registrarMensagem(conversa.numero, 'bot', negocio.pesquisa_satisfacao);
      pesquisaEnviada = true;
    }
  }

  // Se a pesquisa foi mandada, a próxima mensagem do cliente é a nota dela, não um "oi" pro bot
  // — aguardarAvaliacao trata isso; sem pesquisa, volta direto ao normal como já era.
  if (pesquisaEnviada) aguardarAvaliacao(conversa.numero, fluxo);
  else encerrarAtendimento(conversa.numero, fluxo);

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

    // chave "Nota interna" ligada no campo de resposta: grava pra equipe e não manda nada
    if (req.body.interna) {
      if (arquivo) return reexibirComErro('Nota interna é só texto: tire o anexo ou desligue a chave Nota interna.');
      if (!texto) return reexibirComErro('Escreva a nota antes de salvar.');
      registrarNotaInterna(conversa.id, texto, req.atendente.id);
      return res.redirect(`/painel/fila/${conversa.id}`);
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
        registrarMensagem(conversa.numero, 'atendente', texto || (tipo ? LEGENDA_PADRAO[tipo] : '[PDF enviado]'), { tipo, url }, req.atendente.id);
      } else {
        await sock.sendMessage(conversa.numero, { text: texto });
        registrarMensagem(conversa.numero, 'atendente', texto, null, req.atendente.id);
      }
      res.redirect(`/painel/fila/${conversa.id}`);
    } catch (erro) {
      reexibirComErro('Não consegui enviar pelo WhatsApp agora. Tente de novo em instantes.');
    }
  });
});

module.exports = router;
module.exports.MENSAGEM_ENCERRAMENTO_PADRAO = MENSAGEM_ENCERRAMENTO_PADRAO;

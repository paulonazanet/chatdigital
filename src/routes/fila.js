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
  sincronizarConversa,
  registrarReacao,
  marcarReenviada,
  obterMensagem,
  descartarMensagemComFalha,
} = require('../conversas');
const atendimentos = require('../atendimentos');
const respostasRapidas = require('../respostas-rapidas');
const motivosEncerramento = require('../motivos-encerramento');
const marcadores = require('../marcadores');
const { listarSetoresDoAtendente, listarAtendentes } = require('../atendentes');
const { listarSetores } = require('../setores');
const { obterSocket, modoAtual } = require('../socket-atual');
const oficial = require('../whatsapp-oficial');
const instagram = require('../instagram');
const canais = require('../canais');
const { socketDoCanal } = require('../socket-atual');
const { resolverNumeroNoWhatsApp } = require('../whatsapp-numero');
const { carregarFluxo, carregarFluxoDaConversa, leitorDeFluxos } = require('../fluxo');
const { carregarNegocio } = require('../negocio');
const { encerrarAtendimento, iniciarFluxo, transferirParaHumano, aguardarAvaliacao, substituirVariaveis } = require('../flow-engine');
const { temPermissao } = require('../permissoes');
const { barramento } = require('../eventos');
const { tipoPorMimetype, salvarBufferDeMidia, converterParaOggOpus, lerArquivoDeMidia } = require('../midia');
const equipe = require('../equipe');
const retornos = require('../retornos');
const { calcularAlertas, alertaParaAtendente } = require('../alertas');

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

// Antes de assumir/puxar/iniciar: quem está em pausa volta da pausa sozinho (pegar conversa é voltar
// ao atendimento), e quem está no limite de conversas não pega mais uma. Reassumir uma conversa que já
// é dele não conta. Devolve o texto do erro, ou null quando pode.
function impedimentoParaPegar(atendente, conversa = null) {
  if (conversa && conversa.status === 'atendendo' && conversa.atendente_id === atendente.id) return null;
  let situacao = equipe.podeReceberConversa(atendente.id);
  if (situacao.emPausa) {
    equipe.encerrarPausa(atendente.id);
    situacao = equipe.podeReceberConversa(atendente.id);
  }
  return situacao.ok ? null : situacao.motivo;
}

const FILTROS = ['minhas', 'fila', 'bot', 'finalizadas', 'todas'];

// Conversas que o cliente começou a falar com o bot mas não terminaram no início do fluxo (ex.:
// pararam de responder no meio de uma pergunta) — aparecem no filtro "No bot", com botão Puxar.
// Usa `no_fluxo_atual` salvo no banco (não a memória do motor de fluxo), então continua
// funcionando certinho mesmo depois de reiniciar o processo.
// cada conversa segue o fluxo do número dela (E4, 3a parte)
function listarParadasNoFluxo(atendente) {
  const fluxoDe = leitorDeFluxos();
  return listarConversasComBot()
    .filter((c) => podeVerConversa(atendente, c))
    .filter((c) => c.no_fluxo_atual && c.no_fluxo_atual !== fluxoDe(c).inicio);
}

// Filtro e setor escolhidos: vêm da URL quando o atendente clica, e ficam num cookie pra
// sobreviver aos redirecionamentos (responder, assumir...) que voltam pra /painel/fila/:id.
function lerFiltros(req, res) {
  const salvo = req.cookies?.filtroFila ? String(req.cookies.filtroFila).split('|') : [];
  const filtro = FILTROS.includes(req.query.filtro) ? req.query.filtro : FILTROS.includes(salvo[0]) ? salvo[0] : 'minhas';
  const setor = req.query.setor !== undefined ? String(req.query.setor) : salvo[1] || '';
  const marcador = req.query.marcador !== undefined ? String(req.query.marcador).replace(/\D/g, '') : salvo[2] || '';
  // número de WhatsApp (E4, 3a parte), quando tem mais de um
  const numero = req.query.numero !== undefined ? String(req.query.numero).replace(/\D/g, '') : salvo[3] || '';
  if (req.query.filtro !== undefined || req.query.setor !== undefined || req.query.marcador !== undefined || req.query.numero !== undefined) {
    res.cookie('filtroFila', `${filtro}|${setor}|${marcador}|${numero}`, { httpOnly: true, sameSite: 'lax' });
  }
  // a busca não fica no cookie: é de momento, trocar de filtro já limpa
  return { filtro, setor, marcador, numero, busca: String(req.query.q || '').trim().slice(0, 60) };
}

// Uma lista só (opção "A ajustada" aprovada pelo Paulo): quem está esperando resposta há mais
// tempo em cima; `esperandoResposta` = a vez é do atendente (conversa ainda na fila, ou o
// cliente escreveu depois da última resposta) — é quem ganha a bolinha amarela/vermelha.
function montarListaFila(atendente, fluxo, { filtro, setor, marcador, numero = '', busca }) {
  const naFila = listarFila()
    .filter((c) => podeVerConversa(atendente, c))
    .map((c) => ({
      ...c,
      tipo: c.status === 'aguardando' ? 'fila' : 'atendendo',
      esperandoResposta: c.status === 'aguardando' || c.ultima_mensagem_remetente === 'cliente',
    }));
  const noBot = listarParadasNoFluxo(atendente).map((c) => ({ ...c, tipo: 'bot', esperandoResposta: false }));

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
  const todasAsVisiveis = [...porFiltro.todas, ...porFiltro.finalizadas];
  const marcadoresDe = marcadores.marcadoresPorConversa([...new Set(todasAsVisiveis.map((c) => c.id))]);
  const doMarcador = (c) => !marcador || (marcadoresDe[c.id] || []).some((m) => String(m.id) === marcador);
  const doNumero = (c) => !numero || String(c.canal_id || 1) === numero;
  const passa = (c) => doSetor(c) && doMarcador(c) && doNumero(c);
  const contagens = Object.fromEntries(['minhas', 'fila', 'bot', 'todas'].map((f) => [f, porFiltro[f].filter(passa).length]));
  const fixadas = marcadores.idsFixados(atendente.id);
  // com mais de um número ligado, cada conversa mostra por qual chegou
  const nomesDosNumeros = canais.temVariosNumeros() ? new Map(canais.listarCanais().map((k) => [k.id, k.nome])) : new Map();

  const desde = (c) => (c.esperandoResposta ? c.esperando_desde || c.ultima_mensagem_em : c.ultima_mensagem_em) || c.atualizado_em;
  const itens = porFiltro[filtro].filter(passa).filter((c) => conversaCasaComBusca(c, busca)).sort((a, b) => {
    // fixadas pelo atendente ficam no topo (entre elas, a mesma ordem de sempre)
    if (fixadas.has(a.id) !== fixadas.has(b.id)) return fixadas.has(a.id) ? -1 : 1;
    if (a.esperandoResposta !== b.esperandoResposta) return a.esperandoResposta ? -1 : 1;
    // esperando: quem espera há mais tempo primeiro; o resto: atividade mais recente primeiro
    return a.esperandoResposta ? desde(a).localeCompare(desde(b)) : desde(b).localeCompare(desde(a));
  });
  return {
    itens: itens.map((c) => ({ ...c, desde: desde(c), marcadores: marcadoresDe[c.id] || [], fixada: fixadas.has(c.id), numeroNome: nomesDosNumeros.get(c.canal_id || 1) || null })),
    contagens,
  };
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

function renderizarFila(req, res, { conversaSelecionada = null, mensagens = [], erro = null, erroNovaConversa = null } = {}) {
  const fluxo = carregarFluxo();
  const negocio = carregarNegocio();
  let respostas = [];
  let protocoloAtual = null;
  if (conversaSelecionada) {
    const lista = atendimentos.listarAtendimentosDaConversa(conversaSelecionada.id);
    mensagens = atendimentos.marcarFaixasDeAtendimento(mensagens, lista);
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
    marcadorFiltro: filtros.marcador,
    numeroFiltro: filtros.numero,
    // filtro "Número": todos os ligados (o Instagram também); a Nova conversa só sai por WhatsApp
    numerosLigados: canais.temVariosNumeros() ? canais.listarCanais({ soAtivos: true }) : [],
    numerosParaNovaConversa: canais.listarCanais({ soAtivos: true, tipo: 'celular' }),
    numeroDaConversa: conversaSelecionada && canais.temVariosNumeros() ? canais.obterCanal(conversaSelecionada.canal_id || 1) : null,
    marcadoresAtivos: marcadores.listarMarcadores({ soAtivos: true }),
    marcadoresDaConversa: conversaSelecionada ? marcadores.marcadoresPorConversa([conversaSelecionada.id])[conversaSelecionada.id] || [] : [],
    conversaFixada: conversaSelecionada ? marcadores.idsFixados(req.atendente.id).has(conversaSelecionada.id) : false,
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
    podeVerContatos: temPermissao(req.atendente, 'gerenciar_contatos'),
    minhaPausa: equipe.descreverPausa(equipe.pausaAtual(req.atendente.id)),
    motivosPausa: equipe.listarMotivosPausa({ soAtivos: true }),
    meuLimite: { atendendo: equipe.contarConversasAtendendo(req.atendente.id), limite: req.atendente.limite_conversas || 0 },
    alertas: calcularAlertas({ negocio }).filter((a) => alertaParaAtendente(a, req.atendente, temPermissao)),
    retornosDaConversa: conversaSelecionada ? retornos.retornosDaConversa(conversaSelecionada.id) : [],
    // API oficial (E4): depois de 24 h sem o cliente escrever, só vai modelo aprovado
    viaOficial: modoAtual() === 'oficial' && !(conversaSelecionada && instagram.ehInstagram(conversaSelecionada.numero)),
    foraDaJanela: modoAtual() === 'oficial' && !!conversaSelecionada && !instagram.ehInstagram(conversaSelecionada.numero) && !oficial.dentroDaJanela(conversaSelecionada.id),
    // Instagram (E4): só dá para responder até 24 h depois da última mensagem do cliente
    instagramForaDaJanela: !!conversaSelecionada && instagram.ehInstagram(conversaSelecionada.numero) && !oficial.dentroDaJanela(conversaSelecionada.id),
    modelosAprovados: modoAtual() === 'oficial' ? oficial.listarModelos({ soAprovados: true }) : [],
    erroRetorno: res.locals.erroRetorno || null,
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
  // por qual número começar (com mais de um ligado; E4, 3a parte)
  const canalEscolhido = canais.listarCanais({ soAtivos: true, tipo: 'celular' }).find((k) => String(k.id) === String(req.body.canal_id)) || null;
  const sock = canalEscolhido && modoAtual() === 'celular' ? socketDoCanal(canalEscolhido.id) : obterSocket();

  if (!numeroDigitado) {
    return renderizarFila(req, res, { erroNovaConversa: 'Informe um número de telefone (com DDD e DDI).' });
  }
  if (!sock) {
    return renderizarFila(req, res, { erroNovaConversa: 'O bot não está conectado ao WhatsApp agora — não dá pra iniciar conversa.' });
  }
  const impedimentoNova = impedimentoParaPegar(req.atendente);
  if (impedimentoNova) return renderizarFila(req, res, { erroNovaConversa: impedimentoNova });

  try {
    const numero = await resolverNumeroNoWhatsApp(sock, numeroDigitado);
    if (!numero) {
      return renderizarFila(req, res, { erroNovaConversa: 'Esse número não tem WhatsApp, ou está digitado errado.' });
    }
    const conversa = obterOuCriarConversa(numero);
    if (canalEscolhido) require('../db').db.prepare('UPDATE conversas SET canal_id = ? WHERE id = ?').run(canalEscolhido.id, conversa.id);
    assumirConversa(conversa.id, req.atendente.id);
    // Sem isso, o motor de fluxo (memória separada do banco) não sabe que essa conversa já está
    // com um atendente, e o bot mostra o menu automático assim que o cliente responder.
    transferirParaHumano(numero, carregarFluxoDaConversa(numero));

    if (texto && (await enviarComSeguranca(sock, numero, texto))) {
      registrarMensagem(numero, 'atendente', texto, null, req.atendente.id);
    }

    res.redirect(`/painel/fila/${conversa.id}`);
  } catch (erro) {
    renderizarFila(req, res, { erroNovaConversa: 'Não consegui iniciar a conversa agora. Tente de novo em instantes.' });
  }
});

// Mandar modelo aprovado (API oficial): fora das 24 h é o único jeito de falar com o cliente.
// `modelo` = "nome|idioma"; `parametros` = o que vai em {{1}}, {{2}}... do texto do modelo.
router.post('/:id/modelo', async (req, res) => {
  if (!temPermissao(req.atendente, 'responder_conversas')) return res.status(403).send('Você não tem permissão para responder conversas.');
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  const reexibir = (erro) => renderizarFila(req, res, { conversaSelecionada: conversa, mensagens: listarMensagens(conversa.id), erro });
  const canal = obterSocket();
  if (modoAtual() !== 'oficial' || !canal?.enviarModelo) return reexibir('Modelo só existe na API oficial.');
  const [nome, idioma] = String(req.body.modelo || '').split('|');
  const modelo = nome && idioma ? oficial.obterModelo(nome, idioma) : null;
  if (!modelo || modelo.situacao !== 'APPROVED') return reexibir('Escolha um modelo aprovado.');
  const parametros = [].concat(req.body.parametros || []).map((p) => String(p).trim()).slice(0, modelo.variaveis);
  if (parametros.length < modelo.variaveis || parametros.some((p) => !p)) return reexibir(`Preencha as ${modelo.variaveis} informações do modelo.`);
  const texto = oficial.textoDoModelo(modelo, parametros);
  try {
    const enviada = await canal.enviarModelo(conversa.numero, { nome, idioma, parametros });
    registrarMensagem(conversa.numero, 'atendente', texto, null, req.atendente.id, { waId: enviada?.key?.id, deMim: true });
    res.redirect(`/painel/fila/${conversa.id}`);
  } catch (erro) {
    reexibir(`O modelo não foi enviado: ${erro.message}`);
  }
});

// Agendar retorno (Ações > Agendar retorno): dia e hora no horário de Recife (UTC-3)
router.post('/:id/retorno', (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  const data = /^\d{4}-\d{2}-\d{2}$/.test(req.body.data || '') ? req.body.data : '';
  const hora = /^\d{2}:\d{2}$/.test(req.body.hora || '') ? req.body.hora : '';
  const atendenteId = listarAtendentes().some((a) => a.ativo && String(a.id) === String(req.body.atendente_id)) ? Number(req.body.atendente_id) : req.atendente.id;
  const resultado = retornos.agendarRetorno({
    conversaId: conversa.id,
    atendenteId,
    criadoPor: req.atendente.id,
    quando: data && hora ? `${data}T${hora}:00-03:00` : '',
    nota: req.body.nota,
    mensagem: req.body.mandar_mensagem ? req.body.mensagem : '',
  });
  if (resultado.erro) {
    res.locals.erroRetorno = resultado.erro;
    return renderizarFila(req, res, { conversaSelecionada: conversa, mensagens: listarMensagens(conversa.id) });
  }
  res.redirect(`/painel/fila/${conversa.id}`);
});
router.post('/:id/retorno/:retornoId/cancelar', (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  if (retornos.retornosDaConversa(conversa.id).some((r) => r.id === Number(req.params.retornoId))) retornos.cancelarRetorno(Number(req.params.retornoId));
  res.redirect(`/painel/fila/${conversa.id}`);
});

// Pausa do atendente (botão no topo da Fila). `voltar`: a tela da Fila onde ele estava.
function voltarParaFila(req, res) {
  const voltar = String(req.body.voltar || '');
  res.redirect(/^\/painel\/fila(\/\d+)?(\?[\w=&%.-]*)?$/.test(voltar) ? voltar : '/painel/fila');
}
router.post('/pausa', (req, res) => {
  equipe.iniciarPausa(req.atendente.id, Number(req.body.motivo_id));
  voltarParaFila(req, res);
});
router.post('/pausa/voltar', (req, res) => {
  equipe.encerrarPausa(req.atendente.id);
  voltarParaFila(req, res);
});

router.get('/:id', (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  renderizarFila(req, res, { conversaSelecionada: conversa, mensagens: listarMensagens(conversa.id) });
});

router.post('/:id/assumir', async (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  const impedimento = impedimentoParaPegar(req.atendente, conversa);
  if (impedimento) return renderizarFila(req, res, { conversaSelecionada: conversa, mensagens: listarMensagens(conversa.id), erro: impedimento });
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
  const impedimento = impedimentoParaPegar(req.atendente, conversa);
  if (impedimento) return renderizarFila(req, res, { conversaSelecionada: conversa, mensagens: listarMensagens(conversa.id), erro: impedimento });
  transferirParaHumano(conversa.numero, carregarFluxoDaConversa(conversa.numero));
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

  // pra um atendente: ele não pode estar em pausa nem no limite (menos se já é dele)
  if (atendenteId && !(conversa.status === 'atendendo' && conversa.atendente_id === atendenteId)) {
    const situacao = equipe.podeReceberConversa(atendenteId, atendenteId === req.atendente.id ? 'voce' : 'outro');
    if (!situacao.ok) {
      return renderizarFila(req, res, {
        conversaSelecionada: conversa,
        mensagens: listarMensagens(conversa.id),
        erro: `${situacao.motivo} Transfira só para o setor, ou para outra pessoa.`,
      });
    }
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

// Marcadores da conversa (Ações > Marcadores): troca pelos marcados no formulário.
router.post('/:id/marcadores', (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  marcadores.definirMarcadoresDaConversa(conversa.id, [].concat(req.body.marcadores || []).map(Number));
  res.redirect(`/painel/fila/${conversa.id}`);
});

// Fixar / desfixar no topo da lista (só pra quem fixou)
router.post('/:id/fixar', (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  marcadores.alternarFixada(req.atendente.id, conversa.id);
  res.redirect(`/painel/fila/${conversa.id}`);
});

// Devolver ao bot: fecha o atendimento (sem mensagem de encerramento nem pesquisa) e o bot
// recomeça o fluxo do início, mandando o menu pro cliente. Se o fluxo transferir de novo, abre
// um atendimento novo normalmente.
router.post('/:id/devolver-bot', async (req, res) => {
  if (!temPermissao(req.atendente, 'responder_conversas')) {
    return res.status(403).send('Você não tem permissão para mexer nas conversas.');
  }
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  const sock = obterSocket();
  if (!sock) {
    return renderizarFila(req, res, {
      conversaSelecionada: conversa,
      mensagens: listarMensagens(conversa.id),
      erro: 'O bot não está conectado ao WhatsApp agora — não dá pra devolver a conversa pra ele.',
    });
  }
  const fluxo = carregarFluxoDaConversa(conversa.numero);
  registrarNotaInterna(conversa.id, `Devolvida ao bot (menu inicial) por ${req.atendente.nome}.`);
  finalizarConversa(conversa.id, 'outro');
  const texto = await iniciarFluxo({ numero: conversa.numero, negocio: carregarNegocio(), fluxo });
  if (texto && (await enviarComSeguranca(sock, conversa.numero, texto))) registrarMensagem(conversa.numero, 'bot', texto);
  sincronizarConversa(conversa.numero, fluxo, { vinhaDoBot: true });
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

  const fluxo = carregarFluxoDaConversa(conversa.numero);
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

// Monta o conteúdo do Baileys pra texto ou mídia (imagem, vídeo, áudio, PDF) e manda, citando
// `citada` (mensagem do histórico com wa_id) se vier. Devolve o id da mensagem no WhatsApp.
// `urlLocal`: o arquivo já salvo em /uploads (o Instagram só recebe mídia por endereço público)
async function enviarConteudo(sock, numero, { texto, midia = null, citada = null, urlLocal = null }) {
  let conteudo;
  if (!midia) conteudo = { text: texto };
  else if (midia.tipo === 'imagem') conteudo = { image: midia.buffer, caption: texto || undefined };
  else if (midia.tipo === 'video') conteudo = { video: midia.buffer, caption: texto || undefined };
  else if (midia.tipo === 'audio') conteudo = { audio: midia.buffer, mimetype: midia.mimetype };
  else conteudo = { document: midia.buffer, mimetype: 'application/pdf', fileName: midia.nome || 'documento.pdf', caption: texto || undefined };
  const opcoes = citada?.wa_id
    ? { quoted: { key: { remoteJid: numero, id: citada.wa_id, fromMe: !!citada.wa_de_mim }, message: { conversation: citada.texto } } }
    : undefined;
  if (urlLocal && instagram.ehInstagram(numero)) conteudo.urlLocal = urlLocal;
  const enviada = await sock.sendMessage(numero, conteudo, opcoes);
  return enviada?.key?.id || null;
}

// Mensagem do histórico desta conversa (pra citar, reagir, reenviar), ou null
function mensagemDaConversa(conversa, id) {
  const m = id ? obterMensagem(Number(id)) : null;
  return m && m.conversa_id === conversa.id ? m : null;
}

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
    const citada = mensagemDaConversa(conversa, req.body.citar_id);

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
    if (instagram.ehInstagram(conversa.numero) && !oficial.dentroDaJanela(conversa.id)) {
      return reexibirComErro('Passaram 24 horas desde a última mensagem do cliente: pelo Instagram não dá mais para responder. Quando ele escrever de novo, a conversa volta a aceitar resposta.');
    }
    if (modoAtual() === 'oficial' && !instagram.ehInstagram(conversa.numero) && !oficial.dentroDaJanela(conversa.id)) {
      return reexibirComErro('Passaram 24 horas desde a última mensagem do cliente: pela API oficial, só dá para mandar um modelo aprovado (botão "Mandar modelo").');
    }

    let midia = null;
    let textoDoHistorico = texto;
    if (arquivo) {
      const tipo = tipoPorMimetype(arquivo.mimetype);
      const ehPdf = arquivo.mimetype === 'application/pdf';
      if (!tipo && !ehPdf) return reexibirComErro('Só dá pra mandar imagem, vídeo, áudio ou PDF por aqui.');
      midia = { tipo, buffer: arquivo.buffer, mimetype: arquivo.mimetype, nome: arquivo.originalname };
      if (tipo === 'audio' && !arquivo.mimetype.startsWith('audio/ogg')) {
        // O WhatsApp só reproduz áudio de verdade em ogg/opus — outros formatos (webm gravado
        // no navegador, mp3, m4a...) às vezes "enviam" sem erro nenhum aqui, mas não chegam no
        // destinatário. converterParaOggOpus nunca rejeita: se o ffmpeg falhar/não existir,
        // cai pro buffer original (ver midia.js) — mandar do jeito que veio ainda é melhor que
        // travar o envio inteiro por causa da conversão.
        midia.buffer = await converterParaOggOpus(arquivo.buffer);
        midia.mimetype = 'audio/ogg; codecs=opus';
      }
      // PDF fica com midia_tipo nulo (a coluna só aceita imagem/video/audio) — o link genérico
      // de download na tela usa midia_url mesmo sem tipo, ver fila/lista.ejs.
      textoDoHistorico = texto || (tipo ? LEGENDA_PADRAO[tipo] : '[PDF enviado]');
    }
    // o arquivo é salvo antes de mandar: se o envio falhar, o Reenviar usa ele
    const midiaSalva = midia ? { tipo: midia.tipo, url: salvarBufferDeMidia(midia.buffer, midia.mimetype) } : null;

    try {
      const waId = await enviarConteudo(sock, conversa.numero, { texto, midia, citada, urlLocal: midiaSalva?.url });
      registrarMensagem(conversa.numero, 'atendente', textoDoHistorico, midiaSalva, req.atendente.id, { waId, deMim: true, citadaId: citada?.id });
      res.redirect(`/painel/fila/${conversa.id}`);
    } catch (erro) {
      console.error(`Falha ao enviar mensagem para ${conversa.numero}:`, erro);
      // fica no histórico com aviso e botão Reenviar, pra não perder o que foi escrito
      registrarMensagem(conversa.numero, 'atendente', textoDoHistorico, midiaSalva, req.atendente.id, { citadaId: citada?.id, falha: true });
      reexibirComErro(
        instagram.ehInstagram(conversa.numero)
          ? `Não consegui enviar pelo Instagram: ${erro.message} A mensagem ficou no histórico com o botão Reenviar.`
          : 'Não consegui enviar pelo WhatsApp agora. A mensagem ficou no histórico com o botão Reenviar.',
      );
    }
  });
});

// Reenviar uma mensagem do atendente que falhou (o mesmo texto, ou o mesmo arquivo de antes)
router.post('/:id/reenviar/:mensagemId', async (req, res) => {
  if (!temPermissao(req.atendente, 'responder_conversas')) {
    return res.status(403).send('Você não tem permissão para responder conversas.');
  }
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  const m = mensagemDaConversa(conversa, req.params.mensagemId);
  if (!m || !m.falha) return res.redirect(`/painel/fila/${conversa.id}`);
  const reexibirComErro = (erro) => renderizarFila(req, res, { conversaSelecionada: conversa, mensagens: listarMensagens(conversa.id), erro });

  const sock = obterSocket();
  if (!sock) return reexibirComErro('O bot não está conectado ao WhatsApp agora — tente reenviar daqui a pouco.');
  let midia = null;
  if (m.midia_url) {
    const arquivo = lerArquivoDeMidia(m.midia_url);
    if (!arquivo) return reexibirComErro('O arquivo dessa mensagem não existe mais: descarte e mande de novo.');
    midia = { tipo: m.midia_tipo, ...arquivo };
  }
  // sem legenda escrita, o histórico guardou só o "[imagem enviada]" — esse não vai pro cliente
  const legenda = midia && [...Object.values(LEGENDA_PADRAO), '[PDF enviado]'].includes(m.texto) ? '' : m.texto;
  try {
    const waId = await enviarConteudo(sock, conversa.numero, { texto: legenda, midia, citada: m.citada_id ? obterMensagem(m.citada_id) : null, urlLocal: m.midia_url });
    marcarReenviada(m.id, waId);
    res.redirect(`/painel/fila/${conversa.id}`);
  } catch (erro) {
    console.error(`Falha ao reenviar mensagem para ${conversa.numero}:`, erro);
    reexibirComErro('Ainda não consegui enviar pelo WhatsApp. Tente de novo em instantes.');
  }
});

router.post('/:id/descartar/:mensagemId', (req, res) => {
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  if (temPermissao(req.atendente, 'responder_conversas') && mensagemDaConversa(conversa, req.params.mensagemId)) {
    descartarMensagemComFalha(Number(req.params.mensagemId));
  }
  res.redirect(`/painel/fila/${conversa.id}`);
});

// Reagir com emoji numa mensagem (como no WhatsApp); o mesmo emoji de novo tira a reação
const REACOES = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
router.post('/:id/reagir', async (req, res) => {
  if (!temPermissao(req.atendente, 'responder_conversas')) {
    return res.status(403).send('Você não tem permissão para responder conversas.');
  }
  const conversa = obterConversaPorId(Number(req.params.id));
  if (!conversa || !podeVerConversa(req.atendente, conversa)) return res.redirect('/painel/fila');
  const m = mensagemDaConversa(conversa, req.body.mensagem_id);
  const emoji = REACOES.includes(req.body.emoji) ? req.body.emoji : null;
  if (!m || !m.wa_id || !emoji) return res.redirect(`/painel/fila/${conversa.id}`);
  const sock = obterSocket();
  if (!sock) {
    return renderizarFila(req, res, {
      conversaSelecionada: conversa,
      mensagens: listarMensagens(conversa.id),
      erro: 'O bot não está conectado ao WhatsApp agora — não dá pra reagir.',
    });
  }
  const novo = m.reacao_atendente === emoji ? '' : emoji;
  try {
    await sock.sendMessage(conversa.numero, { react: { text: novo, key: { remoteJid: conversa.numero, id: m.wa_id, fromMe: !!m.wa_de_mim } } });
    registrarReacao(m.id, 'atendente', novo);
  } catch (erro) {
    console.error(`Falha ao reagir na mensagem de ${conversa.numero}:`, erro);
  }
  res.redirect(`/painel/fila/${conversa.id}`);
});

module.exports = router;
module.exports.MENSAGEM_ENCERRAMENTO_PADRAO = MENSAGEM_ENCERRAMENTO_PADRAO;
module.exports.REACOES = REACOES;

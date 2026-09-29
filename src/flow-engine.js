const { salvarRegistro } = require('./registros');

const MAX_PASSOS_POR_TURNO = 25; // trava contra fluxo mal configurado (ciclo sem nó de pergunta/fim)

const conversas = new Map();

function estadoInicial(fluxo, numero) {
  return { numero, no: fluxo.inicio, vars: {}, aguardando: false, humano: false, aguardandoAvaliacao: false };
}

function obterEstado(numero, fluxo) {
  if (!conversas.has(numero)) conversas.set(numero, estadoInicial(fluxo, numero));
  return conversas.get(numero);
}

function resolverCaminho(caminho, contexto) {
  return caminho.split('.').reduce((acc, chave) => (acc == null ? acc : acc[chave]), contexto);
}

function formatarValor(valor) {
  if (valor == null) return '';
  if (Array.isArray(valor)) return valor.join(', ');
  return String(valor);
}

function substituir(texto, contexto) {
  if (texto == null) return '';
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, caminho) => formatarValor(resolverCaminho(caminho, contexto)));
}

function substituirObjeto(obj, contexto) {
  const resultado = {};
  for (const [chave, valor] of Object.entries(obj)) {
    resultado[chave] = typeof valor === 'string' ? substituir(valor, contexto) : valor;
  }
  return resultado;
}

function gerarOpcoesDinamicas(def, contexto) {
  const lista = resolverCaminho(def.fonte, contexto) || [];
  return lista.map((item, i) => {
    const preco = def.preco_campo ? item[def.preco_campo] : undefined;
    const rotulo = `${i + 1}. ${item[def.rotulo_campo]}${preco ? ` - R$ ${preco}` : ''}`;
    return { numero: String(i + 1), rotulo, valor: item[def.valor_campo], item };
  });
}

function montarTexto(no, contexto, { invalido = false } = {}) {
  let texto;
  if (no.texto_dinamico) {
    const { fonte, campo_titulo, campo_corpo, rodape } = no.texto_dinamico;
    const lista = resolverCaminho(fonte, contexto) || [];
    texto = lista.map((item) => `*${item[campo_titulo]}*\n${item[campo_corpo]}`).join('\n\n');
    if (rodape) texto += `\n\n${rodape}`;
  } else {
    texto = substituir(no.texto, contexto);
  }

  if (no.opcoes_dinamicas) {
    const opcoes = gerarOpcoesDinamicas(no.opcoes_dinamicas, contexto);
    texto += `\n\n${opcoes.map((o) => o.rotulo).join('\n')}`;
  }
  if (no.opcao_extra) {
    texto += `\n${substituir(no.opcao_extra.rotulo, contexto)}`;
  }
  if (invalido) {
    texto = `Não entendi. 🤔\n\n${texto}`;
  }
  return texto;
}

// Cada janela é uma string "dias horaInicio-horaFim", ex.: "1,2,3,4,5 08:00-18:00" (dias:
// 0=domingo … 6=sábado, separados por vírgula). `agora` é injetável pra dar pra testar sem
// depender do relógio real.
function estaDentroDoHorario(no, agora = new Date()) {
  const dia = agora.getDay();
  const hora = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;

  return (no.janelas || []).some((janela) => {
    const [diasStr, horasStr] = String(janela).trim().split(/\s+/);
    if (!diasStr || !horasStr) return false;
    const dias = diasStr.split(',').map((d) => Number(d.trim()));
    if (!dias.includes(dia)) return false;
    const [inicio, fim] = horasStr.split('-');
    return Boolean(inicio) && Boolean(fim) && hora >= inicio && hora <= fim;
  });
}

function tratarResposta(no, msg, contexto) {
  const msgComparavel = msg.toLowerCase();

  if (no.opcao_extra && msgComparavel === String(no.opcao_extra.quando).toLowerCase()) {
    return { ok: true, proximo: no.opcao_extra.proximo };
  }

  if (no.opcoes_dinamicas) {
    const escolhida = gerarOpcoesDinamicas(no.opcoes_dinamicas, contexto).find((o) => o.numero === msg);
    if (!escolhida) return { ok: false };
    if (no.variavel) contexto.vars[no.variavel] = escolhida.valor;
    if (no.opcoes_dinamicas.guardar_item_em) contexto.vars[no.opcoes_dinamicas.guardar_item_em] = escolhida.item;
    return { ok: true, proximo: no.proximo };
  }

  if (no.opcoes) {
    const escolhida = no.opcoes.find((o) => String(o.quando).toLowerCase() === msgComparavel);
    if (!escolhida) {
      if (no.padrao) return { ok: true, proximo: no.padrao };
      return { ok: false };
    }
    if (no.variavel) contexto.vars[no.variavel] = msg;
    return { ok: true, proximo: escolhida.proximo };
  }

  if (no.variavel) contexto.vars[no.variavel] = msg;
  return { ok: true, proximo: no.proximo };
}

async function executar(estado, contexto, fluxo) {
  const textos = [];
  let passos = 0;

  while (true) {
    if (++passos > MAX_PASSOS_POR_TURNO) {
      textos.push('Desculpa, tive um problema interno (fluxo com ciclo sem parada). Digite *menu* para recomeçar.');
      Object.assign(estado, estadoInicial(fluxo, estado.numero));
      break;
    }

    const no = fluxo.nos[estado.no];
    if (!no) {
      textos.push('Desculpa, tive um problema interno. Digite *menu* para recomeçar.');
      Object.assign(estado, estadoInicial(fluxo, estado.numero));
      break;
    }

    if (no.tipo === 'inicio') {
      estado.no = no.proximo;
      continue;
    }

    if (no.tipo === 'mensagem') {
      textos.push(montarTexto(no, contexto));
      estado.no = no.proximo;
      continue;
    }

    if (no.tipo === 'condicao') {
      const valor = contexto.vars[no.variavel];
      const caso = (no.casos || []).find((c) => String(c.quando) === String(valor));
      estado.no = caso ? caso.proximo : no.padrao;
      continue;
    }

    if (no.tipo === 'salvar') {
      const registro = { numero: estado.numero };
      for (const [campo, caminho] of Object.entries(no.campos || {})) {
        registro[campo] = resolverCaminho(caminho, contexto);
      }
      salvarRegistro(no.colecao, registro);
      estado.no = no.proximo;
      continue;
    }

    if (no.tipo === 'api') {
      try {
        const corpo = no.corpo ? substituirObjeto(no.corpo, contexto) : undefined;
        const resposta = await fetch(substituir(no.url, contexto), {
          method: no.metodo || 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: corpo ? JSON.stringify(corpo) : undefined,
        });
        const dados = await resposta.json().catch(() => null);
        if (no.guardar_em) contexto.vars[no.guardar_em] = dados;
        estado.no = resposta.ok ? no.proximo : no.proximo_erro || no.proximo;
      } catch (erro) {
        if (no.guardar_em) contexto.vars[no.guardar_em] = null;
        estado.no = no.proximo_erro || no.proximo;
      }
      continue;
    }

    if (no.tipo === 'horario') {
      estado.no = estaDentroDoHorario(no) ? no.dentro : no.fora;
      continue;
    }

    if (no.tipo === 'pergunta') {
      textos.push(montarTexto(no, contexto));
      estado.aguardando = true;
      break;
    }

    if (no.tipo === 'transferir') {
      textos.push(montarTexto(no, contexto));
      estado.humano = true;
      estado.setor = no.setor || null;
      break;
    }

    if (no.tipo === 'fim') {
      if (no.texto) textos.push(substituir(no.texto, contexto));
      Object.assign(estado, estadoInicial(fluxo, estado.numero));
      break;
    }

    throw new Error(`Tipo de nó desconhecido: "${no.tipo}" (nó "${estado.no}")`);
  }

  return textos.join('\n\n');
}

/**
 * Processa uma mensagem recebida e devolve o texto de resposta (ou null se o bot deve ficar em
 * silêncio, por exemplo quando a conversa foi transferida para um atendente humano).
 */
async function processarMensagem({ numero, texto, negocio, fluxo }) {
  const msg = texto.trim();
  const estado = obterEstado(numero, fluxo);
  const palavras = fluxo.reinicio_palavras || [];
  const ehReinicio = palavras.some((p) => p.toLowerCase() === msg.toLowerCase());

  if (ehReinicio) {
    Object.assign(estado, estadoInicial(fluxo, numero));
    return executar(estado, { negocio, vars: estado.vars }, fluxo);
  }

  // Resposta à pesquisa de satisfação mandada ao finalizar (ver aguardarAvaliacao) — não é um nó
  // do fluxo de verdade, então sem isso essa mensagem cairia direto no "estado.no = fluxo.inicio"
  // logo abaixo e mostraria o menu de novo, em vez de agradecer a nota.
  if (estado.aguardandoAvaliacao) {
    estado.aguardandoAvaliacao = false;
    salvarRegistro('avaliacoes', { numero, nota: msg });
    return 'Muito obrigado pela sua avaliação! 🙏';
  }

  if (estado.humano) return null;

  const contexto = { negocio, vars: estado.vars };

  if (estado.aguardando) {
    const no = fluxo.nos[estado.no];
    const resultado = tratarResposta(no, msg, contexto);
    if (!resultado.ok) {
      return montarTexto(no, contexto, { invalido: true });
    }
    estado.no = resultado.proximo;
    estado.aguardando = false;
    return executar(estado, contexto, fluxo);
  }

  estado.no = fluxo.inicio;
  return executar(estado, contexto, fluxo);
}

function obterEstadoConversa(numero, fluxo) {
  return obterEstado(numero, fluxo);
}

/**
 * Devolve o controle da conversa pro bot (estado inicial, "menu" de novo). Chamar sempre que um
 * atendente finalizar um atendimento — sem isso o bot acha que a conversa continua transferida e
 * fica em silêncio pra sempre com aquele cliente.
 */
function encerrarAtendimento(numero, fluxo) {
  const estado = obterEstado(numero, fluxo);
  Object.assign(estado, estadoInicial(fluxo, numero));
}

/**
 * Marca a conversa como transferida pra um humano sem passar por um nó "transferir" do fluxo —
 * usado quando o cliente manda algo que o bot não consegue processar sozinho (ex.: mídia).
 */
function transferirParaHumano(numero, fluxo, setor = null) {
  const estado = obterEstado(numero, fluxo);
  estado.humano = true;
  estado.setor = setor;
}

/**
 * Como encerrarAtendimento, mas a PRÓXIMA mensagem do cliente é tratada como a nota da pesquisa
 * de satisfação (salva em `registros` e agradece) em vez de reabrir o menu — só então volta ao
 * normal. Chamar depois de mandar a pesquisa de satisfação ao finalizar um atendimento.
 */
function aguardarAvaliacao(numero, fluxo) {
  const estado = obterEstado(numero, fluxo);
  Object.assign(estado, estadoInicial(fluxo, numero));
  estado.aguardandoAvaliacao = true;
}

module.exports = {
  processarMensagem,
  obterEstadoConversa,
  encerrarAtendimento,
  transferirParaHumano,
  aguardarAvaliacao,
  substituirVariaveis: substituir,
  estaDentroDoHorario,
};

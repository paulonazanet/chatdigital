const { salvarRegistro } = require('./registros');
const { registrarNota } = require('./atendimentos');
const { dentroDasJanelas } = require('./horario');
const { feriadoAgora } = require('./feriados');

const MAX_PASSOS_POR_TURNO = 25; // trava contra fluxo mal configurado (ciclo sem nó de pergunta/fim)

// Depois desse tempo sem o cliente responder a pesquisa de satisfação, a próxima mensagem dele
// não é mais tratada como nota — sem isso, alguém que volta dias depois com uma pergunta de
// verdade so ouviria "obrigado pela avaliação" em vez de ser atendido.
const MINUTOS_LIMITE_AVALIACAO = 30;

const conversas = new Map();

function estadoInicial(fluxo, numero) {
  return { numero, no: fluxo.inicio, vars: {}, aguardando: false, humano: false, atendenteId: null, aguardandoAvaliacao: false, aguardandoAvaliacaoDesde: null };
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

// Pra texto que vai pro cliente: a linha cuja variável ficou vazia sai inteira, em vez de ir
// quebrada — ex.: "Se preferir já chamar direto: ." quando o número do atendente não está
// configurado. Linhas sem variável nenhuma ficam como estão.
function substituirTextoDeMensagem(texto, contexto) {
  if (texto == null) return '';
  return texto
    .split('\n')
    .filter((linha) => {
      const variaveis = [...linha.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)];
      return variaveis.every(([, caminho]) => formatarValor(resolverCaminho(caminho, contexto)).trim() !== '');
    })
    .map((linha) => substituir(linha, contexto))
    .join('\n');
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
    texto = substituirTextoDeMensagem(no.texto, contexto);
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

// (regra das janelas em horario.js, compartilhada com o horário próprio dos setores)
function estaDentroDoHorario(no, agora = new Date()) {
  return dentroDasJanelas(no.janelas, agora);
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

// `simulacao`: lista de eventos do simulador do editor (Testar). Com ela, nada é gravado nem chamado
// de verdade: "salvar", "nota" e "api" só contam o que fariam (a API segue pelo caminho de sucesso).
async function executar(estado, contexto, fluxo, simulacao = null) {
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
      if (simulacao) simulacao.push({ tipo: 'salvar', texto: `Salvaria um registro em "${no.colecao}": ${JSON.stringify(registro)}` });
      else salvarRegistro(no.colecao, registro);
      estado.no = no.proximo;
      continue;
    }

    if (no.tipo === 'api') {
      if (simulacao) {
        simulacao.push({ tipo: 'api', texto: `Chamaria a API ${no.metodo || 'GET'} ${substituir(no.url, contexto)} (no teste não chama; segue como se desse certo)` });
        if (no.guardar_em) contexto.vars[no.guardar_em] = null;
        estado.no = no.proximo;
        continue;
      }
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
      // feriado sem expediente (Configurações > Feriados) = fora do horário, com a mensagem dele antes
      const feriado = feriadoAgora();
      if (feriado && feriado.mensagem) textos.push(substituirTextoDeMensagem(feriado.mensagem, contexto));
      const dentro = !feriado && estaDentroDoHorario(no);
      if (simulacao) simulacao.push({ tipo: 'horario', texto: feriado ? `Hoje é feriado (${feriado.nome}): seguiu por "fora do horário"` : dentro ? 'Agora está dentro do horário' : 'Agora está fora do horário' });
      estado.no = dentro ? no.dentro : no.fora;
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
      if (simulacao) simulacao.push({ tipo: 'transferir', texto: `A conversa iria para a fila do setor "${no.setor || 'sem setor'}". Daqui em diante o bot não responde mais.` });
      break;
    }

    // Transferir direto pra um atendente: a conversa já entra "atendendo" com ele (ver
    // sincronizarConversa); o setor é opcional
    if (no.tipo === 'transferir_atendente') {
      if (no.texto) textos.push(montarTexto(no, contexto));
      estado.humano = true;
      estado.setor = no.setor || null;
      estado.atendenteId = no.atendente_id ? Number(no.atendente_id) : null;
      if (simulacao) simulacao.push({ tipo: 'transferir', texto: `A conversa iria direto para um atendente${no.setor ? ` (setor "${no.setor}")` : ''}. Daqui em diante o bot não responde mais.` });
      break;
    }

    // Aguardar: não manda nada, espera a próxima mensagem do cliente (guarda na variável, se tiver)
    if (no.tipo === 'aguardar') {
      estado.aguardando = true;
      break;
    }

    // Nota interna no histórico da conversa (o cliente não recebe), ex.: "Cliente pediu boleto"
    if (no.tipo === 'nota') {
      if (simulacao) {
        simulacao.push({ tipo: 'nota', texto: `Nota interna (o cliente não vê): ${substituir(no.texto, contexto)}` });
      } else {
        const { obterOuCriarConversa, registrarNotaInterna } = require('./conversas'); // aqui: conversas também usa este arquivo
        registrarNotaInterna(obterOuCriarConversa(estado.numero).id, substituir(no.texto, contexto));
      }
      estado.no = no.proximo;
      continue;
    }

    if (no.tipo === 'fim') {
      if (no.texto) textos.push(substituirTextoDeMensagem(no.texto, contexto));
      if (simulacao) simulacao.push({ tipo: 'fim', texto: 'Fim do fluxo: a próxima mensagem começa do início.' });
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

  // Com atendente, nenhuma palavra de reinício religa o bot — só finalizar devolve a conversa pra
  // ele. Antes isso vinha primeiro e todo "oi"/"olá" do cliente no meio do atendimento reabria o
  // menu e ainda tirava a conversa da fila (sincronizarConversa voltava o status pra 'bot').
  if (ehReinicio && !estado.humano) {
    Object.assign(estado, estadoInicial(fluxo, numero));
    return executar(estado, { negocio, vars: estado.vars }, fluxo);
  }

  // Resposta à pesquisa de satisfação mandada ao finalizar (ver aguardarAvaliacao) — não é um nó
  // do fluxo de verdade, então sem isso essa mensagem cairia direto no "estado.no = fluxo.inicio"
  // logo abaixo e mostraria o menu de novo, em vez de agradecer a nota. Só vale dentro do prazo —
  // passado isso, tratamos como mensagem normal (senão quem volta dias depois com uma pergunta
  // de verdade só ouviria "obrigado pela avaliação").
  if (estado.aguardandoAvaliacao) {
    const dentroDoPrazo = Date.now() - estado.aguardandoAvaliacaoDesde <= MINUTOS_LIMITE_AVALIACAO * 60000;
    estado.aguardandoAvaliacao = false;
    estado.aguardandoAvaliacaoDesde = null;
    if (dentroDoPrazo) {
      salvarRegistro('avaliacoes', { numero, nota: msg });
      registrarNota(numero, msg);
      return 'Muito obrigado pela sua avaliação! 🙏';
    }
  }

  return continuarFluxo(estado, msg, negocio, fluxo);
}

// O que vem depois do reinício e da pesquisa: com atendente fica em silêncio; esperando resposta,
// trata a resposta; senão começa do início. Usado pelo bot de verdade e pelo simulador.
async function continuarFluxo(estado, msg, negocio, fluxo, simulacao = null) {
  if (estado.humano) return null;

  const contexto = { negocio, vars: estado.vars };

  if (estado.aguardando) {
    const no = fluxo.nos[estado.no];
    const resultado = tratarResposta(no, msg, contexto);
    if (!resultado.ok) {
      if (simulacao) simulacao.push({ tipo: 'invalido', texto: 'Resposta não reconhecida: o bot pergunta de novo.' });
      return montarTexto(no, contexto, { invalido: true });
    }
    estado.no = resultado.proximo;
    estado.aguardando = false;
    return executar(estado, contexto, fluxo, simulacao);
  }

  estado.no = fluxo.inicio;
  return executar(estado, contexto, fluxo, simulacao);
}

/**
 * Simulador do editor (botão Testar): roda uma mensagem num estado que fica com o navegador (não
 * mexe no estado das conversas de verdade, não grava nada, não chama API, não manda WhatsApp).
 * Devolve { resposta, estado, eventos, no } — `no` é o bloco onde o fluxo parou.
 */
async function simularMensagem({ estado, texto, negocio, fluxo }) {
  const base = estadoInicial(fluxo, 'simulador');
  const atual = { ...base };
  if (estado && typeof estado === 'object') {
    if (typeof estado.no === 'string' && fluxo.nos[estado.no]) atual.no = estado.no;
    if (estado.vars && typeof estado.vars === 'object' && !Array.isArray(estado.vars)) atual.vars = estado.vars;
    atual.aguardando = !!estado.aguardando;
    atual.humano = !!estado.humano;
    atual.setor = typeof estado.setor === 'string' ? estado.setor : null;
  }
  const eventos = [];
  const msg = String(texto || '').trim();
  const palavras = fluxo.reinicio_palavras || [];
  let resposta;
  if (palavras.some((p) => p.toLowerCase() === msg.toLowerCase()) && !atual.humano) {
    Object.assign(atual, estadoInicial(fluxo, 'simulador'));
    eventos.push({ tipo: 'reinicio', texto: `"${msg}" é palavra de reinício: começou do início.` });
    resposta = await executar(atual, { negocio, vars: atual.vars }, fluxo, eventos);
  } else {
    if (atual.humano) eventos.push({ tipo: 'transferir', texto: 'A conversa está com atendente: o bot não responde. Clique em Recomeçar.' });
    resposta = await continuarFluxo(atual, msg, negocio, fluxo, eventos);
  }
  return { resposta: resposta || null, estado: { no: atual.no, vars: atual.vars, aguardando: atual.aguardando, humano: atual.humano, setor: atual.setor || null }, eventos, no: atual.no };
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
 * Atendente devolveu a conversa pro bot ("Devolver ao bot"): começa o fluxo do início, como se o
 * cliente tivesse digitado "menu", e devolve o texto pra mandar (o menu inicial).
 */
async function iniciarFluxo({ numero, negocio, fluxo }) {
  const estado = obterEstado(numero, fluxo);
  Object.assign(estado, estadoInicial(fluxo, numero));
  return executar(estado, { negocio, vars: estado.vars }, fluxo);
}

/**
 * Marca a conversa como transferida pra um humano sem passar por um nó "transferir" do fluxo —
 * usado quando o cliente manda algo que o bot não consegue processar sozinho (ex.: mídia).
 */
function transferirParaHumano(numero, fluxo, setor = null) {
  const estado = obterEstado(numero, fluxo);
  estado.humano = true;
  estado.setor = setor;
  estado.atendenteId = null;
  // Um atendimento novo (ex.: "+ Nova conversa" logo depois de finalizar) cancela a pesquisa de
  // satisfação pendente — senão a primeira resposta do cliente viraria "obrigado pela avaliação"
  // e, passado o prazo, o aviso de encerramento automático cairia no meio do atendimento novo.
  estado.aguardandoAvaliacao = false;
  estado.aguardandoAvaliacaoDesde = null;
}

/**
 * Como encerrarAtendimento, mas a PRÓXIMA mensagem do cliente, se vier dentro de
 * MINUTOS_LIMITE_AVALIACAO, é tratada como a nota da pesquisa de satisfação (salva em
 * `registros` e agradece) em vez de reabrir o menu — só então volta ao normal. Chamar depois de
 * mandar a pesquisa de satisfação ao finalizar um atendimento.
 */
function aguardarAvaliacao(numero, fluxo) {
  const estado = obterEstado(numero, fluxo);
  Object.assign(estado, estadoInicial(fluxo, numero));
  estado.aguardandoAvaliacao = true;
  estado.aguardandoAvaliacaoDesde = Date.now();
}

/** Números esperando a nota há mais de MINUTOS_LIMITE_AVALIACAO — pra quem checa periodicamente
 * (src/avaliacao-vencida.js) e manda o aviso de encerramento automático. */
function listarAguardandoAvaliacaoVencidos() {
  const limite = Date.now() - MINUTOS_LIMITE_AVALIACAO * 60000;
  const vencidos = [];
  for (const estado of conversas.values()) {
    if (estado.aguardandoAvaliacao && estado.aguardandoAvaliacaoDesde <= limite) vencidos.push(estado.numero);
  }
  return vencidos;
}

/** Desliga o "aguardando nota" sem mandar mensagem nenhuma — usado depois de já ter avisado que
 * o prazo venceu, pra não avisar de novo nem tratar a próxima mensagem como nota atrasada. */
function desligarAguardandoAvaliacao(numero) {
  const estado = conversas.get(numero);
  if (estado) {
    estado.aguardandoAvaliacao = false;
    estado.aguardandoAvaliacaoDesde = null;
  }
}

module.exports = {
  processarMensagem,
  simularMensagem,
  obterEstadoConversa,
  encerrarAtendimento,
  iniciarFluxo,
  transferirParaHumano,
  aguardarAvaliacao,
  listarAguardandoAvaliacaoVencidos,
  desligarAguardandoAvaliacao,
  substituirVariaveis: substituir,
  estaDentroDoHorario,
  MINUTOS_LIMITE_AVALIACAO,
};

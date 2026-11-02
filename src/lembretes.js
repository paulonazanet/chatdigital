const { db } = require('./db');
const { carregarNegocio } = require('./negocio');
const envios = require('./envios');
const { substituirVariaveis } = require('./flow-engine');

// Lembrete de recompra (E3, 1a parte): X dias depois da última compra, o cliente recebe "seu gás deve
// estar acabando, quer pedir?". Enquanto a GásDigital não está ligada, "compra" é o que o próprio
// ChatDigital sabe: pedido salvo pelo bot (registros, coleção "pedidos") ou atendimento finalizado com
// um dos motivos marcados (ex.: "Resolvido › Pedido feito"). O envio sai pela fila de envios
// (devagar, no horário, com limite por dia). Com a recuperação ligada, quem não respondeu nem comprou
// recebe mais mensagens (etapas) em dias contados a partir do prazo do lembrete.

const DIA_MS = 86400000;
const INTERVALO_MINIMO_ETAPAS_DIAS = 7; // lembrete que saiu atrasado não emenda na etapa seguinte
// Cada texto tem versões separadas por uma linha com --- (envios.sortearVersao): cada cliente recebe uma
// sorteada, pra os envios não saírem todos iguais.
const RODAPE_SAIR = '\n\n(Para não receber estes avisos, responda SAIR.)';
const versoes = (...textos) => textos.map((t) => `${t}${RODAPE_SAIR}`).join('\n---\n');
const TEXTO_PADRAO = versoes(
  'Oi, {{cliente.nome}}! Aqui é da {{negocio.nome}}. 🔥 Já faz {{dias}} dias do seu último pedido. Seu gás deve estar acabando: quer que a gente leve outro? É só responder *SIM*.',
  'Olá, {{cliente.nome}}! Tudo bem? Aqui é da {{negocio.nome}}. Seu último gás foi há {{dias}} dias, então ele pode estar perto do fim. Quer que a gente entregue um novo? Responda *SIM*. 🔥',
  'Oi, {{cliente.nome}}, tudo certo por aí? Passando para lembrar: já são {{dias}} dias desde o seu último pedido aqui na {{negocio.nome}}. Se o gás estiver no fim, é só responder *SIM* que a gente leva.',
);
const ETAPAS_PADRAO = [
  {
    etapa: 2,
    nome: 'Segundo lembrete',
    dias: 15,
    texto: versoes(
      'Oi, {{cliente.nome}}! Aqui é da {{negocio.nome}}. Quando precisar de gás, é só responder *SIM* que a gente leva até você. 🔥',
      'Olá, {{cliente.nome}}! A {{negocio.nome}} está por aqui: se o gás acabar, responda *SIM* e a gente entrega na sua casa.',
      'Oi, {{cliente.nome}}, tudo bem? Lembrando que a {{negocio.nome}} entrega gás pertinho de você. Precisando, responda *SIM*. 🔥',
    ),
    nota: '',
  },
  {
    etapa: 3,
    nome: 'Recuperação',
    dias: 45,
    texto: versoes(
      'Oi, {{cliente.nome}}! Sentimos sua falta aqui na {{negocio.nome}}. Se o gás acabou num dia em que estávamos fechados, a gente entende. Quer deixar o próximo com a gente? É só responder *SIM*.',
      'Olá, {{cliente.nome}}! Faz tempo que você não pede com a gente aqui na {{negocio.nome}}. Se o gás acabou fora do nosso horário, tudo bem! Quer que o próximo seja nosso? Responda *SIM*.',
      'Oi, {{cliente.nome}}, tudo bem? A {{negocio.nome}} sentiu sua falta. Quando precisar de gás de novo, é só responder *SIM* que a gente leva rapidinho.',
    ),
    nota: '',
  },
  {
    etapa: 4,
    nome: 'Última tentativa',
    dias: 90,
    texto: versoes(
      'Oi, {{cliente.nome}}! Queremos você de volta na {{negocio.nome}}: *R$ 5 de desconto* no seu gás, sobre o preço do dia. Quer aproveitar? É só responder *SIM*.',
      'Olá, {{cliente.nome}}! Preparamos um presente para você voltar à {{negocio.nome}}: *R$ 5 a menos* no seu próximo gás, sobre o preço do dia. Responda *SIM* para pedir.',
      'Oi, {{cliente.nome}}, tudo bem? Para você voltar a pedir com a gente, a {{negocio.nome}} dá *R$ 5 de desconto* no gás, sobre o preço do dia. Quer? Responda *SIM*.',
    ),
    nota: 'Oferta enviada: R$ 5 de desconto sobre o preço do dia.',
  },
];

// As etapas com o que a empresa mudou (dias, texto, aviso ao atendente) por cima do padrão
function etapasDe(negocio) {
  const salvas = Array.isArray(negocio.recompra_etapas) ? negocio.recompra_etapas : [];
  return ETAPAS_PADRAO.map((padrao) => ({ ...padrao, ...salvas.find((e) => e.etapa === padrao.etapa) }));
}

function regrasDeRecompra(negocio = carregarNegocio()) {
  const dias = Number(negocio.recompra_dias);
  return {
    recuperacao: !!negocio.recompra_recuperacao,
    etapas: etapasDe(negocio),
    ligado: !!negocio.recompra_ligado,
    dias: Number.isInteger(dias) && dias >= 3 && dias <= 365 ? dias : 30,
    texto: negocio.recompra_texto || TEXTO_PADRAO,
    resposta: negocio.recompra_resposta === 'bot' ? 'bot' : 'atendente',
    setor: negocio.recompra_setor || 'Geral',
    motivos: Array.isArray(negocio.recompra_motivos) ? negocio.recompra_motivos : null, // null = os que têm "Pedido" no nome
    usarMedia: negocio.recompra_usar_media !== false,
    // API oficial: modelo aprovado do lembrete ({ nome, idioma, parametros com variáveis })
    modelo: negocio.recompra_modelo && negocio.recompra_modelo.nome ? negocio.recompra_modelo : null,
  };
}

// motivos de encerramento que contam como compra (padrão: os que têm "pedido" no nome)
function motivosDeCompra(regras) {
  if (regras.motivos) return regras.motivos;
  return db
    .prepare('SELECT DISTINCT motivo_texto FROM atendimentos WHERE motivo_texto IS NOT NULL')
    .all()
    .map((r) => r.motivo_texto)
    .filter((t) => /pedido/i.test(t));
}

/** Datas de compra (ms) de cada conversa: { conversaId: [ms, ...] } em ordem */
function comprasPorConversa(regras) {
  const porNumero = new Map(db.prepare('SELECT id, numero FROM conversas').all().map((c) => [c.numero, c.id]));
  const compras = new Map();
  const somar = (id, iso) => {
    if (!id || !iso) return;
    if (!compras.has(id)) compras.set(id, []);
    compras.get(id).push(Date.parse(iso));
  };
  for (const r of db.prepare("SELECT dados, criado_em FROM registros WHERE colecao = 'pedidos'").all()) {
    try {
      somar(porNumero.get(JSON.parse(r.dados).numero), r.criado_em);
    } catch (erro) {
      // registro sem JSON válido não conta
    }
  }
  const motivos = motivosDeCompra(regras);
  if (motivos.length) {
    const linhas = db
      .prepare(`SELECT conversa_id, finalizado_em FROM atendimentos WHERE finalizado_em IS NOT NULL AND motivo_texto IN (${motivos.map(() => '?').join(',')})`)
      .all(...motivos);
    for (const t of linhas) somar(t.conversa_id, t.finalizado_em);
  }
  // pedido pelo bot e atendimento do mesmo pedido no mesmo dia contam uma vez só
  for (const [id, lista] of compras) {
    lista.sort((a, b) => a - b);
    compras.set(id, lista.filter((ms, i) => i === 0 || ms - lista[i - 1] > 12 * 3600000));
  }
  return compras;
}

// Dias até lembrar: o da ficha do cliente; senão a média dele (com 3 compras ou mais, se ligado);
// senão o padrão.
function diasDoCliente(conversa, datas, regras) {
  if (conversa.recompra_dias) return conversa.recompra_dias;
  if (regras.usarMedia && datas.length >= 3) {
    const intervalos = datas.slice(1).map((ms, i) => (ms - datas[i]) / DIA_MS);
    const media = Math.round(intervalos.reduce((s, d) => s + d, 0) / intervalos.length);
    if (media >= 3 && media <= 365) return media;
  }
  return regras.dias;
}

/**
 * Qual mensagem da sequência vai agora para essa compra (1 = o lembrete; null = nenhuma). O 1o lembrete
 * só sai até 30 dias depois do prazo, pra não disparar pra todo mundo antigo de uma vez quando ligar.
 * As etapas seguintes só saem depois da anterior, e param se o cliente respondeu (comprar de novo muda
 * a última compra, então a sequência recomeça sozinha).
 */
function proximaEtapa(conversaId, ultima, vence, regras, agoraMs) {
  const feitos = db
    .prepare("SELECT etapa, status, enviado_em, respondido_em FROM envios WHERE conversa_id = ? AND tipo = 'lembrete' AND criado_em >= ?")
    .all(conversaId, new Date(ultima).toISOString());
  if (feitos.some((e) => e.status === 'pendente' || e.respondido_em)) return null;
  const enviados = feitos.filter((e) => e.status === 'enviado');
  if (!enviados.length) return agoraMs - vence > 30 * DIA_MS ? null : { etapa: 1 };
  if (!regras.recuperacao) return null;
  const atual = Math.max(...enviados.map((e) => e.etapa));
  const proxima = regras.etapas.find((e) => e.etapa > atual);
  if (!proxima) return null;
  const ultimoEnvio = Math.max(...enviados.map((e) => Date.parse(e.enviado_em)));
  const libera = Math.max(vence + proxima.dias * DIA_MS, ultimoEnvio + INTERVALO_MINIMO_ETAPAS_DIAS * DIA_MS);
  return libera > agoraMs ? null : proxima;
}

/** Quem está na hora de uma mensagem agora: última compra + dias já passou e há etapa para mandar. */
function candidatos({ agoraMs = Date.now(), negocio = carregarNegocio() } = {}) {
  const regras = regrasDeRecompra(negocio);
  const compras = comprasPorConversa(regras);
  const lista = [];
  for (const [conversaId, datas] of compras) {
    const conversa = db.prepare('SELECT * FROM conversas WHERE id = ?').get(conversaId);
    if (!conversa) continue;
    const ultima = datas[datas.length - 1];
    const dias = diasDoCliente(conversa, datas, regras);
    const vence = ultima + dias * DIA_MS;
    if (vence > agoraMs) continue;
    const etapa = proximaEtapa(conversaId, ultima, vence, regras, agoraMs);
    if (!etapa) continue;
    lista.push({ conversa, ultima, dias, diasDesde: Math.floor((agoraMs - ultima) / DIA_MS), compras: datas.length, etapa });
  }
  return lista;
}

/**
 * Quem recebe o 1º lembrete nos próximos `dias` dias (ainda não venceu): pra conferir antes de ligar.
 * Em ordem de data. O envio sai no primeiro horário de envio a partir do dia do prazo.
 */
function previsao({ agoraMs = Date.now(), negocio = carregarNegocio(), dias = 30 } = {}) {
  const regras = regrasDeRecompra(negocio);
  const lista = [];
  for (const [conversaId, datas] of comprasPorConversa(regras)) {
    const conversa = db.prepare('SELECT * FROM conversas WHERE id = ?').get(conversaId);
    if (!conversa) continue;
    const ultima = datas[datas.length - 1];
    const prazo = diasDoCliente(conversa, datas, regras);
    const vence = ultima + prazo * DIA_MS;
    if (vence <= agoraMs || vence > agoraMs + dias * DIA_MS) continue;
    lista.push({ conversa, ultima, dias: prazo, vence, compras: datas.length });
  }
  return lista.sort((a, b) => a.vence - b.vence);
}

function montarTexto(regras, negocio, conversa, diasDesde, modelo = regras.texto, sorteio = Math.random) {
  const texto = substituirVariaveis(envios.sortearVersao(modelo, sorteio), {
    negocio,
    cliente: { nome: conversa.nome_contato || '' },
    dias: String(diasDesde),
  });
  // "Oi, !" quando o cliente não tem nome: tira a vírgula/espaço que sobrou
  return texto.replace(/,\s*,/g, ',').replace(/,\s*([!?.])/g, '$1').replace(/[ \t]+([!?.,])/g, '$1');
}

/** Põe na fila de envios os lembretes que venceram. Devolve quantos entraram. */
function gerarLembretes({ agoraMs = Date.now(), negocio = carregarNegocio(), mesmoDesligado = false } = {}) {
  const regras = regrasDeRecompra(negocio);
  if (!regras.ligado && !mesmoDesligado) return 0;
  let total = 0;
  for (const c of candidatos({ agoraMs, negocio })) {
    if (envios.motivoParaNaoMandar(c.conversa, { emAtendimentoConta: false })) continue;
    const modelo = regras.modelo && c.etapa.etapa === 1
      ? {
          nome: regras.modelo.nome,
          idioma: regras.modelo.idioma || 'pt_BR',
          parametros: (regras.modelo.parametros || []).map((p) => substituirVariaveis(p, { negocio, cliente: { nome: c.conversa.nome_contato || 'cliente' }, dias: String(c.diasDesde) }) || '-'),
        }
      : null;
    const { textoDoModelo } = require('./whatsapp-oficial');
    const texto = modelo ? textoDoModelo(modelo, modelo.parametros) : montarTexto(regras, negocio, c.conversa, c.diasDesde, c.etapa.texto);
    envios.enfileirar({ tipo: 'lembrete', conversaId: c.conversa.id, texto, modelo, etapa: c.etapa.etapa });
    total += 1;
  }
  return total;
}

function iniciarLembretesDeRecompra() {
  const rodar = () => {
    try {
      gerarLembretes();
    } catch (erro) {
      console.error('Erro ao gerar lembretes de recompra:', erro.message);
    }
  };
  rodar();
  setInterval(rodar, 60 * 60 * 1000).unref(); // de hora em hora
}

module.exports = { regrasDeRecompra, motivosDeCompra, comprasPorConversa, candidatos, previsao, gerarLembretes, montarTexto, iniciarLembretesDeRecompra, TEXTO_PADRAO };

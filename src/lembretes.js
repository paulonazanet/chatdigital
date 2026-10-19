const { db } = require('./db');
const { carregarNegocio } = require('./negocio');
const envios = require('./envios');
const { substituirVariaveis } = require('./flow-engine');

// Lembrete de recompra (E3, 1a parte): X dias depois da última compra, o cliente recebe "seu gás deve
// estar acabando, quer pedir?". Enquanto a GásDigital não está ligada, "compra" é o que o próprio
// ChatDigital sabe: pedido salvo pelo bot (registros, coleção "pedidos") ou atendimento finalizado com
// um dos motivos marcados (ex.: "Resolvido › Pedido feito"). O envio sai pela fila de envios
// (devagar, no horário, com limite por dia).

const DIA_MS = 86400000;
const TEXTO_PADRAO =
  'Oi, {{cliente.nome}}! Aqui é da {{negocio.nome}}. 🔥 Já faz {{dias}} dias do seu último pedido. Seu gás deve estar acabando: quer que a gente leve outro? É só responder *SIM*.\n\n(Para não receber estes avisos, responda SAIR.)';

function regrasDeRecompra(negocio = carregarNegocio()) {
  const dias = Number(negocio.recompra_dias);
  return {
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
 * Quem está na hora do lembrete agora: última compra + dias já passou, ainda não recebeu lembrete
 * depois dessa compra, e a compra não é velha demais (mais de 30 dias de atraso = cliente que sumiu;
 * não manda pra não disparar pra todo mundo antigo de uma vez quando ligar).
 */
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
    if (vence > agoraMs || agoraMs - vence > 30 * DIA_MS) continue;
    const jaTem = db
      .prepare("SELECT 1 FROM envios WHERE conversa_id = ? AND tipo = 'lembrete' AND status IN ('pendente', 'enviado') AND criado_em >= ?")
      .get(conversaId, new Date(ultima).toISOString());
    if (jaTem) continue;
    lista.push({ conversa, ultima, dias, diasDesde: Math.floor((agoraMs - ultima) / DIA_MS), compras: datas.length });
  }
  return lista;
}

function montarTexto(regras, negocio, conversa, diasDesde) {
  const texto = substituirVariaveis(regras.texto, {
    negocio,
    cliente: { nome: conversa.nome_contato || '' },
    dias: String(diasDesde),
  });
  // "Oi, !" quando o cliente não tem nome: tira a vírgula/espaço que sobrou
  return texto.replace(/,\s*([!?.])/g, '$1').replace(/[ \t]+([!?.,])/g, '$1');
}

/** Põe na fila de envios os lembretes que venceram. Devolve quantos entraram. */
function gerarLembretes({ agoraMs = Date.now(), negocio = carregarNegocio(), mesmoDesligado = false } = {}) {
  const regras = regrasDeRecompra(negocio);
  if (!regras.ligado && !mesmoDesligado) return 0;
  let total = 0;
  for (const c of candidatos({ agoraMs, negocio })) {
    if (envios.motivoParaNaoMandar(c.conversa, { emAtendimentoConta: false })) continue;
    const modelo = regras.modelo
      ? {
          nome: regras.modelo.nome,
          idioma: regras.modelo.idioma || 'pt_BR',
          parametros: (regras.modelo.parametros || []).map((p) => substituirVariaveis(p, { negocio, cliente: { nome: c.conversa.nome_contato || 'cliente' }, dias: String(c.diasDesde) }) || '-'),
        }
      : null;
    const { textoDoModelo } = require('./whatsapp-oficial');
    const texto = modelo ? textoDoModelo(modelo, modelo.parametros) : montarTexto(regras, negocio, c.conversa, c.diasDesde);
    envios.enfileirar({ tipo: 'lembrete', conversaId: c.conversa.id, texto, modelo });
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

module.exports = { regrasDeRecompra, motivosDeCompra, comprasPorConversa, candidatos, gerarLembretes, montarTexto, iniciarLembretesDeRecompra, TEXTO_PADRAO };

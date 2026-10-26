const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const { db } = require('../db');
const { listarFila } = require('../conversas');
const { carregarNegocio } = require('../negocio');
const { situacaoDaEquipe } = require('../equipe');
const { calcularAlertas, inicioDaEspera } = require('../alertas');
const { montarRelatorio } = require('../relatorio');
const whatsappStatus = require('../whatsapp-status');

// Painel ao vivo para TV (E2, 2a parte): /tv/<código> abre sem login (o código fica em
// Configurações > Painel da TV). Só números e nomes da equipe: nada do que o cliente escreve, nem
// nome ou telefone de cliente. A página busca /tv/<código>/dados a cada 15 s.

function codigoValido(recebido) {
  const certo = carregarNegocio().painel_tv_token;
  if (!certo || typeof recebido !== 'string') return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(certo);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function exigirCodigo(req, res, next) {
  if (!codigoValido(req.params.codigo)) return res.status(404).send('Painel não encontrado. Peça o link novo para quem cuida do sistema.');
  res.set('X-Robots-Tag', 'noindex');
  res.set('Referrer-Policy', 'no-referrer');
  next();
}

function dadosDoPainel(agoraMs = Date.now()) {
  const negocio = carregarNegocio();
  const fila = listarFila();
  const minutos = (iso) => (iso ? Math.max(0, Math.floor((agoraMs - Date.parse(iso)) / 60000)) : 0);
  const aguardando = fila.filter((c) => c.status === 'aguardando');
  const esperas = aguardando.map((c) => minutos(inicioDaEspera(c)));

  const porSetor = new Map();
  for (const c of aguardando) {
    const nome = c.setor_nome || 'Sem setor';
    if (!porSetor.has(nome)) porSetor.set(nome, { nome, esperando: 0, maiorEspera: 0, atendendo: 0 });
    const s = porSetor.get(nome);
    s.esperando += 1;
    s.maiorEspera = Math.max(s.maiorEspera, minutos(inicioDaEspera(c)));
  }
  for (const c of fila.filter((x) => x.status === 'atendendo')) {
    const nome = c.setor_nome || 'Sem setor';
    if (!porSetor.has(nome)) porSetor.set(nome, { nome, esperando: 0, maiorEspera: 0, atendendo: 0 });
    porSetor.get(nome).atendendo += 1;
  }

  // "com o bot agora": conversa com atendimento aberto que ainda não chegou na fila
  const noBot = db.prepare("SELECT COUNT(*) AS n FROM conversas WHERE status = 'bot' AND aberta_em IS NOT NULL").get().n;
  const hoje = montarRelatorio({ periodo: 'hoje', agoraMs });
  const limiteEspera = Number(negocio.alerta_fila_minutos) || Number(negocio.fila_minutos_vermelho) || 0;

  return {
    negocio: negocio.nome || 'Atendimento',
    atualizadoEm: new Date(agoraMs).toISOString(),
    whatsappConectado: whatsappStatus.obterEstado().conectado,
    esperando: aguardando.length,
    maiorEspera: esperas.length ? Math.max(...esperas) : 0,
    limiteEspera,
    atendendo: fila.filter((c) => c.status === 'atendendo').length,
    noBot,
    setores: [...porSetor.values()].sort((a, b) => b.esperando - a.esperando || a.nome.localeCompare(b.nome)),
    equipe: situacaoDaEquipe(agoraMs).map((p) => ({
      nome: p.nome,
      situacao: p.situacao,
      rotulo: p.rotulo,
      atendendo: p.atendendo,
      limite: p.limite,
      pausa: p.pausa ? { motivo: p.pausa.motivo, minutos: p.pausa.minutos, passou: p.pausa.passou } : null,
    })),
    hoje: { atendimentos: hoje.total, esperaFila: hoje.esperaFila.texto, nota: hoje.notaMedia },
    alertas: calcularAlertas({ negocio, agoraMs }).map((a) => ({ texto: a.textoTv, gravidade: a.gravidade })),
  };
}

router.get('/:codigo', exigirCodigo, (req, res) => {
  res.render('tv', { codigo: req.params.codigo, dados: dadosDoPainel() });
});

router.get('/:codigo/dados', exigirCodigo, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(dadosDoPainel());
});

module.exports = { router, dadosDoPainel };

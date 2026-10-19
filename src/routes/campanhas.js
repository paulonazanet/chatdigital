const express = require('express');
const router = express.Router();

const { db } = require('../db');
const { carregarNegocio, salvarConfiguracoes } = require('../negocio');
const envios = require('../envios');
const lembretes = require('../lembretes');
const retornos = require('../retornos');
const { listarSetores, janelasDoFormulario } = require('../setores');
const { horarioDoCorpo, horarioDasJanelas } = require('../horario');
const { formatarDataHoraCompleta, formatarTelefone } = require('../relatorio');

// Menu Campanhas (permissão "gerenciar_campanhas"): Lembretes (recompra), Retornos agendados,
// Envios (a fila e o histórico) e Regras de envio. A aba Campanhas entra na 2a parte da E3.

const ROTULO_STATUS = { pendente: 'Na fila', enviado: 'Enviado', falhou: 'Falhou', pulado: 'Não mandado', cancelado: 'Cancelado' };
const ROTULO_TIPO = { lembrete: 'Lembrete de recompra', campanha: 'Campanha', retorno: 'Retorno', teste: 'Teste' };
const nomeDoCliente = (linha) => linha.nome_contato || formatarTelefone(linha.numero_exibicao || linha.numero);

function base(req, ativa, extra = {}) {
  return { atendenteLogado: req.atendente, ativa, fila: envios.situacaoDaFila(), regras: envios.regrasDeEnvio(), ...extra };
}

router.get('/', (req, res) => res.redirect('/painel/campanhas/lembretes'));

// ---- Lembretes de recompra ----
function renderizarLembretes(req, res, extra = {}) {
  const negocio = carregarNegocio();
  const regras = lembretes.regrasDeRecompra(negocio);
  const motivosUsados = db.prepare('SELECT DISTINCT motivo_texto FROM atendimentos WHERE motivo_texto IS NOT NULL ORDER BY motivo_texto').all().map((r) => r.motivo_texto);
  const motivosAtivos = new Set(lembretes.motivosDeCompra(regras));
  const proximos = lembretes.candidatos({ negocio }).slice(0, 50).map((c) => ({
    conversaId: c.conversa.id,
    cliente: nomeDoCliente(c.conversa),
    ultima: formatarDataHoraCompleta(new Date(c.ultima).toISOString()).slice(0, 10),
    dias: c.dias,
    diasDesde: c.diasDesde,
    compras: c.compras,
    motivo: envios.motivoParaNaoMandar(c.conversa, { emAtendimentoConta: false }),
  }));
  const ultimos = db
    .prepare(
      `SELECT e.*, c.nome_contato, c.numero, c.numero_exibicao FROM envios e JOIN conversas c ON c.id = e.conversa_id
       WHERE e.tipo = 'lembrete' ORDER BY e.id DESC LIMIT 50`,
    )
    .all()
    .map((e) => ({ ...e, cliente: nomeDoCliente(e), quando: formatarDataHoraCompleta(e.enviado_em || e.criado_em), rotulo: ROTULO_STATUS[e.status] }));
  const trintaDias = new Date(Date.now() - 30 * 86400000).toISOString();
  res.render('campanhas/lembretes', base(req, 'lembretes', {
    negocio,
    recompra: regras,
    motivosUsados,
    motivosAtivos,
    setores: listarSetores(),
    proximos,
    ultimos,
    numeros: envios.resumoDeEnvios("tipo = 'lembrete' AND criado_em >= ?", [trintaDias]),
    exemplo: lembretes.montarTexto(regras, negocio, { nome_contato: 'Maria' }, regras.dias),
    erro: null,
    salvo: !!req.query.salvo,
    gerados: req.query.gerados !== undefined ? Number(req.query.gerados) : null,
    ...extra,
  }));
}
router.get('/lembretes', (req, res) => renderizarLembretes(req, res));
router.post('/lembretes', (req, res) => {
  const dias = Number(req.body.recompra_dias);
  if (!Number.isInteger(dias) || dias < 3 || dias > 365) return renderizarLembretes(req, res, { erro: 'Os dias até o lembrete têm que ser um número inteiro de 3 a 365.' });
  const texto = String(req.body.recompra_texto || '').trim();
  if (!texto) return renderizarLembretes(req, res, { erro: 'Escreva a mensagem do lembrete.' });
  const setores = listarSetores().map((s) => s.nome);
  salvarConfiguracoes({
    recompra_ligado: req.body.recompra_ligado === '1',
    recompra_dias: dias,
    recompra_texto: texto.slice(0, 1000),
    recompra_resposta: req.body.recompra_resposta === 'bot' ? 'bot' : 'atendente',
    recompra_setor: setores.includes(req.body.recompra_setor) ? req.body.recompra_setor : 'Geral',
    recompra_usar_media: req.body.recompra_usar_media === '1',
    recompra_motivos: [].concat(req.body.recompra_motivos || []).map(String),
  });
  res.redirect('/painel/campanhas/lembretes?salvo=1');
});
// pôr na fila agora os que já venceram (a checagem automática faz isso de hora em hora)
router.post('/lembretes/gerar', (req, res) => {
  const gerados = lembretes.gerarLembretes({ mesmoDesligado: false });
  res.redirect(`/painel/campanhas/lembretes?gerados=${gerados}`);
});

// ---- Retornos agendados ----
router.get('/retornos', (req, res) => {
  const formatar = (r) => ({ ...r, cliente: nomeDoCliente(r), quandoTexto: formatarDataHoraCompleta(r.quando), atrasado: r.status === 'pendente' && Date.parse(r.quando) < Date.now() });
  res.render('campanhas/retornos', base(req, 'retornos', {
    pendentes: retornos.listarRetornos({ status: 'pendente' }).map(formatar),
    feitos: retornos.listarRetornos({ status: 'feito', limite: 50 }).map(formatar),
  }));
});
router.post('/retornos/:id/cancelar', (req, res) => {
  retornos.cancelarRetorno(Number(req.params.id));
  res.redirect('/painel/campanhas/retornos');
});

// ---- Envios (fila e histórico) ----
router.get('/envios', (req, res) => {
  const status = Object.keys(ROTULO_STATUS).includes(req.query.status) ? req.query.status : '';
  const lista = db
    .prepare(
      `SELECT e.*, c.nome_contato, c.numero, c.numero_exibicao, k.nome AS campanha_nome FROM envios e
       JOIN conversas c ON c.id = e.conversa_id LEFT JOIN campanhas k ON k.id = e.referencia_id AND e.tipo = 'campanha'
       WHERE (? = '' OR e.status = ?) ORDER BY CASE e.status WHEN 'pendente' THEN 0 ELSE 1 END, e.id DESC LIMIT 300`,
    )
    .all(status, status)
    .map((e) => ({
      ...e,
      cliente: nomeDoCliente(e),
      tipoTexto: e.tipo === 'campanha' && e.campanha_nome ? `Campanha: ${e.campanha_nome}` : ROTULO_TIPO[e.tipo],
      rotulo: ROTULO_STATUS[e.status],
      quando: formatarDataHoraCompleta(e.enviado_em || e.agendado_para),
    }));
  res.render('campanhas/envios', base(req, 'envios', { lista, status, rotulos: ROTULO_STATUS, hoje: envios.enviadosHoje() }));
});
router.post('/envios/:id/cancelar', (req, res) => {
  db.prepare("UPDATE envios SET status = 'cancelado', motivo = 'Cancelado na tela de Envios' WHERE id = ? AND status = 'pendente'").run(Number(req.params.id));
  res.redirect('/painel/campanhas/envios');
});

// ---- Regras de envio ----
function renderizarRegras(req, res, extra = {}) {
  const regras = envios.regrasDeEnvio();
  res.render('campanhas/regras', base(req, 'regras', { porDia: horarioDasJanelas(regras.janelas), erro: null, salvo: !!req.query.salvo, ...extra }));
}
router.get('/regras', (req, res) => renderizarRegras(req, res));
router.post('/regras', (req, res) => {
  const porDia = horarioDoCorpo(req.body);
  const { janelas, erro } = janelasDoFormulario(porDia);
  if (erro) return renderizarRegras(req, res, { erro: `Horário de envio: ${erro}`, porDia });
  if (!janelas.length) return renderizarRegras(req, res, { erro: 'Marque pelo menos um horário de envio.', porDia });
  const numero = (campo, min, max) => {
    const n = Number(req.body[campo]);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  const minimo = numero('envio_intervalo_min', 10, 3600);
  const maximo = numero('envio_intervalo_max', 10, 3600);
  const limite = numero('envio_limite_dia', 1, 1000);
  if (minimo === null || maximo === null || maximo < minimo) return renderizarRegras(req, res, { erro: 'O intervalo tem que ser em segundos (10 a 3600), e o máximo não pode ser menor que o mínimo.', porDia });
  if (limite === null) return renderizarRegras(req, res, { erro: 'O limite por dia tem que ser de 1 a 1000.', porDia });
  salvarConfiguracoes({ envio_janelas: janelas, envio_intervalo_min: minimo, envio_intervalo_max: maximo, envio_limite_dia: limite, envio_pular_feriados: req.body.envio_pular_feriados === '1' });
  res.redirect('/painel/campanhas/regras?salvo=1');
});

module.exports = router;
module.exports.ROTULO_STATUS = ROTULO_STATUS;
module.exports.nomeDoCliente = nomeDoCliente;
module.exports.base = base;

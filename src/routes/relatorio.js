const express = require('express');
const router = express.Router();

const { montarRelatorio, intervaloDoPeriodo, listarReincidencias, lerMetas, PERIODOS } = require('../relatorio');
const auditoria = require('../auditoria');
const { listarAtendentes } = require('../atendentes');
const { listarSetores } = require('../setores');
const marcadores = require('../marcadores');
const { carregarNegocio } = require('../negocio');
const { temPermissao } = require('../permissoes');

// Menu Relatório (só admin, ou quem ganhar a permissão "ver_relatorio" em Atendentes), com as abas
// Resumo, Auditoria e Reincidências.

function atendenteDaQuery(req, atendentes) {
  return atendentes.some((a) => String(a.id) === req.query.atendente) ? Number(req.query.atendente) : null;
}

router.get('/', (req, res) => {
  const atendentes = listarAtendentes();
  const atendenteId = atendenteDaQuery(req, atendentes);
  const relatorio = montarRelatorio({ periodo: String(req.query.periodo || '30'), atendenteId });
  res.render('relatorio', {
    atendenteLogado: req.atendente,
    relatorio,
    atendentes,
    atendenteId,
    podeEditarMetas: temPermissao(req.atendente, 'gerenciar_configuracoes'),
  });
});

router.get('/auditoria', (req, res) => {
  const filtros = auditoria.lerFiltros(req.query);
  res.render('relatorio/auditoria', {
    atendenteLogado: req.atendente,
    filtros,
    resultado: auditoria.listarAuditoria(filtros),
    atendentes: listarAtendentes(),
    setores: listarSetores(),
    motivos: auditoria.motivosUsados(),
    marcadores: marcadores.listarMarcadores(),
    finalizadoComo: auditoria.FINALIZADO_COMO,
    faixasDeNota: auditoria.FAIXAS_DE_NOTA,
    // a URL com os mesmos filtros, pra paginar e exportar sem perder o que foi escolhido
    query: new URLSearchParams(Object.entries(req.query).filter(([chave, valor]) => chave !== 'pagina' && typeof valor === 'string' && valor)).toString(),
  });
});

router.get('/auditoria/exportar.csv', (req, res) => {
  const filtros = auditoria.lerFiltros(req.query);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="auditoria_${filtros.de}_a_${filtros.ate}.csv"`);
  res.send(auditoria.exportarAuditoriaCsv(filtros));
});

function carregarDetalhe(req, res) {
  const detalhe = /^\d+$/.test(req.params.id) ? auditoria.detalheDoAtendimento(Number(req.params.id)) : null;
  if (!detalhe) res.status(404).send('Atendimento não encontrado.');
  return detalhe;
}

router.get('/auditoria/:id', (req, res) => {
  const detalhe = carregarDetalhe(req, res);
  if (detalhe) res.render('relatorio/atendimento', { atendenteLogado: req.atendente, detalhe, voltar: req.query.voltar || '' });
});

router.get('/auditoria/:id/imprimir', (req, res) => {
  const detalhe = carregarDetalhe(req, res);
  if (detalhe) res.render('relatorio/imprimir', { detalhe, negocio: carregarNegocio(), imprimirAoAbrir: req.query.imprimir === '1' });
});

router.get('/auditoria/:id/conversa.txt', (req, res) => {
  const detalhe = carregarDetalhe(req, res);
  if (!detalhe) return;
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="atendimento_${detalhe.protocolo || detalhe.id}.txt"`);
  res.send('\uFEFF' + auditoria.conversaEmTexto(detalhe, carregarNegocio().nome));
});

router.get('/reincidencias', (req, res) => {
  const atendentes = listarAtendentes();
  const atendenteId = atendenteDaQuery(req, atendentes);
  const periodo = PERIODOS.some(([valor]) => valor === req.query.periodo) ? req.query.periodo : '30';
  const metas = lerMetas();
  const { inicio, fim } = intervaloDoPeriodo(periodo);
  res.render('relatorio/reincidencias', {
    atendenteLogado: req.atendente,
    periodo,
    periodos: PERIODOS,
    atendentes,
    atendenteId,
    dias: metas.reincidenciaDias,
    lista: listarReincidencias({ inicio, fim, dias: metas.reincidenciaDias, atendenteId }),
    podeEditarMetas: temPermissao(req.atendente, 'gerenciar_configuracoes'),
  });
});

module.exports = router;

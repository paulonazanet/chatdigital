const express = require('express');
const router = express.Router();

const { carregarFluxo, validarFluxo } = require('../fluxo');
const versoes = require('../fluxo-versoes');
const modelos = require('../modelos-fluxo');
const { simularMensagem } = require('../flow-engine');
const { carregarNegocio } = require('../negocio');
const { listarAtendentes } = require('../atendentes');
const { listarSetores } = require('../setores');
const { formatarDataHoraCompleta } = require('../relatorio');

router.get('/', (req, res) => {
  res.render('fluxo/editor', { atendenteLogado: req.atendente });
});

router.get('/dados', (req, res) => {
  res.json(carregarFluxo());
});

// listas pros campos de escolha do editor (bloco "Transferir para atendente")
router.get('/opcoes', (req, res) => {
  res.json({
    atendentes: listarAtendentes().filter((a) => a.ativo).map((a) => ({ id: a.id, nome: a.nome })),
    setores: listarSetores().map((s) => s.nome),
  });
});

// Salvar: valida, grava e guarda a versão. ?origem=modelo|importado (+ &detalhe=nome) quando o fluxo
// na tela veio de um fluxo pronto ou de um arquivo.
router.post('/salvar', express.json({ limit: '2mb' }), (req, res) => {
  try {
    const origem = versoes.descreverOrigem(String(req.query.origem || ''), req.query.detalhe);
    versoes.salvarComVersao(req.body, { atendente: req.atendente, origem });
    res.json({ ok: true });
  } catch (erro) {
    res.status(400).json({ ok: false, erros: erro.detalhes || [erro.message] });
  }
});

// Testar (simulador do editor): roda o fluxo que está na tela, sem salvar, sem WhatsApp e sem
// gravar nada. O estado da conversa de teste fica com o navegador.
router.post('/testar', express.json({ limit: '2mb' }), async (req, res) => {
  const { fluxo, estado, texto } = req.body || {};
  const erros = validarFluxo(fluxo);
  if (erros.length) return res.status(400).json({ ok: false, erros });
  try {
    const resultado = await simularMensagem({ estado, texto: String(texto || '').slice(0, 2000), negocio: carregarNegocio(), fluxo });
    res.json({ ok: true, ...resultado });
  } catch (erro) {
    res.status(400).json({ ok: false, erros: [erro.message] });
  }
});

// Conferir um fluxo antes de carregar na tela (arquivo importado): erros e setores que não existem
router.post('/conferir', express.json({ limit: '2mb' }), (req, res) => {
  const fluxo = req.body;
  const erros = validarFluxo(fluxo);
  const setoresFaltando = erros.length ? [] : modelos.setoresQueFaltam(fluxo, listarSetores().map((s) => s.nome));
  res.json({ ok: !erros.length, erros, setoresFaltando, blocos: versoes.contarBlocos(fluxo) });
});

router.get('/exportar', (req, res) => {
  const nome = String(carregarNegocio().nome || 'fluxo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').toLowerCase() || 'fluxo';
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  res.set('Content-Disposition', `attachment; filename="fluxo_${nome}_${hoje}.json"`);
  res.type('application/json').send(JSON.stringify(carregarFluxo(), null, 2) + '\n');
});

router.get('/modelos', (req, res) => {
  res.json(modelos.listarModelos());
});

router.get('/modelos/:id', (req, res) => {
  const modelo = modelos.obterModelo(req.params.id);
  if (!modelo) return res.status(404).json({ ok: false });
  res.json({ ok: true, ...modelo, setoresFaltando: modelos.setoresQueFaltam(modelo.fluxo, listarSetores().map((s) => s.nome)) });
});

// Versões do fluxo
router.get('/versoes', (req, res) => {
  const lista = versoes.listarVersoes().map((v) => ({ ...v, quando: formatarDataHoraCompleta(v.criadoEm) }));
  res.render('fluxo/versoes', { atendenteLogado: req.atendente, versoes: lista, restaurada: !!req.query.restaurada, erro: req.query.erro ? 'Essa versão não existe mais ou não é um fluxo válido.' : null });
});

router.get('/versoes/:id/baixar', (req, res) => {
  const versao = /^\d+$/.test(req.params.id) ? versoes.obterVersao(Number(req.params.id)) : null;
  if (!versao) return res.status(404).send('Versão não encontrada.');
  res.set('Content-Disposition', `attachment; filename="fluxo_versao_${versao.id}.json"`);
  res.type('application/json').send(JSON.stringify(versao.fluxo, null, 2) + '\n');
});

router.post('/versoes/:id/restaurar', (req, res) => {
  const id = /^\d+$/.test(req.params.id) ? Number(req.params.id) : null;
  const versao = id ? versoes.obterVersao(id) : null;
  const ok = versao && versoes.restaurarVersao(id, { atendente: req.atendente, quando: formatarDataHoraCompleta(versao.criado_em) });
  res.redirect(ok ? '/painel/fluxo/versoes?restaurada=1' : '/painel/fluxo/versoes?erro=1');
});

module.exports = router;

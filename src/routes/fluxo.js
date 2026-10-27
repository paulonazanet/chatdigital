const express = require('express');
const router = express.Router();

const { carregarFluxo, validarFluxo, carregarFluxoPorId, listarFluxos, criarFluxo, renomearFluxo, excluirFluxo } = require('../fluxo');
const versoes = require('../fluxo-versoes');
const modelos = require('../modelos-fluxo');
const { simularMensagem } = require('../flow-engine');
const { carregarNegocio } = require('../negocio');
const { listarAtendentes } = require('../atendentes');
const { listarSetores } = require('../setores');
const { formatarDataHoraCompleta } = require('../relatorio');

// Vários fluxos (E4, 3a parte): ?fluxo=<id> em todas as rotas (sem = o Principal, 1)
function fluxoDaQuery(req) {
  const id = Number(req.query.fluxo) || 1;
  return listarFluxos().some((f) => f.id === id) ? id : 1;
}

router.get('/', (req, res) => {
  const fluxoId = fluxoDaQuery(req);
  res.render('fluxo/editor', { atendenteLogado: req.atendente, fluxos: listarFluxos(), fluxoId, aviso: req.query.aviso || null, erro: req.query.erro || null });
});

router.get('/dados', (req, res) => {
  res.json(carregarFluxoPorId(fluxoDaQuery(req)));
});

// criar fluxo: começa como cópia de outro fluxo, de um modelo pronto ou o mínimo (início + fim)
router.post('/fluxos', (req, res) => {
  const base = String(req.body.base || 'copia:1');
  let conteudo;
  if (base.startsWith('modelo:')) conteudo = modelos.obterModelo(base.slice(7))?.fluxo;
  else if (base === 'vazio') conteudo = { inicio: 'inicio', nos: { inicio: { tipo: 'inicio', proximo: 'fim' }, fim: { tipo: 'fim', texto: 'Olá! Em que posso ajudar?' } } };
  else conteudo = carregarFluxoPorId(Number(base.replace('copia:', '')) || 1);
  if (!conteudo) return res.redirect('/painel/fluxo?erro=' + encodeURIComponent('Modelo não encontrado.'));
  const resultado = criarFluxo(req.body.nome, JSON.parse(JSON.stringify(conteudo)));
  if (resultado.erro) return res.redirect('/painel/fluxo?erro=' + encodeURIComponent(resultado.erro));
  res.redirect(`/painel/fluxo?fluxo=${resultado.id}&aviso=criado`);
});
router.post('/fluxos/:id/renomear', (req, res) => {
  const resultado = renomearFluxo(Number(req.params.id), req.body.nome);
  res.redirect(`/painel/fluxo?fluxo=${Number(req.params.id)}${resultado.erro ? `&erro=${encodeURIComponent(resultado.erro)}` : '&aviso=renomeado'}`);
});
router.post('/fluxos/:id/excluir', (req, res) => {
  const resultado = excluirFluxo(Number(req.params.id));
  if (resultado.erro) return res.redirect(`/painel/fluxo?fluxo=${Number(req.params.id)}&erro=${encodeURIComponent(resultado.erro)}`);
  res.redirect('/painel/fluxo?aviso=excluido');
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
    versoes.salvarComVersao(req.body, { atendente: req.atendente, origem, fluxoId: fluxoDaQuery(req) });
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
  const fluxoId = fluxoDaQuery(req);
  res.set('Content-Disposition', `attachment; filename="fluxo_${nome}${fluxoId === 1 ? '' : `_${fluxoId}`}_${hoje}.json"`);
  res.type('application/json').send(JSON.stringify(carregarFluxoPorId(fluxoId), null, 2) + '\n');
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
  const fluxoId = fluxoDaQuery(req);
  const lista = versoes.listarVersoes(fluxoId).map((v) => ({ ...v, quando: formatarDataHoraCompleta(v.criadoEm) }));
  const fluxo = listarFluxos().find((f) => f.id === fluxoId);
  res.render('fluxo/versoes', { atendenteLogado: req.atendente, versoes: lista, fluxoId, nomeFluxo: fluxo ? fluxo.nome : 'Principal', restaurada: !!req.query.restaurada, erro: req.query.erro ? 'Essa versão não existe mais ou não é um fluxo válido.' : null });
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
  const fluxoId = versao ? versao.fluxo_id || 1 : 1;
  res.redirect(`/painel/fluxo/versoes?fluxo=${fluxoId}&${ok ? 'restaurada=1' : 'erro=1'}`);
});

module.exports = router;

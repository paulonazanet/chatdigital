const express = require('express');
const router = express.Router();

const contatos = require('../contatos');
const { obterOuCriarConversa, definirNumeroExibicao, renomearContato } = require('../conversas');
const { obterSocket } = require('../socket-atual');
const { resolverNumeroNoWhatsApp } = require('../whatsapp-numero');

// Menu Contatos: lista com busca e filtros, ficha de cada contato (cadastro, situação,
// consentimento, tags) e o cadastro das tags.

function lerFiltros(query) {
  return {
    busca: String(query.q || '').trim().slice(0, 60),
    situacao: contatos.SITUACOES.includes(query.situacao) ? query.situacao : '',
    tag: String(query.tag || '').replace(/\D/g, ''),
    pagina: Number(query.pagina) || 1,
  };
}

router.get('/', (req, res) => {
  const filtros = lerFiltros(req.query);
  res.render('contatos/lista', {
    atendenteLogado: req.atendente,
    ...contatos.listarContatos(filtros),
    filtros,
    tags: contatos.listarTags(),
  });
});

// Tags (antes de /:id pra "tags" não virar um id)
function renderizarTags(req, res, erro = null) {
  res.render('contatos/tags', { atendenteLogado: req.atendente, tags: contatos.listarTags(), erro });
}
router.get('/tags', (req, res) => renderizarTags(req, res));
router.post('/tags', (req, res) => {
  if (!contatos.criarTag(req.body.nome)) return renderizarTags(req, res, 'Escreva o nome da tag.');
  res.redirect('/painel/contatos/tags');
});
router.post('/tags/:id', (req, res) => {
  if (!contatos.renomearTag(Number(req.params.id), req.body.nome)) return renderizarTags(req, res, 'Já existe uma tag com esse nome (ou o nome ficou vazio).');
  res.redirect('/painel/contatos/tags');
});
router.post('/tags/:id/limpar', (req, res) => {
  contatos.tirarTagDeTodos(Number(req.params.id));
  res.redirect('/painel/contatos/tags');
});
router.post('/tags/:id/excluir', (req, res) => {
  contatos.excluirTag(Number(req.params.id));
  res.redirect('/painel/contatos/tags');
});

// Novo contato: confere no WhatsApp se o número existe (igual a "+ Nova conversa"), cria a ficha
// e abre ela pra completar o cadastro. Se o número já existe, só abre a ficha dele.
function renderizarNovo(req, res, erro = null) {
  res.render('contatos/novo', { atendenteLogado: req.atendente, erro, valores: req.body || {} });
}
router.get('/novo', (req, res) => renderizarNovo(req, res));
router.post('/novo', async (req, res) => {
  const digitos = String(req.body.telefone || '').replace(/\D/g, '');
  if (digitos.length < 10) return renderizarNovo(req, res, 'Informe o telefone com DDD (e o 55 do Brasil na frente, se quiser).');
  const comPais = digitos.length <= 11 ? `55${digitos}` : digitos;
  const sock = obterSocket();
  if (!sock) return renderizarNovo(req, res, 'O WhatsApp não está conectado agora — não dá pra conferir o número. Tente daqui a pouco.');
  try {
    const numero = await resolverNumeroNoWhatsApp(sock, comPais);
    if (!numero) return renderizarNovo(req, res, 'Esse número não tem WhatsApp, ou está digitado errado.');
    const conversa = obterOuCriarConversa(numero);
    definirNumeroExibicao(numero, comPais);
    if (String(req.body.nome || '').trim()) renomearContato(conversa.id, req.body.nome);
    res.redirect(`/painel/contatos/${conversa.id}`);
  } catch (erro) {
    renderizarNovo(req, res, 'Não consegui conferir o número no WhatsApp agora. Tente de novo em instantes.');
  }
});

router.get('/:id', (req, res) => {
  const contato = contatos.obterContato(Number(req.params.id));
  if (!contato) return res.redirect('/painel/contatos');
  res.render('contatos/ficha', { atendenteLogado: req.atendente, contato, tags: contatos.listarTags(), salvo: !!req.query.salvo });
});

router.post('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!contatos.obterContato(id)) return res.redirect('/painel/contatos');
  // tags: o formulário manda tags_enviadas (nenhuma marcada = tira todas)
  contatos.salvarContato(id, { ...req.body, tags: req.body.tags_enviadas ? req.body.tags || [] : undefined });
  res.redirect(`/painel/contatos/${id}?salvo=1`);
});

module.exports = router;

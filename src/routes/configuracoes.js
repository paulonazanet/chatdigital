const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');

const { carregarNegocio, salvarConfiguracoes } = require('../negocio');
const whatsappStatus = require('../whatsapp-status');
const { listarSetores } = require('../setores');
const motivos = require('../motivos-encerramento');
const marcadores = require('../marcadores');
const feriados = require('../feriados');

function paraFormasPagamentoArray(texto) {
  return String(texto || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Campos de texto das mensagens automáticas. Campo que não veio no envio (formulário antigo ainda
// aberto numa aba) mantém o valor atual em vez de virar vazio.
const CAMPOS_DE_TEXTO = [
  'horario_funcionamento',
  'endereco',
  'mensagem_boas_vindas_atendente',
  'mensagem_encerramento',
  'pesquisa_satisfacao',
  'mensagem_sem_atendente_disponivel',
  'mensagem_inatividade',
  'mensagem_avaliacao_nao_respondida',
  'mensagem_inatividade_transferencia',
  'mensagem_fechamento_automatico',
];

// Números inteiros das configurações de tempo: [campo, mínimo, máximo, nome pra mensagem de erro]
const CAMPOS_NUMERICOS = [
  ['fila_minutos_amarelo', 0, 1440, 'Os tempos da fila'],
  ['fila_minutos_vermelho', 0, 1440, 'Os tempos da fila'],
  ['inatividade_minutos_lembrete', 1, 1440, 'Os tempos de inatividade'],
  ['inatividade_minutos_limite', 1, 1440, 'Os tempos de inatividade'],
  ['fechamento_automatico_horas', 0, 720, 'As horas do fechamento automático'],
];

// Resumo dos cartões do topo (WhatsApp, Motivos, Marcadores)
function resumoDasSubtelas() {
  const motivosAtivos = motivos.listarArvore({ soAtivos: true }).reduce((total, g) => total + g.motivos.length, 0);
  return {
    whatsappConectado: whatsappStatus.obterEstado().conectado,
    motivosAtivos,
    marcadoresAtivos: marcadores.listarMarcadores({ soAtivos: true }).length,
    feriadosAtivos: feriados.listarFeriados().filter((f) => f.ativo).length,
  };
}

function renderizar(req, res, extra) {
  res.render('configuracoes/editar', {
    atendenteLogado: req.atendente,
    setores: listarSetores(),
    resumo: resumoDasSubtelas(),
    erro: null,
    salvo: false,
    ...extra,
  });
}

router.get('/', (req, res) => renderizar(req, res, { negocio: carregarNegocio() }));

router.post('/', (req, res) => {
  const atual = carregarNegocio();
  const corpo = req.body;
  const campos = { formas_pagamento: corpo.formas_pagamento === undefined ? atual.formas_pagamento : paraFormasPagamentoArray(corpo.formas_pagamento) };
  for (const campo of CAMPOS_DE_TEXTO) {
    campos[campo] = corpo[campo] === undefined ? atual[campo] : String(corpo[campo]).trim();
  }

  let erro = !corpo.nome || !corpo.nome.trim() ? 'O nome do negócio é obrigatório.' : null;
  for (const [campo, minimo, maximo, rotulo] of CAMPOS_NUMERICOS) {
    const valor = corpo[campo] === undefined ? atual[campo] : Number(corpo[campo]);
    if (!erro && (!Number.isInteger(valor) || valor < minimo || valor > maximo)) {
      erro = `${rotulo} precisam ser números inteiros entre ${minimo} e ${maximo}.`;
    }
    campos[campo] = valor;
  }
  if (!erro && campos.fila_minutos_vermelho < campos.fila_minutos_amarelo) {
    erro = 'O tempo da bolinha vermelha não pode ser menor que o da amarela.';
  }
  if (!erro && campos.inatividade_minutos_limite <= campos.inatividade_minutos_lembrete) {
    erro = 'O tempo pra desistir tem que ser maior que o tempo do lembrete de inatividade.';
  }

  // checkbox desmarcado não vem no envio: o campo escondido diz que o formulário novo foi usado
  campos.exigir_motivo_encerramento = corpo.exigir_motivo_encerramento_enviado
    ? !!corpo.exigir_motivo_encerramento
    : !!atual.exigir_motivo_encerramento;

  campos.inatividade_acao = corpo.inatividade_acao === undefined ? atual.inatividade_acao : corpo.inatividade_acao === 'transferir' ? 'transferir' : 'reiniciar';
  if (corpo.inatividade_setor_id === undefined) {
    campos.inatividade_setor_id = atual.inatividade_setor_id;
  } else {
    const setor = corpo.inatividade_setor_id ? listarSetores().find((s) => String(s.id) === String(corpo.inatividade_setor_id)) : null;
    campos.inatividade_setor_id = setor ? setor.id : null;
  }

  if (erro) {
    return renderizar(req, res, { negocio: { ...atual, ...corpo, formas_pagamento: campos.formas_pagamento }, erro });
  }
  const negocio = salvarConfiguracoes({ nome: corpo.nome.trim(), ...campos });
  renderizar(req, res, { negocio, salvo: true });
});

// Motivos de encerramento: grupos (ex.: "Resolvido") com motivos dentro.
function renderizarMotivos(req, res, erro = null) {
  res.render('configuracoes/motivos', { atendenteLogado: req.atendente, grupos: motivos.listarArvore(), erro, salvo: !!req.query.salvo });
}

router.get('/motivos', (req, res) => renderizarMotivos(req, res));

router.post('/motivos', (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const paiId = req.body.pai_id ? Number(req.body.pai_id) : null;
  if (!nome) return renderizarMotivos(req, res, 'Escreva o nome.');
  if (paiId && !motivos.listarArvore().some((g) => g.id === paiId)) return res.redirect('/painel/configuracoes/motivos');
  motivos.criarMotivo(nome, paiId);
  res.redirect('/painel/configuracoes/motivos');
});

// Salvar tudo de uma vez: cada grupo/motivo da tela vem como nome_<id> e ativo_<id>
router.post('/motivos/salvar', (req, res) => {
  for (const g of motivos.listarArvore()) {
    for (const item of [g, ...g.motivos]) {
      const nome = req.body[`nome_${item.id}`];
      if (nome === undefined || !String(nome).trim()) continue;
      motivos.atualizarMotivo(item.id, { nome, ativo: !!req.body[`ativo_${item.id}`] });
    }
  }
  res.redirect('/painel/configuracoes/motivos?salvo=1');
});

router.post('/motivos/:id', (req, res) => {
  const nome = String(req.body.nome || '').trim();
  if (nome) motivos.atualizarMotivo(Number(req.params.id), { nome, ativo: !!req.body.ativo });
  res.redirect('/painel/configuracoes/motivos');
});

router.post('/motivos/:id/excluir', (req, res) => {
  motivos.excluirMotivo(Number(req.params.id));
  res.redirect('/painel/configuracoes/motivos');
});

// Marcadores da conversa (etiquetas coloridas que o atendente põe em Ações > Marcadores)
function renderizarMarcadores(req, res, erro = null) {
  res.render('configuracoes/marcadores', {
    atendenteLogado: req.atendente,
    marcadores: marcadores.listarMarcadores(),
    cores: marcadores.CORES,
    erro,
    salvo: !!req.query.salvo,
  });
}

router.get('/marcadores', (req, res) => renderizarMarcadores(req, res));

router.post('/marcadores', (req, res) => {
  const nome = String(req.body.nome || '').trim();
  if (!nome) return renderizarMarcadores(req, res, 'Escreva o nome do marcador.');
  marcadores.criarMarcador(nome, req.body.cor);
  res.redirect('/painel/configuracoes/marcadores');
});

// Salvar tudo de uma vez: cada marcador da tela vem como nome_<id>, cor_<id> e ativo_<id>
router.post('/marcadores/salvar', (req, res) => {
  for (const m of marcadores.listarMarcadores()) {
    const nome = req.body[`nome_${m.id}`];
    if (nome === undefined || !String(nome).trim()) continue;
    marcadores.atualizarMarcador(m.id, { nome, cor: req.body[`cor_${m.id}`], ativo: !!req.body[`ativo_${m.id}`] });
  }
  res.redirect('/painel/configuracoes/marcadores?salvo=1');
});

router.post('/marcadores/:id', (req, res) => {
  const nome = String(req.body.nome || '').trim();
  if (nome) marcadores.atualizarMarcador(Number(req.params.id), { nome, cor: req.body.cor, ativo: !!req.body.ativo });
  res.redirect('/painel/configuracoes/marcadores');
});

router.post('/marcadores/:id/excluir', (req, res) => {
  marcadores.excluirMarcador(Number(req.params.id));
  res.redirect('/painel/configuracoes/marcadores');
});

// Feriados: num feriado sem expediente o bloco Horário do fluxo vai para "fora do horário" e os
// setores com horário próprio ficam fechados (ver feriados.js)
function renderizarFeriados(req, res, extra = {}) {
  res.render('configuracoes/feriados', {
    atendenteLogado: req.atendente,
    feriados: feriados.listarFeriados(),
    feriadoHoje: feriados.feriadoAgora(),
    importados: req.query.importados !== undefined ? Number(req.query.importados) : null,
    ...extra,
  });
}
function renderizarFormFeriado(req, res, feriado, erro = null) {
  res.render('configuracoes/feriado-form', { atendenteLogado: req.atendente, feriado, erro });
}
const FERIADO_NOVO = { nome: '', data: '', repete_ano: 1, dia_inteiro: 1, hora_inicio: '', hora_fim: '', tem_expediente: 0, mensagem: '', ativo: 1 };
// o que a pessoa digitou, pra mostrar de volta junto com o erro (checkbox desmarcado não vem no envio)
function feriadoDigitado(corpo) {
  const marcado = (campo) => (corpo[campo] ? 1 : 0);
  return { ...corpo, repete_ano: marcado('repete_ano'), dia_inteiro: marcado('dia_inteiro'), tem_expediente: marcado('tem_expediente'), ativo: marcado('ativo') };
}

router.get('/feriados', (req, res) => renderizarFeriados(req, res));
router.post('/feriados/importar', (req, res) => {
  res.redirect(`/painel/configuracoes/feriados?importados=${feriados.importarNacionais()}`);
});
router.get('/feriados/novo', (req, res) => renderizarFormFeriado(req, res, FERIADO_NOVO));
router.post('/feriados/novo', (req, res) => {
  const { campos, erro } = feriados.validar(req.body);
  if (erro) return renderizarFormFeriado(req, res, feriadoDigitado(req.body), erro);
  feriados.criarFeriado(campos);
  res.redirect('/painel/configuracoes/feriados');
});
router.get('/feriados/:id', (req, res) => {
  // pela lista, que traz a próxima data (a de um feriado móvel muda todo ano)
  const feriado = feriados.listarFeriados().find((f) => f.id === Number(req.params.id));
  if (!feriado) return res.redirect('/painel/configuracoes/feriados');
  renderizarFormFeriado(req, res, feriado);
});
router.post('/feriados/:id', (req, res) => {
  const feriado = feriados.obterFeriado(Number(req.params.id));
  if (!feriado) return res.redirect('/painel/configuracoes/feriados');
  const { campos, erro } = feriados.validar(req.body);
  if (erro) return renderizarFormFeriado(req, res, { ...feriadoDigitado(req.body), id: feriado.id }, erro);
  feriados.atualizarFeriado(feriado.id, campos);
  res.redirect('/painel/configuracoes/feriados');
});
router.post('/feriados/:id/excluir', (req, res) => {
  feriados.excluirFeriado(Number(req.params.id));
  res.redirect('/painel/configuracoes/feriados');
});

router.get('/whatsapp', (req, res) => {
  const { conectado, qr } = whatsappStatus.obterEstado();
  res.render('configuracoes/whatsapp', { atendenteLogado: req.atendente, conectado, temQr: !!qr });
});

// Imagem do QR Code atual, gerada a partir da string que o Baileys manda — sem cache, porque o
// QR muda (o WhatsApp expira e reenvia um novo) toda vez que o painel recarrega essa tag <img>.
router.get('/whatsapp/qr.png', async (req, res) => {
  const { qr } = whatsappStatus.obterEstado();
  if (!qr) return res.status(404).end();

  res.set('Cache-Control', 'no-store');
  try {
    const png = await QRCode.toBuffer(qr, { width: 320, margin: 1 });
    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch (erro) {
    console.error('Falha ao gerar imagem do QR Code:', erro);
    res.status(500).end();
  }
});

module.exports = router;

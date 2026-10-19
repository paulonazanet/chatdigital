const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');

const { carregarNegocio, salvarConfiguracoes } = require('../negocio');
const whatsappStatus = require('../whatsapp-status');
const { listarSetores } = require('../setores');
const motivos = require('../motivos-encerramento');
const marcadores = require('../marcadores');
const feriados = require('../feriados');
const { lerMetas } = require('../relatorio');
const equipe = require('../equipe');
const crypto = require('crypto');
const { montarStatus } = require('../status-sistema');
const oficial = require('../whatsapp-oficial');
const { modoAtual } = require('../socket-atual');

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
    metasDefinidas: Object.entries(lerMetas()).filter(([chave, valor]) => chave !== 'reincidenciaDias' && valor).length,
    motivosPausaAtivos: equipe.listarMotivosPausa({ soAtivos: true }).length,
    alertasLigados: ['alerta_fila_minutos', 'alerta_fila_quantidade', 'alerta_sem_resposta_minutos'].filter((c) => Number(carregarNegocio()[c]) > 0).length,
    painelTvLigado: !!carregarNegocio().painel_tv_token,
    status: montarStatus(),
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
  const feriado = feriados.obterFeriado(Number(req.params.id));
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

// Metas do Relatório (verde dentro, vermelho fora) e o prazo das reincidências. 0 = sem meta.
const CAMPOS_METAS = [
  ['meta_espera_minutos', 0, 1440, true],
  ['meta_primeira_resposta_minutos', 0, 1440, true],
  ['meta_duracao_minutos', 0, 1440, true],
  ['meta_nota', 0, 10, false],
  ['reincidencia_dias', 1, 90, true],
];
function renderizarMetas(req, res, extra = {}) {
  res.render('configuracoes/metas', { atendenteLogado: req.atendente, negocio: carregarNegocio(), erro: null, salvo: !!req.query.salvo, ...extra });
}
router.get('/metas', (req, res) => renderizarMetas(req, res));
router.post('/metas', (req, res) => {
  const campos = {};
  for (const [campo, minimo, maximo, inteiro] of CAMPOS_METAS) {
    const texto = String(req.body[campo] ?? '').trim().replace(',', '.');
    const valor = texto === '' ? (campo === 'reincidencia_dias' ? 7 : 0) : Number(texto);
    if (!Number.isFinite(valor) || valor < minimo || valor > maximo || (inteiro && !Number.isInteger(valor))) {
      const erro =
        campo === 'meta_nota'
          ? 'A nota mínima tem que ser de 0 a 10 (pode ter uma casa decimal, ex.: 8,5).'
          : campo === 'reincidencia_dias'
            ? 'Os dias da reincidência têm que ser um número inteiro de 1 a 90.'
            : 'Os tempos das metas têm que ser minutos inteiros, de 0 a 1440.';
      return renderizarMetas(req, res, { negocio: { ...carregarNegocio(), ...req.body }, erro });
    }
    campos[campo] = campo === 'meta_nota' ? Math.round(valor * 10) / 10 : valor;
  }
  salvarConfiguracoes(campos);
  res.redirect('/painel/configuracoes/metas?salvo=1');
});

// Pausas e alertas: motivos de pausa (com limite de minutos) e os números dos alertas de fila.
const CAMPOS_ALERTAS = [
  ['alerta_fila_minutos', 'O tempo de espera na fila'],
  ['alerta_fila_quantidade', 'A quantidade da fila cheia'],
  ['alerta_sem_resposta_minutos', 'O tempo sem resposta'],
];
function renderizarPausas(req, res, extra = {}) {
  res.render('configuracoes/pausas', {
    atendenteLogado: req.atendente,
    motivos: equipe.listarMotivosPausa(),
    negocio: carregarNegocio(),
    erro: null,
    salvo: !!req.query.salvo,
    ...extra,
  });
}
router.get('/pausas', (req, res) => renderizarPausas(req, res));
router.post('/pausas/alertas', (req, res) => {
  const campos = {};
  for (const [campo, rotulo] of CAMPOS_ALERTAS) {
    const texto = String(req.body[campo] ?? '').trim();
    const valor = texto === '' ? 0 : Number(texto);
    if (!Number.isInteger(valor) || valor < 0 || valor > 1440) {
      return renderizarPausas(req, res, { erro: `${rotulo} tem que ser um número inteiro de 0 a 1440 (0 desliga).`, negocio: { ...carregarNegocio(), ...req.body } });
    }
    campos[campo] = valor;
  }
  salvarConfiguracoes(campos);
  res.redirect('/painel/configuracoes/pausas?salvo=1');
});
router.post('/pausas', (req, res) => {
  const motivo = equipe.validarMotivoPausa(req.body.nome, req.body.limite_minutos);
  if (motivo.erro) return renderizarPausas(req, res, { erro: motivo.erro });
  equipe.criarMotivoPausa(motivo.nome, motivo.limite);
  res.redirect('/painel/configuracoes/pausas?salvo=1');
});
router.post('/pausas/salvar', (req, res) => {
  const atualizacoes = [];
  for (const m of equipe.listarMotivosPausa()) {
    if (req.body[`nome_${m.id}`] === undefined) continue;
    const motivo = equipe.validarMotivoPausa(req.body[`nome_${m.id}`], req.body[`limite_${m.id}`]);
    if (motivo.erro) return renderizarPausas(req, res, { erro: motivo.erro });
    atualizacoes.push([m.id, { nome: motivo.nome, limite: motivo.limite, ativo: !!req.body[`ativo_${m.id}`] }]);
  }
  for (const [id, dados] of atualizacoes) equipe.atualizarMotivoPausa(id, dados);
  res.redirect('/painel/configuracoes/pausas?salvo=1');
});
router.post('/pausas/:id/excluir', (req, res) => {
  equipe.excluirMotivoPausa(Number(req.params.id));
  res.redirect('/painel/configuracoes/pausas');
});

// Painel ao vivo para TV: um link secreto (/tv/<código>) que abre sem login, pra deixar numa TV.
// Gerar de novo troca o código (o link antigo para de funcionar); desligar apaga.
router.get('/painel-tv', (req, res) => {
  const token = carregarNegocio().painel_tv_token;
  const link = token ? `${req.protocol}://${req.get('host')}/tv/${token}` : null;
  res.render('configuracoes/painel-tv', { atendenteLogado: req.atendente, link, gerado: !!req.query.gerado });
});
router.post('/painel-tv/gerar', (req, res) => {
  salvarConfiguracoes({ painel_tv_token: crypto.randomBytes(18).toString('base64url') });
  res.redirect('/painel/configuracoes/painel-tv?gerado=1');
});
router.post('/painel-tv/desligar', (req, res) => {
  salvarConfiguracoes({ painel_tv_token: null });
  res.redirect('/painel/configuracoes/painel-tv');
});

// Status do sistema: WhatsApp, banco, disco, backup e versão (só leitura)
router.get('/status', (req, res) => {
  res.render('configuracoes/status', { atendenteLogado: req.atendente, status: montarStatus() });
});

// WhatsApp: a conexão escolhida (celular por QR Code ou API oficial da Meta) e, na oficial, os dados
// da Meta, o teste, o endereço do webhook e os modelos. A escolha vale depois de reiniciar o sistema.
function renderizarWhatsapp(req, res, extra = {}) {
  const { conectado, qr } = whatsappStatus.obterEstado();
  res.render('configuracoes/whatsapp', {
    atendenteLogado: req.atendente,
    conectado,
    temQr: !!qr,
    escolhida: carregarNegocio().whatsapp_conexao === 'oficial' ? 'oficial' : 'celular',
    emUso: modoAtual(),
    config: oficial.configParaTela(),
    enderecoWebhook: `${req.protocol}://${req.get('host')}/webhook/whatsapp`,
    modelos: oficial.listarModelos(),
    erro: null,
    aviso: req.query.aviso || null,
    ...extra,
  });
}
router.get('/whatsapp', (req, res) => renderizarWhatsapp(req, res));
router.post('/whatsapp/conexao', (req, res) => {
  salvarConfiguracoes({ whatsapp_conexao: req.body.whatsapp_conexao === 'oficial' ? 'oficial' : 'celular' });
  res.redirect('/painel/configuracoes/whatsapp?aviso=conexao');
});
router.post('/whatsapp/oficial', async (req, res) => {
  const resultado = oficial.salvarConfig(req.body);
  if (resultado.erro) return renderizarWhatsapp(req, res, { erro: resultado.erro });
  const teste = oficial.configurado() ? await oficial.testarConexao() : { ok: false, erro: 'Falta o código do número ou a chave de acesso.' };
  if (teste.ok && modoAtual() === 'oficial') whatsappStatus.definirConectado();
  res.redirect(`/painel/configuracoes/whatsapp?aviso=${teste.ok ? 'testado' : 'falhou'}`);
});
router.post('/whatsapp/oficial/testar', async (req, res) => {
  const teste = await oficial.testarConexao();
  if (modoAtual() === 'oficial') (teste.ok ? whatsappStatus.definirConectado : whatsappStatus.definirDesconectado)();
  res.redirect(`/painel/configuracoes/whatsapp?aviso=${teste.ok ? 'testado' : 'falhou'}`);
});
router.post('/whatsapp/oficial/codigo', (req, res) => {
  oficial.trocarCodigoVerificacao();
  res.redirect('/painel/configuracoes/whatsapp?aviso=codigo');
});
router.post('/whatsapp/oficial/modelos', async (req, res) => {
  const resultado = await oficial.sincronizarModelos();
  if (resultado.erro) return renderizarWhatsapp(req, res, { erro: `Modelos: ${resultado.erro}` });
  res.redirect('/painel/configuracoes/whatsapp?aviso=modelos');
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

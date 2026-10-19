const express = require('express');
const router = express.Router();

const {
  listarSetores,
  obterSetorPorId,
  criarSetor,
  renomearSetor,
  janelasDoSetor,
  janelasDoFormulario,
  salvarHorarioDoSetor,
} = require('../setores');

router.get('/', (req, res) => {
  res.render('setores/lista', { atendenteLogado: req.atendente, setores: listarSetores(), erro: null, janelasDoSetor });
});

router.post('/', (req, res) => {
  const nome = (req.body.nome || '').trim();
  const reexibir = (erro) => res.render('setores/lista', { atendenteLogado: req.atendente, setores: listarSetores(), erro, janelasDoSetor });
  if (!nome) return reexibir('Informe um nome para o setor.');
  try {
    criarSetor(nome);
  } catch (erro) {
    return reexibir('Já existe um setor com esse nome.');
  }
  res.redirect('/painel/setores');
});

// Horário do setor: o formulário manda inicio_<dia>_<periodo> e fim_<dia>_<periodo> (dia 0 a 6,
// período 1 ou 2); volta pra tela com os mesmos valores se tiver erro.
function horarioDoCorpo(corpo) {
  const porDia = {};
  for (let dia = 0; dia <= 6; dia += 1) {
    porDia[dia] = [1, 2].map((p) => [String(corpo[`inicio_${dia}_${p}`] || ''), String(corpo[`fim_${dia}_${p}`] || '')]);
  }
  return porDia;
}
function horarioDasJanelas(janelas) {
  const porDia = {};
  for (let dia = 0; dia <= 6; dia += 1) porDia[dia] = [];
  for (const janela of janelas) {
    const [diasStr, horas] = String(janela).split(' ');
    const [inicio, fim] = String(horas || '').split('-');
    for (const dia of String(diasStr).split(',').map(Number)) if (porDia[dia]) porDia[dia].push([inicio, fim]);
  }
  return porDia;
}

function renderizarSetor(req, res, setor, { erro = null, porDia = null, mensagem } = {}) {
  res.render('setores/editar', {
    atendenteLogado: req.atendente,
    setor,
    porDia: porDia || horarioDasJanelas(janelasDoSetor(setor)),
    mensagem: mensagem !== undefined ? mensagem : setor.mensagem_fora_horario || '',
    erro,
    salvo: !!req.query.salvo,
  });
}

router.get('/:id', (req, res) => {
  const setor = obterSetorPorId(Number(req.params.id));
  if (!setor) return res.redirect('/painel/setores');
  renderizarSetor(req, res, setor);
});

router.post('/:id', (req, res) => {
  const setor = obterSetorPorId(Number(req.params.id));
  if (!setor) return res.redirect('/painel/setores');
  const nome = (req.body.nome || '').trim();
  if (req.body.horario_enviado) {
    const porDia = horarioDoCorpo(req.body);
    const { janelas, erro } = janelasDoFormulario(porDia);
    if (erro) return renderizarSetor(req, res, setor, { erro, porDia, mensagem: req.body.mensagem_fora_horario });
    try {
      if (nome) renomearSetor(setor.id, nome);
    } catch (erroNome) {
      return renderizarSetor(req, res, setor, { erro: 'Já existe um setor com esse nome.', porDia, mensagem: req.body.mensagem_fora_horario });
    }
    salvarHorarioDoSetor(setor.id, janelas, req.body.mensagem_fora_horario);
    return res.redirect(`/painel/setores/${setor.id}?salvo=1`);
  }
  if (nome) renomearSetor(setor.id, nome);
  res.redirect('/painel/setores');
});

module.exports = router;

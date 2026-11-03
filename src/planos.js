const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const { arquivoPlano } = require('./caminhos');

// Planos e limites (E5, 3a parte). Cada instalação tem um config/plano.json, escrito pela tela Clientes
// da Eu no Digital (nunca pelo painel do próprio cliente). Sem o arquivo, a instalação não tem limites
// (Nazagás, Eu no Digital e quem ainda não recebeu plano): nunca derrubar ninguém por falta de plano.
// Baixar de plano não apaga nem desliga nada: só impede criar ou ligar mais.

const RECURSOS = {
  relatorios: 'Relatórios',
  lembretes: 'Lembrete de recompra',
  campanhas: 'Campanhas',
  metas: 'Metas',
  painel_tv: 'Painel para TV',
  api_oficial: 'API oficial do WhatsApp',
  instagram: 'Instagram',
};

// numeros: null = sem limite
const PLANOS = {
  essencial: { nome: 'Essencial', preco: 49, atendentes: 3, numeros: 1, recursos: ['relatorios', 'lembretes'] },
  profissional: { nome: 'Profissional', preco: 99, atendentes: 6, numeros: 2, recursos: ['relatorios', 'lembretes', 'campanhas', 'metas', 'painel_tv'] },
  empresa: { nome: 'Empresa', preco: 199, atendentes: 15, numeros: null, recursos: Object.keys(RECURSOS) },
};

const inteiro = (valor) => Math.max(0, Math.floor(Number(valor)) || 0);
const reais = (valor) => Math.max(0, Math.round((Number(String(valor).replace(',', '.')) || 0) * 100) / 100);

function lerArquivo(arquivo) {
  try {
    const salvo = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return PLANOS[salvo.plano] ? salvo : null;
  } catch (erro) {
    if (erro.code !== 'ENOENT') console.error(`plano: não consegui ler ${arquivo}: ${erro.message}`);
    return null;
  }
}

/** O plano com o que foi negociado à parte por cima. Sem plano salvo: { semLimites: true } */
function planoEfetivo(salvo) {
  if (!salvo) return { semLimites: true, nome: 'Sem limites', atendentes: null, numeros: null, recursos: Object.keys(RECURSOS), total: 0, recursosExtras: [] };
  const base = PLANOS[salvo.plano];
  const recursosExtras = [].concat(salvo.recursos_extras || []).filter((r) => RECURSOS[r] && !base.recursos.includes(r));
  const valorExtra = reais(salvo.valor_extra);
  return {
    semLimites: false,
    plano: salvo.plano,
    nome: base.nome,
    atendentes: base.atendentes + inteiro(salvo.atendentes_extras),
    numeros: base.numeros === null ? null : base.numeros + inteiro(salvo.numeros_extras),
    recursos: [...base.recursos, ...recursosExtras],
    atendentesExtras: inteiro(salvo.atendentes_extras),
    numerosExtras: inteiro(salvo.numeros_extras),
    recursosExtras,
    preco: base.preco,
    valorExtra,
    total: base.preco + valorExtra,
    obs: String(salvo.obs || ''),
  };
}

const planoAtual = () => planoEfetivo(lerArquivo(arquivoPlano()));
const temRecurso = (chave) => planoAtual().recursos.includes(chave);

const contarAtendentesAtivos = (exceto = 0) => db.prepare('SELECT COUNT(*) AS n FROM atendentes WHERE ativo = 1 AND id <> ?').get(exceto).n;
const contarNumerosLigados = () => db.prepare("SELECT COUNT(*) AS n FROM canais WHERE ativo = 1 AND tipo = 'celular'").get().n;

/** Dá para ter mais um atendente ativo? `exceto`: quem está sendo editado. Devolve { ok } ou { erro } */
function podeAtivarAtendente(exceto = 0) {
  const { atendentes, nome } = planoAtual();
  if (atendentes === null || contarAtendentesAtivos(exceto) < atendentes) return { ok: true };
  return { erro: `O plano ${nome} vai até ${atendentes} atendentes ativos. Para ter mais, fale com a Eu no Digital.` };
}

function podeLigarNumero() {
  const { numeros, nome } = planoAtual();
  if (numeros === null || contarNumerosLigados() < numeros) return { ok: true };
  return { erro: `O plano ${nome} vai até ${numeros} número${numeros === 1 ? '' : 's'} de WhatsApp. Para ter mais, fale com a Eu no Digital.` };
}

/** Middleware: a função faz parte do plano? Se não, mostra o aviso em vez da tela. */
function exigirRecurso(chave) {
  return (req, res, next) => {
    if (temRecurso(chave)) return next();
    res.status(403).render('fora-do-plano', { atendenteLogado: req.atendente, recurso: RECURSOS[chave], plano: planoAtual() });
  };
}

function resumoDoUso() {
  return { atendentes: contarAtendentesAtivos(), numeros: contarNumerosLigados() };
}

// ---- Tela Clientes: só na instalação da Eu no Digital, que recebe CHATDIGITAL_CENTRAL no .env ----
const NOME_VALIDO = /^[a-z][a-z0-9-]{1,30}$/;

function pastaCentral() {
  return process.env.CHATDIGITAL_CENTRAL ? path.resolve(process.env.CHATDIGITAL_CENTRAL) : null;
}

function pastaDoCliente(nome) {
  const central = pastaCentral();
  if (!central || !NOME_VALIDO.test(String(nome))) return null;
  const pasta = path.join(central, nome);
  return fs.existsSync(path.join(pasta, '.env')) ? pasta : null;
}

const arquivoDoCliente = (pasta) => path.join(pasta, 'config', 'plano.json');

function nomeDoNegocio(pasta, reserva) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pasta, 'config', 'negocio.json'), 'utf8')).nome || reserva;
  } catch (erro) {
    return reserva;
  }
}

function obterCliente(nome) {
  const pasta = pastaDoCliente(nome);
  if (!pasta) return null;
  return { id: nome, nome: nomeDoNegocio(pasta, nome), plano: planoEfetivo(lerArquivo(arquivoDoCliente(pasta))) };
}

function listarClientes() {
  const central = pastaCentral();
  if (!central) return [];
  return fs.readdirSync(central).map(obterCliente).filter(Boolean).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function gravar(arquivo, conteudo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.tmp`;
  fs.writeFileSync(temporario, `${JSON.stringify(conteudo, null, 2)}\n`);
  fs.renameSync(temporario, arquivo); // quem está lendo nunca pega o arquivo pela metade
}

/** Um clique: troca o plano e mantém o que foi negociado à parte. plano vazio = sem limites. */
function escolherPlano(nome, plano) {
  const pasta = pastaDoCliente(nome);
  if (!pasta) return { erro: 'Cliente não encontrado.' };
  const arquivo = arquivoDoCliente(pasta);
  if (!plano) {
    fs.rmSync(arquivo, { force: true });
    return { ok: true };
  }
  if (!PLANOS[plano]) return { erro: 'Plano não encontrado.' };
  gravar(arquivo, { ...(lerArquivo(arquivo) || {}), plano });
  return { ok: true };
}

/** Editar: o que foi negociado à parte com o cliente, por cima do plano */
function salvarNegociado(nome, dados) {
  const pasta = pastaDoCliente(nome);
  if (!pasta) return { erro: 'Cliente não encontrado.' };
  const arquivo = arquivoDoCliente(pasta);
  const atual = lerArquivo(arquivo);
  if (!atual) return { erro: 'Escolha um plano antes.' };
  gravar(arquivo, {
    plano: atual.plano,
    atendentes_extras: inteiro(dados.atendentes_extras),
    numeros_extras: inteiro(dados.numeros_extras),
    recursos_extras: [].concat(dados.recursos_extras || []).filter((r) => RECURSOS[r]),
    valor_extra: reais(dados.valor_extra),
    obs: String(dados.obs || '').trim().slice(0, 300),
  });
  return { ok: true };
}

module.exports = {
  RECURSOS,
  PLANOS,
  planoAtual,
  planoEfetivo,
  temRecurso,
  exigirRecurso,
  podeAtivarAtendente,
  podeLigarNumero,
  resumoDoUso,
  pastaCentral,
  listarClientes,
  obterCliente,
  escolherPlano,
  salvarNegociado,
};

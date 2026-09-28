// Permissões granulares pra atendentes com papel "atendente" (admin sempre tem tudo, sem
// depender dessa lista). Cada chave controla o acesso a uma tela/ação específica do painel.
const CHAVES = [
  'ver_painel',
  'gerenciar_atendentes',
  'gerenciar_setores',
  'editar_fluxo',
  'ver_fila_outros_setores',
  'responder_conversas',
  'finalizar_conversas',
];

const ROTULOS = {
  ver_painel: 'Ver Painel (resumo/gestão)',
  gerenciar_atendentes: 'Cadastrar e gerenciar Atendentes',
  gerenciar_setores: 'Cadastrar e gerenciar Setores',
  editar_fluxo: 'Ver e editar o Fluxo',
  ver_fila_outros_setores: 'Ver fila de outros setores (não só o seu)',
  responder_conversas: 'Responder conversas',
  finalizar_conversas: 'Finalizar conversas',
};

function permissoesPadraoAtendente() {
  // o mínimo pra um atendente recém-cadastrado conseguir atender (admin ajusta depois se quiser)
  return ['responder_conversas', 'finalizar_conversas'];
}

function normalizarPermissoes(lista) {
  const conjunto = new Set(Array.isArray(lista) ? lista : []);
  return CHAVES.filter((c) => conjunto.has(c));
}

function permissoesParaSalvar(papel, listaSubmetida) {
  if (papel === 'admin') return [...CHAVES];
  return normalizarPermissoes(listaSubmetida);
}

function listaPermissoes(atendente) {
  if (!atendente) return [];
  if (atendente.papel === 'admin') return [...CHAVES];
  try {
    return normalizarPermissoes(JSON.parse(atendente.permissoes || '[]'));
  } catch (erro) {
    return [];
  }
}

function temPermissao(atendente, chave) {
  if (!atendente) return false;
  if (atendente.papel === 'admin') return true;
  return listaPermissoes(atendente).includes(chave);
}

module.exports = {
  CHAVES,
  ROTULOS,
  normalizarPermissoes,
  permissoesParaSalvar,
  permissoesPadraoAtendente,
  listaPermissoes,
  temPermissao,
};

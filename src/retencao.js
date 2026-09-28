const crypto = require('crypto');
const { db } = require('./db');

// Retenção de dados (decidido com o Paulo): conversa sem nenhuma atividade há 12 meses tem as
// mensagens apagadas e o número do WhatsApp anonimizado, mantendo a linha em `conversas` (status,
// setor, datas) pra estatística agregada continuar funcionando sem guardar dado pessoal.
// Escopo atual: só `conversas`/`mensagens`, que existem em toda instalação. A tabela `registros`
// (produzida pelo nó "salvar" do fluxo, ex.: pedidos com endereço) tem campos que variam de
// negócio pra negócio e não foi incluída — decisão pendente de como anonimizar isso
// genericamente.
const MESES_RETENCAO = 12;
const INTERVALO_CHECAGEM_MS = 24 * 60 * 60 * 1000; // 1x por dia é suficiente

const PREFIXO_ANONIMO = 'anonimizado-';

function limiteRetencaoIso() {
  const data = new Date();
  data.setMonth(data.getMonth() - MESES_RETENCAO);
  return data.toISOString();
}

function anonimizarNumero(numero) {
  return PREFIXO_ANONIMO + crypto.createHash('sha256').update(numero).digest('hex').slice(0, 16);
}

/** Devolve quantas conversas foram anonimizadas nesta passada. */
function aplicarRetencao() {
  const candidatas = db
    .prepare(`SELECT id, numero FROM conversas WHERE atualizado_em <= ? AND numero NOT LIKE '${PREFIXO_ANONIMO}%'`)
    .all(limiteRetencaoIso());

  for (const conversa of candidatas) {
    db.prepare('DELETE FROM mensagens WHERE conversa_id = ?').run(conversa.id);
    db.prepare('UPDATE conversas SET numero = ? WHERE id = ?').run(anonimizarNumero(conversa.numero), conversa.id);
  }

  return candidatas.length;
}

function iniciarRetencaoDiaria() {
  try {
    aplicarRetencao();
  } catch (erro) {
    console.error('Falha ao aplicar retenção de dados:', erro);
  }
  return setInterval(() => {
    try {
      aplicarRetencao();
    } catch (erro) {
      console.error('Falha ao aplicar retenção de dados:', erro);
    }
  }, INTERVALO_CHECAGEM_MS);
}

module.exports = { aplicarRetencao, iniciarRetencaoDiaria, MESES_RETENCAO, PREFIXO_ANONIMO };

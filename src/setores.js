const { db } = require('./db');
const { dentroDasJanelas } = require('./horario');
const { feriadoAgora } = require('./feriados');

function listarSetores() {
  return db.prepare('SELECT * FROM setores ORDER BY nome').all();
}

function obterSetorPorId(id) {
  return db.prepare('SELECT * FROM setores WHERE id = ?').get(id);
}

function criarSetor(nome) {
  const info = db.prepare('INSERT INTO setores (nome) VALUES (?)').run(nome);
  return obterSetorPorId(Number(info.lastInsertRowid));
}

function renomearSetor(id, nome) {
  db.prepare('UPDATE setores SET nome = ? WHERE id = ?').run(nome, id);
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Janelas do horário próprio do setor (lista vazia = sem horário, sempre aberto). */
function janelasDoSetor(setor) {
  try {
    const lista = JSON.parse(setor?.horario || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch (erro) {
    return [];
  }
}

/**
 * Horário do formulário: por dia da semana (0=domingo … 6=sábado) até 2 períodos, ex.:
 * { 1: [['08:00','12:00'], ['14:00','18:00']] }. Período sem as duas horas é ignorado.
 * Devolve { janelas } ou { erro }.
 */
function janelasDoFormulario(porDia) {
  const janelas = [];
  for (let dia = 0; dia <= 6; dia += 1) {
    for (const [inicio, fim] of porDia[dia] || []) {
      if (!inicio && !fim) continue;
      if (!HORA.test(inicio || '') || !HORA.test(fim || '') || fim <= inicio) {
        return { erro: 'Confira os horários: cada período precisa de início e fim, e o fim depois do início.' };
      }
      janelas.push(`${dia} ${inicio}-${fim}`);
    }
  }
  return { janelas };
}

function salvarHorarioDoSetor(id, janelas, mensagem) {
  db.prepare('UPDATE setores SET horario = ?, mensagem_fora_horario = ? WHERE id = ?').run(
    janelas.length ? JSON.stringify(janelas) : null,
    String(mensagem || '').trim().slice(0, 2000) || null,
    id,
  );
}

/**
 * O setor está atendendo agora? Fecha em feriado sem expediente e fora do horário próprio
 * (setor sem horário cadastrado só fecha em feriado).
 */
function setorAberto(setorOuId, agora = new Date()) {
  const setor = typeof setorOuId === 'object' ? setorOuId : obterSetorPorId(setorOuId);
  if (feriadoAgora(agora)) return false;
  const janelas = janelasDoSetor(setor);
  return janelas.length === 0 || dentroDasJanelas(janelas, agora);
}

module.exports = {
  listarSetores,
  obterSetorPorId,
  criarSetor,
  renomearSetor,
  janelasDoSetor,
  janelasDoFormulario,
  salvarHorarioDoSetor,
  setorAberto,
};

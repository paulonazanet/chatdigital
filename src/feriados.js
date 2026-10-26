const { db } = require('./db');

// Feriados (Configurações > Feriados): num feriado sem expediente, o bloco "Horário" do fluxo
// segue o caminho "fora do horário" (mandando antes a mensagem do feriado, se tiver) e os setores
// com horário próprio ficam fechados. "Tem expediente" só registra a data, não muda nada.

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function dataLocal(agora) {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
}
function horaLocal(agora) {
  return `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
}

// Feriados que mudam de data todo ano: dias a partir do domingo de Páscoa
const MOVEIS = {
  carnaval_segunda: -48,
  carnaval_terca: -47,
  sexta_santa: -2,
  corpus_christi: 60,
};
/** Data (AAAA-MM-DD) de um feriado móvel no ano */
function dataDoMovel(chave, ano) {
  return maisDias(pascoa(ano), MOVEIS[chave]);
}

/** Data do feriado num ano: móvel (pela Páscoa), todo ano (mesmo dia/mês) ou a data única */
function dataNoAno(f, ano) {
  if (f.movel && MOVEIS[f.movel] !== undefined) return dataDoMovel(f.movel, ano);
  if (f.repete_ano) return `${ano}-${f.data.slice(5)}`;
  return f.data;
}

/**
 * Feriados na ordem em que vão acontecer (os que repetem contam a próxima vez); os de data única
 * que já passaram vão para o fim. `proxima` = a próxima data (AAAA-MM-DD) ou null se já passou.
 */
function listarFeriados(agora = new Date()) {
  const hoje = dataLocal(agora);
  const ano = agora.getFullYear();
  return db
    .prepare('SELECT * FROM feriados')
    .all()
    .map((f) => {
      let proxima = f.data >= hoje ? f.data : null;
      if (f.repete_ano || f.movel) {
        const desteAno = dataNoAno(f, ano);
        proxima = desteAno >= hoje ? desteAno : dataNoAno(f, ano + 1);
      }
      return { ...f, proxima };
    })
    .sort((a, b) => (a.proxima && b.proxima ? a.proxima.localeCompare(b.proxima) : a.proxima ? -1 : b.proxima ? 1 : b.data.localeCompare(a.data)));
}

function obterFeriado(id) {
  return db.prepare('SELECT * FROM feriados WHERE id = ?').get(id) || null;
}

/** Valida o formulário; devolve { campos } ou { erro }. */
function validar(entrada) {
  const nome = String(entrada.nome || '').trim().slice(0, 80);
  const data = String(entrada.data || '');
  if (!nome) return { erro: 'Escreva o nome do feriado.' };
  if (!DATA.test(data)) return { erro: 'Escolha a data do feriado.' };
  const diaInteiro = !!entrada.dia_inteiro;
  const inicio = String(entrada.hora_inicio || '');
  const fim = String(entrada.hora_fim || '');
  if (!diaInteiro && (!HORA.test(inicio) || !HORA.test(fim) || fim <= inicio)) {
    return { erro: 'Sem "dia inteiro", informe a hora de início e a de fim (a de fim depois da de início).' };
  }
  return {
    campos: {
      nome,
      data,
      repete_ano: entrada.repete_ano ? 1 : 0,
      dia_inteiro: diaInteiro ? 1 : 0,
      hora_inicio: diaInteiro ? null : inicio,
      hora_fim: diaInteiro ? null : fim,
      tem_expediente: entrada.tem_expediente ? 1 : 0,
      mensagem: String(entrada.mensagem || '').trim().slice(0, 2000) || null,
      ativo: entrada.ativo ? 1 : 0,
    },
  };
}

function criarFeriado(campos) {
  const c = campos;
  return Number(
    db
      .prepare(
        'INSERT INTO feriados (nome, data, repete_ano, dia_inteiro, hora_inicio, hora_fim, tem_expediente, mensagem, ativo, movel) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(c.nome, c.data, c.repete_ano, c.dia_inteiro, c.hora_inicio, c.hora_fim, c.tem_expediente, c.mensagem, c.ativo, c.movel || null).lastInsertRowid,
  );
}

// num feriado móvel a data e o "todo ano" não mudam pela tela (são calculados pela Páscoa)
function atualizarFeriado(id, campos) {
  const atual = obterFeriado(id);
  const c = atual?.movel ? { ...campos, data: atual.data, repete_ano: 1 } : campos;
  db.prepare(
    'UPDATE feriados SET nome = ?, data = ?, repete_ano = ?, dia_inteiro = ?, hora_inicio = ?, hora_fim = ?, tem_expediente = ?, mensagem = ?, ativo = ? WHERE id = ?',
  ).run(c.nome, c.data, c.repete_ano, c.dia_inteiro, c.hora_inicio, c.hora_fim, c.tem_expediente, c.mensagem, c.ativo, id);
}

function excluirFeriado(id) {
  db.prepare('DELETE FROM feriados WHERE id = ?').run(id);
}

/** O feriado (ativo, sem expediente) que vale neste momento, ou null. */
function feriadoAgora(agora = new Date()) {
  const hoje = dataLocal(agora);
  const hora = horaLocal(agora);
  return (
    db
      .prepare('SELECT * FROM feriados WHERE ativo = 1 AND tem_expediente = 0 ORDER BY id')
      .all()
      .filter((f) => dataNoAno(f, agora.getFullYear()) === hoje)
      .find((f) => f.dia_inteiro || (hora >= f.hora_inicio && hora < f.hora_fim)) || null
  );
}

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano)
function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia, 12);
}
function maisDias(data, dias) {
  const nova = new Date(data);
  nova.setDate(nova.getDate() + dias);
  return dataLocal(nova);
}

/**
 * Feriados nacionais: os de data fixa repetem todo ano; os que mudam (Carnaval, Sexta-feira Santa,
 * Corpus Christi) também valem todo ano, com a data calculada pela Páscoa (`movel`); `data` = a do
 * ano pedido. Carnaval e Corpus Christi são ponto facultativo: entram com "tem expediente" marcado
 * (só ficam registrados) — quem fecha nesses dias desmarca.
 */
function feriadosNacionais(ano) {
  const fixos = [
    ['01-01', 'Confraternização Universal'],
    ['04-21', 'Tiradentes'],
    ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'],
    ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'],
    ['11-20', 'Dia Nacional de Zumbi e da Consciência Negra'],
    ['12-25', 'Natal'],
  ].map(([mesDia, nome]) => ({ nome, data: `${ano}-${mesDia}`, repete_ano: 1, tem_expediente: 0 }));
  const moveis = [
    ['carnaval_segunda', 'Carnaval (segunda), ponto facultativo', 1],
    ['carnaval_terca', 'Carnaval (terça), ponto facultativo', 1],
    ['sexta_santa', 'Sexta-feira Santa', 0],
    ['corpus_christi', 'Corpus Christi, ponto facultativo', 1],
  ].map(([movel, nome, temExpediente]) => ({ nome, data: dataDoMovel(movel, ano), repete_ano: 1, movel, tem_expediente: temExpediente }));
  return [...fixos, ...moveis];
}

/** Importa os nacionais (todos valem todo ano) sem repetir os que já existem. Devolve quantos entraram. */
function importarNacionais(agora = new Date()) {
  const existentes = listarFeriados();
  const jaTem = (f) =>
    existentes.some((e) => (f.movel ? e.movel === f.movel : !e.movel && e.repete_ano && e.data.slice(5) === f.data.slice(5)));
  let novos = 0;
  for (const f of feriadosNacionais(agora.getFullYear())) {
    if (jaTem(f)) continue;
    criarFeriado({ dia_inteiro: 1, hora_inicio: null, hora_fim: null, mensagem: null, ativo: 1, movel: null, ...f });
    existentes.push(f);
    novos += 1;
  }
  return novos;
}

module.exports = {
  listarFeriados,
  obterFeriado,
  validar,
  criarFeriado,
  atualizarFeriado,
  excluirFeriado,
  feriadoAgora,
  feriadosNacionais,
  importarNacionais,
  pascoa,
  dataDoMovel,
  dataNoAno,
};

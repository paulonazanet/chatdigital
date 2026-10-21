// Botões e listas (E4, 4a parte): a pergunta do bot com opções numeradas ("1. Fazer um pedido") vira
// botões (até 3) ou lista (até 10) na API oficial do WhatsApp, e respostas rápidas no Instagram. Nada
// muda no fluxo: as opções são lidas do próprio texto, e o que o cliente toca volta como o número da
// opção ("1"), igual a se ele tivesse digitado. Pelo WhatsApp do celular continua o texto numerado.
// Se não dá para montar (opção sem linha no texto, mais de 10, texto muito comprido), vai o texto.

const LIMITE_BOTOES = 3;
const LIMITE_LISTA = 10;
const LIMITE_RESPOSTAS_RAPIDAS = 13;

// "1. Fazer um pedido", "*2* - Dúvidas", "3) Falar com atendente", "0️⃣ Voltar"
const LINHA_DE_OPCAO = /^\s*\*?([0-9]{1,2}|[a-zA-Z])\*?(?:️?⃣)?\s*(?:[.)\-–:]\s*|\s+)(.+?)\s*$/;
const LINHA_DE_INSTRUCAO = /^\s*(responda|digite|escolha)\b.*\b(n[úu]mero|op[çc][ãa]o)\b.*$/i;

const cortar = (texto, limite) => (texto.length > limite ? `${texto.slice(0, limite - 1).trimEnd()}…` : texto);
const semAsteriscos = (texto) => texto.replace(/\*/g, '').trim();

/**
 * Lê as opções do texto do bot. `ids` = o que a pergunta aceita ("1", "2", "0"...). Devolve
 * { corpo, opcoes: [{ id, titulo }] } ou null se alguma opção não tem linha no texto.
 */
function extrairOpcoes(texto, ids) {
  if (!texto || !Array.isArray(ids) || !ids.length) return null;
  const procurados = new Set(ids.map((id) => String(id).toLowerCase()));
  const achadas = new Map();
  const corpo = [];
  for (const linha of String(texto).split('\n')) {
    const m = LINHA_DE_OPCAO.exec(linha);
    const id = m && m[1].toLowerCase();
    if (m && procurados.has(id) && !achadas.has(id)) {
      achadas.set(id, { id: m[1], titulo: semAsteriscos(m[2]) });
      continue;
    }
    if (LINHA_DE_INSTRUCAO.test(linha)) continue; // "Responda só com o número da opção."
    corpo.push(linha);
  }
  if (achadas.size !== procurados.size) return null;
  const opcoes = ids.map((id) => achadas.get(String(id).toLowerCase()));
  const texto_ = corpo.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { corpo: texto_ || 'Escolha uma opção:', opcoes };
}

/** Mensagem interativa da API oficial do WhatsApp (botões ou lista), ou null */
function paraWhatsapp({ corpo, opcoes }, { botaoLista = 'Ver opções' } = {}) {
  if (!opcoes?.length || opcoes.length > LIMITE_LISTA || corpo.length > 1024) return null;
  if (opcoes.length <= LIMITE_BOTOES && opcoes.every((o) => o.titulo.length <= 20)) {
    return {
      type: 'button',
      body: { text: corpo },
      action: { buttons: opcoes.map((o) => ({ type: 'reply', reply: { id: o.id, title: o.titulo } })) },
    };
  }
  return {
    type: 'list',
    body: { text: corpo },
    action: {
      button: cortar(botaoLista, 20),
      sections: [
        {
          title: 'Opções',
          rows: opcoes.map((o) => ({ id: o.id, title: cortar(o.titulo, 24), ...(o.titulo.length > 24 ? { description: cortar(o.titulo, 72) } : {}) })),
        },
      ],
    },
  };
}

/** Respostas rápidas do Instagram, ou null */
function paraInstagram({ corpo, opcoes }) {
  if (!opcoes?.length || opcoes.length > LIMITE_RESPOSTAS_RAPIDAS) return null;
  return { text: corpo, quick_replies: opcoes.map((o) => ({ content_type: 'text', title: cortar(o.titulo, 20), payload: o.id })) };
}

module.exports = { extrairOpcoes, paraWhatsapp, paraInstagram };

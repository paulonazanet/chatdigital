// Fluxos prontos (E2, 3a parte): pontos de partida para o editor de fluxo, um por tipo de negócio.
// Usam só blocos que já existem e as variáveis do negócio ({{negocio.nome}}, horário, endereço,
// formas de pagamento), então servem pra qualquer cliente. Carregar um modelo só troca o fluxo na
// tela do editor: só vale depois de Salvar (e o fluxo anterior fica nas Versões).

const REINICIO = ['menu', 'oi', 'ola', 'olá', 'começar', 'comecar', 'bom dia', 'boa tarde', 'boa noite'];

const fim = (texto) => (texto ? { tipo: 'fim', texto } : { tipo: 'fim' });
const msg = (texto, proximo) => ({ tipo: 'mensagem', texto, proximo });
const pergunta = (texto, variavel, proximo) => ({ tipo: 'pergunta', texto, variavel, proximo });
const menu = (texto, opcoes, variavel) => ({
  tipo: 'pergunta',
  texto,
  ...(variavel ? { variavel } : {}),
  opcoes: Object.entries(opcoes).map(([quando, proximo]) => ({ quando, proximo })),
});
const transferir = (texto, setor = 'Geral') => ({ tipo: 'transferir', texto, setor });
const horario = (janelas, dentro, fora) => ({ tipo: 'horario', janelas, dentro, fora });
const nota = (texto, proximo) => ({ tipo: 'nota', texto, proximo });
const salvar = (colecao, campos, proximo) => ({ tipo: 'salvar', colecao, campos, proximo });

const MAIS_ALGUMA = 'Se precisar de mais alguma coisa, é só mandar *menu*. 🙂';
const FORA_DO_HORARIO =
  'Agora estamos fora do horário de atendimento ({{negocio.horario_funcionamento}}). Sua mensagem ficou registrada e respondemos assim que abrirmos. 🙏';

// Pedaço comum: falar com atendente, com aviso fora do horário
function blocosDeAtendente(janelas, textoDentro = 'Combinado! Já vou te passar para alguém da equipe. Só um instante. 🙂', setor = 'Geral') {
  return {
    atendente: horario(janelas, 'atendente_dentro', 'atendente_fora'),
    atendente_dentro: transferir(textoDentro, setor),
    atendente_fora: transferir(FORA_DO_HORARIO, setor),
  };
}

const MODELOS = [
  {
    id: 'gas',
    nome: 'Revenda de gás',
    descricao: 'Pedido de botijão ou água com endereço e pagamento, preço e pagamento, horário e endereço, atendente.',
    fluxo: {
      inicio: 'inicio',
      reinicio_palavras: REINICIO,
      nos: {
        inicio: { tipo: 'inicio', proximo: 'menu' },
        menu: menu(
          'Olá! Aqui é a *{{negocio.nome}}*. 🔥\n\nComo posso ajudar?\n1. Pedir gás ou água\n2. Formas de pagamento\n3. Horário e endereço\n4. Falar com um atendente\n\nResponda só com o número.',
          { 1: 'pedido_item', 2: 'pagamentos', 3: 'horario_endereco', 4: 'atendente' },
        ),
        pedido_item: pergunta('O que você vai querer? Escreva o produto e a quantidade.\nEx.: *1 botijão de 13 kg* ou *2 galões de água*', 'pedido', 'pedido_endereco'),
        pedido_endereco: pergunta('Anotado! Qual o endereço de entrega? (rua, número, bairro e um ponto de referência)', 'endereco', 'pedido_pagamento'),
        pedido_pagamento: pergunta('Como vai ser o pagamento? ({{negocio.formas_pagamento}})\nSe for dinheiro, diga se precisa de troco.', 'pagamento', 'pedido_confirmar'),
        pedido_confirmar: menu(
          'Confere o pedido:\n*{{vars.pedido}}*\nEntrega em: {{vars.endereco}}\nPagamento: {{vars.pagamento}}\n\n1. Está certo, pode mandar\n2. Corrigir\n0. Voltar ao menu',
          { 1: 'pedido_salvar', 2: 'pedido_item', 0: 'menu' },
        ),
        pedido_salvar: salvar('pedidos', { pedido: 'vars.pedido', endereco: 'vars.endereco', pagamento: 'vars.pagamento' }, 'pedido_nota'),
        pedido_nota: nota('Pedido pelo bot: {{vars.pedido}} · Entrega: {{vars.endereco}} · Pagamento: {{vars.pagamento}}', 'pedido_horario'),
        pedido_horario: horario(['1,2,3,4,5,6 07:00-19:00', '0 07:00-12:00'], 'pedido_dentro', 'pedido_fora'),
        pedido_dentro: transferir('Pedido anotado! ✅ Um atendente já vai confirmar o valor e o tempo de entrega.'),
        pedido_fora: transferir('Pedido anotado! ✅ Agora estamos fora do horário ({{negocio.horario_funcionamento}}). Confirmamos assim que abrirmos.'),
        pagamentos: msg('Aceitamos: *{{negocio.formas_pagamento}}*.\nO valor do dia é confirmado pelo atendente na hora do pedido.', 'fim'),
        horario_endereco: msg('🕒 Horário: {{negocio.horario_funcionamento}}\n📍 Endereço: {{negocio.endereco}}', 'fim'),
        ...blocosDeAtendente(['1,2,3,4,5,6 07:00-19:00', '0 07:00-12:00']),
        fim: fim(MAIS_ALGUMA),
      },
    },
  },
  {
    id: 'loja',
    nome: 'Loja',
    descricao: 'Produtos e preços, pedido com entrega ou retirada, trocas e devoluções, horário e endereço, atendente.',
    fluxo: {
      inicio: 'inicio',
      reinicio_palavras: REINICIO,
      nos: {
        inicio: { tipo: 'inicio', proximo: 'menu' },
        menu: menu(
          'Olá! Bem-vindo(a) à *{{negocio.nome}}*. 🛍️\n\nComo posso ajudar?\n1. Ver produtos e preços\n2. Fazer um pedido\n3. Trocas e devoluções\n4. Horário e endereço\n5. Falar com um atendente\n\nResponda só com o número.',
          { 1: 'produtos', 2: 'pedido_item', 3: 'trocas', 4: 'horario_endereco', 5: 'atendente' },
        ),
        produtos: pergunta('Qual produto você procura? Escreva o nome (e o tamanho ou a cor, se tiver) que um atendente te manda fotos e preço.', 'procura', 'produtos_nota'),
        produtos_nota: nota('Cliente procura: {{vars.procura}}', 'atendente'),
        pedido_item: pergunta('O que você quer pedir? Escreva o produto, a quantidade e o tamanho ou a cor.', 'pedido', 'pedido_modo'),
        pedido_modo: menu('Vai ser entrega ou você retira na loja?\n1. Entrega\n2. Retiro na loja', { 1: 'pedido_endereco', 2: 'pedido_pagamento' }),
        pedido_endereco: pergunta('Qual o endereço de entrega? (rua, número, bairro, cidade e CEP)', 'endereco', 'pedido_pagamento'),
        pedido_pagamento: pergunta('Como prefere pagar? ({{negocio.formas_pagamento}})', 'pagamento', 'pedido_confirmar'),
        pedido_confirmar: menu(
          'Confere o pedido:\n*{{vars.pedido}}*\nEntrega em: {{vars.endereco}}\nPagamento: {{vars.pagamento}}\n\n1. Está certo\n2. Corrigir\n0. Voltar ao menu',
          { 1: 'pedido_salvar', 2: 'pedido_item', 0: 'menu' },
        ),
        pedido_salvar: salvar('pedidos', { pedido: 'vars.pedido', endereco: 'vars.endereco', pagamento: 'vars.pagamento' }, 'pedido_nota'),
        pedido_nota: nota('Pedido pelo bot: {{vars.pedido}} · Entrega: {{vars.endereco}} · Pagamento: {{vars.pagamento}}', 'atendente'),
        trocas: msg('Trocas e devoluções: em até 7 dias depois de receber, com a etiqueta e a nota. Para começar, um atendente vai te ajudar.', 'atendente'),
        horario_endereco: msg('🕒 Horário: {{negocio.horario_funcionamento}}\n📍 Endereço: {{negocio.endereco}}', 'fim'),
        ...blocosDeAtendente(['1,2,3,4,5 09:00-18:00', '6 09:00-13:00']),
        fim: fim(MAIS_ALGUMA),
      },
    },
  },
  {
    id: 'clinica',
    nome: 'Clínica ou consultório',
    descricao: 'Pedido de agendamento (nome, especialidade, dia e período, convênio), remarcar ou cancelar, convênios, resultados de exames, recepção.',
    fluxo: {
      inicio: 'inicio',
      reinicio_palavras: REINICIO,
      nos: {
        inicio: { tipo: 'inicio', proximo: 'menu' },
        menu: menu(
          'Olá! Aqui é a *{{negocio.nome}}*. 🩺\n\nComo posso ajudar?\n1. Agendar consulta\n2. Remarcar ou cancelar\n3. Convênios e valores\n4. Resultado de exame\n5. Endereço e horário\n6. Falar com a recepção\n\nResponda só com o número.',
          { 1: 'agendar_nome', 2: 'remarcar', 3: 'convenios', 4: 'exame', 5: 'horario_endereco', 6: 'atendente' },
        ),
        agendar_nome: pergunta('Vamos lá! Qual o *nome completo* do paciente?', 'paciente', 'agendar_especialidade'),
        agendar_especialidade: pergunta('Qual a especialidade ou o profissional?', 'especialidade', 'agendar_quando'),
        agendar_quando: pergunta('Qual dia e período você prefere? (ex.: *quinta de manhã*)', 'preferencia', 'agendar_convenio'),
        agendar_convenio: pergunta('É por convênio (qual?) ou particular?', 'convenio', 'agendar_confirmar'),
        agendar_confirmar: menu(
          'Confere:\nPaciente: *{{vars.paciente}}*\nEspecialidade: {{vars.especialidade}}\nPreferência: {{vars.preferencia}}\nConvênio: {{vars.convenio}}\n\n1. Está certo\n2. Corrigir\n0. Voltar ao menu',
          { 1: 'agendar_salvar', 2: 'agendar_nome', 0: 'menu' },
        ),
        agendar_salvar: salvar('agendamentos', { paciente: 'vars.paciente', especialidade: 'vars.especialidade', preferencia: 'vars.preferencia', convenio: 'vars.convenio' }, 'agendar_nota'),
        agendar_nota: nota('Pedido de agendamento: {{vars.paciente}} · {{vars.especialidade}} · {{vars.preferencia}} · {{vars.convenio}}', 'agendar_horario'),
        agendar_horario: horario(['1,2,3,4,5 07:00-18:00', '6 07:00-12:00'], 'agendar_dentro', 'agendar_fora'),
        agendar_dentro: transferir('Recebemos seu pedido! ✅ A recepção vai confirmar o dia e a hora com você por aqui.'),
        agendar_fora: transferir('Recebemos seu pedido! ✅ Estamos fora do horário ({{negocio.horario_funcionamento}}); a recepção confirma assim que abrir.'),
        remarcar: pergunta('Escreva o *nome do paciente* e a *data da consulta* que quer remarcar ou cancelar.', 'remarcacao', 'remarcar_nota'),
        remarcar_nota: nota('Remarcar/cancelar: {{vars.remarcacao}}', 'atendente'),
        convenios: msg('Atendemos particular e convênios. Para saber se o seu é aceito e os valores, a recepção te responde agora.', 'atendente'),
        exame: pergunta('Para o resultado, escreva o *nome completo* e a *data do exame*.', 'exame', 'exame_nota'),
        exame_nota: nota('Resultado de exame: {{vars.exame}}', 'atendente'),
        horario_endereco: msg('🕒 Horário: {{negocio.horario_funcionamento}}\n📍 Endereço: {{negocio.endereco}}', 'fim'),
        ...blocosDeAtendente(['1,2,3,4,5 07:00-18:00', '6 07:00-12:00'], 'Já vou te passar para a recepção. Só um instante. 🙂'),
        fim: fim(MAIS_ALGUMA),
      },
    },
  },
  {
    id: 'provedor',
    nome: 'Provedor de internet',
    descricao: 'Sem internet ou lenta (com passo a passo antes do suporte), 2ª via e pagamento, planos, mudança de endereço, atendente. Usa os setores Suporte, Financeiro e Vendas.',
    fluxo: {
      inicio: 'inicio',
      reinicio_palavras: REINICIO,
      nos: {
        inicio: { tipo: 'inicio', proximo: 'menu' },
        menu: menu(
          'Olá! Aqui é a *{{negocio.nome}}*. 📶\n\nComo posso ajudar?\n1. Estou sem internet ou está lenta\n2. 2ª via do boleto ou pagamento\n3. Conhecer os planos\n4. Mudança de endereço ou outro assunto\n5. Falar com um atendente\n\nResponda só com o número.',
          { 1: 'suporte_reiniciou', 2: 'financeiro_doc', 3: 'planos', 4: 'outros', 5: 'atendente' },
        ),
        suporte_reiniciou: menu('Vamos resolver! Você já desligou o roteador da tomada, esperou 30 segundos e ligou de novo?\n1. Já fiz isso\n2. Ainda não', { 1: 'suporte_doc', 2: 'suporte_passos' }),
        suporte_passos: msg('Faça assim:\n1) Tire o roteador (e o aparelho da fibra, se tiver) da tomada.\n2) Espere 30 segundos.\n3) Ligue de novo e aguarde uns 2 minutos até as luzes firmarem.', 'suporte_voltou'),
        suporte_voltou: menu('E aí, a internet voltou?\n1. Voltou 🎉\n2. Não voltou', { 1: 'suporte_ok', 2: 'suporte_doc' }),
        suporte_ok: fim('Que ótimo! Se acontecer de novo, é só mandar *menu*. 😉'),
        suporte_doc: pergunta('Para o suporte achar seu cadastro, me diga o *CPF ou o nome do titular*.', 'titular', 'suporte_nota'),
        suporte_nota: nota('Suporte: sem internet/lenta. Titular: {{vars.titular}}', 'suporte_horario'),
        suporte_horario: horario(['1,2,3,4,5,6 08:00-20:00', '0 08:00-12:00'], 'suporte_dentro', 'suporte_fora'),
        suporte_dentro: transferir('Obrigado! Já vou te passar para o suporte técnico. 🔧', 'Suporte'),
        suporte_fora: transferir(FORA_DO_HORARIO, 'Suporte'),
        financeiro_doc: pergunta('Me diga o *CPF ou o nome do titular* que eu passo para o financeiro com a 2ª via.', 'titular', 'financeiro_nota'),
        financeiro_nota: nota('Financeiro: 2ª via/pagamento. Titular: {{vars.titular}}', 'financeiro'),
        financeiro: transferir('Certo! O financeiro já te manda a 2ª via por aqui. 💳', 'Financeiro'),
        planos: pergunta('Que bom que você quer ser nosso cliente! 😃 Qual o seu *bairro* (e a rua, se puder)? Assim vemos se temos cobertura aí.', 'bairro', 'planos_nota'),
        planos_nota: nota('Interesse em plano. Bairro/rua: {{vars.bairro}}', 'vendas'),
        vendas: transferir('Já vou te passar para o comercial, que te mostra os planos disponíveis para o seu endereço.', 'Vendas'),
        outros: pergunta('Escreva em poucas palavras o que você precisa.', 'assunto', 'outros_nota'),
        outros_nota: nota('Assunto: {{vars.assunto}}', 'atendente'),
        ...blocosDeAtendente(['1,2,3,4,5,6 08:00-20:00', '0 08:00-12:00']),
      },
    },
  },
  {
    id: 'delivery',
    nome: 'Delivery (lanchonete, restaurante)',
    descricao: 'Cardápio, pedido com entrega ou retirada, troco e observação, taxa e tempo de entrega, acompanhar pedido, atendente.',
    fluxo: {
      inicio: 'inicio',
      reinicio_palavras: REINICIO,
      nos: {
        inicio: { tipo: 'inicio', proximo: 'menu' },
        menu: menu(
          'Olá! Aqui é o *{{negocio.nome}}*. 🍔\n\nO que você deseja?\n1. Ver o cardápio\n2. Fazer um pedido\n3. Taxa e tempo de entrega\n4. Acompanhar meu pedido\n5. Falar com um atendente\n\nResponda só com o número.',
          { 1: 'cardapio', 2: 'pedido_horario', 3: 'taxa', 4: 'acompanhar', 5: 'atendente' },
        ),
        cardapio: msg('Já te mandamos o cardápio com os preços do dia. Quando escolher, mande *menu* e a opção 2 para pedir. 😋', 'cardapio_atendente'),
        cardapio_atendente: transferir('Um atendente vai te enviar o cardápio agora.'),
        pedido_horario: horario(['2,3,4,5,6,0 18:00-23:30'], 'pedido_itens', 'pedido_fechado'),
        pedido_fechado: fim('Agora estamos fechados. 😕 Nosso horário: {{negocio.horario_funcionamento}}. Te esperamos!'),
        pedido_itens: pergunta('Escreva o seu pedido: os itens e as quantidades.\nEx.: *2 X-burguer e 1 refrigerante de 2 L*', 'pedido', 'pedido_modo'),
        pedido_modo: menu('Vai ser entrega ou retirada?\n1. Entrega\n2. Retiro no local', { 1: 'pedido_endereco', 2: 'pedido_pagamento' }),
        pedido_endereco: pergunta('Qual o endereço de entrega? (rua, número, bairro e ponto de referência)', 'endereco', 'pedido_pagamento'),
        pedido_pagamento: pergunta('Como vai pagar? ({{negocio.formas_pagamento}})\nSe for dinheiro, diga o troco para quanto.', 'pagamento', 'pedido_obs'),
        pedido_obs: pergunta('Alguma observação? (ex.: *sem cebola*). Se não tiver, responda *não*.', 'observacao', 'pedido_confirmar'),
        pedido_confirmar: menu(
          'Confere o pedido:\n*{{vars.pedido}}*\nEntrega em: {{vars.endereco}}\nPagamento: {{vars.pagamento}}\nObservação: {{vars.observacao}}\n\n1. Confirmar\n2. Corrigir\n0. Voltar ao menu',
          { 1: 'pedido_salvar', 2: 'pedido_itens', 0: 'menu' },
        ),
        pedido_salvar: salvar('pedidos', { pedido: 'vars.pedido', endereco: 'vars.endereco', pagamento: 'vars.pagamento', observacao: 'vars.observacao' }, 'pedido_nota'),
        pedido_nota: nota('Pedido pelo bot: {{vars.pedido}} · Entrega: {{vars.endereco}} · Pagamento: {{vars.pagamento}} · Obs.: {{vars.observacao}}', 'pedido_fim'),
        pedido_fim: transferir('Pedido recebido! ✅ Um atendente confirma o valor total e o tempo de entrega agora.'),
        taxa: msg('A taxa de entrega depende do bairro. Me diga o seu bairro que um atendente te responde com a taxa e o tempo. 🛵', 'taxa_bairro'),
        taxa_bairro: pergunta('Qual o seu bairro?', 'bairro', 'taxa_nota'),
        taxa_nota: nota('Pergunta taxa de entrega. Bairro: {{vars.bairro}}', 'atendente'),
        acompanhar: pergunta('Me diga o *nome* usado no pedido que eu vejo com a cozinha.', 'nome_pedido', 'acompanhar_nota'),
        acompanhar_nota: nota('Acompanhar pedido de: {{vars.nome_pedido}}', 'atendente'),
        ...blocosDeAtendente(['2,3,4,5,6,0 18:00-23:30']),
        fim: fim(MAIS_ALGUMA),
      },
    },
  },
];

// Posição dos blocos no quadro do editor: por "camadas" a partir do início (cada coluna é um passo
// a mais), pra o modelo abrir arrumado em vez de tudo empilhado.
function montarLayout(fluxo) {
  const proximos = (no) =>
    [no.proximo, no.dentro, no.fora, no.padrao, no.proximo_erro, ...(no.opcoes || []).map((o) => o.proximo)].filter((x) => x && fluxo.nos[x]);
  const coluna = { [fluxo.inicio]: 0 };
  const fila = [fluxo.inicio];
  while (fila.length) {
    const id = fila.shift();
    for (const destino of proximos(fluxo.nos[id])) {
      if (coluna[destino] === undefined) {
        coluna[destino] = coluna[id] + 1;
        fila.push(destino);
      }
    }
  }
  const linhasPorColuna = {};
  const layout = {};
  for (const id of Object.keys(fluxo.nos)) {
    const c = coluna[id] ?? 0;
    const linha = (linhasPorColuna[c] = (linhasPorColuna[c] ?? -1) + 1);
    layout[id] = { x: 40 + c * 280, y: 40 + linha * 200 };
  }
  return layout;
}

function listarModelos() {
  return MODELOS.map(({ id, nome, descricao, fluxo }) => ({ id, nome, descricao, blocos: Object.keys(fluxo.nos).length }));
}

/** O modelo pronto pra carregar no editor (cópia, com as posições dos blocos), ou null. */
function obterModelo(id) {
  const modelo = MODELOS.find((m) => m.id === id);
  if (!modelo) return null;
  const fluxo = JSON.parse(JSON.stringify(modelo.fluxo));
  fluxo._layout = montarLayout(fluxo);
  return { id: modelo.id, nome: modelo.nome, descricao: modelo.descricao, fluxo };
}

/** Setores que o fluxo usa e que não existem (a conversa cairia "sem setor"). */
function setoresQueFaltam(fluxo, nomesDosSetores) {
  const existentes = new Set(nomesDosSetores.map((n) => n.toLowerCase()));
  const usados = new Set();
  for (const no of Object.values((fluxo && fluxo.nos) || {})) {
    if ((no.tipo === 'transferir' || no.tipo === 'transferir_atendente') && no.setor) usados.add(no.setor);
  }
  return [...usados].filter((s) => !existentes.has(String(s).toLowerCase()));
}

module.exports = { listarModelos, obterModelo, setoresQueFaltam, montarLayout, MODELOS };

const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E1, 3a parte: responder citando, reações, reenviar com falha, Contatos, feriados, horário por
// setor e os blocos novos do fluxo.
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e1final-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = ''; // o .env local pode ter modo de teste ligado (dotenv não sobrescreve)

const { app } = require('../src/server');
const { processarMensagem } = require('../src/flow-engine');
const { registrarMensagem, sincronizarConversa } = require('../src/conversas');
const { carregarFluxo } = require('../src/fluxo');
const { definirSocket } = require('../src/socket-atual');
const { db } = require('../src/db');

const negocio = {
  nome: 'Loja Exemplo',
  formas_pagamento: ['Pix'],
  produtos: [{ id: 'p13', nome: 'Botijão 13kg', preco: 120 }],
  faq: [],
  mensagem_boas_vindas_atendente: '',
  mensagem_encerramento: 'Fechado por aqui!',
  pesquisa_satisfacao: '',
};
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify(negocio));
const fluxo = carregarFluxo();

let servidor;
let baseUrl;
let cookie;
const enviadas = [];
let proximoEnvioFalha = false;
let contadorIds = 0;

// socket de mentira: guarda o que foi mandado e devolve um id como o do WhatsApp
const sockFalso = {
  sendMessage: async (numero, conteudo, opcoes) => {
    if (proximoEnvioFalha) {
      proximoEnvioFalha = false;
      throw new Error('falha simulada');
    }
    enviadas.push({ numero, conteudo, opcoes });
    contadorIds += 1;
    return { key: { id: `ENVIADA${contadorIds}`, fromMe: true, remoteJid: numero } };
  },
};

async function clienteEscreve(numero, texto, extra = {}) {
  registrarMensagem(numero, 'cliente', texto, null, null, extra);
  const resposta = await processarMensagem({ numero, texto, negocio, fluxo });
  sincronizarConversa(numero, fluxo);
  if (resposta) registrarMensagem(numero, 'bot', resposta);
}

function post(caminho, campos = {}) {
  return fetch(`${baseUrl}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(campos),
    redirect: 'manual',
  });
}
async function pagina(caminho) {
  return (await fetch(`${baseUrl}${caminho}`, { headers: { cookie } })).text();
}

async function conversaAssumida(numero) {
  await clienteEscreve(numero, 'oi');
  await clienteEscreve(numero, '3');
  const id = db.prepare('SELECT id FROM conversas WHERE numero = ?').get(numero).id;
  await post(`/painel/fila/${id}/assumir`);
  return id;
}

before(async () => {
  await new Promise((resolve) => {
    servidor = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${servidor.address().port}`;
      resolve();
    });
  });
  const resp = await fetch(`${baseUrl}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nome: 'Carla', email: 'admin@teste.com', senha: '123456' }),
    redirect: 'manual',
  });
  cookie = resp.headers.get('set-cookie').split(';')[0];
  definirSocket(sockFalso);
});

after(async () => {
  definirSocket(null);
  await new Promise((resolve) => servidor.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('responder citando: a resposta vai com a citação e o histórico mostra o trecho citado', async () => {
  const numero = '5511910000001@s.whatsapp.net';
  const id = await conversaAssumida(numero);
  await clienteEscreve(numero, 'Vocês entregam no domingo?', { waId: 'CLIENTE1' });
  const citada = db.prepare("SELECT id FROM mensagens WHERE wa_id = 'CLIENTE1'").get();
  enviadas.length = 0;

  await post(`/painel/fila/${id}/responder`, { texto: 'Entregamos sim, até meio-dia.', citar_id: String(citada.id) });
  assert.strictEqual(enviadas.length, 1);
  assert.deepStrictEqual(enviadas[0].opcoes.quoted.key, { remoteJid: numero, id: 'CLIENTE1', fromMe: false });
  const resposta = db.prepare("SELECT * FROM mensagens WHERE texto = 'Entregamos sim, até meio-dia.'").get();
  assert.strictEqual(resposta.citada_id, citada.id);
  assert.strictEqual(resposta.wa_id, 'ENVIADA' + contadorIds, 'guarda o id do WhatsApp da resposta');

  const corpo = await pagina(`/painel/fila/${id}`);
  assert.match(corpo, /class="mensagem-citada"[^>]*><span>Cliente<\/span>Vocês entregam no domingo\?/);
  assert.match(corpo, /botao-citar/);
});

test('reações: o atendente reage, o cliente reage, e o mesmo emoji de novo tira a reação', async () => {
  const numero = '5511910000002@s.whatsapp.net';
  const id = await conversaAssumida(numero);
  await clienteEscreve(numero, 'Obrigado!', { waId: 'CLIENTE2' });
  const m = db.prepare("SELECT id FROM mensagens WHERE wa_id = 'CLIENTE2'").get();
  enviadas.length = 0;

  await post(`/painel/fila/${id}/reagir`, { mensagem_id: String(m.id), emoji: '❤️' });
  assert.deepStrictEqual(enviadas[0].conteudo, { react: { text: '❤️', key: { remoteJid: numero, id: 'CLIENTE2', fromMe: false } } });
  assert.strictEqual(db.prepare('SELECT reacao_atendente FROM mensagens WHERE id = ?').get(m.id).reacao_atendente, '❤️');
  assert.match(await pagina(`/painel/fila/${id}`), /title="Nossa reação">❤️/);

  await post(`/painel/fila/${id}/reagir`, { mensagem_id: String(m.id), emoji: '❤️' });
  assert.strictEqual(enviadas[1].conteudo.react.text, '', 'segundo clique tira a reação no WhatsApp');
  assert.strictEqual(db.prepare('SELECT reacao_atendente FROM mensagens WHERE id = ?').get(m.id).reacao_atendente, null);

  // emoji fora da lista é ignorado
  await post(`/painel/fila/${id}/reagir`, { mensagem_id: String(m.id), emoji: '<script>' });
  assert.strictEqual(enviadas.length, 2);

  // reação do cliente numa mensagem nossa (chega pelo bot: aqui pela função que o bot usa)
  const { acharMensagemPorWaId, registrarReacao } = require('../src/conversas');
  await post(`/painel/fila/${id}/responder`, { texto: 'Por nada!' });
  const nossa = acharMensagemPorWaId(numero, 'ENVIADA' + contadorIds);
  registrarReacao(nossa.id, 'cliente', '👍');
  assert.match(await pagina(`/painel/fila/${id}`), /title="Reação do cliente">👍/);
});

test('reenviar com falha: a mensagem fica no histórico com aviso, não conta como resposta, e o Reenviar manda', async () => {
  const numero = '5511910000003@s.whatsapp.net';
  const id = await conversaAssumida(numero);
  await clienteEscreve(numero, 'Qual o preço?', { waId: 'CLIENTE3' });
  enviadas.length = 0;

  proximoEnvioFalha = true;
  const resp = await post(`/painel/fila/${id}/responder`, { texto: 'R$ 120 o 13kg.' });
  assert.strictEqual(resp.status, 200, 'mostra a tela com o erro');
  const falhou = db.prepare("SELECT * FROM mensagens WHERE texto = 'R$ 120 o 13kg.'").get();
  assert.strictEqual(falhou.falha, 1);
  const atendimento = db.prepare('SELECT primeira_resposta_em FROM atendimentos WHERE conversa_id = ? ORDER BY id DESC').get(id);
  assert.strictEqual(atendimento.primeira_resposta_em, null, 'mensagem que não saiu não é resposta');
  let corpo = await pagina(`/painel/fila/${id}`);
  assert.match(corpo, /mensagem-falha[\s\S]*Não foi enviada[\s\S]*Reenviar/);

  await post(`/painel/fila/${id}/reenviar/${falhou.id}`);
  assert.deepStrictEqual(enviadas.at(-1).conteudo, { text: 'R$ 120 o 13kg.' });
  const depois = db.prepare('SELECT falha, wa_id FROM mensagens WHERE id = ?').get(falhou.id);
  assert.strictEqual(depois.falha, 0);
  assert.ok(depois.wa_id);
  const atendimentoDepois = db.prepare('SELECT primeira_resposta_em FROM atendimentos WHERE conversa_id = ? ORDER BY id DESC').get(id);
  assert.ok(atendimentoDepois.primeira_resposta_em, 'depois de reenviada conta como resposta');
  corpo = await pagina(`/painel/fila/${id}`);
  assert.doesNotMatch(corpo, /Não foi enviada/);

  // descartar
  proximoEnvioFalha = true;
  await post(`/painel/fila/${id}/responder`, { texto: 'Vai sumir' });
  const outra = db.prepare("SELECT id FROM mensagens WHERE texto = 'Vai sumir'").get();
  await post(`/painel/fila/${id}/descartar/${outra.id}`);
  assert.strictEqual(db.prepare('SELECT id FROM mensagens WHERE id = ?').get(outra.id), undefined);
});

// mensagem chegando pelo WhatsApp, do jeito que o Baileys entrega
let contadorRecebidas = 0;
function msgRecebida(numero, texto, extra = {}) {
  contadorRecebidas += 1;
  return { key: { remoteJid: numero, id: `RECEBIDA${contadorRecebidas}`, fromMe: false }, message: { conversation: texto }, pushName: 'Cliente', ...extra };
}

test('Contatos: lista, ficha com cadastro, consentimento com datas e tags', async () => {
  const numero = '5511920000001@s.whatsapp.net';
  await clienteEscreve(numero, 'oi');
  const id = db.prepare('SELECT id FROM conversas WHERE numero = ?').get(numero).id;

  let resp = await post('/painel/contatos/tags', { nome: 'Condomínio' });
  assert.strictEqual(resp.status, 302);
  const tagId = db.prepare("SELECT id FROM tags_contato WHERE nome = 'Condomínio'").get().id;

  resp = await post(`/painel/contatos/${id}`, {
    nome: 'Dona Maria', email: 'maria@exemplo.com', documento: '123.456.789-00', endereco: 'Rua A, 10',
    observacoes: 'Prefere à tarde', situacao_contato: 'normal', consentimento: '1', consentimento_enviado: '1', tags: String(tagId), tags_enviadas: '1',
  });
  assert.strictEqual(resp.status, 302);
  let c = db.prepare('SELECT * FROM conversas WHERE id = ?').get(id);
  assert.strictEqual(c.nome_contato, 'Dona Maria');
  assert.strictEqual(c.nome_editado, 1);
  assert.strictEqual(c.documento, '123.456.789-00');
  assert.strictEqual(c.consentimento, 1);
  assert.ok(c.consentimento_em, 'guarda quando aceitou');
  assert.strictEqual(c.optout_em, null);

  // desmarcar = opt-out com data
  await post(`/painel/contatos/${id}`, { nome: 'Dona Maria', situacao_contato: 'normal', consentimento_enviado: '1', tags: String(tagId), tags_enviadas: '1' });
  c = db.prepare('SELECT * FROM conversas WHERE id = ?').get(id);
  assert.strictEqual(c.consentimento, 0);
  assert.ok(c.optout_em, 'guarda quando pediu pra sair');

  const lista = await pagina('/painel/contatos?q=maria');
  assert.match(lista, /Dona Maria/);
  assert.match(lista, /Condomínio/);
  assert.match(await pagina('/painel/contatos?q=12345678900'), /Dona Maria/, 'acha pelo documento');
  assert.match(await pagina(`/painel/contatos?tag=${tagId}`), /Dona Maria/);
  assert.doesNotMatch(await pagina('/painel/contatos?situacao=ignorado'), /Dona Maria/);
  assert.ok((await pagina('/painel/contatos/tags')).includes(`href="/painel/contatos?tag=${tagId}">1<`), 'conta quantos contatos têm a tag');
  assert.match(await pagina(`/painel/fila/${id}`), /Ficha do contato/);

  await post(`/painel/contatos/tags/${tagId}/limpar`);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM conversas_tags WHERE tag_id = ?').get(tagId).n, 0);
});

test('Contatos: ignorado guarda a mensagem sem bot nem atendimento; bloqueado não guarda nada', async () => {
  const { tratarMensagemRecebida } = require('../src/bot');
  const numero = '5511920000002@s.whatsapp.net';
  await tratarMensagemRecebida(sockFalso, msgRecebida(numero, 'oi'), negocio, fluxo);
  const id = db.prepare('SELECT id FROM conversas WHERE numero = ?').get(numero).id;
  await post(`/painel/contatos/${id}`, { situacao_contato: 'ignorado' });
  // fecha o que o "oi" abriu, pra começar limpo
  db.prepare("UPDATE conversas SET aberta_em = NULL, status = 'bot' WHERE id = ?").run(id);
  require('../src/flow-engine').encerrarAtendimento(numero, fluxo);

  enviadas.length = 0;
  await tratarMensagemRecebida(sockFalso, msgRecebida(numero, 'Pai, chego às 6'), negocio, fluxo);
  await tratarMensagemRecebida(sockFalso, msgRecebida(numero, '3'), negocio, fluxo);
  assert.strictEqual(enviadas.length, 0, 'o bot não responde contato ignorado');
  const c = db.prepare('SELECT status, aberta_em FROM conversas WHERE id = ?').get(id);
  assert.strictEqual(c.status, 'bot', 'não vai pra fila');
  assert.strictEqual(c.aberta_em, null, 'não abre atendimento (o fechamento automático não mexe)');
  assert.ok(db.prepare("SELECT id FROM mensagens WHERE conversa_id = ? AND texto = 'Pai, chego às 6'").get(id), 'a mensagem fica guardada');
  assert.match(await pagina(`/painel/fila/${id}`), /Contato ignorado/);

  await post(`/painel/contatos/${id}`, { situacao_contato: 'bloqueado' });
  const antes = db.prepare('SELECT COUNT(*) AS n FROM mensagens WHERE conversa_id = ?').get(id).n;
  await tratarMensagemRecebida(sockFalso, msgRecebida(numero, 'mensagem de bloqueado'), negocio, fluxo);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM mensagens WHERE conversa_id = ?').get(id).n, antes, 'bloqueado: nada é guardado');
  assert.strictEqual(enviadas.length, 0);
});

test('Contatos: reação e citação do cliente chegando pelo WhatsApp', async () => {
  const { tratarMensagemRecebida } = require('../src/bot');
  const numero = '5511920000003@s.whatsapp.net';
  const id = await conversaAssumida(numero);
  await post(`/painel/fila/${id}/responder`, { texto: 'Seu pedido saiu.' });
  const nossa = db.prepare("SELECT * FROM mensagens WHERE texto = 'Seu pedido saiu.'").get();
  await tratarMensagemRecebida(sockFalso, { key: { remoteJid: numero, id: 'R1', fromMe: false }, message: { reactionMessage: { key: { id: nossa.wa_id }, text: '🙏' } } }, negocio, fluxo);
  assert.strictEqual(db.prepare('SELECT reacao_cliente FROM mensagens WHERE id = ?').get(nossa.id).reacao_cliente, '🙏');
  await tratarMensagemRecebida(
    sockFalso,
    msgRecebida(numero, null, { message: { extendedTextMessage: { text: 'Chegou, obrigado', contextInfo: { stanzaId: nossa.wa_id } } } }),
    negocio,
    fluxo,
  );
  const resposta = db.prepare("SELECT citada_id FROM mensagens WHERE texto = 'Chegou, obrigado'").get();
  assert.strictEqual(resposta.citada_id, nossa.id);
});

test('Contatos: novo contato confere o número no WhatsApp e abre a ficha', async () => {
  sockFalso.onWhatsApp = async (jid) => [{ exists: jid.startsWith('5581'), jid }];
  let resp = await post('/painel/contatos/novo', { telefone: '(81) 99999-0001', nome: 'Seu João' });
  assert.strictEqual(resp.status, 302);
  const c = db.prepare("SELECT * FROM conversas WHERE numero = '5581999990001@s.whatsapp.net'").get();
  assert.strictEqual(c.nome_contato, 'Seu João');
  assert.strictEqual(resp.headers.get('location'), `/painel/contatos/${c.id}`);
  resp = await post('/painel/contatos/novo', { telefone: '11 98888-0000' });
  assert.match(await resp.text(), /não tem WhatsApp/);
  delete sockFalso.onWhatsApp;
});

test('feriados: importar nacionais (com Páscoa certa), não repetir, e valer no bloco Horário', async () => {
  const feriados = require('../src/feriados');
  assert.strictEqual(feriados.pascoa(2026).toDateString(), new Date(2026, 3, 5).toDateString(), 'Páscoa de 2026 é 5 de abril');
  const nacionais2026 = feriados.feriadosNacionais(2026);
  assert.ok(nacionais2026.some((f) => f.data === '2026-04-03' && /Sexta-feira Santa/.test(f.nome)));
  assert.ok(nacionais2026.some((f) => f.data === '2026-02-17' && /Carnaval \(terça\)/.test(f.nome) && f.tem_expediente === 1));
  assert.ok(nacionais2026.some((f) => f.data === '2026-06-04' && /Corpus Christi/.test(f.nome)));

  let resp = await post('/painel/configuracoes/feriados/importar');
  const primeira = Number(new URL(resp.headers.get('location'), baseUrl).searchParams.get('importados'));
  assert.strictEqual(primeira, 9 + 4, '9 fixos + 4 móveis (que valem todo ano, pela Páscoa)');
  resp = await post('/painel/configuracoes/feriados/importar');
  assert.strictEqual(new URL(resp.headers.get('location'), baseUrl).searchParams.get('importados'), '0', 'importar de novo não duplica');
  assert.match(await pagina('/painel/configuracoes/feriados'), /Tiradentes[\s\S]*todo ano|todo ano[\s\S]*Tiradentes/);

  // feriado com período e validação
  resp = await post('/painel/configuracoes/feriados/novo', { nome: 'Meio feriado', data: '2026-06-24', hora_inicio: '12:00', hora_fim: '10:00', ativo: '1' });
  assert.match(await resp.text(), /hora de fim depois da de início|fim depois/);
  await post('/painel/configuracoes/feriados/novo', { nome: 'São João', data: '2026-06-24', repete_ano: '1', dia_inteiro: '1', mensagem: 'Hoje é São João, voltamos amanhã!', ativo: '1' });
  const saoJoao = feriados.listarFeriados().find((f) => f.nome === 'São João');
  assert.strictEqual(feriados.feriadoAgora(new Date(2027, 5, 24, 9)).id, saoJoao.id, 'repete todo ano');
  assert.strictEqual(feriados.feriadoAgora(new Date(2026, 1, 17, 9)), null, 'Carnaval (ponto facultativo) tem expediente: não fecha');

  // bloco Horário do fluxo num feriado: vai pra "fora" com a mensagem do feriado antes
  const { processarMensagem: processar } = require('../src/flow-engine');
  const fluxoHorario = {
    inicio: 'inicio',
    nos: {
      inicio: { tipo: 'inicio', proximo: 'h' },
      h: { tipo: 'horario', janelas: ['0,1,2,3,4,5,6 00:00-23:59'], dentro: 'aberto', fora: 'fechado' },
      aberto: { tipo: 'fim', texto: 'Estamos abertos' },
      fechado: { tipo: 'fim', texto: 'Estamos fechados' },
    },
  };
  const hoje = new Date();
  const dataHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  assert.strictEqual(await processar({ numero: 'feriado-1', texto: 'oi', negocio, fluxo: fluxoHorario }), 'Estamos abertos');
  const idHoje = feriados.criarFeriado({ nome: 'Hoje', data: dataHoje, repete_ano: 0, dia_inteiro: 1, hora_inicio: null, hora_fim: null, tem_expediente: 0, mensagem: 'Feriado hoje!', ativo: 1 });
  assert.strictEqual(await processar({ numero: 'feriado-2', texto: 'oi', negocio, fluxo: fluxoHorario }), 'Feriado hoje!\n\nEstamos fechados');
  feriados.excluirFeriado(idHoje);
});

test('horário do setor: cadastro por dia e aviso para quem cai na fila fora do horário', async () => {
  const setores = require('../src/setores');
  const setorId = db.prepare("INSERT INTO setores (nome) VALUES ('Entrega')").run().lastInsertRowid;
  let resp = await post(`/painel/setores/${setorId}`, { nome: 'Entrega', horario_enviado: '1', inicio_1_1: '08:00', fim_1_1: '07:00' });
  assert.match(await resp.text(), /Confira os horários/);
  resp = await post(`/painel/setores/${setorId}`, {
    nome: 'Entrega', horario_enviado: '1',
    inicio_1_1: '08:00', fim_1_1: '12:00', inicio_1_2: '14:00', fim_1_2: '18:00', inicio_6_1: '08:00', fim_6_1: '13:00',
    mensagem_fora_horario: 'A entrega abre amanhã às 8h.',
  });
  assert.strictEqual(resp.status, 302);
  const setor = setores.obterSetorPorId(setorId);
  assert.deepStrictEqual(setores.janelasDoSetor(setor), ['1 08:00-12:00', '1 14:00-18:00', '6 08:00-13:00']);
  assert.strictEqual(setores.setorAberto(setor, new Date(2026, 9, 19, 10)), true, 'segunda 10h aberto');
  assert.strictEqual(setores.setorAberto(setor, new Date(2026, 9, 19, 13)), false, 'segunda 13h (almoço) fechado');
  assert.strictEqual(setores.setorAberto(setor, new Date(2026, 9, 18, 10)), false, 'domingo fechado');
  assert.strictEqual(setores.setorAberto(setor, new Date(2026, 11, 25, 10)), false, 'Natal (feriado importado) fechado');
  assert.match(await pagina(`/painel/setores/${setorId}`), /value="14:00"/);

  // cliente cai na fila do setor fechado: recebe o aviso do setor (e não o "sem atendente")
  db.prepare("UPDATE setores SET horario = ? WHERE id = ?").run(JSON.stringify(['0 00:00-00:01']), setorId);
  const { transferirParaHumano: transferir } = require('../src/flow-engine');
  const numero = '5511930000001@s.whatsapp.net';
  registrarMensagem(numero, 'cliente', 'oi');
  transferir(numero, fluxo, 'Entrega');
  const sinc = sincronizarConversa(numero, fluxo, { vinhaDoBot: true });
  assert.strictEqual(sinc.mensagemForaDoHorario, 'A entrega abre amanhã às 8h.');
  assert.strictEqual(sinc.semAtendenteDisponivel, false);
});

test('blocos do fluxo: Aguardar resposta, Nota interna e Transferir para atendente', async () => {
  const { validarFluxo } = require('../src/fluxo');
  const atendenteId = db.prepare("SELECT id FROM atendentes WHERE email = 'admin@teste.com'").get().id;
  const fluxoNovo = {
    inicio: 'inicio',
    nos: {
      inicio: { tipo: 'inicio', proximo: 'pede_foto' },
      pede_foto: { tipo: 'mensagem', texto: 'Mande o número do pedido', proximo: 'espera' },
      espera: { tipo: 'aguardar', variavel: 'pedido', proximo: 'anota' },
      anota: { tipo: 'nota', texto: 'Cliente informou o pedido {{vars.pedido}}', proximo: 'passa' },
      passa: { tipo: 'transferir_atendente', texto: 'Já vou te atender!', atendente_id: atendenteId },
    },
  };
  assert.deepStrictEqual(validarFluxo(fluxoNovo), [], 'os tipos novos são válidos');

  const numero = '5511940000001@s.whatsapp.net';
  registrarMensagem(numero, 'cliente', 'oi');
  assert.strictEqual(await processarMensagem({ numero, texto: 'oi', negocio, fluxo: fluxoNovo }), 'Mande o número do pedido');
  sincronizarConversa(numero, fluxoNovo);
  registrarMensagem(numero, 'cliente', '4521');
  assert.strictEqual(await processarMensagem({ numero, texto: '4521', negocio, fluxo: fluxoNovo }), 'Já vou te atender!');
  sincronizarConversa(numero, fluxoNovo, { vinhaDoBot: true });

  const conversa = db.prepare('SELECT * FROM conversas WHERE numero = ?').get(numero);
  assert.strictEqual(conversa.status, 'atendendo', 'entra direto atendendo');
  assert.strictEqual(conversa.atendente_id, atendenteId);
  const nota = db.prepare('SELECT texto, interna FROM mensagens WHERE conversa_id = ? AND interna = 1').get(conversa.id);
  assert.strictEqual(nota.texto, 'Cliente informou o pedido 4521');
  assert.ok(db.prepare('SELECT assumido_em FROM atendimentos WHERE conversa_id = ?').get(conversa.id).assumido_em);

  const opcoesEditor = await (await fetch(`${baseUrl}/painel/fluxo/opcoes`, { headers: { cookie } })).json();
  assert.ok(opcoesEditor.atendentes.some((a) => a.id === atendenteId && a.nome === 'Carla'));
});

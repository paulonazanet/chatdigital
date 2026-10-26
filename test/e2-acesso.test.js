const assert = require('node:assert');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// E2, 4a parte: grupos de permissão, horário e IP de acesso, histórico de acessos, status do sistema
// e importar/exportar contatos por planilha.
const diretorioTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdigital-e2acesso-teste-'));
process.env.CHATDIGITAL_DB = path.join(diretorioTeste, 'teste.db');
process.env.CHATDIGITAL_NEGOCIO = path.join(diretorioTeste, 'negocio.json');
process.env.CHATDIGITAL_BACKUP_DIR = path.join(diretorioTeste, 'backups');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.NUMEROS_TESTE = '';
fs.writeFileSync(process.env.CHATDIGITAL_NEGOCIO, JSON.stringify({ nome: 'Loja Exemplo', formas_pagamento: ['Pix'], produtos: [], faq: [] }));

const { app } = require('../src/server');
const { db } = require('../src/db');
const { obterAtendentePorEmail } = require('../src/atendentes');
const grupos = require('../src/grupos-permissao');
const acesso = require('../src/acesso');
const { montarStatus } = require('../src/status-sistema');
const planilha = require('../src/contatos-planilha');
const contatos = require('../src/contatos');
const { obterOuCriarConversa, definirNumeroExibicao, renomearContato } = require('../src/conversas');
const { definirSocket } = require('../src/socket-atual');

let servidor;
let baseUrl;
let cookieAdmin;

// campo com lista (várias caixas marcadas) vai repetido, como o navegador manda
function post(caminho, campos = {}, cookie = cookieAdmin) {
  const corpo = new URLSearchParams();
  for (const [chave, valor] of Object.entries(campos)) [].concat(valor).forEach((v) => corpo.append(chave, v));
  return fetch(`${baseUrl}${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, body: corpo, redirect: 'manual' });
}
async function pagina(caminho, cookie = cookieAdmin) {
  return (await fetch(`${baseUrl}${caminho}`, { headers: { cookie } })).text();
}
async function entrar(email, senha = '123456') {
  const resp = await fetch(`${baseUrl}/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, senha }), redirect: 'manual' });
  const bruto = resp.headers.get('set-cookie');
  return { resp, cookie: bruto && resp.status === 302 ? bruto.split(';')[0] : null };
}
const beto = () => obterAtendentePorEmail('beto@teste.com');
const permissoesDe = (a) => JSON.parse(a.permissoes);
// campos do formulário de atendente, com o horário de acesso (dia -> [inicio, fim])
function camposDoBeto(extra = {}, horario = {}) {
  const campos = { nome: 'Beto', papel: 'atendente', ativo: 'on', permissoes: 'responder_conversas', ...extra };
  for (const [dia, [inicio, fim]] of Object.entries(horario)) {
    campos[`inicio_${dia}_1`] = inicio;
    campos[`fim_${dia}_1`] = fim;
  }
  return campos;
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
  cookieAdmin = resp.headers.get('set-cookie').split(';')[0];
  await post('/painel/atendentes', { nome: 'Beto', email: 'beto@teste.com', senha: '123456', papel: 'atendente', permissoes: 'responder_conversas' });
});

after(async () => {
  definirSocket(null);
  await new Promise((resolve) => servidor.close(resolve));
  db.close();
  fs.rmSync(diretorioTeste, { recursive: true, force: true });
});

test('grupos de permissão: vêm prontos, o atendente herda, mudar o grupo muda todos, excluir não tira nada', async () => {
  assert.deepStrictEqual(grupos.listarGrupos().map((g) => g.nome), ['Atendente', 'Gerente']);
  const gerente = grupos.listarGrupos().find((g) => g.nome === 'Gerente');
  await post(`/painel/atendentes/${beto().id}`, camposDoBeto({ grupo_id: String(gerente.id) }));
  assert.strictEqual(beto().grupo_id, gerente.id);
  assert.ok(permissoesDe(beto()).includes('ver_relatorio'), 'herdou as do grupo (a marcada à mão não vale)');

  await post(`/painel/atendentes/grupos/${gerente.id}`, { nome: 'Gerente', permissoes: ['responder_conversas', 'gerenciar_contatos'] });
  assert.deepStrictEqual(permissoesDe(beto()).sort(), ['gerenciar_contatos', 'responder_conversas'], 'mudar o grupo muda quem está nele');

  let resp = await post('/painel/atendentes/grupos', { nome: 'gerente', permissoes: 'ver_painel' });
  assert.match(await resp.text(), /Já existe um grupo com esse nome/);
  resp = await post('/painel/atendentes/grupos', { nome: 'Supervisor', permissoes: ['ver_painel', 'ver_relatorio'] });
  assert.strictEqual(resp.status, 302);

  const lista = await pagina('/painel/atendentes');
  assert.match(lista, /Atendente<span class="selo" title="Grupo de permissões">Gerente<\/span>|Atendente <span class="selo" title="Grupo de permissões">Gerente<\/span>/);

  await post(`/painel/atendentes/grupos/${gerente.id}/excluir`);
  assert.strictEqual(beto().grupo_id, null);
  assert.deepStrictEqual(permissoesDe(beto()).sort(), ['gerenciar_contatos', 'responder_conversas'], 'continua com as mesmas');

  // só administrador mexe em grupo
  const { cookie } = await entrar('beto@teste.com');
  assert.strictEqual((await post('/painel/atendentes/grupos', { nome: 'X' }, cookie)).status, 403);
});

test('horário de acesso: fora do horário não entra e quem está dentro é desconectado quando acaba', async () => {
  const hoje = new Date().getDay();
  const amanha = (hoje + 1) % 7;
  await post(`/painel/atendentes/${beto().id}`, camposDoBeto({}, { [amanha]: ['08:00', '18:00'] }));
  assert.deepStrictEqual(acesso.janelasDeAcesso(beto()), [`${amanha} 08:00-18:00`]);

  let tentativa = await entrar('beto@teste.com');
  assert.strictEqual(tentativa.resp.status, 403);
  assert.match(await tentativa.resp.text(), /Fora do seu horário de acesso/);

  await post(`/painel/atendentes/${beto().id}`, camposDoBeto({}, { [hoje]: ['00:00', '23:59'] }));
  tentativa = await entrar('beto@teste.com');
  assert.ok(tentativa.cookie, 'dentro do horário entra');
  assert.strictEqual((await fetch(`${baseUrl}/painel/fila`, { headers: { cookie: tentativa.cookie }, redirect: 'manual' })).status, 200);

  // o horário acabou (o admin mudou): a próxima tela manda pro login com o aviso
  await post(`/painel/atendentes/${beto().id}`, camposDoBeto({}, { [amanha]: ['08:00', '18:00'] }));
  const resp = await fetch(`${baseUrl}/painel/fila`, { headers: { cookie: tentativa.cookie }, redirect: 'manual' });
  assert.strictEqual(resp.headers.get('location'), '/login?fora=1');
  assert.match(await pagina('/login?fora=1', ''), /acabou o seu horário de acesso/);

  // horário inválido no formulário
  const erro = await post(`/painel/atendentes/${beto().id}`, camposDoBeto({}, { 1: ['18:00', '08:00'] }));
  assert.match(await erro.text(), /Horário de acesso: Confira os horários/);

  // administrador nunca é barrado
  assert.strictEqual(acesso.verificarAcesso({ papel: 'admin', acesso_horario: JSON.stringify([`${amanha} 08:00-09:00`]) }).ok, true);
  await post(`/painel/atendentes/${beto().id}`, camposDoBeto());
  assert.strictEqual(beto().acesso_horario, null, 'tudo em branco = sem restrição');
});

test('IP liberado: só entra dos endereços da lista (aceita faixa terminada em ponto)', async () => {
  await post(`/painel/atendentes/${beto().id}`, camposDoBeto({ acesso_ips: '10.9.9.9' }));
  let tentativa = await entrar('beto@teste.com');
  assert.strictEqual(tentativa.resp.status, 403);
  assert.match(await tentativa.resp.text(), /IP/);
  await post(`/painel/atendentes/${beto().id}`, camposDoBeto({ acesso_ips: '10.9.9.9\n127.0.0.' }));
  tentativa = await entrar('beto@teste.com');
  assert.ok(tentativa.cookie);
  assert.ok((await pagina('/painel/atendentes')).includes('IP liberado'));
  await post(`/painel/atendentes/${beto().id}`, camposDoBeto({ acesso_ips: '' }));
});

test('histórico de acessos: entradas, saídas, senha errada e barrados; guarda 90 dias', async () => {
  await entrar('beto@teste.com', 'errada');
  const { cookie } = await entrar('beto@teste.com');
  await post('/logout', {}, cookie);
  const eventos = acesso.listarAcessos({ atendenteId: beto().id }).map((x) => x.evento);
  for (const e of ['senha_errada', 'entrou', 'saiu', 'bloqueado_horario', 'bloqueado_ip', 'desconectado']) assert.ok(eventos.includes(e), e);
  const tela = await pagina(`/painel/atendentes/acessos?atendente=${beto().id}`);
  assert.ok(tela.includes('Senha errada'));
  assert.ok(tela.includes('Barrado: fora do horário'));
  assert.ok(tela.includes('127.0.0.1'));

  db.prepare("UPDATE acessos SET criado_em = '2020-01-01T00:00:00.000Z' WHERE evento = 'senha_errada'").run();
  acesso.limparAcessosAntigos();
  assert.ok(!acesso.listarAcessos().some((x) => x.evento === 'senha_errada'), 'mais de 90 dias sai');
  assert.strictEqual(acesso.navegadorLegivel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'), 'Chrome · Windows');
});

test('status do sistema: WhatsApp, banco, disco, backup e versão', async () => {
  const status = montarStatus();
  assert.deepStrictEqual(status.itens.map((i) => i.nome), ['WhatsApp', 'Banco de dados', 'Espaço em disco', 'Backup', 'Sistema']);
  assert.strictEqual(status.itens[0].nivel, 'problema', 'sem WhatsApp no teste');
  assert.strictEqual(status.itens[1].nivel, 'ok');
  assert.strictEqual(status.itens[3].texto, 'Nenhum backup ainda');
  require('../src/backup').fazerBackup();
  assert.match(montarStatus().itens[3].texto, /^Último há \d+ min/);
  const tela = await pagina('/painel/configuracoes/status');
  assert.ok(tela.includes('Espaço em disco'));
  assert.ok((await pagina('/painel/configuracoes')).includes('Status do sistema'));
});

test('contatos: exportar planilha com os filtros e telefone como texto', async () => {
  const c = obterOuCriarConversa('5581933330001@s.whatsapp.net');
  definirNumeroExibicao('5581933330001@s.whatsapp.net', '5581933330001');
  renomearContato(c.id, 'Maria Exemplo');
  contatos.salvarContato(c.id, { email: 'maria@exemplo.test', consentimento_enviado: '1', consentimento: '1' });
  obterOuCriarConversa('5581933330002@s.whatsapp.net');

  const resp = await fetch(`${baseUrl}/painel/contatos/exportar.csv?q=Maria`, { headers: { cookie: cookieAdmin } });
  assert.match(resp.headers.get('content-disposition'), /contatos_\d{4}-\d{2}-\d{2}\.csv/);
  const linhas = (await resp.text()).replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.strictEqual(linhas.length, 2, 'só a Maria (busca da tela)');
  assert.match(linhas[0], /^Nome;Telefone;E-mail;Documento;Endereço;Observações;Tags;Situação;Consentimento/);
  assert.match(linhas[1], /^Maria Exemplo;="5581933330001";maria@exemplo\.test;;;;;Normal;sim;\d{2}\/\d{2}\/\d{4};/);
});

test('contatos: importar confere antes, completa quem existe e só cria quem tem WhatsApp', async () => {
  const csv = [
    'nome,celular,email,tags,consentimento,observacoes',
    '"Maria Nova Nome",(81) 93333-0001,outra@exemplo.test,"VIP, Condomínio",,"tem, vírgula"',
    'Joao Sem Zap,81 92222-0000,,,sim,',
    'Ana Zap,81 91111-0000,ana@exemplo.test,VIP,sim,',
    'Repetida,(81) 9 1111-0000,,,,',
    'Ruim,123,,,,',
  ].join('\n');
  const lida = planilha.lerPlanilha(csv);
  assert.deepStrictEqual(lida.colunas.sort(), ['consentimento', 'email', 'nome', 'observacoes', 'tags', 'telefone']);
  const itens = planilha.conferir(lida.linhas);
  assert.deepStrictEqual(itens.map((i) => i.acao), ['atualizar', 'novo', 'novo', 'erro', 'erro']);
  assert.match(itens[3].motivo, /repetido/);
  assert.match(itens[4].motivo, /inválido/);
  assert.strictEqual(itens[0].observacoes, 'tem, vírgula');

  // pela tela: conferir não grava nada
  const fd = new FormData();
  fd.append('arquivo', new Blob([csv], { type: 'text/csv' }), 'clientes.csv');
  const conferencia = await (await fetch(`${baseUrl}/painel/contatos/importar`, { method: 'POST', body: fd, headers: { cookie: cookieAdmin } })).text();
  assert.match(conferencia, /Nada foi gravado ainda/);
  assert.match(conferencia, /o contato novo não vai|os 2 contatos novos não vão/);
  const token = /name="token" value="([a-f0-9]+)"/.exec(conferencia)[1];
  assert.strictEqual(contatos.listarContatos({ busca: 'Ana Zap' }).total, 0);

  // WhatsApp de mentira: só o 81 91111-0000 existe
  definirSocket({
    onWhatsApp: async (jid) => [{ exists: jid.startsWith('5581911110000'), jid }],
    signalRepository: null,
  });
  const fim = await post('/painel/contatos/importar/confirmar', { token });
  const textoFim = await fim.text();
  assert.match(textoFim, /concluída/);
  assert.match(textoFim, /Sem WhatsApp \(não entraram\): 5581922220000/);

  const maria = contatos.listarContatos({ busca: '933330001' }).itens[0];
  assert.strictEqual(maria.nome_contato, 'Maria Exemplo', 'sem "trocar", o nome que já tinha fica');
  assert.strictEqual(maria.email, 'maria@exemplo.test', 'e o e-mail também');
  assert.strictEqual(maria.observacoes, 'tem, vírgula', 'o que estava vazio é preenchido');
  assert.deepStrictEqual(maria.tags.map((t) => t.nome).sort(), ['Condomínio', 'VIP']);
  const ana = contatos.listarContatos({ busca: 'Ana Zap' }).itens[0];
  assert.ok(ana, 'quem tem WhatsApp entrou');
  assert.strictEqual(ana.consentimento, 1);
  assert.strictEqual(ana.telefone, '5581911110000');

  // o mesmo token não vale de novo
  assert.match(await (await post('/painel/contatos/importar/confirmar', { token })).text(), /expirou/);

  // com "trocar": substitui o que já estava
  const outra = planilha.conferir(planilha.lerPlanilha('Nome;Telefone;E-mail\nMaria Trocada;81933330001;nova@exemplo.test').linhas);
  await planilha.aplicar(outra, { substituir: true });
  const trocada = contatos.listarContatos({ busca: '933330001' }).itens[0];
  assert.strictEqual(trocada.nome_contato, 'Maria Trocada');
  assert.strictEqual(trocada.email, 'nova@exemplo.test');
  assert.strictEqual(trocada.situacao_contato, 'normal');

  assert.match(planilha.lerPlanilha('Nome;Email\nX;y').erro, /coluna do telefone/);
  definirSocket(null);
});

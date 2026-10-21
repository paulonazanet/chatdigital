const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ARQUIVO_DB = process.env.CHATDIGITAL_DB || path.join(__dirname, '..', 'data', 'chatdigital.db');
const DIRETORIO = path.dirname(ARQUIVO_DB);
if (!fs.existsSync(DIRETORIO)) fs.mkdirSync(DIRETORIO, { recursive: true });

const db = new DatabaseSync(ARQUIVO_DB);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS atendentes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    papel TEXT NOT NULL CHECK (papel IN ('admin', 'atendente')),
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS setores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS atendentes_setores (
    atendente_id INTEGER NOT NULL REFERENCES atendentes(id) ON DELETE CASCADE,
    setor_id INTEGER NOT NULL REFERENCES setores(id) ON DELETE CASCADE,
    PRIMARY KEY (atendente_id, setor_id)
  );

  CREATE TABLE IF NOT EXISTS registros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    colecao TEXT NOT NULL,
    dados TEXT NOT NULL,
    criado_em TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT NOT NULL UNIQUE,
    numero_exibicao TEXT,
    status TEXT NOT NULL CHECK (status IN ('bot', 'aguardando', 'atendendo', 'finalizado')) DEFAULT 'bot',
    setor_id INTEGER REFERENCES setores(id),
    atendente_id INTEGER REFERENCES atendentes(id),
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mensagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
    remetente TEXT NOT NULL CHECK (remetente IN ('cliente', 'bot', 'atendente')),
    texto TEXT NOT NULL,
    criado_em TEXT NOT NULL,
    midia_tipo TEXT CHECK (midia_tipo IN ('imagem', 'video', 'audio')),
    midia_url TEXT
  );
`);

// Migrações simples: adiciona colunas novas em bancos já existentes (instalações antigas), sem
// mexer nos dados já gravados. CREATE TABLE IF NOT EXISTS não altera tabelas que já existem.
function colunaExiste(tabela, coluna) {
  return db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
}
if (!colunaExiste('atendentes', 'permissoes')) {
  db.exec("ALTER TABLE atendentes ADD COLUMN permissoes TEXT NOT NULL DEFAULT '[]'");
}
if (!colunaExiste('atendentes', 'ultimo_login')) {
  db.exec('ALTER TABLE atendentes ADD COLUMN ultimo_login TEXT');
}
if (!colunaExiste('conversas', 'no_fluxo_atual')) {
  // em qual nó do fluxo o cliente está agora (motor de fluxo só guarda isso em memória) — salvar
  // aqui é o que permite a seção "Parado no fluxo" sobreviver a um reinício do processo.
  db.exec('ALTER TABLE conversas ADD COLUMN no_fluxo_atual TEXT');
}
if (!colunaExiste('conversas', 'lembrete_inatividade_em')) {
  // quando o lembrete de inatividade foi mandado (NULL = nenhum pendente) — usado por
  // src/inatividade.js pra não repetir o lembrete e pra saber quando resetar a conversa parada.
  db.exec('ALTER TABLE conversas ADD COLUMN lembrete_inatividade_em TEXT');
}
if (!colunaExiste('conversas', 'numero_exibicao')) {
  // número de telefone legível pra mostrar na fila. Normalmente é o próprio `numero`, mas quando
  // o WhatsApp usa o formato @lid (Linked ID, sem o número visível) pra endereçar a conversa,
  // isso guarda o número de verdade que o Baileys manda separado (`senderPn`) — sem mexer no
  // `numero` usado de fato pra mandar mensagem, que continua sendo o que funcionou de verdade.
  db.exec('ALTER TABLE conversas ADD COLUMN numero_exibicao TEXT');
}
if (!colunaExiste('mensagens', 'midia_url')) {
  // suporte a imagem/vídeo/áudio no histórico (recebido do cliente ou enviado pelo atendente) —
  // midia_tipo é NULL pra mensagem de texto normal, midia_url é o caminho público do arquivo
  // salvo em public/uploads.
  db.exec("ALTER TABLE mensagens ADD COLUMN midia_tipo TEXT CHECK (midia_tipo IN ('imagem', 'video', 'audio'))");
  db.exec('ALTER TABLE mensagens ADD COLUMN midia_url TEXT');
}
if (!colunaExiste('mensagens', 'atendente_id')) {
  // quem mandou a mensagem, quando remetente = 'atendente' — sem isso o histórico só mostrava
  // "atendente" genérico. Mensagens antigas (de antes desta coluna) ficam NULL.
  db.exec('ALTER TABLE mensagens ADD COLUMN atendente_id INTEGER REFERENCES atendentes(id) ON DELETE SET NULL');
}
if (!colunaExiste('conversas', 'nome_contato')) {
  // nome do cliente: vem sozinho do perfil do WhatsApp (pushName) até um atendente corrigir na
  // mão — aí nome_editado = 1 e o nome do perfil não sobrescreve mais.
  db.exec('ALTER TABLE conversas ADD COLUMN nome_contato TEXT');
  db.exec('ALTER TABLE conversas ADD COLUMN nome_editado INTEGER NOT NULL DEFAULT 0');
}
if (!colunaExiste('conversas', 'aberta_em')) {
  // quando o atendimento atual foi aberto (1a mensagem depois de estar parado/finalizado) — é de
  // onde conta o fechamento automático. NULL = sem atendimento aberto. `criado_em` não serve: a
  // linha da conversa é reaproveitada pra sempre pro mesmo número.
  db.exec('ALTER TABLE conversas ADD COLUMN aberta_em TEXT');
  // quem já estava em andamento conta a partir da última atividade (não fecha tudo de uma vez)
  db.exec("UPDATE conversas SET aberta_em = atualizado_em WHERE status IN ('aguardando', 'atendendo', 'bot')");
}

// Livro de atendimentos (base do menu Relatório): uma linha por atendimento, porque a linha de
// `conversas` é reaproveitada pra sempre pro mesmo número e só sabe o estado de agora.
// origem 'cliente' = entrou na fila pelo bot; 'ativo' = começou pelo atendente (Nova conversa,
// Puxar...), sem espera de fila pra medir. Com o livro vazio, o boot reconstrói os atendimentos
// antigos pelas mensagens (ver atendimentos.js e app.js).
db.exec(`
  CREATE TABLE IF NOT EXISTS atendimentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
    origem TEXT NOT NULL CHECK (origem IN ('cliente', 'ativo')),
    setor_id INTEGER REFERENCES setores(id) ON DELETE SET NULL,
    atendente_id INTEGER REFERENCES atendentes(id) ON DELETE SET NULL,
    aberto_em TEXT NOT NULL,
    assumido_em TEXT,
    primeira_resposta_em TEXT,
    finalizado_em TEXT,
    finalizado_como TEXT CHECK (finalizado_como IN ('atendente', 'automatico', 'outro')),
    nota INTEGER,
    reconstruido INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_atendimentos_conversa ON atendimentos (conversa_id, finalizado_em);
  CREATE INDEX IF NOT EXISTS idx_atendimentos_aberto ON atendimentos (aberto_em);
`);

if (!colunaExiste('mensagens', 'interna')) {
  // nota interna: escrita por atendente (ou pelo sistema, ex.: registro de transferência) que o
  // cliente NÃO recebe. Fica no histórico, mas não conta como resposta pra fila nem pro Relatório.
  db.exec('ALTER TABLE mensagens ADD COLUMN interna INTEGER NOT NULL DEFAULT 0');
}
if (!colunaExiste('atendimentos', 'protocolo')) {
  // número do atendimento pra falar com o cliente ("seu protocolo é ...") e achar depois.
  // Formato AAAAMMDD + id com 4 dígitos (o id já garante que não repete).
  db.exec('ALTER TABLE atendimentos ADD COLUMN protocolo TEXT');
  db.exec(
    "UPDATE atendimentos SET protocolo = strftime('%Y%m%d', aberto_em, 'localtime') || printf('%04d', id) WHERE protocolo IS NULL",
  );
}
if (!colunaExiste('atendimentos', 'motivo_id')) {
  // motivo de encerramento escolhido ao finalizar; motivo_texto guarda "Grupo › Motivo" como
  // estava na hora (se o motivo for renomeado ou apagado depois, o histórico não muda)
  db.exec('ALTER TABLE atendimentos ADD COLUMN motivo_id INTEGER');
  db.exec('ALTER TABLE atendimentos ADD COLUMN motivo_texto TEXT');
}

if (!colunaExiste('mensagens', 'wa_id')) {
  // E1, 3a parte: id da mensagem no WhatsApp (pra responder citando e reagir), se fui eu quem
  // mandou (fromMe), qual mensagem foi citada, reações do cliente e do atendente, e envio que falhou
  // (fica no histórico com o botão Reenviar).
  db.exec('ALTER TABLE mensagens ADD COLUMN wa_id TEXT');
  db.exec('ALTER TABLE mensagens ADD COLUMN wa_de_mim INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE mensagens ADD COLUMN citada_id INTEGER');
  db.exec('ALTER TABLE mensagens ADD COLUMN reacao_cliente TEXT');
  db.exec('ALTER TABLE mensagens ADD COLUMN reacao_atendente TEXT');
  db.exec('ALTER TABLE mensagens ADD COLUMN falha INTEGER NOT NULL DEFAULT 0');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_mensagens_wa_id ON mensagens (wa_id)');

if (!colunaExiste('conversas', 'situacao_contato')) {
  // Ficha do contato (menu Contatos). A linha de `conversas` já é uma por número pra sempre, então
  // o cadastro mora nela. situacao_contato: 'normal'; 'ignorado' (o bot não responde e não abre
  // atendimento, mas a mensagem fica no histórico; ex.: família, fornecedor); 'bloqueado' (nada é
  // registrado). consentimento: aceitou receber mensagens (campanhas, LGPD); as datas guardam
  // quando aceitou e quando pediu pra sair (opt-out).
  db.exec('ALTER TABLE conversas ADD COLUMN email TEXT');
  db.exec('ALTER TABLE conversas ADD COLUMN documento TEXT');
  db.exec('ALTER TABLE conversas ADD COLUMN endereco TEXT');
  db.exec('ALTER TABLE conversas ADD COLUMN observacoes TEXT');
  db.exec("ALTER TABLE conversas ADD COLUMN situacao_contato TEXT NOT NULL DEFAULT 'normal'");
  db.exec('ALTER TABLE conversas ADD COLUMN consentimento INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE conversas ADD COLUMN consentimento_em TEXT');
  db.exec('ALTER TABLE conversas ADD COLUMN optout_em TEXT');
}

// Tags de contato: segmentação do cliente (ex.: "Condomínio", "Comércio"), diferente dos
// marcadores, que são do atendimento e o atendente tira quando resolve.
db.exec(`
  CREATE TABLE IF NOT EXISTS tags_contato (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE IF NOT EXISTS conversas_tags (
    conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags_contato(id) ON DELETE CASCADE,
    PRIMARY KEY (conversa_id, tag_id)
  );
`);

// Respostas rápidas: textos prontos que o atendente puxa com "/" no campo de resposta. Sem setor
// marcado = aparece pra todos os setores.
db.exec(`
  CREATE TABLE IF NOT EXISTS respostas_rapidas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    texto TEXT NOT NULL,
    ativa INTEGER NOT NULL DEFAULT 1,
    expira_em TEXT,
    criado_por INTEGER REFERENCES atendentes(id) ON DELETE SET NULL,
    criado_em TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS respostas_rapidas_setores (
    resposta_id INTEGER NOT NULL REFERENCES respostas_rapidas(id) ON DELETE CASCADE,
    setor_id INTEGER NOT NULL REFERENCES setores(id) ON DELETE CASCADE,
    PRIMARY KEY (resposta_id, setor_id)
  );
`);

// Motivos de encerramento em 2 níveis: grupo (pai_id NULL, ex.: "Resolvido") e motivo dentro dele.
db.exec(`
  CREATE TABLE IF NOT EXISTS motivos_encerramento (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    pai_id INTEGER REFERENCES motivos_encerramento(id) ON DELETE CASCADE,
    ativo INTEGER NOT NULL DEFAULT 1
  );
`);

// Marcadores: etiquetas coloridas que o atendente põe na conversa (ex.: "Urgente", "Aguardando
// retorno") pra achar e filtrar na fila. Ficam na conversa (no cliente) até alguém tirar.
// Conversas fixadas: cada atendente fixa as dele no topo da lista.
db.exec(`
  CREATE TABLE IF NOT EXISTS marcadores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cor TEXT NOT NULL DEFAULT '#2f6690',
    ativo INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS conversas_marcadores (
    conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
    marcador_id INTEGER NOT NULL REFERENCES marcadores(id) ON DELETE CASCADE,
    PRIMARY KEY (conversa_id, marcador_id)
  );
  CREATE TABLE IF NOT EXISTS conversas_fixadas (
    atendente_id INTEGER NOT NULL REFERENCES atendentes(id) ON DELETE CASCADE,
    conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
    PRIMARY KEY (atendente_id, conversa_id)
  );
`);

// Feriados (Configurações > Feriados, ver feriados.js). repete_ano: vale todo ano no mesmo dia/mês;
// tem_expediente: só fica registrado, não fecha nada.
db.exec(`
  CREATE TABLE IF NOT EXISTS feriados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    data TEXT NOT NULL,
    repete_ano INTEGER NOT NULL DEFAULT 1,
    dia_inteiro INTEGER NOT NULL DEFAULT 1,
    hora_inicio TEXT,
    hora_fim TEXT,
    tem_expediente INTEGER NOT NULL DEFAULT 0,
    mensagem TEXT,
    ativo INTEGER NOT NULL DEFAULT 1
  );
`);

// Horário próprio do setor: lista de janelas no formato do bloco Horário do fluxo
// ("1,2,3,4,5 08:00-12:00"), em JSON; NULL = sem horário (sempre aberto). Fora do horário (ou
// em feriado), quem cai na fila do setor recebe a mensagem_fora_horario.
if (!colunaExiste('setores', 'horario')) {
  db.exec('ALTER TABLE setores ADD COLUMN horario TEXT');
  db.exec('ALTER TABLE setores ADD COLUMN mensagem_fora_horario TEXT');
}

// E2, 2a parte: pausa do atendente com motivo (quem está em pausa não recebe conversa) e limite de
// conversas ao mesmo tempo por atendente (0 = sem limite). limite_minutos do motivo: depois disso a
// pausa vira alerta (0 = sem limite). A pausa guarda o nome e o limite do motivo como estavam.
if (!colunaExiste('atendentes', 'limite_conversas')) {
  db.exec('ALTER TABLE atendentes ADD COLUMN limite_conversas INTEGER NOT NULL DEFAULT 0');
}
const motivosPausaNovos = !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'motivos_pausa'").get();
db.exec(`
  CREATE TABLE IF NOT EXISTS motivos_pausa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    limite_minutos INTEGER NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS pausas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    atendente_id INTEGER NOT NULL REFERENCES atendentes(id) ON DELETE CASCADE,
    motivo_id INTEGER,
    motivo_texto TEXT NOT NULL,
    limite_minutos INTEGER NOT NULL DEFAULT 0,
    inicio TEXT NOT NULL,
    fim TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pausas_atendente ON pausas (atendente_id, fim);
  CREATE INDEX IF NOT EXISTS idx_pausas_inicio ON pausas (inicio);
`);
if (motivosPausaNovos) {
  const inserir = db.prepare('INSERT INTO motivos_pausa (nome, limite_minutos) VALUES (?, ?)');
  for (const [nome, limite] of [['Almoço', 60], ['Lanche ou café', 15], ['Banheiro', 10], ['Reunião', 0], ['Outro', 0]]) inserir.run(nome, limite);
}

// E2, 3a parte: versões do fluxo do bot. Cada "Salvar" do editor (e cada volta para uma versão
// antiga) guarda o fluxo inteiro aqui, pra poder voltar atrás. `origem` diz de onde veio (editor,
// modelo pronto, arquivo importado, restaurada); fica só as últimas 100.
db.exec(`
  CREATE TABLE IF NOT EXISTS fluxo_versoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    criado_em TEXT NOT NULL,
    atendente_id INTEGER REFERENCES atendentes(id) ON DELETE SET NULL,
    atendente_nome TEXT,
    origem TEXT NOT NULL,
    conteudo TEXT NOT NULL
  );
`);

// E2, 4a parte: grupos de permissão (ex.: "Gerente", "Atendente"): o atendente que está num grupo
// tem as permissões do grupo (copiadas pra `atendentes.permissoes` quando o grupo ou o atendente é
// salvo, então quem lê permissão não precisa saber de grupo). Horário de acesso (janelas no formato
// do bloco Horário, JSON; NULL = qualquer hora) e IPs permitidos (um por linha; NULL = qualquer IP),
// que não valem pra administrador. Histórico de acessos (entradas, tentativas e saídas).
if (!colunaExiste('atendentes', 'grupo_id')) {
  db.exec('ALTER TABLE atendentes ADD COLUMN grupo_id INTEGER');
  db.exec('ALTER TABLE atendentes ADD COLUMN acesso_horario TEXT');
  db.exec('ALTER TABLE atendentes ADD COLUMN acesso_ips TEXT');
}
const gruposNovos = !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'grupos_permissao'").get();
db.exec(`
  CREATE TABLE IF NOT EXISTS grupos_permissao (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
    permissoes TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS acessos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    criado_em TEXT NOT NULL,
    atendente_id INTEGER REFERENCES atendentes(id) ON DELETE SET NULL,
    email TEXT,
    evento TEXT NOT NULL,
    detalhe TEXT,
    ip TEXT,
    navegador TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_acessos_criado ON acessos (criado_em);
`);
if (gruposNovos) {
  const inserir = db.prepare('INSERT INTO grupos_permissao (nome, permissoes) VALUES (?, ?)');
  inserir.run('Atendente', JSON.stringify(['responder_conversas', 'finalizar_conversas']));
  inserir.run('Gerente', JSON.stringify(['ver_painel', 'ver_fila_outros_setores', 'responder_conversas', 'finalizar_conversas', 'ver_relatorio', 'gerenciar_respostas_rapidas', 'gerenciar_contatos']));
}

// E3: envios automáticos (lembrete de recompra, campanha), um por cliente, mandados devagar por
// envios.js (janela de horário, intervalo, limite por dia). Guarda o que aconteceu depois: entregue,
// lido, respondido, pediu pra sair. `referencia_id` = campanha (tipo 'campanha').
db.exec(`
  CREATE TABLE IF NOT EXISTS envios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL CHECK (tipo IN ('lembrete', 'campanha', 'retorno', 'teste')),
    referencia_id INTEGER,
    conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
    texto TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviado', 'falhou', 'pulado', 'cancelado')),
    motivo TEXT,
    agendado_para TEXT NOT NULL,
    criado_em TEXT NOT NULL,
    enviado_em TEXT,
    wa_id TEXT,
    entregue_em TEXT,
    lido_em TEXT,
    respondido_em TEXT,
    saiu_em TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_envios_status ON envios (status, agendado_para);
  CREATE INDEX IF NOT EXISTS idx_envios_conversa ON envios (conversa_id, enviado_em);
  CREATE INDEX IF NOT EXISTS idx_envios_wa ON envios (wa_id);

  CREATE TABLE IF NOT EXISTS retornos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
    atendente_id INTEGER REFERENCES atendentes(id) ON DELETE SET NULL,
    criado_por INTEGER REFERENCES atendentes(id) ON DELETE SET NULL,
    quando TEXT NOT NULL,
    nota TEXT,
    mensagem TEXT,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'feito', 'cancelado')),
    criado_em TEXT NOT NULL,
    feito_em TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_retornos_quando ON retornos (status, quando);

  CREATE TABLE IF NOT EXISTS campanhas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    texto TEXT NOT NULL,
    publico TEXT NOT NULL DEFAULT '{}',
    frase_chave TEXT,
    acao_frase TEXT,
    setor_frase TEXT,
    bloco_frase TEXT,
    status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'enviando', 'pausada', 'concluida', 'cancelada')),
    comecar_em TEXT,
    criado_por INTEGER REFERENCES atendentes(id) ON DELETE SET NULL,
    criado_em TEXT NOT NULL,
    iniciada_em TEXT,
    concluida_em TEXT
  );
`);
if (!colunaExiste('conversas', 'recompra_dias')) {
  // dias até o lembrete de recompra deste cliente (NULL = o padrão de Configurações)
  db.exec('ALTER TABLE conversas ADD COLUMN recompra_dias INTEGER');
}

// E4: API oficial do WhatsApp (Meta). Uma linha só (id = 1) com a configuração; a chave e o
// segredo do app ficam aqui no banco (não no negocio.json, que pode ir para o repositório).
// modelos_oficiais: os modelos (templates) aprovados, puxados da Meta. envios.modelo: o modelo que
// o envio usa pela API oficial (JSON { nome, idioma, parametros }).
db.exec(`
  CREATE TABLE IF NOT EXISTS whatsapp_oficial (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    numero_id TEXT,
    conta_id TEXT,
    chave TEXT,
    segredo_app TEXT,
    codigo_verificacao TEXT,
    versao TEXT,
    numero_exibicao TEXT,
    nome_verificado TEXT,
    qualidade TEXT,
    testado_em TEXT,
    erro TEXT
  );
  CREATE TABLE IF NOT EXISTS modelos_oficiais (
    nome TEXT NOT NULL,
    idioma TEXT NOT NULL,
    categoria TEXT,
    situacao TEXT,
    corpo TEXT,
    variaveis INTEGER NOT NULL DEFAULT 0,
    componentes TEXT,
    atualizado_em TEXT NOT NULL,
    PRIMARY KEY (nome, idioma)
  );
`);
// modelos_enviados (E4, 4a parte): cada modelo que saiu pela API oficial, que é o que a Meta cobra.
// `gratis` = utilidade dentro das 24 h do cliente (a Meta não cobra). Base da tela Custos da Meta.
db.exec(`
  CREATE TABLE IF NOT EXISTS modelos_enviados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversa_id INTEGER REFERENCES conversas(id) ON DELETE SET NULL,
    nome TEXT NOT NULL,
    idioma TEXT NOT NULL,
    categoria TEXT,
    origem TEXT NOT NULL,
    gratis INTEGER NOT NULL DEFAULT 0,
    wa_id TEXT,
    enviado_em TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_modelos_enviados_em ON modelos_enviados (enviado_em);
`);
db.prepare('INSERT OR IGNORE INTO whatsapp_oficial (id, codigo_verificacao, versao) VALUES (1, ?, ?)').run(require('crypto').randomBytes(16).toString('hex'), 'v23.0');
if (!colunaExiste('envios', 'modelo')) db.exec('ALTER TABLE envios ADD COLUMN modelo TEXT');
// modelo da campanha pela API oficial: nome, idioma e o que vai em {{1}}, {{2}}... (JSON, com variáveis)
if (!colunaExiste('campanhas', 'modelo_nome')) {
  db.exec('ALTER TABLE campanhas ADD COLUMN modelo_nome TEXT');
  db.exec('ALTER TABLE campanhas ADD COLUMN modelo_idioma TEXT');
  db.exec('ALTER TABLE campanhas ADD COLUMN modelo_parametros TEXT');
}


// E4, 3a parte: vários números de WhatsApp (pelo celular) na mesma instalação, com o mesmo bot.
// Cada número tem a pasta de login dele (o 1o usa a pasta "auth" de sempre). A conversa guarda por
// qual número o cliente escreveu por último (canal_id), e a resposta sai por ele; a mensagem do
// cliente guarda por qual número chegou.
db.exec(`
  CREATE TABLE IF NOT EXISTS canais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    pasta TEXT NOT NULL UNIQUE,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL
  );
`);
db.prepare("INSERT OR IGNORE INTO canais (id, nome, pasta, criado_em) VALUES (1, 'Principal', 'auth', ?)").run(new Date().toISOString());
if (!colunaExiste('conversas', 'canal_id')) db.exec('ALTER TABLE conversas ADD COLUMN canal_id INTEGER');
// fluxos: cada número pode ter o seu bot. O 1 é o "Principal" (o arquivo config/fluxo.json, sem
// conteúdo aqui); os outros guardam o fluxo inteiro em JSON. fluxo_versoes passa a ser por fluxo.
db.exec(`
  CREATE TABLE IF NOT EXISTS fluxos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    conteudo TEXT,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT
  );
`);
db.prepare("INSERT OR IGNORE INTO fluxos (id, nome, criado_em) VALUES (1, 'Principal', ?)").run(new Date().toISOString());
if (!colunaExiste('canais', 'fluxo_id')) db.exec('ALTER TABLE canais ADD COLUMN fluxo_id INTEGER');
if (!colunaExiste('fluxo_versoes', 'fluxo_id')) db.exec('ALTER TABLE fluxo_versoes ADD COLUMN fluxo_id INTEGER NOT NULL DEFAULT 1');
if (!colunaExiste('mensagens', 'canal_id')) db.exec('ALTER TABLE mensagens ADD COLUMN canal_id INTEGER');

// E4: Instagram (Direct), pela API do Instagram com login do Instagram (graph.instagram.com).
// Uma conta por instalação. A conversa do Instagram usa "<IGSID>@instagram" como número e um canal
// próprio (canais.tipo = 'instagram'), então tem etiqueta e fluxo como um número de WhatsApp.
db.exec(`
  CREATE TABLE IF NOT EXISTS instagram_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    conta_id TEXT,
    usuario TEXT,
    chave TEXT,
    chave_renovada_em TEXT,
    segredo_app TEXT,
    codigo_verificacao TEXT,
    versao TEXT,
    endereco_publico TEXT,
    testado_em TEXT,
    erro TEXT
  );
`);
db.prepare('INSERT OR IGNORE INTO instagram_config (id, codigo_verificacao, versao) VALUES (1, ?, ?)').run(require('crypto').randomBytes(16).toString('hex'), 'v26.0');
// central do Instagram (um app só na Meta para todas as instalações): endereço dela e o código desta
// instalação lá; o segredo combinado com a central fica em segredo_app
if (!colunaExiste('instagram_config', 'central_url')) db.exec('ALTER TABLE instagram_config ADD COLUMN central_url TEXT');
if (!colunaExiste('instagram_config', 'central_instalacao')) db.exec('ALTER TABLE instagram_config ADD COLUMN central_instalacao TEXT');
if (!colunaExiste('canais', 'tipo')) db.exec("ALTER TABLE canais ADD COLUMN tipo TEXT NOT NULL DEFAULT 'celular'");

// O fluxo padrão (config/fluxo.json) transfere para o setor "Geral" — garante que ele exista
// sem sobrescrever setores que o cliente já tenha criado.
db.prepare('INSERT OR IGNORE INTO setores (nome) VALUES (?)').run('Geral');

module.exports = { db, ARQUIVO_DB };

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

// Feriados que mudam de data todo ano (calculados pela Páscoa): movel = 'carnaval_segunda',
// 'carnaval_terca', 'sexta_santa' ou 'corpus_christi'. Um registro só por feriado, que vale todo ano.
// Na 1a vez, junta os que a importação antiga criou com o ano no nome (fica com o do ano que vem, pra
// manter o "abre/fecha" e a mensagem que a empresa escolheu) e apaga os outros.
if (!colunaExiste('feriados', 'movel')) {
  db.exec('ALTER TABLE feriados ADD COLUMN movel TEXT');
  const TIPOS = [
    ['carnaval_segunda', /^Carnaval \(segunda\)/, 'Carnaval (segunda), ponto facultativo'],
    ['carnaval_terca', /^Carnaval \(terça\)/, 'Carnaval (terça), ponto facultativo'],
    ['sexta_santa', /^Sexta-feira Santa/, 'Sexta-feira Santa'],
    ['corpus_christi', /^Corpus Christi/, 'Corpus Christi, ponto facultativo'],
  ];
  const antigos = db.prepare('SELECT * FROM feriados WHERE repete_ano = 0').all();
  for (const [chave, padrao, nome] of TIPOS) {
    const doTipo = antigos.filter((f) => padrao.test(f.nome) && /\b20\d{2}\b/.test(f.nome)).sort((a, b) => b.data.localeCompare(a.data));
    if (!doTipo.length) continue;
    db.prepare('UPDATE feriados SET movel = ?, nome = ?, repete_ano = 1 WHERE id = ?').run(chave, nome, doTipo[0].id);
    for (const f of doTipo.slice(1)) db.prepare('DELETE FROM feriados WHERE id = ?').run(f.id);
  }
}

// Horário próprio do setor: lista de janelas no formato do bloco Horário do fluxo
// ("1,2,3,4,5 08:00-12:00"), em JSON; NULL = sem horário (sempre aberto). Fora do horário (ou
// em feriado), quem cai na fila do setor recebe a mensagem_fora_horario.
if (!colunaExiste('setores', 'horario')) {
  db.exec('ALTER TABLE setores ADD COLUMN horario TEXT');
  db.exec('ALTER TABLE setores ADD COLUMN mensagem_fora_horario TEXT');
}

// O fluxo padrão (config/fluxo.json) transfere para o setor "Geral" — garante que ele exista
// sem sobrescrever setores que o cliente já tenha criado.
db.prepare('INSERT OR IGNORE INTO setores (nome) VALUES (?)').run('Geral');

module.exports = { db, ARQUIVO_DB };

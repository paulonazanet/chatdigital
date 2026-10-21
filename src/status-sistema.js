const fs = require('fs');
const path = require('path');
const { db, ARQUIVO_DB } = require('./db');
const whatsappStatus = require('./whatsapp-status');
const { DIRETORIO_BACKUP } = require('./backup');

// Status do sistema (Configurações > Status do sistema): WhatsApp, banco de dados, espaço em disco,
// último backup e a versão em uso. Cada item: { nome, nivel ('ok' | 'atencao' | 'problema'), texto,
// detalhe }. Só lê; não conserta nada sozinho.

const RAIZ = path.join(__dirname, '..');
const DIA_MS = 86400000;

function formatarBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  return `${valor.toFixed(valor >= 10 || i === 0 ? 0 : 1).replace('.', ',')} ${unidades[i]}`;
}

function formatarTempo(ms) {
  const minutos = Math.floor(ms / 60000);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `${horas}h ${minutos % 60}min`;
  return `${Math.floor(horas / 24)} dias`;
}

// commit em uso (lendo o .git direto, sem rodar programa): "6dbe929"; null se não der
function commitAtual() {
  try {
    let dirGit = path.join(RAIZ, '.git');
    if (fs.statSync(dirGit).isFile()) dirGit = path.resolve(RAIZ, fs.readFileSync(dirGit, 'utf8').replace(/^gitdir:\s*/, '').trim());
    const head = fs.readFileSync(path.join(dirGit, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head.slice(0, 7);
    const ref = head.replace(/^ref:\s*/, '');
    const comum = fs.existsSync(path.join(dirGit, 'commondir')) ? path.resolve(dirGit, fs.readFileSync(path.join(dirGit, 'commondir'), 'utf8').trim()) : dirGit;
    for (const base of [dirGit, comum]) {
      const arquivo = path.join(base, ref);
      if (fs.existsSync(arquivo)) return fs.readFileSync(arquivo, 'utf8').trim().slice(0, 7);
    }
    const empacotados = fs.readFileSync(path.join(comum, 'packed-refs'), 'utf8');
    const linha = empacotados.split('\n').find((l) => l.endsWith(` ${ref}`));
    return linha ? linha.slice(0, 7) : null;
  } catch (erro) {
    return null;
  }
}

function itemWhatsapp() {
  const { conectado, qr } = whatsappStatus.obterEstado();
  if (require('./socket-atual').modoAtual() === 'oficial') {
    const c = require('./whatsapp-oficial').lerConfig();
    if (conectado && !c.erro) return { nome: 'WhatsApp', nivel: 'ok', texto: `API oficial: ${c.numero_exibicao || 'conectada'}`, detalhe: `Pela Meta${c.nome_verificado ? ` (${c.nome_verificado})` : ''}.` };
    return { nome: 'WhatsApp', nivel: 'problema', texto: 'API oficial com problema', detalhe: c.erro || 'Confira os dados da Meta em Configurações > WhatsApp.', link: '/painel/configuracoes/whatsapp' };
  }
  if (conectado) return { nome: 'WhatsApp', nivel: 'ok', texto: 'Conectado', detalhe: 'Recebendo e mandando mensagens.' };
  return {
    nome: 'WhatsApp',
    nivel: 'problema',
    texto: qr ? 'Esperando ler o QR Code' : 'Desconectado',
    detalhe: 'O bot não recebe nem manda mensagens. Veja em Configurações > WhatsApp.',
    link: '/painel/configuracoes/whatsapp',
  };
}

function itemBanco() {
  try {
    const resultado = db.prepare('PRAGMA quick_check').get();
    const ok = Object.values(resultado || {})[0] === 'ok';
    let tamanho = 0;
    for (const sufixo of ['', '-wal']) if (fs.existsSync(ARQUIVO_DB + sufixo)) tamanho += fs.statSync(ARQUIVO_DB + sufixo).size;
    const conversas = db.prepare('SELECT COUNT(*) AS n FROM conversas').get().n;
    const mensagens = db.prepare('SELECT COUNT(*) AS n FROM mensagens').get().n;
    return {
      nome: 'Banco de dados',
      nivel: ok ? 'ok' : 'problema',
      texto: ok ? `Funcionando · ${formatarBytes(tamanho)}` : 'A checagem achou erro',
      detalhe: ok ? `${conversas} conversas e ${mensagens} mensagens guardadas.` : 'Avise o suporte: pode ser preciso voltar o último backup.',
    };
  } catch (erro) {
    return { nome: 'Banco de dados', nivel: 'problema', texto: 'Não consegui conferir', detalhe: erro.message };
  }
}

function itemDisco() {
  try {
    const info = fs.statfsSync(path.dirname(ARQUIVO_DB));
    const livre = info.bavail * info.bsize;
    const total = info.blocks * info.bsize;
    const pct = total ? Math.round((livre / total) * 100) : 0;
    const nivel = pct < 5 || livre < 500 * 1024 * 1024 ? 'problema' : pct < 15 ? 'atencao' : 'ok';
    return {
      nome: 'Espaço em disco',
      nivel,
      texto: `${formatarBytes(livre)} livres de ${formatarBytes(total)} (${pct}%)`,
      detalhe: nivel === 'ok' ? 'Espaço de sobra.' : 'Pouco espaço: fotos e áudios recebidos e os backups podem parar de ser gravados. Avise o suporte.',
    };
  } catch (erro) {
    return { nome: 'Espaço em disco', nivel: 'atencao', texto: 'Não consegui medir', detalhe: erro.message };
  }
}

function itemBackup(agoraMs = Date.now()) {
  try {
    const arquivos = fs.existsSync(DIRETORIO_BACKUP)
      ? fs.readdirSync(DIRETORIO_BACKUP).filter((n) => n.endsWith('.db')).map((n) => ({ nome: n, ...fs.statSync(path.join(DIRETORIO_BACKUP, n)) }))
      : [];
    if (!arquivos.length) return { nome: 'Backup', nivel: 'atencao', texto: 'Nenhum backup ainda', detalhe: 'O backup é feito 1 vez por dia, sozinho, enquanto o sistema está ligado.' };
    arquivos.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const ultimo = arquivos[0];
    const idade = Math.max(0, agoraMs - ultimo.mtimeMs); // a hora do arquivo pode vir uns milésimos à frente
    return {
      nome: 'Backup',
      nivel: idade > 2 * DIA_MS ? 'atencao' : 'ok',
      texto: `Último há ${formatarTempo(idade)} · ${formatarBytes(ultimo.size)}`,
      detalhe: `${arquivos.length} backup${arquivos.length === 1 ? '' : 's'} guardado${arquivos.length === 1 ? '' : 's'} no servidor (1 por dia, últimos 30 dias).${idade > 2 * DIA_MS ? ' O último está velho: avise o suporte.' : ''}`,
    };
  } catch (erro) {
    return { nome: 'Backup', nivel: 'atencao', texto: 'Não consegui conferir', detalhe: erro.message };
  }
}

function itemSistema() {
  let versao = '';
  try {
    versao = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version;
  } catch (erro) {
    // sem package.json legível, mostra só o resto
  }
  const commit = commitAtual();
  const memoria = process.memoryUsage().rss;
  return {
    nome: 'Sistema',
    nivel: 'ok',
    texto: `Ligado há ${formatarTempo(process.uptime() * 1000)}`,
    detalhe: `Versão ${versao || '—'}${commit ? ` (${commit})` : ''} · Node ${process.versions.node} · memória ${formatarBytes(memoria)}`,
  };
}

// pelo celular com mais de um número: um item por número ligado
function itensWhatsapp() {
  const modo = require('./socket-atual').modoAtual();
  if (modo === 'oficial') return [itemWhatsapp()];
  const ligados = require('./canais').listarCanais({ soAtivos: true, tipo: 'celular' });
  // os dois jeitos (misto): um item por número do celular e um da API oficial
  const itemOficial = () => {
    const c = require('./whatsapp-oficial').lerConfig();
    const numero = require('./canais').canalOficial();
    const { conectado } = numero ? whatsappStatus.obterEstado(numero.id) : { conectado: false };
    return conectado && !c.erro
      ? { nome: `WhatsApp: ${numero.nome}`, nivel: 'ok', texto: `API oficial: ${c.numero_exibicao || 'conectada'}`, detalhe: 'Pela Meta.' }
      : { nome: `WhatsApp: ${numero?.nome || 'API oficial'}`, nivel: 'problema', texto: 'API oficial com problema', detalhe: c.erro || 'Confira os dados da Meta em Configurações > WhatsApp.', link: '/painel/configuracoes/whatsapp' };
  };
  if (ligados.length <= 1 && modo !== 'misto') return [itemWhatsapp()];
  const itens = ligados.map((c) => {
    const { conectado, qr } = whatsappStatus.obterEstado(c.id);
    return conectado
      ? { nome: `WhatsApp: ${c.nome}`, nivel: 'ok', texto: 'Conectado', detalhe: 'Recebendo e mandando mensagens.' }
      : { nome: `WhatsApp: ${c.nome}`, nivel: 'problema', texto: qr ? 'Esperando ler o QR Code' : 'Desconectado', detalhe: 'Veja em Configurações > WhatsApp.', link: '/painel/configuracoes/whatsapp' };
  });
  return modo === 'misto' ? [...itens, itemOficial()] : itens;
}

function montarStatus(agoraMs = Date.now()) {
  const itens = [...itensWhatsapp(), itemBanco(), itemDisco(), itemBackup(agoraMs), itemSistema()];
  const problemas = itens.filter((i) => i.nivel === 'problema').length;
  const atencao = itens.filter((i) => i.nivel === 'atencao').length;
  return {
    itens,
    nivel: problemas ? 'problema' : atencao ? 'atencao' : 'ok',
    resumo: problemas ? `${problemas} problema${problemas === 1 ? '' : 's'}` : atencao ? `${atencao} ponto${atencao === 1 ? '' : 's'} de atenção` : 'Tudo certo',
  };
}

module.exports = { montarStatus, formatarBytes, commitAtual };

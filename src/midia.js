const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Arquivos de mídia do chat (fotos/vídeos/áudios recebidos do cliente ou mandados pelo
// atendente) ficam em public/uploads, servidos como estáticos pelo Express — igual a
// public/img, public/css etc. Runtime data, como data/ e auth/, não entra no git.
const DIRETORIO_UPLOADS = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(DIRETORIO_UPLOADS)) fs.mkdirSync(DIRETORIO_UPLOADS, { recursive: true });

const EXTENSAO_POR_MIMETYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/webm': 'webm', // gravado direto no navegador (MediaRecorder) — ver public/js/fila-responder.js
  'application/pdf': 'pdf',
};

function tipoPorMimetype(mimetype) {
  const base = String(mimetype || '').split(';')[0].trim();
  if (base.startsWith('image/')) return 'imagem';
  if (base.startsWith('video/')) return 'video';
  if (base.startsWith('audio/')) return 'audio';
  return null;
}

/** Salva o buffer com um nome só nosso (nunca o nome que veio de fora) e devolve a URL pública. */
function salvarBufferDeMidia(buffer, mimetype) {
  const base = String(mimetype || '').split(';')[0].trim();
  const extensao = EXTENSAO_POR_MIMETYPE[base] || 'bin';
  const nomeArquivo = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${extensao}`;
  fs.writeFileSync(path.join(DIRETORIO_UPLOADS, nomeArquivo), buffer);
  return `/uploads/${nomeArquivo}`;
}

/**
 * Áudio mandado pro WhatsApp via Baileys precisa estar em ogg/opus de verdade — outros formatos
 * (webm do MediaRecorder do navegador, mp3, m4a, wav...) às vezes "enviam" sem erro nenhum do
 * nosso lado, mas não chegam de verdade no destinatário. Usa o ffmpeg do sistema (o Baileys já
 * depende dele por fora pra miniatura de vídeo, então já é esperado estar instalado). Se o
 * ffmpeg não estiver disponível, devolve o buffer original — melhor tentar mandar do jeito que
 * veio do que travar o envio inteiro.
 */
function converterParaOggOpus(buffer) {
  return new Promise((resolve) => {
    let processo;
    try {
      processo = spawn('ffmpeg', ['-i', 'pipe:0', '-c:a', 'libopus', '-f', 'ogg', 'pipe:1'], {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (erro) {
      console.error('ffmpeg não disponível pra converter áudio, mandando original:', erro.message);
      return resolve(buffer);
    }

    const pedacos = [];
    processo.stdout.on('data', (pedaco) => pedacos.push(pedaco));
    processo.on('error', (erro) => {
      console.error('ffmpeg não disponível pra converter áudio, mandando original:', erro.message);
      resolve(buffer);
    });
    processo.on('close', (codigo) => {
      if (codigo === 0 && pedacos.length > 0) resolve(Buffer.concat(pedacos));
      else {
        console.error(`ffmpeg saiu com código ${codigo} ao converter áudio, mandando original.`);
        resolve(buffer);
      }
    });
    processo.stdin.write(buffer);
    processo.stdin.end();
  });
}

module.exports = { DIRETORIO_UPLOADS, tipoPorMimetype, salvarBufferDeMidia, converterParaOggOpus };

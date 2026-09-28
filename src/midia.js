const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

module.exports = { DIRETORIO_UPLOADS, tipoPorMimetype, salvarBufferDeMidia };

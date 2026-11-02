const fs = require('fs');
const path = require('path');

// Onde cada instalação guarda os seus arquivos (E5: várias instalações, um código só).
// Com CHATDIGITAL_DADOS (ex.: /opt/chatdigital/clientes/novanet), tudo do cliente fica nessa pasta:
//   data/chatdigital.db (+ backups/), config/negocio.json, config/fluxo.json, auth*/ (WhatsApp), uploads/
// Sem ela, fica tudo na pasta do código, como sempre foi (a Nazagás de antes da E5 e o computador do
// desenvolvimento). As variáveis específicas (CHATDIGITAL_DB, _NEGOCIO, _FLUXO, _BACKUP_DIR) continuam
// valendo por cima.

const RAIZ_CODIGO = path.join(__dirname, '..');

function pastaDeDados() {
  return process.env.CHATDIGITAL_DADOS ? path.resolve(process.env.CHATDIGITAL_DADOS) : null;
}

function base() {
  return pastaDeDados() || RAIZ_CODIGO;
}

const arquivoDb = () => process.env.CHATDIGITAL_DB || path.join(base(), 'data', 'chatdigital.db');
const arquivoNegocio = () => process.env.CHATDIGITAL_NEGOCIO || path.join(base(), 'config', 'negocio.json');
const arquivoFluxo = () => process.env.CHATDIGITAL_FLUXO || path.join(base(), 'config', 'fluxo.json');
// pasta de login de um número do WhatsApp ("auth", "auth-numero-2"...)
const pastaAuth = (nome = 'auth') => path.join(base(), nome);
// fotos, áudios e documentos da conversa (servidos em /uploads)
const pastaUploads = () => (pastaDeDados() ? path.join(pastaDeDados(), 'uploads') : path.join(RAIZ_CODIGO, 'public', 'uploads'));

// Cliente novo: a pasta de dados começa com a configuração e o fluxo modelo de config/modelos/ (nunca
// editados). Não usa config/negocio.json nem config/fluxo.json da pasta do código: no servidor eles
// são os da Nazagás. Só copia o que ainda não existe.
function prepararPastaDeDados() {
  const dados = pastaDeDados();
  if (!dados) return;
  for (const [destino, modelo] of [
    [arquivoNegocio(), path.join(RAIZ_CODIGO, 'config', 'modelos', 'negocio.json')],
    [arquivoFluxo(), path.join(RAIZ_CODIGO, 'config', 'modelos', 'fluxo.json')],
  ]) {
    if (fs.existsSync(destino) || !fs.existsSync(modelo)) continue;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(modelo, destino);
  }
  fs.mkdirSync(pastaUploads(), { recursive: true });
}

module.exports = { RAIZ_CODIGO, pastaDeDados, arquivoDb, arquivoNegocio, arquivoFluxo, pastaAuth, pastaUploads, prepararPastaDeDados };

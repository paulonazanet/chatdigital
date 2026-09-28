const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// src/midia.js grava sempre em public/uploads (sem variável de ambiente pra apontar noutro
// lugar em teste) — os testes abaixo limpam os arquivos que criam logo depois de conferir.
const { tipoPorMimetype, salvarBufferDeMidia, converterParaOggOpus, DIRETORIO_UPLOADS } = require('../src/midia');

test('tipoPorMimetype reconhece imagem/vídeo/áudio e rejeita o resto', () => {
  assert.strictEqual(tipoPorMimetype('image/jpeg'), 'imagem');
  assert.strictEqual(tipoPorMimetype('image/png'), 'imagem');
  assert.strictEqual(tipoPorMimetype('video/mp4'), 'video');
  assert.strictEqual(tipoPorMimetype('audio/ogg; codecs=opus'), 'audio', 'deve ignorar parâmetros depois do ;');
  assert.strictEqual(tipoPorMimetype('application/pdf'), null);
  assert.strictEqual(tipoPorMimetype('text/plain'), null);
  assert.strictEqual(tipoPorMimetype(''), null);
  assert.strictEqual(tipoPorMimetype(undefined), null);

  console.log('OK: tipoPorMimetype aceita só imagem/vídeo/áudio');
});

test('salvarBufferDeMidia grava o arquivo de verdade e devolve uma URL pública em /uploads', () => {
  const buffer = Buffer.from('conteudo de teste');
  const url = salvarBufferDeMidia(buffer, 'image/png');

  assert.match(url, /^\/uploads\/.+\.png$/);

  const caminhoFisico = path.join(DIRETORIO_UPLOADS, path.basename(url));
  assert.ok(fs.existsSync(caminhoFisico), 'arquivo deve existir de verdade no disco');
  assert.deepStrictEqual(fs.readFileSync(caminhoFisico), buffer, 'conteúdo salvo deve ser idêntico ao buffer original');

  fs.unlinkSync(caminhoFisico);
  console.log('OK: salvarBufferDeMidia grava o arquivo e devolve a URL pública certa');
});

test('salvarBufferDeMidia nunca usa nome vindo de fora — dois arquivos do mesmo tipo não colidem', () => {
  const buffer = Buffer.from('a');
  const url1 = salvarBufferDeMidia(buffer, 'audio/mpeg');
  const url2 = salvarBufferDeMidia(buffer, 'audio/mpeg');

  assert.notStrictEqual(url1, url2, 'cada upload deve ganhar um nome único, mesmo com o mesmo conteúdo/tipo');

  fs.unlinkSync(path.join(DIRETORIO_UPLOADS, path.basename(url1)));
  fs.unlinkSync(path.join(DIRETORIO_UPLOADS, path.basename(url2)));
  console.log('OK: nomes de arquivo gerados nunca colidem');
});

test('converterParaOggOpus nunca rejeita — sem ffmpeg ou com áudio inválido, cai pro buffer original', async () => {
  const original = Buffer.from('não é um áudio de verdade, só bytes de teste');
  const resultado = await converterParaOggOpus(original);

  assert.ok(Buffer.isBuffer(resultado), 'sempre devolve um Buffer, nunca lança erro');
  // com bytes inválidos o ffmpeg (se existir) não consegue decodificar e a função cai pro
  // original — o importante aqui é não travar o envio, não garantir conversão de verdade
  // (isso exigiria um arquivo de áudio real de fixture, o que não vale o custo neste teste).
  assert.deepStrictEqual(resultado, original);

  console.log('OK: converterParaOggOpus nunca trava o envio, mesmo sem ffmpeg ou áudio inválido');
});

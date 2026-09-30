require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { carregarAtendenteLogado, exigirLogin, exigirPermissao } = require('./sessao');
const rotasAuth = require('./routes/auth');
const rotasPainel = require('./routes/painel');
const rotasAtendentes = require('./routes/atendentes');
const rotasSetores = require('./routes/setores');
const rotasFila = require('./routes/fila');
const rotasEventos = require('./routes/eventos');
const rotasFluxoEditor = require('./routes/fluxo');
const rotasConfiguracoes = require('./routes/configuracoes');

const app = express();

// Segredo que assina o cookie de login. Com um segredo conhecido (vazio, o valor de exemplo do
// .env.example ou curto), qualquer um consegue forjar o cookie e entrar como administrador — em
// produção (NODE_ENV=production) o sistema se recusa a subir assim; em desenvolvimento só avisa.
const EM_PRODUCAO = process.env.NODE_ENV === 'production';
const SEGREDO = process.env.SESSION_SECRET || '';
const SEGREDO_FRACO = SEGREDO.length < 32 || /^troque/i.test(SEGREDO);
if (SEGREDO_FRACO && EM_PRODUCAO) {
  console.error('ERRO: SESSION_SECRET ausente ou fraco no .env (mínimo 32 caracteres aleatórios). Gere um com: openssl rand -hex 32');
  process.exit(1);
}
if (SEGREDO_FRACO && !EM_PRODUCAO && !process.env.CHATDIGITAL_DB) { // (testes automáticos definem CHATDIGITAL_DB)
  console.warn('Aviso: SESSION_SECRET fraco — tudo bem em desenvolvimento, NUNCA em produção.');
}
// em produção o sistema fica atrás do Caddy (HTTPS) na mesma máquina: confia só nele pra saber
// que a conexão original era HTTPS (necessário pro cookie "secure")
if (EM_PRODUCAO) app.set('trust proxy', 'loopback');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(cookieParser(SEGREDO || 'segredo-so-para-desenvolvimento-local'));
app.use(carregarAtendenteLogado);

app.use(rotasAuth);
app.use('/painel/atendentes', exigirLogin, exigirPermissao('gerenciar_atendentes'), rotasAtendentes);
app.use('/painel/setores', exigirLogin, exigirPermissao('gerenciar_setores'), rotasSetores);
app.use('/painel/fila', exigirLogin, rotasFila);
app.use('/painel/eventos', exigirLogin, rotasEventos);
app.use('/painel/fluxo', exigirLogin, exigirPermissao('editar_fluxo'), rotasFluxoEditor);
app.use('/painel/configuracoes', exigirLogin, exigirPermissao('gerenciar_configuracoes'), rotasConfiguracoes);
app.use('/painel', exigirLogin, rotasPainel);

app.get('/', (req, res) => res.redirect(req.atendente ? '/painel' : '/login'));

if (require.main === module) {
  const porta = process.env.PORTA || 3000;
  app.listen(porta, () => console.log(`ChatDigital rodando em http://localhost:${porta}`));
}

module.exports = { app };

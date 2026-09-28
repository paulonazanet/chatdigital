require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { carregarAtendenteLogado, exigirLogin, exigirAdmin } = require('./sessao');
const rotasAuth = require('./routes/auth');
const rotasPainel = require('./routes/painel');
const rotasAtendentes = require('./routes/atendentes');
const rotasSetores = require('./routes/setores');
const rotasFila = require('./routes/fila');
const rotasEventos = require('./routes/eventos');
const rotasFluxoEditor = require('./routes/fluxo');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(cookieParser(process.env.SESSION_SECRET || 'troque-este-segredo-no-.env'));
app.use(carregarAtendenteLogado);

app.use(rotasAuth);
app.use('/painel/atendentes', exigirLogin, exigirAdmin, rotasAtendentes);
app.use('/painel/setores', exigirLogin, exigirAdmin, rotasSetores);
app.use('/painel/fila', exigirLogin, rotasFila);
app.use('/painel/eventos', exigirLogin, rotasEventos);
app.use('/painel/fluxo', exigirLogin, exigirAdmin, rotasFluxoEditor);
app.use('/painel', exigirLogin, rotasPainel);

app.get('/', (req, res) => res.redirect(req.atendente ? '/painel' : '/login'));

if (require.main === module) {
  const porta = process.env.PORTA || 3000;
  app.listen(porta, () => console.log(`ChatDigital rodando em http://localhost:${porta}`));
}

module.exports = { app };

// Menu lateral. No computador, o ☰ recolhe/expande (lembrado no navegador). No celular (até 760px),
// o menu vira uma gaveta: o ☰ abre e fecha, e tocar fora, apertar Esc ou escolher uma página fecha.
var celular = window.matchMedia('(max-width: 760px)');

function definirGaveta(aberta) {
  document.documentElement.classList.toggle('menu-aberto', aberta);
  var botao = document.getElementById('botao-recolher');
  if (botao && celular.matches) {
    botao.setAttribute('aria-expanded', aberta ? 'true' : 'false');
    botao.setAttribute('aria-label', aberta ? 'Fechar menu' : 'Abrir menu');
  }
}

document.addEventListener('click', function (evento) {
  if (evento.target.closest('#fundo-menu')) return definirGaveta(false);
  if (celular.matches && evento.target.closest('#menu-gaveta a')) return definirGaveta(false);
  var botao = evento.target.closest('#botao-recolher');
  if (!botao) return;
  if (celular.matches) return definirGaveta(!document.documentElement.classList.contains('menu-aberto'));
  var recolhido = document.documentElement.classList.toggle('menu-recolhido');
  try {
    localStorage.setItem('menuRecolhido', recolhido ? '1' : '0');
  } catch (e) {}
});

document.addEventListener('keydown', function (evento) {
  if (evento.key === 'Escape' && document.documentElement.classList.contains('menu-aberto')) definirGaveta(false);
});

// virou computador com a gaveta aberta (girou o tablet, por exemplo): fecha
celular.addEventListener('change', function () {
  definirGaveta(false);
});

// marca a página atual no menu (o endereço mais comprido que bate, pra /painel não ganhar de /painel/fila)
document.addEventListener('DOMContentLoaded', function () {
  var caminho = window.location.pathname.replace(/\/+$/, '') || '/';
  var melhor = null;
  document.querySelectorAll('.barra-lateral nav a').forEach(function (link) {
    var alvo = link.getAttribute('href').replace(/\/+$/, '');
    var bate = caminho === alvo || caminho.indexOf(alvo + '/') === 0;
    if (bate && (!melhor || alvo.length > melhor.getAttribute('href').length)) melhor = link;
  });
  if (melhor) melhor.setAttribute('aria-current', 'page');
  if (celular.matches) definirGaveta(false);
});

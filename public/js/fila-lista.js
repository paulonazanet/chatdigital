// Mantém o "há X min" e a cor da bolinha da fila andando sozinhos, sem recarregar a página — os
// limites de amarelo/vermelho vêm de Configurações (data-minutos-* na lista). Mesma regra de
// haQuanto/corDaBolinha em views/fila/lista.ejs, que faz o primeiro desenho no servidor.
(function () {
  var lista = document.querySelector('.fila-lista');
  if (!lista) return;

  var minutosAmarelo = Number(lista.getAttribute('data-minutos-amarelo')) || 0;
  var minutosVermelho = Number(lista.getAttribute('data-minutos-vermelho')) || 0;

  function minutosDesde(iso) {
    return (Date.now() - new Date(iso).getTime()) / 60000;
  }

  function haQuanto(iso) {
    var min = Math.max(0, Math.floor(minutosDesde(iso)));
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    if (min < 1440) return 'há ' + Math.floor(min / 60) + ' h';
    return 'há ' + Math.floor(min / 1440) + (min < 2880 ? ' dia' : ' dias');
  }

  function corDaBolinha(iso) {
    var min = minutosDesde(iso);
    if (min >= minutosVermelho) return 'vermelha';
    if (min >= minutosAmarelo) return 'amarela';
    return 'verde';
  }

  function atualizar() {
    lista.querySelectorAll('.item-tempo[data-desde]').forEach(function (el) {
      el.textContent = haQuanto(el.getAttribute('data-desde'));
    });
    lista.querySelectorAll('.bolinha[data-desde]').forEach(function (el) {
      el.className = 'bolinha bolinha-' + corDaBolinha(el.getAttribute('data-desde'));
    });
  }

  setInterval(atualizar, 30000);
})();

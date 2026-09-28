document.addEventListener('click', function (evento) {
  var botao = evento.target.closest('#botao-recolher');
  if (!botao) return;
  var recolhido = document.documentElement.classList.toggle('menu-recolhido');
  try {
    localStorage.setItem('menuRecolhido', recolhido ? '1' : '0');
  } catch (e) {}
});

/* =========================================================
   POKÉDEX ULTIMATE — HEADER-SCROLL.JS
   Esconde o cabeçalho ao rolar para baixo e traz de volta ao rolar
   para cima — comportamento comum em apps mobile, para o cabeçalho
   não ficar ocupando espaço da tela o tempo todo.
   ========================================================= */

(function () {
  'use strict';

  function init() {
    const header = document.querySelector('.header');
    if (!header) return;

    let lastScrollY = window.scrollY;
    let ticking = false;

    // Só reage depois que o usuário já passou da altura do próprio
    // cabeçalho, para não "piscar" logo no topo da página.
    function handleScroll() {
      const currentScrollY = window.scrollY;
      const scrolledPastHeader = currentScrollY > header.offsetHeight;
      const scrollingDown = currentScrollY > lastScrollY;

      if (scrolledPastHeader && scrollingDown) {
        header.classList.add('header-hidden');
      } else {
        header.classList.remove('header-hidden');
      }

      lastScrollY = currentScrollY <= 0 ? 0 : currentScrollY;
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(handleScroll);
        ticking = true;
      }
    }, { passive: true });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
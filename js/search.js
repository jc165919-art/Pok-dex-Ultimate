/* =========================================================
   POKÉDEX ULTIMATE — SEARCH.JS
   Busca com autocomplete no hero, integrado ao app.js via
   window.Pokedex.
   ========================================================= */

(function () {
  'use strict';

  function waitForPokedex(callback) {
    let attempts = 0;
    const maxAttempts = 80;

    function check() {
      const pokedex = window.Pokedex;
      const list = pokedex?.getMasterList?.();
      if (pokedex && Array.isArray(list) && list.length > 0) {
        callback();
        return;
      }

      if (attempts >= maxAttempts) {
        callback();
        return;
      }

      attempts += 1;
      setTimeout(check, 150);
    }

    check();
  }

  function initSearch() {
    const pokedex = window.Pokedex;
    if (!pokedex) return;

    const { debounce, formatId, formatPokemonName, applyFiltersFromSearch, openDetailModal, getMasterList, fuzzyMatch } = pokedex;

    const input = document.getElementById('searchPokemon');
    const button = document.getElementById('searchButton');
    const list = document.getElementById('autocompleteList');

    if (!input || !button || !list) return;

    // Atributos ARIA de combobox — permitem que leitores de tela anunciem
    // a lista de sugestões e qual item está ativo, como em qualquer campo
    // de autocomplete acessível.
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', 'autocompleteList');
    list.setAttribute('role', 'listbox');

    let activeIndex = -1;
    let currentMatches = [];

    function closeList() {
      list.classList.remove('open');
      list.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      activeIndex = -1;
      currentMatches = [];
    }

    function getMatches(term) {
      if (!term.trim()) return [];
      const master = getMasterList();
      return master
        .filter((p) => fuzzyMatch(term, p.name, p.id))
        .slice(0, 8);
    }

    function renderSuggestions(matches) {
      if (matches.length === 0) {
        closeList();
        return;
      }
      currentMatches = matches;
      list.innerHTML = matches.map((p, idx) => `
        <div class="autocomplete-item" role="option" id="ac-item-${p.id}" aria-selected="false" data-id="${p.id}" data-index="${idx}">
          <span>${formatPokemonName(p.name)}</span>
          <span class="ac-id">${formatId(p.id)}</span>
        </div>
      `).join('');
      list.classList.add('open');
      input.setAttribute('aria-expanded', 'true');

      Array.from(list.querySelectorAll('.autocomplete-item')).forEach((el) => {
        el.addEventListener('click', () => {
          const id = Number(el.dataset.id);
          input.value = formatPokemonName(matches[Number(el.dataset.index)].name);
          closeList();
          openDetailModal(id);
        });
      });
    }

    const debouncedSuggest = debounce((term) => {
      renderSuggestions(getMatches(term));
    }, 200);

    input.addEventListener('input', () => {
      debouncedSuggest(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (!list.classList.contains('open')) {
        if (e.key === 'Enter') runSearch();
        return;
      }
      const items = Array.from(list.querySelectorAll('.autocomplete-item'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(items.length - 1, activeIndex + 1);
        highlight(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(0, activeIndex - 1);
        highlight(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && currentMatches[activeIndex]) {
          const chosen = currentMatches[activeIndex];
          input.value = formatPokemonName(chosen.name);
          closeList();
          openDetailModal(chosen.id);
        } else {
          runSearch();
        }
      } else if (e.key === 'Escape') {
        closeList();
      }
    });

    function highlight(items) {
      items.forEach((el, idx) => {
        const isActive = idx === activeIndex;
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-selected', String(isActive));
      });
      if (activeIndex >= 0 && items[activeIndex]) {
        input.setAttribute('aria-activedescendant', items[activeIndex].id);
        items[activeIndex].scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function runSearch() {
      closeList();
      applyFiltersFromSearch(input.value);
      document.getElementById('pokedex').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    button.addEventListener('click', runSearch);

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box')) closeList();
    });
  }

  document.addEventListener('DOMContentLoaded', () => waitForPokedex(initSearch));
})();
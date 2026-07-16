/* =========================================================
   POKÉDEX ULTIMATE — APP.JS
   Consome a PokéAPI (https://pokeapi.co) em tempo real.
   ========================================================= */

(function () {
  'use strict';

  const API_BASE = 'https://pokeapi.co/api/v2';
  const PAGE_SIZE = 20;
  const FETCH_CONCURRENCY = 12;

  /* ---------- Traduções de tipo (PT-BR) ---------- */
  const TYPE_PT = {
    normal: 'Normal', fire: 'Fogo', water: 'Água', grass: 'Planta',
    electric: 'Elétrico', ice: 'Gelo', fighting: 'Lutador', poison: 'Venenoso',
    ground: 'Terra', flying: 'Voador', psychic: 'Psíquico', bug: 'Inseto',
    rock: 'Pedra', ghost: 'Fantasma', dragon: 'Dragão', dark: 'Sombrio',
    steel: 'Aço', fairy: 'Fada'
  };

  /* ---------- Faixas de geração por número de Pokédex nacional ---------- */
  const GENERATIONS = {
    kanto: { label: 'Kanto', range: [1, 151] },
    johto: { label: 'Johto', range: [152, 251] },
    hoenn: { label: 'Hoenn', range: [252, 386] },
    sinnoh: { label: 'Sinnoh', range: [387, 493] },
    unova: { label: 'Unova', range: [494, 649] },
    kalos: { label: 'Kalos', range: [650, 721] },
    alola: { label: 'Alola', range: [722, 809] },
    galar: { label: 'Galar', range: [810, 905] },
    paldea: { label: 'Paldea', range: [906, 1025] }
  };

  /* ---------- IDs conhecidos de lendários/míticos (dados de jogo, fixos) ---------- */
  const LEGENDARY_IDS = new Set([
    144,145,146,150,243,244,245,249,250,377,378,379,380,381,382,383,384,
    480,481,482,483,484,485,486,487,488,638,639,640,641,642,643,644,645,646,
    716,717,718,772,773,785,786,787,788,789,790,791,792,800,888,889,890,891,
    892,894,895,896,897,898,905,1001,1002,1003,1004,1007,1008,1014,1015,1016,1017
  ]);
  const MYTHICAL_IDS = new Set([
    151,251,385,386,489,490,491,492,493,494,647,648,649,719,720,721,801,802,
    807,808,809,893,1025
  ]);

  const STORAGE = {
    favorites: 'pokedex_favorites_v1',
    theme: 'pokedex_theme_v1',
    trainer: 'pokedex_trainer_v1',
    currentAccount: 'pokedex_current_account_v1',
    accounts: 'pokedex_accounts_v1',
    cache: 'pokedex_cache_v1',
    filters: 'pokedex_filters_v1',
    googleClientId: 'pokedex_google_client_id_v1',
    oneTapDismissed: 'pokedex_onetap_dismissed_v1'
  };

  /* =========================================================
     ESTADO
     ========================================================= */
  const state = {
    masterList: [],       // { id, name, url }
    filtered: [],         // subconjunto atual (após filtros/busca)
    page: 1,
    filters: { type: '', generation: '', rarity: '', order: 'number' },
    searchTerm: '',
    favorites: new Set(safeParseFavorites()),
    currentAccountEmail: '',
    ranking: {
      attack: null, defense: null, speed: null, hp: null
    },
    // Token incrementado a cada nova chamada de applyFilters/renderPage.
    // Uma operação assíncrona em andamento só pode aplicar seu resultado
    // se o token capturado no início ainda for o mais recente — isso evita
    // que uma resposta antiga (ex: filtro anterior, mais lento) sobrescreva
    // um resultado mais novo quando o usuário troca filtros rapidamente.
    filterToken: 0,
    pageToken: 0
  };

  function safeParseFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE.favorites) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      console.warn('Lista de favoritos corrompida no localStorage, reiniciando.', e);
      return [];
    }
  }

  function loadPersistedFilters() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE.filters) || 'null');
      if (raw && typeof raw === 'object') {
        state.filters = {
          type: raw.type || '',
          generation: raw.generation || '',
          rarity: raw.rarity || '',
          order: raw.order || 'number'
        };
      }
    } catch (e) {
      // ignora filtros corrompidos
    }
  }

  function persistFilters() {
    try {
      localStorage.setItem(STORAGE.filters, JSON.stringify(state.filters));
    } catch (e) { /* localStorage indisponível — não é crítico */ }
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function safeParseAccounts() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE.accounts) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (e) {
      return {};
    }
  }

  function persistAccounts(accounts) {
    try {
      localStorage.setItem(STORAGE.accounts, JSON.stringify(accounts));
    } catch (e) { /* ignora */ }
  }

  function getStoredAccount(email) {
    return safeParseAccounts()[normalizeEmail(email)] || null;
  }

  function saveStoredAccount(account) {
    const email = normalizeEmail(account.email);
    if (!email) return;
    const accounts = safeParseAccounts();
    accounts[email] = account;
    persistAccounts(accounts);
  }

  function clearCurrentAccount() {
    state.currentAccountEmail = '';
    try { localStorage.removeItem(STORAGE.currentAccount); } catch (e) { /* ignora */ }
  }

  function setCurrentAccount(email) {
    state.currentAccountEmail = normalizeEmail(email);
    try { localStorage.setItem(STORAGE.currentAccount, state.currentAccountEmail); } catch (e) { /* ignora */ }
  }

  function updateAccountFavorites() {
    if (!state.currentAccountEmail) return;
    const accounts = safeParseAccounts();
    const account = accounts[state.currentAccountEmail];
    if (!account) return;
    account.favorites = Array.from(state.favorites);
    persistAccounts(accounts);
  }

  function loadAccountFavorites() {
    if (!state.currentAccountEmail) return;
    const account = getStoredAccount(state.currentAccountEmail);
    if (!account || !Array.isArray(account.favorites)) return;
    state.favorites = new Set(account.favorites);
  }

  const detailCache = new Map(); // id -> detail object simplificado
  const typeRelationCache = new Map(); // type name -> damage_relations
  const evolutionCache = new Map(); // species id -> lista de estágios [{id,name}]

  /* =========================================================
     DOM
     ========================================================= */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const dom = {
    loadingOverlay: $('#loadingOverlay'),
    loadingText: $('#loadingText'),
    toastContainer: $('#toastContainer'),
    themeButton: $('#themeButton'),
    randomButton: $('#randomButton'),
    editProfileButton: $('#editProfileButton'),
    profileName: $('#profileName'),
    profileLevel: $('#profileLevel'),
    totalPokemon: $('#totalPokemon'),
    favoriteCount: $('#favoriteCount'),
    typeSelect: $('#type'),
    generationSelect: $('#generation'),
    raritySelect: $('#rarity'),
    orderSelect: $('#order'),
    filterReset: $('#filterReset'),
    grid: $('#pokemonGrid'),
    emptyState: $('#emptyState'),
    pagination: $('#pagination'),
    favoritesGrid: $('#favoritesGrid'),
    favoritesEmpty: $('#favoritesEmpty'),
    rankingSubtitle: $('#rankingSubtitle'),
    compareOne: $('#pokemonOne'),
    compareTwo: $('#pokemonTwo'),
    compareButton: $('#compareButton'),
    compareResult: $('#compareResult'),
    modal: $('#detailModal'),
    modalContent: $('#modalContent'),
    modalClose: $('#modalClose'),
    loginButton: $('#loginButton'),
    loginModal: $('#loginModal'),
    loginModalClose: $('#loginModalClose'),
    loginEmail: $('#loginEmail'),
    loginPassword: $('#loginPassword'),
    loginSubmitButton: $('#loginSubmitButton'),
    loginCreateButton: $('#loginCreateButton')
  };

  /* =========================================================
     UTILITÁRIOS
     ========================================================= */
  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function formatId(id) {
    return '#' + String(id).padStart(4, '0');
  }

  function formatPokemonName(rawName) {
    // Casos especiais conhecidos
    const special = {
      'nidoran-f': 'Nidoran ♀',
      'nidoran-m': 'Nidoran ♂',
      'mr-mime': 'Mr. Mime',
      'mime-jr': 'Mime Jr.',
      'mr-rime': 'Mr. Rime',
      'type-null': 'Type: Null',
      'ho-oh': 'Ho-Oh',
      'porygon-z': 'Porygon-Z',
      'jangmo-o': 'Jangmo-o',
      'hakamo-o': 'Hakamo-o',
      'kommo-o': 'Kommo-o'
    };
    if (special[rawName]) return special[rawName];
    return rawName
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function getRarity(id, baseExperience) {
    if (MYTHICAL_IDS.has(id)) return { key: 'mitico', label: 'Mítico' };
    if (LEGENDARY_IDS.has(id)) return { key: 'lendario', label: 'Lendário' };
    if (baseExperience >= 170) return { key: 'raro', label: 'Raro' };
    if (baseExperience >= 100) return { key: 'incomum', label: 'Incomum' };
    return { key: 'comum', label: 'Comum' };
  }

  function getGenerationForId(id) {
    for (const key in GENERATIONS) {
      const [min, max] = GENERATIONS[key].range;
      if (id >= min && id <= max) return key;
    }
    return null;
  }

  function showToast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    dom.toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      el.style.transition = 'opacity .3s ease, transform .3s ease';
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function idFromUrl(url) {
    const match = url.match(/\/(\d+)\/?$/);
    return match ? Number(match[1]) : null;
  }

  function statLabel(key) {
    const map = { hp: 'HP', attack: 'Ataque', defense: 'Defesa', speed: 'Velocidade' };
    return map[key] || key;
  }

  // Remove acentos, espaços e hífens para tornar a busca mais tolerante
  // (ex: "charizard", "Charizard", "chari zard" e "cháriz-ard" batem igual)
  function normalizeStr(str) {
    return String(str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[\s-]+/g, '');
  }

  // Distância de edição simples — usada para aceitar pequenos erros de
  // digitação na busca (ex: "pikachu" ainda encontra com "pikaxu")
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const prev = Array(b.length + 1).fill(0).map((_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      prev.splice(0, prev.length, ...row);
    }
    return prev[b.length];
  }

  // Verifica se um termo de busca "combina" com um nome, aceitando:
  // - substring em qualquer posição (após normalizar acentos/espaços)
  // - número do Pokédex
  // - pequenos erros de digitação (distância de edição tolerante ao tamanho do termo)
  function fuzzyMatch(term, name, id) {
    const cleanTerm = normalizeStr(term);
    if (!cleanTerm) return true;
    if (String(id) === cleanTerm) return true;

    const cleanName = normalizeStr(name);
    if (cleanName.includes(cleanTerm)) return true;

    // tolerância cresce com o tamanho do termo (erros maiores permitidos em nomes longos)
    const tolerance = cleanTerm.length <= 4 ? 1 : cleanTerm.length <= 8 ? 2 : 3;
    if (cleanTerm.length < 3) return false; // termos muito curtos não usam fuzzy, só substring

    // compara contra o nome inteiro e também contra prefixos do mesmo tamanho
    if (levenshtein(cleanTerm, cleanName.slice(0, cleanTerm.length + tolerance)) <= tolerance) return true;
    if (levenshtein(cleanTerm, cleanName) <= tolerance) return true;
    return false;
  }

  /* =========================================================
     PERSISTÊNCIA DE CACHE (localStorage) — acelera visitas futuras
     ========================================================= */
  function loadPersistedCache() {
    try {
      const raw = localStorage.getItem(STORAGE.cache);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      Object.keys(parsed).forEach((id) => detailCache.set(Number(id), parsed[id]));
    } catch (e) {
      console.warn('Cache local inválido, ignorando.', e);
    }
  }

  const persistCacheDebounced = debounce(() => {
    try {
      const obj = {};
      detailCache.forEach((value, key) => { obj[key] = value; });
      localStorage.setItem(STORAGE.cache, JSON.stringify(obj));
    } catch (e) {
      // localStorage cheio ou indisponível — não é crítico
    }
  }, 1500);

  /* =========================================================
     CAMADA DE DADOS — PokéAPI
     ========================================================= */
  async function fetchJson(url, timeoutMs = 10000, retries = 2) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });

      // 429 (rate limit) e 5xx são erros transitórios: vale a pena tentar
      // de novo com backoff exponencial antes de desistir. Isso evita que
      // picos de uso (ex: ordenar por atributo, que dispara dezenas de
      // requisições em paralelo) derrubem a Pokédex por um erro passageiro.
      if ((res.status === 429 || res.status >= 500) && retries > 0) {
        clearTimeout(timeoutId);
        const retryAfterHeader = Number(res.headers.get('Retry-After'));
        const backoffMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : (3 - retries) * 600 + Math.random() * 300;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return fetchJson(url, timeoutMs, retries - 1);
      }

      if (!res.ok) throw new Error(`Falha ao buscar ${url} (status ${res.status})`);
      return await res.json();
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error(`Tempo esgotado ao buscar ${url}`);
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function fetchMasterList() {
    const data = await fetchJson(`${API_BASE}/pokemon-species?limit=1350&offset=0`);
    return data.results
      .map((item) => ({ id: idFromUrl(item.url), name: item.name, url: item.url }))
      .filter((p) => p.id)
      .sort((a, b) => a.id - b.id);
  }

  async function fetchPokemonDetail(idOrName) {
    const key = typeof idOrName === 'string' ? idOrName.toLowerCase().trim() : idOrName;
    if (detailCache.has(key)) return detailCache.get(key);

    const data = await fetchJson(`${API_BASE}/pokemon/${key}`);
    const stats = {};
    data.stats.forEach((s) => {
      const name = s.stat.name === 'special-attack' ? 'attack' :
                   s.stat.name === 'special-defense' ? 'defense' : s.stat.name;
      if (!(name in stats) || s.base_stat > stats[name]) stats[name] = s.base_stat;
    });

    const detail = {
      id: data.id,
      name: data.name,
      displayName: formatPokemonName(data.name),
      types: data.types.map((t) => t.type.name),
      sprite: data.sprites.other?.['official-artwork']?.front_default || data.sprites.front_default,
      baseExperience: data.base_experience || 0,
      heightM: data.height / 10,
      weightKg: data.weight / 10,
      abilities: data.abilities.map((a) => a.ability.name),
      speciesUrl: data.species?.url || null,
      stats: {
        hp: stats.hp || 0,
        attack: stats.attack || 0,
        defense: stats.defense || 0,
        speed: stats.speed || 0
      }
    };
    detail.rarity = getRarity(detail.id, detail.baseExperience);
    detail.generationKey = getGenerationForId(detail.id);

    detailCache.set(data.id, detail);
    detailCache.set(data.name, detail);
    persistCacheDebounced();
    updateRanking(detail);
    return detail;
  }

  // Busca com limite de concorrência para não sobrecarregar a API
  async function fetchDetailsBatch(idsOrNames, onProgress) {
    const results = new Array(idsOrNames.length);
    let cursor = 0;
    let done = 0;

    async function worker() {
      while (cursor < idsOrNames.length) {
        const index = cursor++;
        try {
          results[index] = await fetchPokemonDetail(idsOrNames[index]);
        } catch (e) {
          results[index] = null;
        }
        done++;
        if (onProgress) onProgress(done, idsOrNames.length);
      }
    }

    const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, idsOrNames.length) }, worker);
    await Promise.all(workers);
    return results.filter(Boolean);
  }

  async function fetchPokemonListByType(typeName) {
    const data = await fetchJson(`${API_BASE}/type/${typeName}`);
    return data.pokemon
      .map((p) => ({ id: idFromUrl(p.pokemon.url), name: p.pokemon.name }))
      .filter((p) => p.id);
  }

  // Busca as relações de dano (fraquezas/resistências/imunidades) de um tipo,
  // com cache — usado para montar o painel de efetividade no modal.
  async function fetchTypeRelations(typeName) {
    if (typeRelationCache.has(typeName)) return typeRelationCache.get(typeName);
    const data = await fetchJson(`${API_BASE}/type/${typeName}`);
    const relations = data.damage_relations;
    typeRelationCache.set(typeName, relations);
    return relations;
  }

  // Combina as relações de dano de 1 ou 2 tipos num multiplicador final
  // por tipo atacante (ex.: 4x, 2x, 1x, 0.5x, 0.25x, 0x), do jeito que o
  // jogo calcula: os multiplicadores de cada tipo defensivo se multiplicam.
  async function computeTypeEffectiveness(types) {
    const multipliers = {};
    Object.keys(TYPE_PT).forEach((t) => { multipliers[t] = 1; });

    for (const defType of types) {
      let relations;
      try {
        relations = await fetchTypeRelations(defType);
      } catch (e) {
        continue; // se uma relação falhar, segue com o que já temos
      }
      relations.double_damage_from.forEach((t) => { multipliers[t.name] *= 2; });
      relations.half_damage_from.forEach((t) => { multipliers[t.name] *= 0.5; });
      relations.no_damage_from.forEach((t) => { multipliers[t.name] *= 0; });
    }
    return multipliers;
  }

  // Busca e simplifica a cadeia de evolução de um Pokémon a partir da sua
  // espécie. O resultado é uma lista plana de estágios (a PokéAPI modela
  // ramificações, mas para exibição seguimos sempre o primeiro caminho).
  async function fetchEvolutionChain(speciesUrl, speciesId) {
    if (!speciesUrl) return [];
    if (evolutionCache.has(speciesId)) return evolutionCache.get(speciesId);

    const species = await fetchJson(speciesUrl);
    if (!species.evolution_chain?.url) return [];
    const chainData = await fetchJson(species.evolution_chain.url);

    const stages = [];
    let node = chainData.chain;
    while (node) {
      const id = idFromUrl(node.species.url);
      stages.push({ id, name: node.species.name });
      node = node.evolves_to && node.evolves_to.length > 0 ? node.evolves_to[0] : null;
    }

    // Guarda o resultado sob o id de todos os estágios da cadeia, já que
    // qualquer um deles pode ser o próximo Pokémon consultado.
    stages.forEach((s) => evolutionCache.set(s.id, stages));
    return stages;
  }

  /* =========================================================
     RANKING (constrói-se conforme os Pokémon são explorados)
     ========================================================= */
  function updateRanking(detail) {
    let changed = false;
    ['attack', 'defense', 'speed', 'hp'].forEach((key) => {
      const current = state.ranking[key];
      if (!current || detail.stats[key] > current.stats[key]) {
        state.ranking[key] = detail;
        changed = true;
      }
    });
    if (changed) renderRanking();
  }

  function renderRanking() {
    const map = {
      attack: '#rankAttack', defense: '#rankDefense',
      speed: '#rankSpeed', hp: '#rankHp'
    };
    let exploredCount = 0;
    detailCache.forEach((_, key) => { if (typeof key === 'number') exploredCount++; });

    Object.keys(map).forEach((statKey) => {
      const card = $(map[statKey]);
      const p = state.ranking[statKey];
      if (!card || !p) return;
      card.innerHTML = `
        <h3>Maior ${statLabel(statKey)}</h3>
        <img src="${p.sprite}" alt="${p.displayName}" loading="lazy">
        <p>${p.displayName}</p>
        <span class="rank-value">${p.stats[statKey]} pts · ${formatId(p.id)}</span>
      `;
    });

    if (dom.rankingSubtitle) {
      dom.rankingSubtitle.textContent = exploredCount > 0
        ? `Com base em ${exploredCount} Pokémon já explorados na Pokédex.`
        : 'Veja os destaques da Pokédex.';
    }
  }

  /* =========================================================
     FILTROS E BUSCA
     ========================================================= */
  async function applyFilters() {
    const myToken = ++state.filterToken;
    const isStale = () => myToken !== state.filterToken;

    const { type, generation, rarity } = state.filters;
    const term = state.searchTerm.trim().toLowerCase();

    let candidates = state.masterList;

    // Busca por nome/número tem prioridade e reduz a lista rapidamente.
    // Agora tolera acentos, espaços/hífens diferentes e pequenos erros de digitação.
    if (term) {
      candidates = candidates.filter((p) => fuzzyMatch(term, p.name, p.id));
    }

    // Filtro por geração — direto pela faixa de IDs, sem chamadas extras
    if (generation && GENERATIONS[generation]) {
      const [min, max] = GENERATIONS[generation].range;
      candidates = candidates.filter((p) => p.id >= min && p.id <= max);
    }

    // Filtro por tipo — usa o endpoint /type/{name} e faz interseção
    if (type) {
      setLoadingMessage(`Filtrando por tipo ${TYPE_PT[type] || type}...`);
      toggleGridLoading(true);
      try {
        const typeList = await fetchPokemonListByType(type);
        if (isStale()) return; // um filtro mais recente já foi disparado
        const typeIds = new Set(typeList.map((p) => p.id));
        candidates = candidates.filter((p) => typeIds.has(p.id));
      } catch (e) {
        if (isStale()) return;
        showToast('Não foi possível carregar esse tipo agora. Tente novamente.', 'error');
        toggleGridLoading(false);
        return;
      }
    }

    // Filtro por raridade lendário/mítico não precisa de fetch (IDs fixos)
    if (rarity === 'lendario') {
      candidates = candidates.filter((p) => LEGENDARY_IDS.has(p.id));
    } else if (rarity === 'mitico') {
      candidates = candidates.filter((p) => MYTHICAL_IDS.has(p.id));
    } else if (rarity === 'comum' || rarity === 'incomum' || rarity === 'raro') {
      // Precisa de base_experience — busca detalhes do conjunto candidato
      toggleGridLoading(true);
      setLoadingMessage('Avaliando raridade de cada Pokémon...');
      const details = await fetchDetailsBatch(
        candidates.map((p) => p.id),
        (done, total) => setLoadingMessage(`Avaliando raridade... ${done}/${total}`)
      );
      if (isStale()) return;
      const validIds = new Set(
        details.filter((d) => d.rarity.key === rarity).map((d) => d.id)
      );
      candidates = candidates.filter((p) => validIds.has(p.id));
    }

    if (isStale()) return;
    toggleGridLoading(false);
    state.filtered = candidates;
    state.page = 1;
    await sortFiltered(myToken, isStale);
    if (isStale()) return;
    renderPage();
  }

  async function sortFiltered(myToken, isStale) {
    const { order } = state.filters;
    if (order === 'number') {
      state.filtered.sort((a, b) => a.id - b.id);
      return;
    }
    if (order === 'name') {
      state.filtered.sort((a, b) => a.name.localeCompare(b.name));
      return;
    }
    // Ordenar por atributo requer os detalhes de cada Pokémon do conjunto filtrado.
    // Para listas muito grandes (ex: sem nenhum filtro aplicado), buscar todos os
    // detalhes de uma vez seria centenas/milhares de requisições à PokeAPI. Como
    // o resultado é ordenado por relevância decrescente, ordenamos com base nos
    // dados já disponíveis em cache e só buscamos os detalhes que faltam para
    // as primeiras páginas — o restante é buscado sob demanda ao paginar.
    const statKey = order; // attack | defense | speed | hp
    const PRIORITY_FETCH_LIMIT = 200;
    const list = state.filtered;
    const known = [];
    const unknown = [];
    list.forEach((p) => {
      const cached = detailCache.get(p.id);
      if (cached) known.push(p); else unknown.push(p);
    });

    const toFetch = unknown.slice(0, Math.max(0, PRIORITY_FETCH_LIMIT - known.length));
    if (toFetch.length > 0) {
      toggleGridLoading(true);
      setLoadingMessage(`Ordenando por ${statLabel(statKey)}...`);
      await fetchDetailsBatch(
        toFetch.map((p) => p.id),
        (done, total) => { if (!isStale || !isStale()) setLoadingMessage(`Ordenando por ${statLabel(statKey)}... ${done}/${total}`); }
      );
      toggleGridLoading(false);
    }
    if (isStale && isStale()) return;

    list.sort((a, b) => {
      const da = detailCache.get(a.id);
      const db = detailCache.get(b.id);
      const va = da ? da.stats[statKey] : -1;
      const vb = db ? db.stats[statKey] : -1;
      return vb - va;
    });

    if (unknown.length > PRIORITY_FETCH_LIMIT - known.length) {
      showToast('Lista grande: os Pokémon ainda não vistos serão ordenados conforme forem carregados nas próximas páginas.', 'info');
    }
  }

  function toggleGridLoading(isLoading) {
    if (!dom.grid) return;
    if (isLoading) {
      dom.grid.innerHTML = Array.from({ length: 8 }, () => `
        <div class="pokemon-card skeleton">
          <div class="skeleton-block" style="height:150px;margin-bottom:16px;"></div>
          <div class="skeleton-block" style="height:20px;width:60%;margin-bottom:10px;"></div>
          <div class="skeleton-block" style="height:14px;width:40%;"></div>
        </div>
      `).join('');
      return;
    }
    if (dom.grid.querySelector('.skeleton')) {
      dom.grid.innerHTML = '';
    }
  }

  function setLoadingMessage(msg) {
    if (dom.loadingText && !dom.loadingOverlay.hidden) dom.loadingText.textContent = msg;
  }

  /* =========================================================
     RENDERIZAÇÃO DA GRADE / PAGINAÇÃO
     ========================================================= */
  async function renderPage() {
    const myToken = ++state.pageToken;
    const isStale = () => myToken !== state.pageToken;

    const total = state.filtered.length;
    dom.emptyState.hidden = total !== 0;
    dom.grid.style.display = total === 0 ? 'none' : 'grid';

    if (total === 0) {
      dom.grid.innerHTML = '';
      renderPagination(0);
      return;
    }

    const start = (state.page - 1) * PAGE_SIZE;
    const pageItems = state.filtered.slice(start, start + PAGE_SIZE);

    toggleGridLoading(true);
    try {
      const details = await fetchDetailsBatch(pageItems.map((p) => p.id));
      if (isStale()) return; // usuário já navegou para outra página/filtro
      // mantém a ordem original da página
      const byId = new Map(details.map((d) => [d.id, d]));
      const ordered = pageItems.map((p) => byId.get(p.id)).filter(Boolean);

      dom.grid.innerHTML = ordered.map(cardTemplate).join('');
      wireCardButtons();
      renderPagination(total);
    } catch (e) {
      if (isStale()) return;
      console.error('Erro ao renderizar a página:', e);
      dom.grid.innerHTML = '<p class="compare-error">Não foi possível carregar os Pokémon agora. Verifique sua conexão e tente novamente.</p>';
      dom.grid.style.display = 'block';
      renderPagination(0);
    } finally {
      if (!isStale()) toggleGridLoading(false);
    }
  }

  function cardTemplate(p) {
    const isFav = state.favorites.has(p.id);
    return `
      <article class="pokemon-card" data-id="${p.id}">
        <span class="rarity-badge rarity-${p.rarity.key}">${p.rarity.label}</span>
        <div class="card-id">${formatId(p.id)}</div>
        <img src="${p.sprite}" alt="${p.displayName}" loading="lazy">
        <h3>${p.displayName}</h3>
        <div class="type-badges">
          ${p.types.map((t) => `<span class="type type-${t}">${TYPE_PT[t] || t}</span>`).join('')}
        </div>
        <p class="card-flavor">Altura: ${p.heightM.toFixed(1)} m · Peso: ${p.weightKg.toFixed(1)} kg</p>
        <div class="card-buttons">
          <button type="button" class="details-btn" data-action="details" data-id="${p.id}">Detalhes</button>
          <button type="button" class="favorite-btn ${isFav ? 'is-favorite' : ''}" data-action="favorite" data-id="${p.id}">
            ${isFav ? '★ Favorito' : '☆ Favoritar'}
          </button>
        </div>
      </article>
    `;
  }

  function wireCardButtons() {
    $$('#pokemonGrid [data-action="details"]').forEach((btn) => {
      btn.addEventListener('click', () => openDetailModal(Number(btn.dataset.id)));
    });
    $$('#pokemonGrid [data-action="favorite"]').forEach((btn) => {
      btn.addEventListener('click', () => toggleFavorite(Number(btn.dataset.id)));
    });
  }

  function renderPagination(total) {
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = state.page;
    let html = '';

    html += `<button type="button" data-page="prev" ${page === 1 ? 'disabled' : ''}>Anterior</button>`;

    const addBtn = (n) => {
      html += `<button type="button" data-page="${n}" class="${n === page ? 'active' : ''}">${n}</button>`;
    };
    const addDots = () => { html += `<span class="dots">…</span>`; };

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) addBtn(i);
    } else {
      addBtn(1);
      if (page > 3) addDots();
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) addBtn(i);
      if (page < totalPages - 2) addDots();
      addBtn(totalPages);
    }

    html += `<button type="button" data-page="next" ${page === totalPages ? 'disabled' : ''}>Próximo</button>`;
    dom.pagination.innerHTML = html;

    $$('#pagination [data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.page;
        if (value === 'prev') state.page = Math.max(1, state.page - 1);
        else if (value === 'next') state.page = Math.min(totalPages, state.page + 1);
        else state.page = Number(value);
        renderPage();
        $('#pokedex').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* =========================================================
     FAVORITOS
     ========================================================= */
  function saveFavorites() {
    try {
      localStorage.setItem(STORAGE.favorites, JSON.stringify(Array.from(state.favorites)));
    } catch (e) { /* ignora */ }
    updateAccountFavorites();
  }

  async function toggleFavorite(id) {
    if (state.favorites.has(id)) {
      state.favorites.delete(id);
      showToast('Removido dos favoritos.', 'info');
    } else {
      state.favorites.add(id);
      showToast('Adicionado aos favoritos!', 'success');
    }
    saveFavorites();
    dom.favoriteCount.textContent = state.favorites.size;
    renderPage();
    renderFavorites();
    syncModalFavoriteButton(id);
  }

  async function renderFavorites() {
    dom.favoriteCount.textContent = state.favorites.size;
    if (state.favorites.size === 0) {
      dom.favoritesGrid.innerHTML = '';
      dom.favoritesEmpty.style.display = 'block';
      return;
    }
    dom.favoritesEmpty.style.display = 'none';
    const ids = Array.from(state.favorites);
    const details = await fetchDetailsBatch(ids);
    dom.favoritesGrid.innerHTML = details.map(cardTemplate).join('');
    $$('#favoritesGrid [data-action="details"]').forEach((btn) => {
      btn.addEventListener('click', () => openDetailModal(Number(btn.dataset.id)));
    });
    $$('#favoritesGrid [data-action="favorite"]').forEach((btn) => {
      btn.addEventListener('click', () => toggleFavorite(Number(btn.dataset.id)));
    });
  }

  /* =========================================================
     MODAL DE DETALHES
     ========================================================= */
  let lastFocusedBeforeModal = null;
  let modalRequestToken = 0;

  async function openDetailModal(id) {
    // Guarda o elemento que tinha foco (o botão "Detalhes" clicado) para
    // devolver o foco a ele ao fechar — evita que o teclado "perca" o
    // usuário no topo da página depois de fechar o modal.
    lastFocusedBeforeModal = document.activeElement;
    const myToken = ++modalRequestToken;
    dom.modal.hidden = false;
    dom.modalContent.innerHTML = '<div class="loader" style="margin:40px auto;"></div>';
    try {
      const p = await fetchPokemonDetail(id);
      if (myToken !== modalRequestToken) return;
      dom.modalContent.innerHTML = detailModalTemplate(p);
      const favBtn = $('#modalFavoriteBtn');
      if (favBtn) {
        favBtn.addEventListener('click', () => toggleFavorite(p.id));
      }
      dom.modalClose.focus();
      loadEffectivenessPanel(p, myToken);
      loadEvolutionPanel(p, myToken);
    } catch (e) {
      if (myToken !== modalRequestToken) return;
      dom.modalContent.innerHTML = '<p class="compare-error">Não foi possível carregar os detalhes agora.</p>';
      dom.modalClose.focus();
    }
  }

  // Painel de efetividade de tipo é carregado à parte (requer chamadas
  // extras ao endpoint /type) para não atrasar a abertura inicial do modal.
  async function loadEffectivenessPanel(p, myToken) {
    const container = $('#effectivenessPanel');
    if (!container) return;
    try {
      const multipliers = await computeTypeEffectiveness(p.types);
      if (myToken !== modalRequestToken) return;
      const relevant = Object.entries(multipliers)
        .filter(([, mult]) => mult !== 1)
        .sort((a, b) => b[1] - a[1]);

      if (relevant.length === 0) {
        container.innerHTML = '<p class="evolution-empty">Nenhuma fraqueza ou resistência notável.</p>';
        return;
      }

      container.innerHTML = `
        <div class="effectiveness-grid">
          ${relevant.map(([typeName, mult]) => {
            const cls = mult === 0 ? 'mult-immune' : mult > 1 ? 'mult-weak' : 'mult-resist';
            const label = mult === 0 ? 'Imune' : `${mult}×`;
            return `
              <div class="effectiveness-item">
                <span class="type small type-${typeName}">${TYPE_PT[typeName] || typeName}</span>
                <span class="mult ${cls}">${label}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } catch (e) {
      if (myToken !== modalRequestToken) return;
      container.innerHTML = '<p class="evolution-empty">Não foi possível calcular a efetividade agora.</p>';
    }
  }

  // Painel de cadeia de evolução, também carregado à parte.
  async function loadEvolutionPanel(p, myToken) {
    const container = $('#evolutionPanel');
    if (!container) return;
    if (!p.speciesUrl) {
      container.innerHTML = '<p class="evolution-empty">Cadeia de evolução indisponível.</p>';
      return;
    }
    try {
      const stages = await fetchEvolutionChain(p.speciesUrl, p.id);
      if (myToken !== modalRequestToken) return;
      if (stages.length <= 1) {
        container.innerHTML = '<p class="evolution-empty">Este Pokémon não evolui.</p>';
        return;
      }
      // Busca sprites simplificados de cada estágio via cache/detail fetch
      const details = await fetchDetailsBatch(stages.map((s) => s.id));
      if (myToken !== modalRequestToken) return;
      const byId = new Map(details.map((d) => [d.id, d]));

      container.innerHTML = `
        <div class="evolution-row">
          ${stages.map((s, idx) => {
            const d = byId.get(s.id);
            const isCurrent = s.id === p.id;
            const node = `
              <div class="evolution-node ${isCurrent ? 'current' : ''}" data-id="${s.id}">
                <img src="${d ? d.sprite : ''}" alt="${formatPokemonName(s.name)}" loading="lazy">
                <span>${formatPokemonName(s.name)}</span>
              </div>
            `;
            return idx < stages.length - 1 ? node + '<span class="evolution-arrow">→</span>' : node;
          }).join('')}
        </div>
      `;
      $$('#evolutionPanel .evolution-node').forEach((node) => {
        node.addEventListener('click', () => openDetailModal(Number(node.dataset.id)));
      });
    } catch (e) {
      if (myToken !== modalRequestToken) return;
      container.innerHTML = '<p class="evolution-empty">Não foi possível carregar a evolução agora.</p>';
    }
  }

  function closeDetailModal() {
    dom.modal.hidden = true;
    modalRequestToken++; // invalida qualquer carregamento de painel em andamento
    if (lastFocusedBeforeModal && document.contains(lastFocusedBeforeModal)) {
      lastFocusedBeforeModal.focus();
    }
    lastFocusedBeforeModal = null;
  }

  // Mantém o foco do teclado dentro do modal enquanto ele estiver aberto
  // (focus trap), como esperado em qualquer dialog acessível.
  function trapFocus(e) {
    if (dom.modal.hidden || e.key !== 'Tab') return;
    const focusable = Array.from(
      dom.modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.disabled && el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function syncModalFavoriteButton(id) {
    const favBtn = $('#modalFavoriteBtn');
    if (!favBtn || Number(favBtn.dataset.id) !== id) return;
    const isFav = state.favorites.has(id);
    favBtn.classList.toggle('is-favorite', isFav);
    favBtn.textContent = isFav ? '★ Remover dos Favoritos' : '☆ Adicionar aos Favoritos';
  }

  // Gera um radar SVG simples (4 eixos: HP, Ataque, Defesa, Velocidade)
  // para dar uma leitura visual mais rápida do "formato" dos atributos.
  function statRadarSvg(p) {
    const keys = ['hp', 'attack', 'defense', 'speed'];
    const maxStat = 180;
    const center = 60;
    const radius = 46;
    const angleStep = (Math.PI * 2) / keys.length;

    function pointFor(key, index, valueOverride) {
      const value = valueOverride !== undefined ? valueOverride : p.stats[key];
      const ratio = Math.min(1, value / maxStat);
      const angle = angleStep * index - Math.PI / 2;
      return {
        x: center + Math.cos(angle) * radius * ratio,
        y: center + Math.sin(angle) * radius * ratio
      };
    }

    const dataPoints = keys.map((k, i) => pointFor(k, i)).map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
    const gridPoints = keys.map((k, i) => pointFor(k, i, maxStat)).map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
    const midGridPoints = keys.map((k, i) => pointFor(k, i, maxStat / 2)).map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');

    const labels = keys.map((k, i) => {
      const angle = angleStep * i - Math.PI / 2;
      const lx = center + Math.cos(angle) * (radius + 14);
      const ly = center + Math.sin(angle) * (radius + 14);
      return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="stat-radar-label" text-anchor="middle" dominant-baseline="middle">${statLabel(k)}</text>`;
    }).join('');

    return `
      <svg viewBox="0 0 120 120" role="img" aria-label="Gráfico radar de atributos base">
        <polygon class="stat-radar-grid" points="${gridPoints}"></polygon>
        <polygon class="stat-radar-grid" points="${midGridPoints}"></polygon>
        <polygon class="stat-radar-fill" points="${dataPoints}"></polygon>
        ${labels}
      </svg>
    `;
  }

  function detailModalTemplate(p) {
    const isFav = state.favorites.has(p.id);
    const maxStat = 180;
    const statsHtml = ['hp', 'attack', 'defense', 'speed'].map((key) => {
      const value = p.stats[key];
      const pct = Math.min(100, Math.round((value / maxStat) * 100));
      return `
        <div class="stat-row">
          <span>${statLabel(key)}</span>
          <div class="stat-bar"><div class="stat-bar-fill" style="width:${pct}%"></div></div>
          <strong>${value}</strong>
        </div>
      `;
    }).join('');

    return `
      <div class="modal-header">
        <span class="rarity-badge rarity-${p.rarity.key}" style="position:static;display:inline-flex;margin-bottom:10px;">${p.rarity.label}</span>
        <img src="${p.sprite}" alt="${p.displayName}">
        <h3 id="modalTitle">${p.displayName}</h3>
        <div class="card-id">${formatId(p.id)}</div>
        <div class="type-badges" style="justify-content:center;margin-top:10px;">
          ${p.types.map((t) => `<span class="type type-${t}">${TYPE_PT[t] || t}</span>`).join('')}
        </div>
      </div>

      <div class="modal-section">
        <h4>Atributos base</h4>
        <div class="stat-radar-wrap">${statRadarSvg(p)}</div>
        ${statsHtml}
      </div>

      <div class="modal-section">
        <h4>Fraquezas e resistências</h4>
        <div id="effectivenessPanel"><div class="loader small" style="margin:8px auto;"></div></div>
      </div>

      <div class="modal-section">
        <h4>Cadeia de evolução</h4>
        <div id="evolutionPanel"><p class="evolution-loading">Carregando evolução...</p></div>
      </div>

      <div class="modal-section">
        <h4>Informações</h4>
        <div class="modal-meta">
          <span>Altura: ${p.heightM.toFixed(1)} m</span>
          <span>Peso: ${p.weightKg.toFixed(1)} kg</span>
          <span>Geração: ${p.generationKey ? GENERATIONS[p.generationKey].label : '—'}</span>
        </div>
      </div>

      <div class="modal-section">
        <h4>Habilidades</h4>
        <div class="modal-abilities">
          ${p.abilities.map((a) => `<span class="ability-chip">${formatPokemonName(a)}</span>`).join('')}
        </div>
      </div>

      <button type="button" id="modalFavoriteBtn" class="modal-favorite ${isFav ? 'is-favorite' : ''}" data-id="${p.id}">
        ${isFav ? '★ Remover dos Favoritos' : '☆ Adicionar aos Favoritos'}
      </button>
    `;
  }

  /* =========================================================
     COMPARADOR
     ========================================================= */
  async function handleCompare() {
    const rawOne = dom.compareOne.value.trim();
    const rawTwo = dom.compareTwo.value.trim();

    if (!rawOne || !rawTwo) {
      showToast('Preencha os dois Pokémon para comparar.', 'error');
      return;
    }

    dom.compareResult.innerHTML = '<div class="loader" style="margin:20px auto;"></div>';

    try {
      const [one, two] = await Promise.all([
        fetchPokemonDetail(normalizeQuery(rawOne)),
        fetchPokemonDetail(normalizeQuery(rawTwo))
      ]);
      dom.compareResult.innerHTML = buildComparison(one, two);
    } catch (e) {
      dom.compareResult.innerHTML = '<p class="compare-error">Um ou ambos os Pokémon não foram encontrados. Verifique o nome ou número.</p>';
    }
  }

  function normalizeQuery(raw) {
    const trimmed = raw.trim().toLowerCase();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    return trimmed.replace(/\s+/g, '-');
  }

  function buildComparison(a, b) {
    const totalA = ['hp', 'attack', 'defense', 'speed'].reduce((sum, k) => sum + a.stats[k], 0);
    const totalB = ['hp', 'attack', 'defense', 'speed'].reduce((sum, k) => sum + b.stats[k], 0);
    const cards = [a, b].map((p, idx) => {
      const other = idx === 0 ? b : a;
      const rows = ['hp', 'attack', 'defense', 'speed'].map((key) => {
        const win = p.stats[key] > other.stats[key];
        return `<li class="${win ? 'winner' : ''}"><span>${statLabel(key)}</span><span>${p.stats[key]}</span></li>`;
      }).join('');
      return `
        <div class="compare-card">
          <img src="${p.sprite}" alt="${p.displayName}">
          <h3>${p.displayName} <small style="color:var(--text-muted)">${formatId(p.id)}</small></h3>
          <ul>${rows}</ul>
        </div>
      `;
    }).join('');

    let verdict;
    if (totalA === totalB) {
      verdict = `Empate técnico: ambos somam ${totalA} pontos nos atributos exibidos.`;
    } else {
      const winner = totalA > totalB ? a : b;
      const winnerTotal = Math.max(totalA, totalB);
      const loserTotal = Math.min(totalA, totalB);
      verdict = `${winner.displayName} leva vantagem no total (${winnerTotal} vs ${loserTotal} pontos).`;
    }

    return cards + `<div class="compare-verdict">${verdict}</div>`;
  }

  /* =========================================================
     TEMA (claro/escuro)
     ========================================================= */
  function applyTheme(theme) {
    document.body.classList.toggle('theme-light', theme === 'light');
    dom.themeButton.textContent = theme === 'light' ? 'Modo Escuro' : 'Modo Claro';
    localStorage.setItem(STORAGE.theme, theme);
  }

  function initTheme() {
    const saved = localStorage.getItem(STORAGE.theme) || 'dark';
    applyTheme(saved);
    dom.themeButton.addEventListener('click', () => {
      const current = document.body.classList.contains('theme-light') ? 'light' : 'dark';
      applyTheme(current === 'light' ? 'dark' : 'light');
    });
  }

  /* =========================================================
     POKÉMON ALEATÓRIO
     ========================================================= */
  function initRandomButton() {
    if (!dom.randomButton) return;
    dom.randomButton.addEventListener('click', async () => {
      if (state.masterList.length === 0) return;
      dom.randomButton.classList.add('spinning');
      const pick = state.masterList[Math.floor(Math.random() * state.masterList.length)];
      try {
        await openDetailModal(pick.id);
      } finally {
        setTimeout(() => dom.randomButton.classList.remove('spinning'), 400);
      }
    });
  }

  /* =========================================================
     PERFIL / LOGIN LOCAL
     ========================================================= */
  const profileChip = {
    wrapper: $('#profileChip'),
    avatar: $('#profileChipAvatar'),
    name: $('#profileChipName'),
    logoutBtn: $('#logoutButton')
  };

  function loadPersistedCurrentAccount() {
    try {
      const email = localStorage.getItem(STORAGE.currentAccount) || '';
      if (!email) return null;
      const account = getStoredAccount(email);
      if (account) {
        setCurrentAccount(email);
        return account;
      }
    } catch (e) { /* ignora */ }
    return null;
  }

  function loadAccountFavorites() {
    if (!state.currentAccountEmail) return;
    const account = getStoredAccount(state.currentAccountEmail);
    if (!account) return;
    state.favorites = new Set(Array.isArray(account.favorites) ? account.favorites : []);
  }

  function loadPersistedFavorites() {
    if (state.currentAccountEmail) {
      loadAccountFavorites();
      return;
    }
    state.favorites = new Set(safeParseFavorites());
  }

  function persistTrainerProfile(account) {
    try {
      localStorage.setItem(STORAGE.trainer, JSON.stringify({
        name: account.name,
        picture: account.picture,
        email: account.email
      }));
    } catch (e) { /* ignora */ }
  }

  function applyLoggedInProfile(profile) {
    if (dom.profileName) dom.profileName.textContent = profile.name;
    const avatarEl = $('#profileAvatar');
    if (avatarEl) avatarEl.src = profile.picture;
    if (profileChip.avatar) profileChip.avatar.src = profile.picture;
    if (profileChip.name) profileChip.name.textContent = profile.name;
    if (profileChip.wrapper) profileChip.wrapper.hidden = false;
    if (dom.loginButton) dom.loginButton.hidden = true;
  }

  function applyLoggedOutProfile() {
    if (dom.profileName) dom.profileName.textContent = 'Treinador Pokémon';
    const avatarEl = $('#profileAvatar');
    if (avatarEl) avatarEl.src = 'istockphoto-1495088043-612x612.png';
    if (profileChip.avatar) profileChip.avatar.src = 'istockphoto-1495088043-612x612.png';
    if (profileChip.wrapper) profileChip.wrapper.hidden = true;
    if (dom.loginButton) dom.loginButton.hidden = false;
  }

  function loginWithAccount(email, password) {
    if (!email || !password) {
      showToast('Informe e-mail e senha.', 'error');
      return null;
    }
    const account = getStoredAccount(email);
    if (!account || account.password !== password) {
      showToast('E-mail ou senha inválidos.', 'error');
      return null;
    }
    return account;
  }

  function createLocalAccount(email, password) {
    if (!email || !password) {
      showToast('Informe e-mail e senha.', 'error');
      return null;
    }
    if (getStoredAccount(email)) {
      showToast('Conta já existe. Faça login ou use outro e-mail.', 'error');
      return null;
    }
    const account = {
      email,
      password,
      name: 'Treinador Pokémon',
      picture: 'istockphoto-1495088043-612x612.png',
      favorites: []
    };
    saveStoredAccount(account);
    return account;
  }

  function persistLoggedInAccount(account) {
    setCurrentAccount(account.email);
    state.favorites = new Set(Array.isArray(account.favorites) ? account.favorites : []);
    persistTrainerProfile(account);
    applyLoggedInProfile(account);
    renderFavorites();
  }

  function openLoginModal() {
    if (!dom.loginModal) return;
    if (dom.loginEmail) dom.loginEmail.value = '';
    if (dom.loginPassword) dom.loginPassword.value = '';
    dom.loginModal.hidden = false;
    dom.loginEmail?.focus();
  }

  function closeLoginModal() {
    if (!dom.loginModal) return;
    dom.loginModal.hidden = true;
  }

  function initLoginModal() {
    if (dom.loginButton) {
      dom.loginButton.addEventListener('click', openLoginModal);
    }
    if (dom.loginModalClose) {
      dom.loginModalClose.addEventListener('click', closeLoginModal);
    }
    if (dom.loginModal) {
      dom.loginModal.addEventListener('click', (e) => {
        if (e.target === dom.loginModal) closeLoginModal();
      });
    }
    if (dom.loginSubmitButton) {
      dom.loginSubmitButton.addEventListener('click', () => {
        const email = normalizeEmail(dom.loginEmail?.value);
        const password = String(dom.loginPassword?.value || '');
        const account = loginWithAccount(email, password);
        if (!account) return;
        persistLoggedInAccount(account);
        closeLoginModal();
        showToast(`Bem-vindo, ${account.name}!`, 'success');
      });
    }
    if (dom.loginCreateButton) {
      dom.loginCreateButton.addEventListener('click', () => {
        const email = normalizeEmail(dom.loginEmail?.value);
        const password = String(dom.loginPassword?.value || '');
        const account = createLocalAccount(email, password);
        if (!account) return;
        persistLoggedInAccount(account);
        closeLoginModal();
        showToast('Conta criada e conectada.', 'success');
      });
    }
    if (dom.loginPassword) {
      dom.loginPassword.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          dom.loginSubmitButton?.click();
        }
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dom.loginModal && !dom.loginModal.hidden) {
        closeLoginModal();
      }
    });
  }

  function initProfile() {
    const account = loadPersistedCurrentAccount();
    if (account) {
      persistLoggedInAccount(account);
    } else {
      applyLoggedOutProfile();
      loadPersistedFavorites();
    }

    if (profileChip.logoutBtn) {
      profileChip.logoutBtn.addEventListener('click', () => {
        clearCurrentAccount();
        try { localStorage.removeItem(STORAGE.trainer); } catch (e) { /* ignora */ }
        loadPersistedFavorites();
        applyLoggedOutProfile();
        renderFavorites();
        showToast('Sessão encerrada.', 'info');
      });
    }

    if (dom.editProfileButton) {
      dom.editProfileButton.addEventListener('click', () => {
        const name = prompt('Novo nome de exibição:', dom.profileName ? dom.profileName.textContent : '');
        if (name && name.trim()) {
          const clean = escapeHtml(name.trim());
          if (dom.profileName) dom.profileName.textContent = clean;
          if (profileChip.name) profileChip.name.textContent = clean;
          if (state.currentAccountEmail) {
            const account = getStoredAccount(state.currentAccountEmail);
            if (account) {
              account.name = clean;
              saveStoredAccount(account);
              persistTrainerProfile(account);
            }
          }
          showToast('Perfil atualizado.', 'success');
        }
      });
    }

    initLoginModal();
  }

  /* =========================================================
     MODAL — fechar
     ========================================================= */
  function initModal() {
    dom.modalClose.addEventListener('click', closeDetailModal);
    dom.modal.addEventListener('click', (e) => {
      if (e.target === dom.modal) closeDetailModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !dom.modal.hidden) closeDetailModal();
      trapFocus(e);
    });
  }

  /* =========================================================
     FILTROS — eventos
     ========================================================= */
  function syncFilterInputs() {
    if (dom.typeSelect) dom.typeSelect.value = state.filters.type;
    if (dom.generationSelect) dom.generationSelect.value = state.filters.generation;
    if (dom.raritySelect) dom.raritySelect.value = state.filters.rarity;
    if (dom.orderSelect) dom.orderSelect.value = state.filters.order;
  }

  function initFilters() {
    syncFilterInputs();
    dom.typeSelect.addEventListener('change', () => {
      state.filters.type = dom.typeSelect.value;
      persistFilters();
      applyFilters();
    });
    dom.generationSelect.addEventListener('change', () => {
      state.filters.generation = dom.generationSelect.value;
      persistFilters();
      applyFilters();
    });
    dom.raritySelect.addEventListener('change', () => {
      state.filters.rarity = dom.raritySelect.value;
      persistFilters();
      applyFilters();
    });
    dom.orderSelect.addEventListener('change', () => {
      state.filters.order = dom.orderSelect.value;
      persistFilters();
      applyFilters();
    });
    if (dom.filterReset) {
      dom.filterReset.addEventListener('click', () => {
        state.filters = { type: '', generation: '', rarity: '', order: 'number' };
        syncFilterInputs();
        persistFilters();
        applyFilters();
        showToast('Filtros limpos.', 'info');
      });
    }
  }

  function initCompare() {
    dom.compareButton.addEventListener('click', handleCompare);
    [dom.compareOne, dom.compareTwo].forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleCompare();
      });
    });
  }

  /* =========================================================
     ATALHOS DE TECLADO GLOBAIS
     ========================================================= */
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

      // "/" foca a busca — mas só quando o usuário não está digitando em outro campo
      if (e.key === '/' && !isTyping) {
        e.preventDefault();
        $('#searchPokemon')?.focus();
      }

      // "r" abre um Pokémon aleatório
      if ((e.key === 'r' || e.key === 'R') && !isTyping && dom.modal.hidden) {
        dom.randomButton?.click();
      }
    });
  }

  /* =========================================================
     INICIALIZAÇÃO
     ========================================================= */
  async function init() {
    try {
      loadPersistedCache();
      loadPersistedFilters();
      initTheme();
      initProfile();
      initModal();
      initFilters();
      initCompare();
      initRandomButton();
      initKeyboardShortcuts();
      dom.favoriteCount.textContent = state.favorites.size;

      state.masterList = await fetchMasterList();
      dom.totalPokemon.textContent = state.masterList.length;
      state.filtered = state.masterList;
      await sortFiltered(++state.filterToken, () => false);
      await renderPage();
      renderFavorites();
      renderRanking();
    } catch (e) {
      console.error('Pokédex Ultimate — erro na inicialização:', e);
      state.masterList = [];
      state.filtered = [];
      state.page = 1;
      dom.totalPokemon.textContent = '0';
      dom.grid.innerHTML = '<p class="compare-error">Não foi possível carregar a Pokédex agora. Verifique sua conexão e tente novamente.</p>';
      dom.grid.style.display = 'block';
      dom.emptyState.hidden = true;
      renderPagination(0);
      renderFavorites();
      renderRanking();
      showToast('Erro ao carregar a página. Verifique sua conexão e tente novamente.', 'error');
    } finally {
      if (dom.loadingOverlay) {
        dom.loadingOverlay.classList.add('fade-out');
        setTimeout(() => { if (dom.loadingOverlay) dom.loadingOverlay.hidden = true; }, 450);
      }
    }
  }

  // Expõe uma API mínima para o search.js
  window.Pokedex = {
    state,
    dom,
    debounce,
    formatId,
    formatPokemonName,
    fetchPokemonDetail,
    fuzzyMatch,
    normalizeStr,
    applyFiltersFromSearch(term) {
      state.searchTerm = term;
      applyFilters();
    },
    openDetailModal,
    getMasterList: () => state.masterList
  };

  document.addEventListener('DOMContentLoaded', init);
})();
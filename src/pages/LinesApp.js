/**
 * LinesApp.js — Página de listagem de linhas STCP
 * Carrega a lista estática do proxy e renderiza com pesquisa.
 */
import { PROXY_BASE_URL } from '../config/config.js';

const searchInput  = document.getElementById('lines-search');
const searchClear  = document.getElementById('lines-search-clear');
const listEl       = document.getElementById('lines-list');

let allRoutes = [];

async function loadRoutes() {
  try {
    const res  = await fetch(`${PROXY_BASE_URL}/routes/list`);
    const data = await res.json();
    allRoutes  = data.routes || [];
    renderList(allRoutes);
  } catch (err) {
    listEl.innerHTML = `<li class="lines-empty">Erro ao carregar linhas. Tenta mais tarde.</li>`;
  }
}

function renderList(routes) {
  if (!routes.length) {
    listEl.innerHTML = `<li class="lines-empty">Nenhuma linha encontrada.</li>`;
    return;
  }
  listEl.innerHTML = routes.map(route => {
    const bg   = route.color      || '#187EC2';
    const fg   = route.text_color || '#FFFFFF';
    return `
      <a href="/line-detail?id=${encodeURIComponent(route.id)}&number=${encodeURIComponent(route.number)}"
         class="line-list-item"
         role="listitem"
         aria-label="Linha ${route.number}: ${route.name}">
        <span class="line-badge" style="background:${bg};color:${fg}">${route.number}</span>
        <span class="line-item-name">${route.name}</span>
        <svg class="line-item-arrow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </a>`;
  }).join('');
}

function filterRoutes(query) {
  const q = query.trim().toLowerCase();
  if (!q) return allRoutes;
  return allRoutes.filter(r =>
    r.number.toLowerCase().includes(q) ||
    r.name.toLowerCase().includes(q)
  );
}

searchInput.addEventListener('input', () => {
  const val = searchInput.value;
  searchClear.style.display = val ? 'flex' : 'none';
  renderList(filterRoutes(val));
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.style.display = 'none';
  renderList(allRoutes);
  searchInput.focus();
});

loadRoutes();

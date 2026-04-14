/**
 * LinesApp.js — Página de listagem de linhas STCP
 * Carrega a lista do proxy, agrupa por secção e renderiza com pesquisa.
 */
import { PROXY_BASE_URL } from '../config/config.js';

const listEl  = document.getElementById('list');
const searchEl = document.getElementById('search');
const clearEl  = document.getElementById('search-clear');

let allRoutes = [];

// Classificação de cada rota numa secção
function classifyRoute(r) {
  const n = r.number;
  if (n === 'MB1')                      return 'metrobus';
  if (/^\d+M$/.test(n))                 return 'noturnas';
  if (/^2\d{2}$/.test(n))               return 'linhas200';
  if (/^3\d{2}$/.test(n))               return 'linhas300';
  if (/^4\d{2}$/.test(n) || n === 'ZC') return 'linhas400';
  if (/^5\d{2}$/.test(n))               return 'linhas500';
  if (/^6\d{2}$/.test(n))               return 'linhas600';
  if (/^7\d{2}$/.test(n))               return 'linhas700';
  if (/^8\d{2}$/.test(n))               return 'linhas800';
  if (/^9\d{2}$/.test(n))               return 'linhas900';
  return 'outras';
}

const SECTION_ORDER = [
  { key: 'linhas200', label: 'Linhas 200 - Porto Ocidental' },
  { key: 'linhas300', label: 'Linhas 300 - Porto Centro' },
  { key: 'linhas400', label: 'Linhas 400 - Porto Oriental' },
  { key: 'linhas500', label: 'Linhas 500 — Matosinhos' },
  { key: 'linhas600', label: 'Linhas 600 — Maia / Aeroporto' },
  { key: 'linhas700', label: 'Linhas 700 — Valongo / Ermesinde' },
  { key: 'linhas800', label: 'Linhas 800 — Gondomar' },
  { key: 'linhas900', label: 'Linhas 900 — Gaia' },
  { key: 'noturnas',  label: '\uD83C\uDF19 Linhas Noturnas' },
  { key: 'metrobus', label: '\uD83D\uDE8C Metrobus' },
  { key: 'outras',   label: 'Outras' },
];

function groupRoutes(routes) {
  const buckets = {};
  SECTION_ORDER.forEach(s => { buckets[s.key] = []; });
  routes.forEach(r => {
    const key = classifyRoute(r);
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(r);
  });

  const grouped = [];
  SECTION_ORDER.forEach(({ key, label }) => {
    if (!buckets[key] || !buckets[key].length) return;
    grouped.push({ type: 'label', text: label });
    buckets[key].forEach(r => grouped.push({ type: 'route', route: r }));
  });
  return grouped;
}

function renderList(routes) {
  if (!routes.length) {
    listEl.innerHTML = '<li class="empty">Nenhuma linha encontrada.</li>';
    return;
  }
  const items = groupRoutes(routes);
  listEl.innerHTML = items.map(item => {
    if (item.type === 'label') {
      return `<li class="section-label" role="presentation">${item.text}</li>`;
    }
    const r  = item.route;
    const bg = r.color      || '#187EC2';
    const fg = r.text_color || '#FFFFFF';
    return `
      <a href="line-detail.html?id=${encodeURIComponent(r.id)}&number=${encodeURIComponent(r.number)}"
         class="line-item" role="listitem"
         aria-label="Linha ${r.number}: ${r.name}">
        <span class="badge" style="background:${bg};color:${fg}">${r.number}</span>
        <span class="line-name">${r.name}</span>
        <svg class="arrow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </a>`;
  }).join('');
}

async function load() {
  listEl.innerHTML = '<li class="spinner-wrap" style="list-style:none"><div class="spinner"></div><span>A carregar linhas&hellip;</span></li>';
  try {
    const res  = await fetch(`${PROXY_BASE_URL}/routes/list`);
    const data = await res.json();
    allRoutes  = data.routes || [];
    renderList(allRoutes);
  } catch (e) {
    listEl.innerHTML = '<li class="empty">Erro ao carregar linhas. Tenta mais tarde.</li>';
  }
}

searchEl.addEventListener('input', () => {
  const q = searchEl.value;
  clearEl.style.display = q ? 'flex' : 'none';
  const lq = q.trim().toLowerCase();
  renderList(lq
    ? allRoutes.filter(r => r.number.toLowerCase().includes(lq) || r.name.toLowerCase().includes(lq))
    : allRoutes
  );
});

clearEl.addEventListener('click', () => {
  searchEl.value = '';
  clearEl.style.display = 'none';
  renderList(allRoutes);
  searchEl.focus();
});

load();

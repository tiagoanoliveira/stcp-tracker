/**
 * LineDetailApp.js — Página de detalhe de uma linha STCP
 * Mostra as paragens numa timeline.
 * Ao clicar numa paragem abre o stopsmap com a paragem e filtro da linha.
 */
import { PROXY_BASE_URL } from '../config/config.js';

const params      = new URLSearchParams(location.search);
const routeId     = params.get('id')     || '';
const routeNumber = params.get('number') || routeId;

const heroEl    = document.getElementById('hero');
const badgeEl   = document.getElementById('hero-badge');
const nameEl    = document.getElementById('hero-name');
const stateLoad = document.getElementById('state-loading');
const stateErr  = document.getElementById('state-error');
const errMsgEl  = document.getElementById('err-msg');
const stopsEl   = document.getElementById('stops');
const btnInvert = document.getElementById('btn-invert');
const btnMap    = document.getElementById('btn-map');

const BUS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="5" width="18" height="13" rx="2"/>
  <path d="M3 10h18"/>
  <path d="M8 18v2M16 18v2"/>
  <circle cx="8" cy="14.5" r="1"/>
  <circle cx="16" cy="14.5" r="1"/>
</svg>`;

let direction = 0;
let route     = { id: routeId, number: routeNumber, name: '', color: '#187EC2', text_color: '#FFFFFF' };

function applyHero() {
  const bg = route.color || '#187EC2';
  document.title = `Linha ${route.number} \u2014 STCP Live`;
  heroEl.style.setProperty('--rc', bg);
  document.documentElement.style.setProperty('--rc', bg);
  badgeEl.textContent = route.number;
  nameEl.textContent  = route.name || route.number;
}

btnMap.addEventListener('click', () => {
  window.location.href = `stopsmap.html?line=${encodeURIComponent(routeNumber)}&dir=${direction}`;
});

async function init() {
  if (!routeId) { showError('Linha n\u00e3o encontrada.'); return; }
  try {
    const res  = await fetch(`${PROXY_BASE_URL}/routes/list`);
    const data = await res.json();
    const found = (data.routes || []).find(r => r.id === routeId);
    if (found) route = found;
  } catch (_) {}
  applyHero();
  loadStops();
}

async function loadStops() {
  stateLoad.style.display = 'flex';
  stateErr.style.display  = 'none';
  stopsEl.style.display   = 'none';

  try {
    const res  = await fetch(`${PROXY_BASE_URL}/route/${routeId}/stops?direction_id=${direction}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const stops = data.stops || [];
    if (!stops.length) throw new Error('Sem paragens');
    renderStops(stops);
  } catch (e) {
    showError(`N\u00e3o foi poss\u00edvel carregar as paragens da linha ${routeNumber}.`);
  }
}

function renderStops(stops) {
  stateLoad.style.display = 'none';
  stopsEl.style.display   = 'block';
  const bg   = route.color || '#187EC2';
  const last = stops.length - 1;

  stopsEl.innerHTML = stops.map((s, i) => {
    const isFirst = i === 0;
    const isLast  = i === last;
    const code    = s.stop_code || s.stop_id || '';
    const zone    = s.zone_id ? `Zona ${s.zone_id}` : '';
    const mapUrl  = `stopsmap.html?stop=${encodeURIComponent(code)}&line=${encodeURIComponent(routeNumber)}&dir=${direction}`;
    const cls     = ['stop', isFirst ? 'stop-first' : '', isLast ? 'stop-last' : ''].filter(Boolean).join(' ');

    let dotHtml;
    if (isFirst) {
      dotHtml = `<div class="bus-icon" style="background:${bg}">${BUS_SVG}</div>`;
    } else if (isLast) {
      dotHtml = `<div class="dot dot-lg" style="border-color:${bg}"></div>`;
    } else {
      dotHtml = `<div class="dot" style="border-color:${bg}"></div>`;
    }

    return `
      <li class="${cls}">
        <div class="tl" style="--line-color:${bg}">
          ${dotHtml}
        </div>
        <a class="stop-link" href="${mapUrl}" title="Ver ${s.stop_name} no mapa">
          <span class="stop-name">${s.stop_name}</span>
          ${code ? `<span class="stop-code">${code}</span>` : ''}
          ${zone ? `<span class="stop-zone">${zone}</span>` : ''}
        </a>
      </li>`;
  }).join('');
}

function showError(msg) {
  stateLoad.style.display = 'none';
  errMsgEl.textContent    = msg;
  stateErr.style.display  = 'flex';
}

btnInvert.addEventListener('click', () => {
  direction = direction === 0 ? 1 : 0;
  loadStops();
});

init();

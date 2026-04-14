/**
 * LineDetailApp.js — Página de detalhe de uma linha STCP
 * Mostra as paragens da linha numa timeline.
 * Ao clicar numa paragem abre o stopsmap com a paragem e filtro da linha.
 */
import { PROXY_BASE_URL } from '../config/config.js';

const params       = new URLSearchParams(location.search);
const routeId      = params.get('id')      || '';
const routeNumber  = params.get('number')  || routeId;

const heroEl       = document.getElementById('line-detail-hero');
const badgeEl      = document.getElementById('line-detail-badge');
const nameEl       = document.getElementById('line-detail-name');
const pageTitleEl  = document.getElementById('detail-page-title');
const loadingEl    = document.getElementById('line-detail-loading');
const errorEl      = document.getElementById('line-detail-error');
const errorMsgEl   = document.getElementById('line-detail-error-msg');
const stopsList    = document.getElementById('line-stops-list');
const btnInvert    = document.getElementById('btn-invert');
const btnMap       = document.getElementById('btn-map');

let currentDirection = 0;
let currentRoute     = null;
let currentStops     = [];

async function loadRouteInfo() {
  try {
    const res  = await fetch(`${PROXY_BASE_URL}/routes/list`);
    const data = await res.json();
    const routes = data.routes || [];
    currentRoute = routes.find(r => r.id === routeId) || {
      id: routeId, number: routeNumber, name: routeNumber,
      color: '#187EC2', text_color: '#FFFFFF'
    };
  } catch {
    currentRoute = { id: routeId, number: routeNumber, name: routeNumber, color: '#187EC2', text_color: '#FFFFFF' };
  }
  applyRouteHeader();
  loadStops();
}

function applyRouteHeader() {
  const bg = currentRoute.color      || '#187EC2';
  const fg = currentRoute.text_color || '#FFFFFF';

  document.title = `Linha ${currentRoute.number} — STCP Live`;
  pageTitleEl.textContent = `Linha ${currentRoute.number}`;

  heroEl.style.setProperty('--route-color', bg);
  badgeEl.textContent  = currentRoute.number;
  badgeEl.style.cssText = `background:${bg};color:${fg}`;
  nameEl.textContent   = currentRoute.name;

  btnMap.href = `/stopsmap?route=${encodeURIComponent(routeId)}`;
}

async function loadStops() {
  loadingEl.style.display = 'flex';
  errorEl.style.display   = 'none';
  stopsList.style.display = 'none';
  currentStops = [];

  try {
    const res  = await fetch(`${PROXY_BASE_URL}/route/${routeId}/stops?direction_id=${currentDirection}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    currentStops = data.stops || [];
    if (!currentStops.length) throw new Error('Sem paragens');
    renderStops();
  } catch (err) {
    loadingEl.style.display = 'none';
    errorMsgEl.textContent  = `Não foi possível carregar as paragens da linha ${routeNumber}.`;
    errorEl.style.display   = 'flex';
  }
}

function renderStops() {
  loadingEl.style.display = 'none';
  stopsList.style.display = 'block';

  const bg = (currentRoute && currentRoute.color) || '#187EC2';

  stopsList.innerHTML = currentStops.map((stop, idx) => {
    const isFirst = idx === 0;
    const isLast  = idx === currentStops.length - 1;
    const zoneLabel = stop.zone_id ? `Zona ${stop.zone_id}` : '';
    const stopCode  = stop.stop_code || stop.stop_id || '';

    const mapUrl = `/stopsmap?stop=${encodeURIComponent(stopCode)}&route=${encodeURIComponent(routeId)}`;

    return `
      <li class="stop-item${isFirst ? ' stop-first' : ''}${isLast ? ' stop-last' : ''}"
          data-stop-id="${stopCode}"
          role="listitem">
        <div class="stop-timeline">
          <div class="stop-dot${isFirst ? ' stop-dot--origin' : isLast ? ' stop-dot--dest' : ''}" style="--route-color:${bg}"></div>
          ${!isLast ? `<div class="stop-line" style="--route-color:${bg}"></div>` : ''}
        </div>
        <a class="stop-content" href="${mapUrl}" title="Ver ${stop.stop_name} no mapa" aria-label="Paragem ${stop.stop_name}${zoneLabel ? ', ' + zoneLabel : ''}">
          <span class="stop-name">${stop.stop_name}</span>
          <span class="stop-meta">
            ${stopCode ? `<span class="stop-code">${stopCode}</span>` : ''}
            ${zoneLabel ? `<span class="stop-zone">${zoneLabel}</span>` : ''}
          </span>
        </a>
      </li>`;
  }).join('');
}

btnInvert.addEventListener('click', () => {
  currentDirection = currentDirection === 0 ? 1 : 0;
  loadStops();
});

if (!routeId) {
  errorMsgEl.textContent = 'Linha não encontrada.';
  loadingEl.style.display = 'none';
  errorEl.style.display   = 'flex';
} else {
  loadRouteInfo();
}

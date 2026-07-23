/**
 * BusMarkerManager - Gestão de marcadores de autocarros
 *
 * Popup lazy: o destino (headsign) é resolvido apenas no primeiro clique,
 * a menos que bus.destination já esteja preenchido (ex: vindo do protobuf MQTT).
 *
 * DEDUPLICAÇÃO:
 *   Antes de criar qualquer marcador, o método _upsertMarker() verifica se já
 *   existe um marcador com o mesmo id (independentemente da origem — FIWARE
 *   bootstrap ou MQTT). Se existir, o marcador é movido e actualizado em vez
 *   de se criar um duplicado.
 *
 * COR DO POPUP:
 *   _lineColors() consulta iconCache.getRouteColor() que verifica em cascata:
 *     1. Cores registadas via iconCache.registerRouteColors() (vindas da API)
 *     2. BUS_COLORS hardcoded (busColors.js)
 *     3. Fallback azul STCP #0072c6
 *   Para que as cores da API estejam disponíveis, o código que chama
 *   routeService.fetchRoutesList() deve passar o resultado a
 *   iconCache.registerRouteColors() logo a seguir.
 */

import { iconCache }      from '../../ui/design/iconCache.js';
import { vehicleService } from '../../services/vehicleService.js';
import { stopService }           from '../../services/stopService.js';
import { normalizeDestinationText } from '../../services/vehicleService.js';

/**
 * Devolve { bg, text } para o cabeçalho do popup.
 * Lê as cores registadas pela API; fallback para azul STCP.
 */
function _lineColors(line) {
  const colors = iconCache.getRouteColor(String(line ?? '').trim());
  if (colors?.busColor) {
    return { bg: colors.busColor, text: colors.textColor || '#fff' };
  }
  return { bg: '#0072c6', text: '#fff' };
}

export class BusMarkerManager {
  constructor(map) {
    this.map = map;
    this.markers       = {};
    this._busData      = {};
    this._markerRoutes = {};
    this._markerDirs   = {};
  }

  setRouteForMarker(busId, routeNumber, direction) {
    this._markerRoutes[busId] = String(routeNumber || '');
    this._markerDirs[busId]   = direction != null ? Number(direction) : null;
  }

  filterByRoutes(selectedRoutes, routeDirMap) {
    const showAll = !selectedRoutes || selectedRoutes.size === 0;
    const visiblePositions = [];

    Object.entries(this.markers).forEach(([id, marker]) => {
      const bus         = this._busData[id];
      const displayLine = (bus?.displayLine) || this._markerRoutes[id] || '';
      const markerDir   = this._markerDirs[id];

      let visible = showAll || selectedRoutes.has(displayLine);

      if (visible && routeDirMap && routeDirMap.has(displayLine) && markerDir !== null) {
        visible = markerDir === routeDirMap.get(displayLine);
      }

      if (visible) {
        if (!this.map.hasLayer(marker)) marker.addTo(this.map);
        const ll = marker.getLatLng();
        visiblePositions.push([ll.lat, ll.lng]);
      } else {
        if (this.map.hasLayer(marker)) this.map.removeLayer(marker);
      }
    });
    return visiblePositions;
  }

  // ─── Upsert central ──────────────────────────────────────────────────────

  _upsertMarker(bus) {
    const prev = this._busData[bus.id];
    // Limpar atraso cacheado se a próxima paragem mudou
    if (prev && prev.nextStop !== bus.nextStop) {
      bus._delaySec = undefined; // forçar re-resolução do atraso
    } else if (prev) {
      bus._delaySec = prev._delaySec; // preservar atraso existente
    }

    this._busData[bus.id] = bus;
    const icon = iconCache.getBusIcon(bus.line, bus.source || 'stcp');

    if (this.markers[bus.id]) {
      const marker = this.markers[bus.id];
      marker.setLatLng([bus.latitude, bus.longitude]);
      marker.setIcon(icon);

      if (bus.destination !== null && bus.destination !== undefined) {
        // Se o popup está aberto e nextStop mudou, re-resolver nome e atraso
        if (prev?.nextStop !== bus.nextStop && marker.isPopupOpen()) {
          this._resolvePopupHeadsign(bus.id, marker);
        } else if (!marker.isPopupOpen()) {
          marker.setPopupContent(this._createPopupContent(bus));
        } else {
          marker.setPopupContent(this._createPopupContent(bus));
        }
      }
      return marker;
    }
    return this._createBusMarker(bus);
  }

  // ─── API pública ─────────────────────────────────────────────────────────

  updateBusMarkers(busData) {
    const validIDs = new Set();
    busData.forEach(bus => {
      validIDs.add(bus.id);
      this._upsertMarker(bus);
    });
    Object.keys(this.markers).forEach(id => {
      if (!validIDs.has(id)) this.removeBusMarker(id);
    });
  }

  updateSingleBusMarker(bus) {
    this._upsertMarker(bus);
  }

  // ─── Criação de marcador ─────────────────────────────────────────────────

  _createBusMarker(bus) {
    const icon = iconCache.getBusIcon(bus.line, bus.source || 'stcp');
    const popupContent = (bus.destination !== null && bus.destination !== undefined)
      ? this._createPopupContent(bus)
      : this._createLoadingPopup(bus);
    const marker = L.marker([bus.latitude, bus.longitude], { icon }).addTo(this.map);
    marker.bindPopup(popupContent, { maxWidth: 200, className: 'bus-popup-wrapper' });
    marker.on('popupopen', () => this._resolvePopupHeadsign(bus.id, marker));
    this.markers[bus.id] = marker;
    return marker;
  }

  async _resolvePopupHeadsign(busId, marker) {
    const bus = this._busData[busId];
    if (!bus) return;

    // Resolver destino (já existe)
    if (bus.destination == null) {
      const destination = await vehicleService.resolveHeadsign(bus);
      bus.destination = destination;
      this._busData[busId] = bus;
    }

    // ADICIONAR: Resolver delay se nextStop existe e delay ainda não foi calculado
    if (bus.nextStop && bus._delaySec === undefined) {
      try {
        const delay = await vehicleService.resolveVehicleDelay(bus);
        bus._delaySec = delay;
        this._busData[busId] = bus;
      } catch (err) {
        console.warn(`Não foi possível obter delay para veículo ${busId}:`, err);
        bus._delaySec = null; // Marcar como tentado para não repetir
      }
    }

    // Resolver nome da paragem (já existe)
    if (bus.nextStop && !stopService.getStopById(bus.nextStop)) {
      try { await stopService.searchStops(bus.nextStop); } catch {}
    }

    marker.setPopupContent(this._createPopupContent(bus));
  }

  // ─── Templates dos popups ────────────────────────────────────────────────

  _createLoadingPopup(bus) {
    const line   = bus.displayLine ?? bus.line ?? '?';
    const colors = _lineColors(line);
    return `
      <div>
        <div class="bus-popup__header" style="background:${colors.bg};">
          <span class="bus-popup__badge" style="color:${colors.bg};">${line}</span>
          <span class="bus-popup__destination" style="color:${colors.text};">A carregar…</span>
        </div>
        <div class="bus-popup__body">
          <div class="bus-popup__vehicle">Veículo nº ${bus.busNumber ?? '—'}</div>
        </div>
      </div>`;
  }

  _createPopupContent(bus) {
    const line        = bus.displayLine ?? bus.line ?? '?';
    const colors      = _lineColors(line);
    const destination = bus.destination || 'Desconhecido';
    const vehicle     = bus.busNumber ?? '—';

    // ─── Ícones inline ────────────────────
    const ICON_NEXT_STOP = `<svg class="bus-popup__icon bus-popup__icon--wide" width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="0" y1="2" x2="2" y2="20"></line>
      <rect x="0" y="2" width="12" height="7" rx="2"></rect>
    </svg>`;

    const ICON_CLOCK = `<svg class="bus-popup__icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 16 14"></polyline>
    </svg>`;

    // ─── Próxima paragem ──────────────────────────────────────────────
    let nextStopHtml = '';
    if (bus.nextStop) {
      const stopObj  = stopService.getStopById(bus.nextStop);
      const rawName  = stopObj?.stop_name ?? bus.nextStop;
      const stopName = normalizeDestinationText(rawName) ?? rawName;
      nextStopHtml = `
      <div class="bus-popup__row">
        <div class="bus-popup-next-stop" title="Próxima paragem">
          ${ICON_NEXT_STOP}
          <span class="bus-popup__label">Próxima:</span>
          <span>${stopName}</span>
        </div>
      </div>`;
    }

    // ─── Atraso via TripUpdate MQTT ───────────────────────────────────
    let delayHtml = '';
    const delaySec = bus._delaySec ?? null;
    if (delaySec != null) {
      const absSec = Math.abs(delaySec);
      const mins   = Math.floor(absSec / 60);
      const secs   = Math.round(absSec % 60);
      const label  = delaySec > 30
          ? `${mins > 0 ? mins + 'min. ' : ''}${secs} seg. atrasado`
          : delaySec < -30
              ? `${mins > 0 ? mins + ' min. ' : ''}${secs} seg. adiantado`
              : 'Dentro do horário';
      const color  = delaySec > 30 ? '#c0392b' : '#27ae60';
      delayHtml = `
      <div class="bus-popup__row bus-popup__delay" style="color:${color};font-weight:600;">
        ${ICON_CLOCK}
        <span>${label}</span>
      </div>`;

    }

    return `
    <div>
      <div class="bus-popup__header" style="background:${colors.bg};">
        <span class="bus-popup__badge" style="color:${colors.bg};">${line}</span>
        <span class="bus-popup__destination" style="color:${colors.text};" title="${destination}">${destination}</span>
      </div>
      <div class="bus-popup__body">
        ${nextStopHtml}
        ${delayHtml}
        <div class="bus-popup__vehicle">Veículo nº ${vehicle}</div>
      </div>
    </div>`;
  }

  // ─── Utilitários ─────────────────────────────────────────────────────────

  removeBusMarker(id) {
    if (this.markers[id]) {
      this.map.removeLayer(this.markers[id]);
      delete this.markers[id];
      delete this._busData[id];
      delete this._markerRoutes[id];
      delete this._markerDirs[id];
    }
  }

  hideAllMarkers() {
    Object.values(this.markers).forEach(m => {
      if (this.map.hasLayer(m)) this.map.removeLayer(m);
    });
  }

  openPopup(busId) {
    if (this.markers[busId]) this.markers[busId].openPopup();
  }

  getAllPositions() {
    return Object.values(this.markers).map(m => m.getLatLng());
  }

  clearAllMarkers() {
    Object.keys(this.markers).forEach(id => this.removeBusMarker(id));
    this._markerRoutes = {};
    this._markerDirs   = {};
    this._busData      = {};
  }

  getMarkerCount() { return Object.keys(this.markers).length; }
}

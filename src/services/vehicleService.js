/**
 * Vehicle Service - Lógica centralizada de processamento de dados de autocarros
 *
 * LAZY HEADSIGN: processBusData / processBusDataBatch não resolvem o destino.
 * Esse campo fica null até ao primeiro clique no marker — A MENOS QUE o caller
 * (ex: mqttVehicleService) já tenha extraído o destino do tópico MQTT e o passe
 * no campo `bus.destination`. Nesse caso o valor é preservado sem resolver nada.
 *
 * TRIP MATCHING: O trip_id tem o formato:
 *   {linha}_{dir}_{seq}|{nr_viagem}|{dia}|{turno}|{servico}
 * O nr_viagem (2º segmento) pode diferir entre FIWARE e API STCP.
 * O matching delega em scheduleService._tripMatchKey que ignora esse segmento.
 *
 * LINE ALIASES: Algumas linhas são reportadas pela API com um ID numérico
 * diferente do nome real da linha. O mapa LINE_ID_ALIASES faz essa tradução.
 * Exemplo: a linha ZC é transmitida como '107' na localização em tempo real.
 *
 * ID NORMALISATION (FIWARE):
 *   O FIWARE usa o formato "urn:ngsi-ld:Vehicle:{number}" como id de entidade.
 *   O MQTT usa apenas o número do veículo (ex: "3261").
 *   Para garantir deduplicação correcta no BusMarkerManager, o branch FIWARE
 *   de processBusData extrai o número final do URN:
 *     "urn:ngsi-ld:Vehicle:3261" → "3261"
 *   Se o id não seguir esse padrão, é usado tal qual.
 */

import { scheduleService } from './scheduleService.js';
import { getUnirLineColor } from '../../resources/busDesign/busColors.js';

/**
 * Mapeamento de IDs de linha da API FIWARE para nomes/números reais de linha.
 * Usar apenas para casos em que o ID da API não corresponde ao nome real.
 */
const LINE_ID_ALIASES = {
  '107': 'ZC',
};

/**
 * Normaliza um id de entidade FIWARE para o número puro do veículo.
 * "urn:ngsi-ld:Vehicle:3261" → "3261"
 * "3261"                     → "3261"  (passthrough)
 * @param {string} rawId
 * @returns {string}
 */
function _normalizeFiwareId(rawId) {
  if (!rawId) return rawId;
  // Extrair último segmento de URN separado por ':'
  const parts = String(rawId).split(':');
  return parts[parts.length - 1] || String(rawId);
}

export const KEEP_LOWERCASE_DEST_WORDS = new Set(['de', 'da', 'do']);

export function normalizeDestinationText(value) {
  if (!value || typeof value !== 'string') return value;

  const trimmed = value.trim();
  const withoutAsterisk = trimmed.replace(/^\*+\s*/, '').replace(/\s*\*+$/, '').trim();
  if (!withoutAsterisk) return withoutAsterisk;

  const lettersOnly = withoutAsterisk.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const isAllCaps = lettersOnly.length > 0 && lettersOnly === lettersOnly.toUpperCase();
  const startedWithAsterisk = trimmed.startsWith('*');

  if (!isAllCaps && !startedWithAsterisk) return withoutAsterisk;

  return withoutAsterisk
      .toLowerCase()
      .split(/\s+/)
      .map(word => {
        if (!word) return word;
        if (KEEP_LOWERCASE_DEST_WORDS.has(word)) return word;
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
}

class VehicleService {
  extractAnnotation(bus, prefix) {
    if (!bus.annotations?.value) return null;
    for (const annotation of bus.annotations.value) {
      const decoded = decodeURIComponent(annotation);
      if (decoded.startsWith(prefix)) return decoded.slice(prefix.length);
    }
    return null;
  }

  /**
   * Número/ID de linha
   *  - Novo formato (worker /vehicles):   bus.routeId
   *  - Formato FIWARE bruto (Broker):    annotation "stcp:route:"
   */
  extractLineNumber(bus) {
    if (bus.routeId) {
      const raw = String(bus.routeId);

      // UNIR: "6017:0" -> "6017"
      if ((bus.source || '').toLowerCase() === 'unir') {
        return raw.split(':')[0];
      }

      return raw;
    }

    return this.extractAnnotation(bus, 'stcp:route:');
  }

  /**
   * Direcção (0/1)
   *  - Novo formato:   bus.directionId
   *  - FIWARE bruto:   annotation "stcp:sentido:"
   */
  extractDirection(bus) {
    if (bus.directionId != null) return Number(bus.directionId);
    const val = this.extractAnnotation(bus, 'stcp:sentido:');
    return val != null ? Number(val) : null;
  }

  /**
   * trip_id
   *  - Novo formato:   bus.tripId
   *  - FIWARE bruto:   annotation "stcp:nr_viagem:"
   */
  extractTripId(bus) {
    if (bus.tripId) return bus.tripId;
    return this.extractAnnotation(bus, 'stcp:nr_viagem:');
  }

  /**
   * Devolve o nome de linha para apresentação ao utilizador.
   * Se existir um alias para o lineId (ex: '107' -> 'ZC'), usa-o;
   * caso contrário devolve o próprio lineId.
   * @param {string} lineId - ID de linha conforme devolvido pela API
   * @returns {string}
   */
  getDisplayLine(lineId) {
    if (!lineId) return lineId;
    return LINE_ID_ALIASES[lineId] ?? lineId;
  }

  /**
   * Extrai a localização geográfica de um veículo.
   * Aceita:
   *  - objecto processado por processBusData (latitude/longitude)
   *  - objecto normalizado do worker (/vehicles): lat/lng
   *  - objecto FIWARE bruto: location.value.coordinates
   * Devolve { lat, lon } ou null se não houver coordenadas válidas.
   */
  extractVehicleLocation(vehicle) {
    if (!vehicle) return null;

    // Objecto já processado por processBusData
    if (Number.isFinite(vehicle.latitude) && Number.isFinite(vehicle.longitude)) {
      return { lat: vehicle.latitude, lon: vehicle.longitude };
    }

    // Objecto normalizado do worker (/vehicles)
    if (Number.isFinite(vehicle.lat) && Number.isFinite(vehicle.lng)) {
      return { lat: vehicle.lat, lon: vehicle.lng };
    }

    // Objecto FIWARE bruto
    const coords = vehicle.location?.value?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const lon = coords[0];
      const lat = coords[1];
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    }

    return null;
  }

  /**
   * Compara dois trip_ids ignorando o nr_viagem (2º segmento).
   * Delega a lógica de chave em scheduleService._tripMatchKey.
   */
  tripIdsMatch(vehicleTripId, arrivalTripId) {
    if (!vehicleTripId || !arrivalTripId) return false;
    if (vehicleTripId === arrivalTripId) return true;
    return scheduleService._tripMatchKey(vehicleTripId) === scheduleService._tripMatchKey(arrivalTripId);
  }

  matchVehicleToTrip(vehicles, tripId) {
    if (!Array.isArray(vehicles) || !tripId) return null;
    return vehicles.find(v => this.tripIdsMatch(this.extractTripId(v), tripId)) || null;
  }

  /**
   * Normaliza um veículo de qualquer origem para o formato interno usado no mapa.
   *
   * Suporta:
   *  - Formato MQTT (mqttVehicleService): { id, routeId, directionId, lat, lng,
   *      speed, tripId, destination, busNumber }
   *    → speed já em km/h, destination já resolvido do tópico.
   *  - Formato normalizado do worker (/vehicles): { id, routeId, directionId, lat, lng, speed, tripId }
   *  - Formato FIWARE bruto: annotations + location.value.coordinates
   *
   * VELOCIDADE: para o formato MQTT e worker, o campo speed chega já em km/h
   * (arredondado). Para FIWARE bruto, speed.value está em m/s e é convertido.
   *
   * DESTINO: se bus.destination já tiver valor (string não-nula e não-vazia),
   * é preservado directamente — não é chamado resolveHeadsign.
   *
   * ID (FIWARE): o URN é normalizado para o número puro do veículo via
   * _normalizeFiwareId, garantindo deduplicação com marcadores MQTT.
   */
  processBusData(bus) {
    // Formato normalizado do worker (/vehicles) ou MQTT
    if (Number.isFinite(bus.lat) && Number.isFinite(bus.lng)) {
      const line      = this.extractLineNumber(bus);
      const direction = this.extractDirection(bus);
      const tripId    = this.extractTripId(bus);

      const source = bus.source || 'stcp';
      if (source !== 'unir' && (!line || direction == null)) return null;


      // Destino: usar o valor do tópico se disponível, senão resolver preguiçosamente
      const destination = (bus.destination != null && bus.destination !== '')
          ? normalizeDestinationText(bus.destination)
          : null;

      // ── UNIR: displayLine = número tal qual (sem alias), cor via getUnirLineColor
      const displayLine = bus.source === 'unir'
          ? String(line)
          : this.getDisplayLine(line);

      // busNumber: do tópico MQTT se disponível, senão do campo id
      const busNumber = bus.busNumber || bus.id || 'N/A';

      const safeLine      = line || (source === 'unir' ? (bus.line || bus.route || '') : '');
      const safeDirection = direction != null ? direction : (source === 'unir' ? 0 : null);

      if (source !== 'unir' && (!safeLine || safeDirection == null)) return null;

      return {
        id:          String(bus.id),
        line:        safeLine,
        displayLine,
        latitude:    bus.lat,
        longitude:   bus.lng,
        nextStop:    bus.nextStop || null,
        busNumber,
        destination,
        direction:   safeDirection,
        tripId,
        source,
      };
    }

    // Formato FIWARE bruto
    const line      = this.extractLineNumber(bus);
    const direction = this.extractDirection(bus);
    const tripId    = this.extractTripId(bus);
    const lat       = bus.location?.value?.coordinates?.[1];
    const lon       = bus.location?.value?.coordinates?.[0];

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (!line || direction == null) return null;

    // Normalizar ID FIWARE: "urn:ngsi-ld:Vehicle:3261" → "3261"
    // Garante que o id coincide com o número do veículo usado pelo MQTT,
    // evitando marcadores duplicados no BusMarkerManager.
    const normalizedId = _normalizeFiwareId(bus.id);

    return {
      id:          normalizedId,
      line,
      displayLine: this.getDisplayLine(line),
      latitude:    lat,
      longitude:   lon,
      busNumber:   normalizedId,
      destination: null,
      nextStop: null,
      direction,
      tripId
    };
  }

  processBusDataBatch(buses) {
    if (!Array.isArray(buses)) return [];
    return buses.map(b => this.processBusData(b)).filter(Boolean);
  }

  /**
   * Resolve o headsign ao clicar no marker.
   * Só é chamado se bus.destination for null (ou seja, não veio do tópico MQTT).
   * O serviceId é obtido do cache (aquecido em loadScheduleData)
   * e passado directamente a getHeadsignForTrip.
   */
  async resolveHeadsign(bus) {
    // Se o destino já foi resolvido (ex: via tópico MQTT), devolver directamente
    if (bus.destination) return normalizeDestinationText(bus.destination);

    // UNIR: resolver via GTFS local trips.txt
    if (bus.source === 'unir' && bus.tripId) {
      try {
        const destination = await this.resolveUnirHeadsign(bus.tripId);
        if (destination) return normalizeDestinationText(destination);
      } catch {}
    }

    if (!bus.tripId || !bus.line || bus.direction == null) return 'Destino desconhecido';
    try {
      const serviceId = await scheduleService.getServiceIdAtual();
      const headsign = await scheduleService.getHeadsignForTrip(bus.tripId, bus.line, bus.direction, serviceId);
      return normalizeDestinationText(headsign);
    } catch {
      return 'Destino desconhecido';
    }
  }

  async resolveUnirHeadsign(tripId) {
    try {
      const response = await fetch('./resources/unir-gtfs/trips.txt');
      if (!response.ok) return null;

      const text  = await response.text();
      const lines = text.split('\n');

      // Prefixo até ao penúltimo ':' – ex: "AU:9018:0:1:1850" → "AU:9018:0:1:"
      let prefix = tripId;
      const lastColon = tripId.lastIndexOf(':');
      if (lastColon > 0) {
        prefix = tripId.slice(0, lastColon + 1); // inclui o ':'
      }

      let fallbackHeadsign = null;

      for (const line of lines) {
        if (!line) continue;

        // 1) tentativa exacta
        if (line.includes(tripId)) {
          const match = line.match(/"([^"]+)"/);
          if (match) return match[1];
        }

        // 2) fallback por prefixo (ignora hora nos últimos dígitos)
        if (!fallbackHeadsign && prefix && line.includes(prefix)) {
          const match = line.match(/"([^"]+)"/);
          if (match) fallbackHeadsign = match[1];
        }
      }

      return fallbackHeadsign;
    } catch {
      return null;
    }
  }

  /**
   * Resolve o delay de um veículo consultando as chegadas da sua próxima paragem.
   * @param {Object} vehicle - Veículo processado com nextStop e tripId
   * @returns {Promise<number|null>} Delay em segundos, ou null se não encontrado
   */
  async resolveVehicleDelay(vehicle) {
    if (!vehicle.nextStop) return null;

    // Importar plannedArrivalsService no topo do ficheiro se ainda não estiver
    const { plannedArrivalsService } = await import('./plannedArrivalsService.js');

    try {
      // Buscar próximas chegadas para a paragem (com cache de 30s)
      const arrivals = await plannedArrivalsService.getNextArrivals(
          vehicle.nextStop,
          10, // Apenas primeiras 10 chegadas
          false // Usar cache
      );

      if (!arrivals || arrivals.length === 0) return null;

      // Tentar match por tripId exacto
      if (vehicle.tripId) {
        const exactMatch = arrivals.find(a =>
            a.trip_id && this.tripIdsMatch(vehicle.tripId, a.trip_id)
        );
        if (exactMatch && exactMatch.delay != null) {
          return exactMatch.delay;
        }
      }

      // Fallback: match por linha
      const lineMatch = arrivals.find(a =>
          String(a.route_short_name || '') === String(vehicle.displayLine || vehicle.line || '')
      );

      return (lineMatch && lineMatch.delay != null) ? lineMatch.delay : null;

    } catch (err) {
      console.warn(`Erro ao resolver delay para veículo ${vehicle.id}:`, err);
      return null;
    }
  }
}

export const vehicleService = new VehicleService();

/**
 * Vehicle Service - Lógica centralizada de processamento de dados de autocarros
 *
 * LAZY HEADSIGN: processBusData / processBusDataBatch já NÃO resolvem o
 * destino (headsign). Esse campo fica como null até ao primeiro clique no
 * marker, altura em que resolveHeadsign() é chamado e o popup é actualizado.
 * Isto elimina as chamadas /route/{id}/schedule na inicialização.
 *
 * TRIP MATCHING: A STCP disponibiliza o trip_id no formato:
 *   {linha}_{dir}_{seq}|{nr_viagem}|{dia}|{turno}|{servico}
 * Exemplo: "600_0_2|218|D6|T7|N16" (localização FIWARE)
 *          "600_0_2|219|D6|T7|N16" (chegadas em tempo real)
 * O 2º segmento (nr_viagem) pode diferir entre as duas fontes.
 * O matching é feito comparando o 1º segmento (prefixo) e os últimos
 * dois segmentos (turno|servico), ignorando o nr_viagem do meio.
 */

import { scheduleService } from './scheduleService.js';

class VehicleService {
  extractAnnotation(bus, prefix) {
    if (!bus.annotations?.value) return null;
    for (const annotation of bus.annotations.value) {
      const decoded = decodeURIComponent(annotation);
      if (decoded.startsWith(prefix)) return decoded.slice(prefix.length);
    }
    return null;
  }

  extractLineNumber(bus)  { return this.extractAnnotation(bus, 'stcp:route:'); }
  extractDirection(bus)   { return this.extractAnnotation(bus, 'stcp:sentido:'); }
  extractTripId(bus)      { return this.extractAnnotation(bus, 'stcp:nr_viagem:'); }

  /**
   * Extrai a "chave de viagem" de um trip_id para efeitos de matching.
   * Formato: {prefixo}|{nr_viagem}|{dia}|{turno}|{servico}
   * A chave de match usa o prefixo + turno + servico, ignorando o nr_viagem.
   * Se o trip_id não tiver pipes (formato simples), devolve o próprio trip_id.
   * @param {string} tripId
   * @returns {string|null}
   */
  _tripMatchKey(tripId) {
    if (!tripId) return null;
    const parts = tripId.split('|');
    if (parts.length < 5) return tripId; // formato simples, comparar direto
    // prefixo (600_0_2) + turno (T7) + servico (N16)
    return `${parts[0]}|${parts[3]}|${parts[4]}`;
  }

  /**
   * Verifica se dois trip_ids correspondem à mesma viagem.
   * Ignora o 2º segmento (nr_viagem) que pode diferir entre FIWARE e STCP API.
   * @param {string} vehicleTripId - trip_id vindo do FIWARE (nr_viagem da localização)
   * @param {string} arrivalTripId - trip_id vindo das chegadas em tempo real
   * @returns {boolean}
   */
  tripIdsMatch(vehicleTripId, arrivalTripId) {
    if (!vehicleTripId || !arrivalTripId) return false;
    if (vehicleTripId === arrivalTripId) return true;
    return this._tripMatchKey(vehicleTripId) === this._tripMatchKey(arrivalTripId);
  }

  /**
   * Encontra o veículo que corresponde a um trip_id de uma chegada.
   * Usa tripIdsMatch para tolerar diferenças no nr_viagem.
   * @param {Array} vehicles - lista de veículos do FIWARE
   * @param {string} tripId - trip_id vindo das chegadas em tempo real
   * @returns {Object|null}
   */
  matchVehicleToTrip(vehicles, tripId) {
    if (!Array.isArray(vehicles) || !tripId) return null;
    return vehicles.find(vehicle => {
      const vehicleTripId = this.extractTripId(vehicle);
      return this.tripIdsMatch(vehicleTripId, tripId);
    }) || null;
  }

  extractVehicleLocation(vehicle) {
    if (!vehicle?.location?.value) return null;
    const coords = vehicle.location.value.coordinates;
    if (!coords || coords.length < 2) return null;
    return {
      latitude:  coords[1],
      longitude: coords[0],
      bearing:   vehicle.bearing?.value || vehicle.heading?.value || 0,
      speed:     vehicle.speed?.value || 0
    };
  }

  /**
   * Processa um autocarro SEM resolver o headsign (lazy).
   * O campo destination fica null até ao clique no marker.
   */
  processBusData(bus) {
    const line      = this.extractLineNumber(bus);
    const direction = this.extractDirection(bus);
    const tripId    = this.extractTripId(bus);
    const lat       = bus.location?.value?.coordinates?.[1];
    const lon       = bus.location?.value?.coordinates?.[0];

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (!line || direction == null) return null;

    return {
      id:          bus.id,
      line,
      latitude:    lat,
      longitude:   lon,
      speed:       bus.speed?.value ?? 'N/A',
      busNumber:   bus.fleetVehicleId?.value ?? 'N/A',
      destination: null,   // resolvido lazy ao clicar
      direction,
      tripId
    };
  }

  /**
   * Processa múltiplos autocarros em paralelo (síncrono, sem headsign).
   */
  processBusDataBatch(buses) {
    if (!Array.isArray(buses)) return [];
    return buses.map(b => this.processBusData(b)).filter(b => b !== null);
  }

  /**
   * Resolve o headsign de um autocarro já processado.
   * Chamado apenas quando o utilizador clica no marker.
   * @param {object} bus - resultado de processBusData
   * @returns {Promise<string>}
   */
  async resolveHeadsign(bus) {
    if (!bus.tripId || !bus.line || bus.direction == null) return 'Destino desconhecido';
    try {
      return await scheduleService.getHeadsignForTrip(bus.tripId, bus.line, bus.direction);
    } catch {
      return 'Destino desconhecido';
    }
  }

  shouldIncludeBus(bus, filterValue) {
    return filterValue === '' || (bus.line && bus.line.startsWith(filterValue));
  }
}

export const vehicleService = new VehicleService();

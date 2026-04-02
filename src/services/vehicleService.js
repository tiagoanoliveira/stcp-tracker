/**
 * Vehicle Service - Lógica centralizada de processamento de dados de autocarros
 *
 * LAZY HEADSIGN: processBusData / processBusDataBatch já NÃO resolvem o
 * destino (headsign). Esse campo fica como null até ao primeiro clique no
 * marker, altura em que resolveHeadsign() é chamado e o popup é actualizado.
 * Isto elimina as chamadas /route/{id}/schedule na inicialização.
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
   * Constrói uma chave de comparação de trip_id ignorando o 2º segmento
   * numérico (separado por |), que pode diferir entre a anotação do veículo
   * e o trip_id das próximas chegadas das paragens.
   *
   * Exemplo:
   *   Veículo : "600_0_2|218|D6|T7|N16"
   *   Paragem : "600_0_2|219|D6|T7|N16"
   *   Chave   : "600_0_2|D6|T7|N16"  (igual em ambos)
   *
   * @param {string} tripId
   * @returns {string|null}
   */
  tripMatchKey(tripId) {
    if (!tripId) return null;
    const parts = tripId.split('|');
    // O formato é: <linha_dir>|<seq>|<dia>|<turno>|<servico>|...
    // Removemos o 2º elemento (índice 1) que é o número de sequência variável.
    if (parts.length < 2) return tripId; // formato inesperado — usar tal-qual
    return [parts[0], ...parts.slice(2)].join('|');
  }

  /**
   * Verifica se dois trip_ids correspondem ao mesmo serviço,
   * ignorando o 2º segmento numérico variável.
   *
   * @param {string} vehicleTripId  - trip_id vindo da anotação stcp:nr_viagem do veículo
   * @param {string} arrivalTripId  - trip_id vindo das próximas chegadas da paragem
   * @returns {boolean}
   */
  matchTripIds(vehicleTripId, arrivalTripId) {
    if (!vehicleTripId || !arrivalTripId) return false;
    // Tentativa de correspondência exacta (caso os dados já coincidam)
    if (vehicleTripId === arrivalTripId) return true;
    // Correspondência ignorando o 2º segmento
    return this.tripMatchKey(vehicleTripId) === this.tripMatchKey(arrivalTripId);
  }

  /**
   * Encontra o veículo correspondente a um trip_id de chegada.
   * Usa matchTripIds() para tolerar a diferença no 2º segmento numérico.
   *
   * @param {Array}  vehicles - lista de veículos devolvida pela API
   * @param {string} tripId   - trip_id da chegada em tempo real
   * @returns {object|null}
   */
  matchVehicleToTrip(vehicles, tripId) {
    if (!Array.isArray(vehicles) || !tripId) return null;
    return vehicles.find(vehicle => {
      const vehicleTripId = this.extractTripId(vehicle);
      return this.matchTripIds(vehicleTripId, tripId);
    });
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

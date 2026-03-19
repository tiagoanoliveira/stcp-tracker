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

  matchVehicleToTrip(vehicles, tripId) {
    if (!Array.isArray(vehicles) || !tripId) return null;
    return vehicles.find(vehicle =>
      vehicle.annotations?.value?.some(a => decodeURIComponent(a) === `stcp:nr_viagem:${tripId}`)
    );
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

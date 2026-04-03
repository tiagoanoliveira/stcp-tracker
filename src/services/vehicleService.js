/**
 * Vehicle Service - Lógica centralizada de processamento de dados de autocarros
 *
 * LAZY HEADSIGN: processBusData / processBusDataBatch não resolvem o destino.
 * Esse campo fica null até ao primeiro clique no marker, altura em que
 * resolveHeadsign() é chamado e o popup é actualizado.
 *
 * TRIP MATCHING: A STCP usa o formato:
 *   {linha}_{dir}_{seq}|{nr_viagem}|{dia}|{turno}|{servico}
 * O 2º segmento (nr_viagem) pode diferir entre FIWARE e API STCP.
 * O matching compara apenas o 1º segmento (prefixo) + turno + servico.
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

  extractLineNumber(bus) { return this.extractAnnotation(bus, 'stcp:route:'); }
  extractDirection(bus)  { return this.extractAnnotation(bus, 'stcp:sentido:'); }
  extractTripId(bus)     { return this.extractAnnotation(bus, 'stcp:nr_viagem:'); }

  /**
   * Chave de matching que ignora o nr_viagem (2º segmento).
   * Exemplo: "600_0_2|218|D6|T7|N16" -> "600_0_2|T7|N16"
   */
  _tripMatchKey(tripId) {
    if (!tripId) return null;
    const parts = tripId.split('|');
    if (parts.length < 5) return tripId;
    return `${parts[0]}|${parts[3]}|${parts[4]}`;
  }

  tripIdsMatch(vehicleTripId, arrivalTripId) {
    if (!vehicleTripId || !arrivalTripId) return false;
    if (vehicleTripId === arrivalTripId) return true;
    return this._tripMatchKey(vehicleTripId) === this._tripMatchKey(arrivalTripId);
  }

  matchVehicleToTrip(vehicles, tripId) {
    if (!Array.isArray(vehicles) || !tripId) return null;
    return vehicles.find(v => this.tripIdsMatch(this.extractTripId(v), tripId)) || null;
  }

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
      destination: null, // resolvido lazy ao clicar
      direction,
      tripId
    };
  }

  processBusDataBatch(buses) {
    if (!Array.isArray(buses)) return [];
    return buses.map(b => this.processBusData(b)).filter(Boolean);
  }

  /**
   * Resolve o headsign de um autocarro ao clicar no marker.
   * Obtém o serviceId do cache do scheduleService (já aquecido em loadScheduleData)
   * e passa-o directamente para getHeadsignForTrip.
   */
  async resolveHeadsign(bus) {
    if (!bus.tripId || !bus.line || bus.direction == null) return 'Destino desconhecido';
    try {
      const serviceId = await scheduleService.getServiceIdAtual();
      return await scheduleService.getHeadsignForTrip(bus.tripId, bus.line, bus.direction, serviceId);
    } catch {
      return 'Destino desconhecido';
    }
  }

  shouldIncludeBus(bus, filterValue) {
    return filterValue === '' || (bus.line && bus.line.startsWith(filterValue));
  }
}

export const vehicleService = new VehicleService();

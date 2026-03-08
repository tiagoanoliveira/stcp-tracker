/**
 * Vehicle Service - Lógica centralizada de processamento de dados de autocarros
 * Usa: scheduleService
 * Responsável por: extração de anotações, processamento de dados, matching
 */

import { scheduleService } from './scheduleService.js';

class VehicleService {
  /**
   * Extrair anotação de um autocarro por prefixo
   */
  extractAnnotation(bus, prefix) {
    if (!bus.annotations || !bus.annotations.value) return null;
    
    for (const annotation of bus.annotations.value) {
      const decoded = decodeURIComponent(annotation);
      if (decoded.startsWith(prefix)) {
        return decoded.slice(prefix.length);
      }
    }
    return null;
  }

  /**
   * Extrair número da linha do autocarro
   */
  extractLineNumber(bus) {
    return this.extractAnnotation(bus, "stcp:route:");
  }

  /**
   * Extrair sentido/direção do autocarro
   */
  extractDirection(bus) {
    return this.extractAnnotation(bus, "stcp:sentido:");
  }

  /**
   * Extrair ID da viagem (trip_id) do autocarro
   */
  extractTripId(bus) {
    return this.extractAnnotation(bus, "stcp:nr_viagem:");
  }

  /**
   * Match de um veículo com uma viagem específica
   */
  matchVehicleToTrip(vehicles, tripId) {
    if (!Array.isArray(vehicles) || !tripId) return null;

    return vehicles.find(vehicle => {
      if (!vehicle.annotations || !vehicle.annotations.value) return false;
      
      return vehicle.annotations.value.some(annotation => {
        const decoded = decodeURIComponent(annotation);
        return decoded === `stcp:nr_viagem:${tripId}`;
      });
    });
  }

  /**
   * Extrair localização de um veículo
   */
  extractVehicleLocation(vehicle) {
    if (!vehicle || !vehicle.location || !vehicle.location.value) {
      return null;
    }

    const coords = vehicle.location.value.coordinates;
    if (!coords || coords.length < 2) return null;

    return {
      latitude: coords[1],
      longitude: coords[0],
      bearing: vehicle.bearing?.value || vehicle.heading?.value || 0,
      speed: vehicle.speed?.value || 0
    };
  }

  /**
   * ⭐ ASYNC: Processar dados completos de um autocarro
   * Agora usa API para obter destino em vez de trips.json
   * @param {object} bus - Objeto do autocarro da API
   * @returns {Promise<object|null>} Objeto processado ou null se inválido
   */
  async processBusData(bus) {
    const line = this.extractLineNumber(bus);
    const direction = this.extractDirection(bus);
    const tripId = this.extractTripId(bus);
    const lat = bus.location?.value?.coordinates?.[1];
    const lon = bus.location?.value?.coordinates?.[0];

    // Validar coordenadas
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }

    // Validar dados mínimos
    if (!line || direction == null) {
      return null;
    }

    // ✨ Obter destino via API (assíncrono)
    let destination = 'Destino Desconhecido';
    if (tripId && line && direction != null) {
      try {
        destination = await scheduleService.getHeadsignForTrip(tripId, line, direction);
      } catch (error) {
        console.warn(`⚠️ Erro ao obter destino para ${line}/${tripId}:`, error.message);
      }
    }

    const speed = bus.speed ? bus.speed.value : 'N/A';
    const busNumber = bus.fleetVehicleId ? bus.fleetVehicleId.value : 'N/A';

    return {
      id: bus.id,
      line,
      latitude: lat,
      longitude: lon,
      speed,
      busNumber,
      destination,
      direction,
      tripId
    };
  }

  /**
   * ⭐ NOVO: Processar múltiplos autocarros em paralelo
   * @param {Array} buses - Array de autocarros da API
   * @returns {Promise<Array>} Array de autocarros processados
   */
  async processBusDataBatch(buses) {
    if (!Array.isArray(buses)) return [];
    
    // Processar todos em paralelo
    const promises = buses.map(bus => this.processBusData(bus));
    const results = await Promise.all(promises);
    
    // Filtrar nulos
    return results.filter(bus => bus !== null);
  }

  /**
   * Verificar se um autocarro deve ser incluído (filtro)
   */
  shouldIncludeBus(bus, filterValue) {
    return filterValue === '' || (bus.line && bus.line.startsWith(filterValue));
  }
}

export const vehicleService = new VehicleService();

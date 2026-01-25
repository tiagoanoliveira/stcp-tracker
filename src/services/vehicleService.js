/**
 * Vehicle Service - Lógica centralizada de processamento de dados de autocarros
 * Responsável por: extração de anotações, processamento de dados, matching
 */

class VehicleService {
  /**
   * Extrair anotação de um autocarro por prefixo
   * @param {object} bus - Objeto do autocarro
   * @param {string} prefix - Prefixo da anotação (ex: "stcp:route:")
   * @returns {string|null} Valor da anotação ou null
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
   * @param {object} bus - Objeto do autocarro
   * @returns {string|null}
   */
  extractLineNumber(bus) {
    const line = this.extractAnnotation(bus, "stcp:route:");
    if (!line) console.warn(`⚠ Linha não encontrada para autocarro ${bus.id}`);
    return line;
  }

  /**
   * Extrair sentido/direção do autocarro
   * @param {object} bus - Objeto do autocarro
   * @returns {string|null}
   */
  extractDirection(bus) {
    const direction = this.extractAnnotation(bus, "stcp:sentido:");
    if (direction === null) console.warn(`⚠ Sentido não encontrado para autocarro ${bus.id}`);
    return direction;
  }

  /**
   * Extrair ID da viagem (trip_id) do autocarro
   * @param {object} bus - Objeto do autocarro
   * @returns {string|null}
   */
  extractTripId(bus) {
    return this.extractAnnotation(bus, "stcp:nr_viagem:");
  }

  /**
   * Match de um veículo com uma viagem específica
   * @param {array} vehicles - Array de veículos
   * @param {string} tripId - ID da viagem a procurar
   * @returns {object|null} Veículo encontrado ou null
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
   * @param {object} vehicle - Objeto do veículo
   * @returns {object|null} Objeto com latitude, longitude, bearing, speed
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
   * Processar dados completos de um autocarro
   * @param {object} bus - Objeto do autocarro da API
   * @param {string} destination - Destino/headsign
   * @returns {object|null} Objeto processado ou null se inválido
   */
  processBusData(bus, destination = 'Destino Desconhecido') {
    const line = this.extractLineNumber(bus);
    const direction = this.extractDirection(bus);
    const tripId = this.extractTripId(bus);
    const lat = bus.location?.value?.coordinates?.[1];
    const lon = bus.location?.value?.coordinates?.[0];

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      console.warn(`⚠ Coordenadas inválidas para autocarro ${bus.id}`);
      return null;
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
   * Verificar se um autocarro deve ser incluindo (filtro)
   * @param {object} bus - Objeto do autocarro processado
   * @param {string} filterValue - Valor de filtro (número da linha)
   * @returns {boolean}
   */
  shouldIncludeBus(bus, filterValue) {
    return filterValue === '' || (bus.line && bus.line.startsWith(filterValue));
  }
}

export const vehicleService = new VehicleService();

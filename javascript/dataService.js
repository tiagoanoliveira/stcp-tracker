// dataService.js - Versão corrigida e simplificada
class DataService {
  constructor() {
    this.trips = [];
    this.calendar = {};
    this.apiUrl = 'https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType==bus&limit=1000';
  }

  // Carregar trips do JSON (array simples)
  async carregarTrips() {
    try {
      const response = await fetch('./javascript/trips.json');
      this.trips = await response.json();
    } catch (error) {
      console.error('Erro ao carregar trips:', error);
      this.trips = [];
    }
  }

  // Carregar calendar do JSON (objeto mapeado por service_id)
  async carregarCalendar() {
    try {
      const response = await fetch('./javascript/calendar.json');
      const calendarArray = await response.json();
      this.calendar = {};
      for (const service of calendarArray) {
        this.calendar[service.service_id] = service;
      }
    } catch (error) {
      console.error('Erro ao carregar calendar:', error);
      this.calendar = {};
    }
  }

  // Obter service_id atual simplificado: UTEIS, SAB, DOM
  obterServiceIdAtual() {
    const dateNow = new Date();
    const yyyyMMdd = dateNow.toISOString().slice(0, 10).replace(/-/g, '');
    const weekday = dateNow.getDay(); // 0=domingo, 6=sábado

    const dayMap = {
      0: 'DOM',
      6: 'SAB',
      1: 'UTEIS',
      2: 'UTEIS',
      3: 'UTEIS',
      4: 'UTEIS',
      5: 'UTEIS'
    };

    const currentServiceId = dayMap[weekday];
    const service = this.calendar[currentServiceId];
    if (service && service.start_date <= yyyyMMdd && service.end_date >= yyyyMMdd) {
      return currentServiceId;
    }
    return null;
  }

  // Extrair número da linha (route)
  extractLineNumber(bus) {
    if (!bus.annotations || !bus.annotations.value) return null;
    for (const annotation of bus.annotations.value) {
      const decoded = decodeURIComponent(annotation);
      if (decoded.startsWith("stcp:route:")) {
        return decoded.slice("stcp:route:".length);
      }
    }
    return null;
  }

  // Extrair sentido (direction) como string
  extractDirectionRaw(bus) {
    if (!bus.annotations || !bus.annotations.value) return null;
    for (const annotation of bus.annotations.value) {
      const decoded = decodeURIComponent(annotation);
      if (decoded.startsWith("stcp:sentido:")) {
        return decoded.slice("stcp:sentido:".length);
      }
    }
    return null;
  }

  // Obter destino baseado no trips.json (busca por route_id, direction_id e service_id)
  obterDestino(line, sentido) {
    const serviceId = this.obterServiceIdAtual();
    if (!serviceId) {
      console.warn('Não foi possível determinar serviceId atual.');
      return 'Destino Desconhecido';
    }
    if (!line || sentido == null) {
      return 'Destino Desconhecido';
    }

    const direction = sentido.toString();

    const trip = this.trips.find(t =>
      t.route_id === line &&
      t.direction_id === direction &&
      t.service_id === serviceId
    );

    return trip?.trip_headsign || 'Destino Desconhecido';
  }

  // Buscar dados dos autocarros da API com fallback para evitar falha total
  async fetchBusData(filterValue = '') {
    try {
      const response = await fetch(this.apiUrl);
      const data = await response.json();
      if (!Array.isArray(data)) {
        console.error('Dados inválidos:', data);
        return [];
      }
      return data
        .map(bus => this.processBusData(bus))
        .filter(bus => bus && this.shouldIncludeBus(bus, filterValue));
    } catch (error) {
      console.error('Erro ao obter dados dos autocarros:', error);
      return [];
    }
  }

  // Processar dados de um autocarro individual
  processBusData(bus) {
    const line = this.extractLineNumber(bus);
    const sentidoRaw = this.extractDirectionRaw(bus);
    const destino = this.obterDestino(line, sentidoRaw);
    const lat = bus.location?.value?.coordinates?.[1];
    const lon = bus.location?.value?.coordinates?.[0];
    if (lat === undefined || lon === undefined) return null;
    const speed = bus.speed ? bus.speed.value : 'N/A';
    const busNumber = bus.fleetVehicleId ? bus.fleetVehicleId.value : 'N/A';
    return {
      id: bus.id,
      line: line,
      latitude: lat,
      longitude: lon,
      speed: speed,
      busNumber: busNumber,
      destino: destino,
      sentidoRaw: sentidoRaw
    };
  }

  // Filtro simples por linha
  shouldIncludeBus(bus, filterValue) {
    return filterValue === '' || (bus.line && bus.line.startsWith(filterValue));
  }
}

// Exportar instância singleton
export const dataService = new DataService();

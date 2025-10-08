class DataService {
  constructor() {
    this.trips = [];
    this.calendar = {};
    this.apiUrl = 'https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType==bus&limit=1000';
    this.cachedServiceId = null;
    this.cachedServiceDate = null;
  }

  async carregarTrips() {
    try {
      const response = await fetch('./javascript/trips.json');
      this.trips = await response.json();
    } catch (error) {
      console.error('Erro ao carregar trips:', error);
      this.trips = [];
    }
  }

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

  // Cacheia o service_id atual por dia para evitar cálculos repetidos
  obterServiceIdAtual() {
    const dateNow = new Date();
    const yyyyMMdd = dateNow.toISOString().slice(0, 10).replace(/-/g, '');

    if (this.cachedServiceDate === yyyyMMdd && this.cachedServiceId) {
      return this.cachedServiceId;
    }

    const weekday = dateNow.getDay();
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
      this.cachedServiceDate = yyyyMMdd;
      this.cachedServiceId = currentServiceId;
      return currentServiceId;
    }
    this.cachedServiceId = null;
    return null;
  }

  // Auxiliar geral para extrair annotations por prefixo
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

  extractLineNumber(bus) {
    const line = this.extractAnnotation(bus, "stcp:route:");
    if (!line) console.warn(`Linha não encontrada para autocarro ${bus.id}`);
    return line;
  }

  extractDirectionRaw(bus) {
    const direction = this.extractAnnotation(bus, "stcp:sentido:");
    if (direction === null) console.warn(`Sentido não encontrado para autocarro ${bus.id}`);
    return direction;
  }

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

  // Exemplo simples de retry no fetch (3 tentativas)
  async fetchWithRetry(url, options = {}, retries = 3, delayMs = 500) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
      } catch (error) {
        if (i === retries -1) throw error;
        await new Promise(res => setTimeout(res, delayMs));
      }
    }
  }

  async fetchBusData(filterValue = '') {
    try {
      const data = await this.fetchWithRetry(this.apiUrl);
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

  processBusData(bus) {
    const line = this.extractLineNumber(bus);
    const sentidoRaw = this.extractDirectionRaw(bus);
    const destino = this.obterDestino(line, sentidoRaw);
    const lat = bus.location?.value?.coordinates?.[1];
    const lon = bus.location?.value?.coordinates?.[0];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      console.warn(`Coordenadas inválidas para autocarro ${bus.id}`);
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
      destino,
      sentidoRaw
    };
  }

  shouldIncludeBus(bus, filterValue) {
    return filterValue === '' || (bus.line && bus.line.startsWith(filterValue));
  }
}

export const dataService = new DataService();

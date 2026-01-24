class DataService {
  constructor() {
    this.trips = [];
    this.specialPeriods = []; // Substitui o calendar
    this.apiUrl = 'https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType==bus&limit=1000';
    this.cachedServiceId = null;
    this.cachedServiceDate = null;
  }

  async carregarTrips() {
    try {
      const response = await fetch('./resources/trips.json');
      this.trips = await response.json();
    } catch (error) {
      console.error('Erro ao carregar trips:', error);
      this.trips = [];
    }
  }

  async carregarCalendar() {
    try {
      const response = await fetch('./resources/calendar.json');
      this.specialPeriods = await response.json();
    } catch (error) {
      console.error('Erro ao carregar calendar:', error);
      this.specialPeriods = [];
    }
  }

  // Determina o service_id baseado no dia atual e períodos especiais
  obterServiceIdAtual() {
    const dateNow = new Date();
    const yyyyMMdd = dateNow.toISOString().slice(0, 10).replace(/-/g, '');

    // Verifica cache
    if (this.cachedServiceDate === yyyyMMdd && this.cachedServiceId) {
      return this.cachedServiceId;
    }

    // Determina o tipo de dia base (U, S, D)
    const weekday = dateNow.getDay();
    let serviceId;

    if (weekday === 0) {
      serviceId = 'D'; // Domingo
    } else if (weekday === 6) {
      serviceId = 'S'; // Sábado
    } else {
      serviceId = 'U'; // Útil (segunda a sexta)
    }

    // Verifica se está num período especial
    const specialPeriod = this.specialPeriods.find(period =>
        period.start_date <= yyyyMMdd && period.end_date >= yyyyMMdd
    );

    if (specialPeriod) {
      if (specialPeriod.description === 'FERIADO') {
        // Feriados usam horário de domingo
        serviceId = 'D';
      } else if (specialPeriod.description === 'FERIAS') {
        // Férias escolares: F (útil), G (sábado), H (domingo)
        if (weekday === 0) {
          serviceId = 'H';
        } else if (weekday === 6) {
          serviceId = 'G';
        } else {
          serviceId = 'F';
        }
      }
    }

    // Cacheia o resultado
    this.cachedServiceDate = yyyyMMdd;
    this.cachedServiceId = serviceId;

    return serviceId;
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

    console.log('  - Linha (route_id):', line);
    console.log('  - Sentido (direction_id):', sentido);
    console.log('  - Service ID:', serviceId);

    if (!line || sentido == null) {
      return 'Destino Desconhecido';
    }

    const direction = sentido.toString();
    //DEBUG START
    const tripsForLine = this.trips.filter(t => t.route_id === line);
    console.log(`Trips disponíveis para linha ${line}:`, tripsForLine.length);


    if (tripsForLine.length > 0) {
      console.log('Exemplo de trip desta linha:', tripsForLine[0]);
      console.log('Service IDs disponíveis para esta linha:',
          [...new Set(tripsForLine.map(t => t.service_id))]);
    }
    //DEBUG END
    const trip = this.trips.find(t =>
        t.route_id === line &&
        t.direction_id === direction &&
        t.service_id === serviceId
    );
    //DEBUG START
    if (trip) {
      console.log('✅ Trip encontrado:', trip.trip_headsign);
    } else {
      console.log('❌ Nenhum trip encontrado com estes critérios');
      // Mostra trips similares para debug
      const similarTrips = this.trips.filter(t =>
          t.route_id === line && t.direction_id === direction
      );
      console.log('Trips com mesma linha e sentido (service_id diferente):',
          similarTrips.map(t => ({ service_id: t.service_id, headsign: t.trip_headsign })));
    }
    console.log('========================\n');
    // DEBUG END
    return trip?.trip_headsign || `Destino Desconhecido (${serviceId})`;
  }

  async fetchWithRetry(url, options = {}, retries = 3, delayMs = 500, timeoutMs = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
      } catch (error) {
        if (i === retries - 1) throw error;
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

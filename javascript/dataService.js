// dataService.js - Responsável pela leitura e extração de dados dos autocarros
class DataService {
  constructor() {
    this.trips = {};
    this.calendar = {};
    this.apiUrl = 'https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType==bus&limit=1000';
  }

  // Carregar trips do ficheiro JSON
  async carregarTrips() {
    try {
      const response = await fetch('./javascript/trips.json');
      const tripsArray = await response.json();
      this.trips = {};
      for (const trip of tripsArray) {
        this.trips[trip.trip_id] = trip;
      }
    } catch (error) {
      console.error('Erro ao carregar trips:', error);
    }
  }

  // Carregar calendário do ficheiro JSON
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
    }
  }

  // Converter service_id do calendar.json para abreviação usada no trips.json
  serviceIdToTripAbbr(serviceId) {
    const map = {
      UTEIS: "U",
      SAB: "S",
      DOM: "D",
      UTEISFE: "U",
      SABFE: "S",
      DOMFE: "D",
      ELECUTEIS: "U",
      ELECSAB: "S",
      ELECDOM: "D"
    };
    return map[serviceId] || serviceId;
  }

  // Obter o service_id atual com base na data e dia da semana
  obterServiceIdAtual() {
    const dateNow = new Date();
    const yyyyMMdd = dateNow.toISOString().slice(0, 10).replace(/-/g, '');
    const weekday = dateNow.getDay();
    const weekdayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    for (const serviceId in this.calendar) {
      const service = this.calendar[serviceId];
      if (service.start_date <= yyyyMMdd && service.end_date >= yyyyMMdd) {
        if (service[weekdayMap[weekday]] === "1") {
          return serviceId;
        }
      }
    }
    return null;
  }

  // Extrair número da linha do autocarro
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

  // Extrair direção raw do autocarro (sentido)
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

  // Extrair número da viagem do autocarro
  extractNrViagem(bus) {
    if (!bus.annotations || !bus.annotations.value) return null;
    for (const annotation of bus.annotations.value) {
      const decoded = decodeURIComponent(annotation);
      if (decoded.startsWith("stcp:nr_viagem:")) {
        return decoded.slice("stcp:nr_viagem:".length);
      }
    }
    return null;
  }

  // Construir trip_id para procurar no trips.json
  construirTripId(line, sentido, serviceId, nrViagem) {
    if (!line || sentido == null || !serviceId || !nrViagem) return null;
    const direction = sentido.toString();
    return `${line}_${direction}_${serviceId}_${nrViagem}`;
  }

  // Obter destino baseado no trips.json, recebendo parâmetros necessários
  obterDestino(line, sentido, nrViagem) {
    const serviceId = this.obterServiceIdAtual();
    if (!serviceId) {
      console.warn('Não foi possível determinar serviceId atual.');
      return 'Destino Desconhecido';
    }
    const abbrServiceId = this.serviceIdToTripAbbr(serviceId);
    const tripId = this.construirTripId(line, sentido, abbrServiceId, nrViagem);
    if (!tripId) return 'Destino Desconhecido';

    const trip = this.trips[tripId];
    if (trip && trip.trip_headsign) {
      return trip.trip_headsign;
    }
    return 'Destino Desconhecido';
  }

  // Buscar dados dos autocarros da API
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
    const nrViagem = this.extractNrViagem(bus);
    const destino = this.obterDestino(line, sentidoRaw, nrViagem);
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

  // Verificar se o autocarro deve ser incluído baseado no filtro - geofencing removido aqui
  shouldIncludeBus(bus, filterValue) {
    return filterValue === '' || (bus.line && bus.line.startsWith(filterValue));
  }
}

// Exportar instância singleton
export const dataService = new DataService();

// dataService.js - Versão otimizada, sem uso de destinos.json

class DataService {
  constructor() {
    this.tripIndex = {};        // { trip_id: trip_headsign }
    this.serviceCalendars = []; // [{...}]
    this.apiUrl = 'https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType==bus&limit=1000';
    this.currentService = null; // Ex: 'UTEIS'
    this.initPromise = this.initialize();
  }

  // Inicialização: carrega ambos os ficheiros e prepara tudo
  async initialize() {
    await this.loadCalendar();
    await this.loadTrips();
  }

  // Carregar e processar o calendar.txt
  async loadCalendar() {
    const response = await fetch('calendar.txt');
    const text = await response.text();
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    this.serviceCalendars = lines.slice(1).map(line => {
      const parts = line.split(',').map(p => p.trim());
      const obj = {};
      headers.forEach((h, i) => obj[h] = parts[i]);
      return obj;
    });
    this.currentService = this._getServiceIdForToday();
  }

  // Determina o service_id válido para hoje
  _getServiceIdForToday(date = new Date()) {
    const yyyymmdd = date.toISOString().slice(0, 10).replace(/-/g, '');
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const dayIndex = date.getDay();
    return (
      this.serviceCalendars.find(service =>
        service.start_date <= yyyymmdd &&
        service.end_date >= yyyymmdd &&
        service[days[dayIndex]] === '1'
      )?.service_id || null
    );
  }

  // Carregar trips.txt e indexar por trip_id
  async loadTrips() {
    const response = await fetch('trips.txt');
    const text = await response.text();
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    lines.slice(1).forEach(line => {
      const parts = line.split(',').map(p => p.trim());
      const obj = {};
      headers.forEach((h, i) => obj[h] = parts[i]);
      this.tripIndex[obj.trip_id] = obj.trip_headsign;
    });
  }

  // Extrair número da linha
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

  // Extrair sentido
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

  // Extrair número de viagem
  extractViagemNumber(bus) {
    if (!bus.annotations || !bus.annotations.value) return null;
    for (const annotation of bus.annotations.value) {
      const decoded = decodeURIComponent(annotation);
      if (decoded.startsWith("stcp:nr_viagem:")) {
        return decoded.slice("stcp:nr_viagem:".length);
      }
    }
    return null;
  }

  // Extrair/codificar service code para o trip_id (ex: UTEIS -> 'U', SAB -> 'S', DOM -> 'D')
  serviceIdToCode(serviceId) {
    // Ajuste conforme padrão dos ficheiros, aqui assume-se a primeira letra
    return serviceId ? serviceId.replace(/^ELEC/, '').charAt(0) : '';
  }

  // Construção do trip_id: Ex: 804_1_U_9
  buildTripId(line, sentido, serviceId, viagem) {
    const code = this.serviceIdToCode(serviceId);
    return `${line}_${sentido}_${code}_${viagem}`;
  }

  // Obter destino verdadeiro do autocarro
  getDestino(line, sentido, viagem) {
    const serviceId = this.currentService;
    const tripId = this.buildTripId(line, sentido, serviceId, viagem);
    return this.tripIndex[tripId] || 'Destino Desconhecido';
  }

  // Buscar dados dos autocarros da API
  async fetchBusData(filterValue = '') {
    await this.initPromise; // Garante que índices estão prontos
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
    const viagem = this.extractViagemNumber(bus); // NOVO!
    const destino = this.getDestino(line, sentidoRaw, viagem);

    const lat = bus.location?.value?.coordinates?.[1];
    const lon = bus.location?.value?.coordinates?.[0];
    if (lat == undefined || lon == undefined) return null;

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
      sentidoRaw: sentidoRaw,
      viagem: viagem
    };
  }

  // Filtro opcional por número de linha
  shouldIncludeBus(bus, filterValue) {
    return filterValue === '' || (bus.line && bus.line.startsWith(filterValue));
  }
}

export const dataService = new DataService();

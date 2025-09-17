// dataService.js - Responsável pela leitura e extração de dados dos autocarros
class DataService {
  constructor() {
    this.destinos = {};
    this.apiUrl = 'https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType==bus&limit=1000';
  }

  // Carregar destinos do ficheiro JSON
  async carregarDestinos() {
    try {
      const response = await fetch('destinos.json');
      this.destinos = await response.json();
    } catch (error) {
      console.error('Erro ao carregar destinos:', error);
    }
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

  // Extrair direção raw do autocarro
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

  // Obter destino baseado na linha e sentido
  obterDestino(line, sentido) {
    if (this.destinos[line] && this.destinos[line][sentido]) {
      return this.destinos[line][sentido];
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

      // Processar e filtrar os dados
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
      sentidoRaw: sentidoRaw
    };
  }

  // Verificar se o autocarro deve ser incluído baseado no filtro
  shouldIncludeBus(bus, filterValue) {
    return filterValue === '' || (bus.line && bus.line.startsWith(filterValue));
  }
}

// Exportar instância singleton
export const dataService = new DataService();

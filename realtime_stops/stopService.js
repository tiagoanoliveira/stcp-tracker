class StopService {
  constructor() {
    this.proxyUrl = 'https://stcp.up202007448.workers.dev';
    
    this.vehicleApiUrl = 'https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType==bus&limit=1000';
    this.refreshInterval = 5000; // 5 segundos
  }

  async fetchStopRealtime(stopId) {
    try {
      const url = `${this.proxyUrl}/${stopId}`;
      
      console.log(`Buscando dados da paragem via proxy: ${url}`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Erro HTTP: ${response.status}`);
      }

      const data = await response.json();
      console.log(`Dados recebidos para paragem ${stopId}:`, data);
      return data;
    } catch (error) {
      console.error('Erro ao obter dados da paragem:', error);
      return null;
    }
  }

  async fetchVehicleData() {
    try {
      const response = await fetch(this.vehicleApiUrl);
      
      if (!response.ok) {
        throw new Error(`Erro HTTP: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Erro ao obter dados dos veículos:', error);
      return [];
    }
  }

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

  formatArrivalTime(minutes) {
    if (minutes === 0) return 'A chegar';
    if (minutes === 1) return '1 min';
    return `${Math.round(minutes)} min`;
  }

  getStatusText(status) {
    const statusMap = {
      'ON_TIME': 'No horário',
      'DELAYED': 'Atrasado',
      'EARLY': 'Adiantado'
    };
    return statusMap[status] || status;
  }
}

export const stopService = new StopService();

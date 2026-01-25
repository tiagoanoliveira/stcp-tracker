// stopService.js - Lógica de paragens usando stops.json

import { apiService } from '../core/apiService.js';
import { calculateDistance } from '../map/utils/distanceCalculator.js';

class StopService {
  constructor() {
    this.stops = [];
  }

  async loadStopsData() {
    try {
      const data = await apiService.fetchStopsData();
      this.stops = data.map(stop => ({
        stop_id: stop.stop_code,
        stop_name: stop.stop_name,
        latitude: stop.stop_lat,
        longitude: stop.stop_lon,
        stop_url: stop.stop_url
      }));
      console.log(`${this.stops.length} paragens carregadas`);
      return this.stops;
    } catch (error) {
      console.error('Erro ao carregar stops.json:', error);
      this.stops = [];
      return [];
    }
  }

  getAllStops() {
    return this.stops;
  }

  getNearbyStops(userLat, userLon, maxDistance = 1000) {
    return this.stops
      .map(stop => {
        const distance = calculateDistance(userLat, userLon, stop.latitude, stop.longitude);
        return { ...stop, distance };
      })
      .filter(stop => stop.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance);
  }

  searchStops(query) {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return this.stops;

    return this.stops.filter(stop =>
      stop.stop_name.toLowerCase().includes(lowerQuery) ||
      stop.stop_id.toLowerCase().includes(lowerQuery)
    );
  }

  getStopById(id) {
    return this.stops.find(stop => stop.stop_id === id) || null;
  }
}

export const stopService = new StopService();

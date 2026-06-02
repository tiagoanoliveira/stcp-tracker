/**
 * Geolocation Service - Centraliza gestão de localização do utilizador
 * Emite eventos quando a localização é atualizada
 */

import { eventBus } from './eventBus.js';

class GeolocationService {
  constructor() {
    this.userPosition = null;
    this.watchId = null;
    this.isWatching = false;
  }

  /**
   * Obter localização atual do utilizador uma única vez.
   * Usa maximumAge: 30 000 ms → pode devolver uma posição em cache do browser.
   */
  async getCurrentPosition(options = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }

      const defaultOptions = {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 27000,
        ...options
      };

      navigator.geolocation.getCurrentPosition(
        position => {
          this.userPosition = [
            position.coords.latitude,
            position.coords.longitude
          ];
          eventBus.emit('geolocation:update', this.userPosition);
          resolve(this.userPosition);
        },
        error => {
          eventBus.emit('geolocation:error', error);
          reject(error);
        },
        defaultOptions
      );
    });
  }

  /**
   * Forçar um novo pedido de geolocalização ao browser, sem usar cache.
   * Usar quando se quer a posição ATUAL (ex: ao clicar no botão GPS).
   * maximumAge: 0 garante que o browser faz uma nova leitura do GPS/WiFi.
   */
  async getFreshPosition(options = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }

      const freshOptions = {
        enableHighAccuracy: true,
        maximumAge: 0,        // sem cache — leitura fresca obrigatória
        timeout: 15000,
        ...options
      };

      navigator.geolocation.getCurrentPosition(
        position => {
          this.userPosition = [
            position.coords.latitude,
            position.coords.longitude
          ];
          eventBus.emit('geolocation:update', this.userPosition);
          resolve(this.userPosition);
        },
        error => {
          eventBus.emit('geolocation:error', error);
          reject(error);
        },
        freshOptions
      );
    });
  }

  /**
   * Monitorizar localização em tempo real
   */
  watchPosition(options = {}) {
    if (!navigator.geolocation) {
      return;
    }

    if (this.isWatching) {
      return;
    }

    const defaultOptions = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 27000,
      ...options
    };

    this.watchId = navigator.geolocation.watchPosition(
      position => {
        this.userPosition = [
          position.coords.latitude,
          position.coords.longitude
        ];
        eventBus.emit('geolocation:update', this.userPosition);
      },
      error => {
        eventBus.emit('geolocation:error', error);
      },
      defaultOptions
    );

    this.isWatching = true;
  }

  /**
   * Parar de monitorizar localização
   */
  stopWatching() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      this.isWatching = false;
    }
  }

  /**
   * Obter localização atual em cache
   */
  getPosition() {
    return this.userPosition;
  }

  /**
   * Verificar se a localização está disponível
   */
  isAvailable() {
    return this.userPosition !== null;
  }
}

export const geolocationService = new GeolocationService();

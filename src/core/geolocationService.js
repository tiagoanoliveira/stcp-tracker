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
   * Obter localização atual do utilizador uma única vez
   */
  async getCurrentPosition(options = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        console.warn('⚠ Geolocalização não suportada pelo navegador');
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
          console.log('✓ Localização obtida:', this.userPosition);
          eventBus.emit('geolocation:update', this.userPosition);
          resolve(this.userPosition);
        },
        error => {
          console.warn('⚠ Não foi possível obter a localização:', error);
          eventBus.emit('geolocation:error', error);
          reject(error);
        },
        defaultOptions
      );
    });
  }

  /**
   * Monitorizar localização em tempo real
   */
  watchPosition(options = {}) {
    if (!navigator.geolocation) {
      console.warn('⚠ Geolocalização não suportada pelo navegador');
      return;
    }

    if (this.isWatching) {
      console.log('Já a monitorizar localização');
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
        console.log('📏 Localização atualizada:', this.userPosition);
        eventBus.emit('geolocation:update', this.userPosition);
      },
      error => {
        console.warn('⚠ Erro ao monitorizar localização:', error);
        eventBus.emit('geolocation:error', error);
      },
      defaultOptions
    );

    this.isWatching = true;
    console.log('⏳ A monitorizar localização do utilizador');
  }

  /**
   * Parar de monitorizar localização
   */
  stopWatching() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      this.isWatching = false;
      console.log('⚠ Monitorização de localização parada');
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

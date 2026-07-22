/**
 * Auto Refresh Manager - Centraliza a lógica de atualização automática
 *
 * Suporta dois modos:
 *   - Polling (start/forceRefresh/stop): comportamento original via setTimeout.
 *   - MQTT    (startMqtt):              sem polling — o mapa é atualizado por eventos
 *     emitidos pelo MqttVehicleService. O manager mantém o registo do refresh
 *     activo mas não agenda nenhum setTimeout.
 */

import { eventBus }           from './eventBus.js';
import { mqttVehicleService } from '../services/mqttVehicleService.js';
import { apiService }         from './apiService.js';

class AutoRefreshManager {
  constructor() {
    this.refreshes = {}; // Map de refreshes por ID
  }

  /**
   * Iniciar refresh automático (modo polling).
   * @param {string}   id       - ID único para este refresh
   * @param {function} callback - Função a executar a cada intervalo
   * @param {number}   interval - Intervalo em ms (padrão: 5000)
   */
  start(id, callback, interval = 5000) {
    if (this.refreshes[id]) return;

    let isRefreshing = false;

    const scheduleNext = async () => {
      const startTime = Date.now();
      try {
        if (isRefreshing) return;
        isRefreshing = true;
        await callback();
        const duration = Date.now() - startTime;
        eventBus.emit(`refresh:complete:${id}`, { duration });
      } catch (error) {
        console.error(`❌ Erro durante refresh '${id}':`, error);
        eventBus.emit(`refresh:error:${id}`, error);
      } finally {
        isRefreshing = false;
        if (this.refreshes[id]) {
          this.refreshes[id].timeout = setTimeout(scheduleNext, interval);
        }
      }
    };

    this.refreshes[id] = {
      mode:         'polling',
      callback,
      interval,
      isRefreshing: () => isRefreshing,
      timeout:      setTimeout(scheduleNext, interval),
    };
  }

  /**
   * Inicia o refresh no modo MQTT (event-driven).
   *
   * Em vez de polling, subscreve ao MqttVehicleService e chama
   * onVehicleUpdate por cada mensagem recebida.
   *
   * O bootstrap inicial (snapshot FIWARE) é feito uma única vez aqui.
   *
   * @param {string}   id              - ID único para este refresh
   * @param {function} onVehicleUpdate - callback(vehicle) chamado por cada update MQTT
   * @param {function} onSnapshot      - callback(vehicles[]) para o snapshot inicial
   */
  async startMqtt(id, { onVehicleUpdate, onSnapshot } = {}) {
    if (this.refreshes[id]) {
      console.warn(`⚠ Refresh '${id}' já existe`);
      return;
    }

    this.refreshes[id] = {
      mode:         'mqtt',
      isRefreshing: () => false,
      timeout:      null,
    };

    // Bootstrap: snapshot inicial antes do MQTT ligar
    try {
      const snapshot = await apiService.fetchBusData();
      if (snapshot.length > 0) {
        onSnapshot?.(snapshot);
        eventBus.emit(`refresh:complete:${id}`, { duration: 0, source: 'bootstrap' });
      }
    } catch (err) {
      console.error('❌ Snapshot inicial falhou:', err);
    }

    // Inicia MQTT
    try {
      await mqttVehicleService.start({
        onVehicleUpdate: (vehicle) => {
          onVehicleUpdate?.(vehicle);
          eventBus.emit(`refresh:complete:${id}`, { duration: 0, source: 'mqtt' });
        },
        onConnected:    () => console.info('🟢 MQTT activo — atualizações em tempo real'),
        onDisconnected: () => console.warn('🔴 MQTT desligado — aguardar reconexão…'),
      });
    } catch (err) {
      console.error('❌ MQTT falhou ao iniciar. A recair em polling…', err);
      // Fallback para polling se o MQTT não estiver disponível
      this.stop(id);
      const pollCallback = async () => {
        const vehicles = await apiService.fetchBusData();
        onSnapshot?.(vehicles);
      };
      this.start(id, pollCallback, 15000);
    }
  }

  /**
   * Forçar refresh imediatamente (só faz sentido no modo polling).
   * No modo MQTT, os dados já chegam em tempo real — emite um aviso.
   * @param {string} id - ID do refresh
   */
  async forceRefresh(id) {
    if (!this.refreshes[id]) {
      console.warn(`⚠ Refresh '${id}' não encontrado`);
      return;
    }

    if (this.refreshes[id].mode === 'mqtt') {
      console.info(`ℹ️  Refresh '${id}' em modo MQTT — dados já chegam em tempo real`);
      return;
    }

    const startTime = Date.now();
    try {
      await this.refreshes[id].callback();
      const duration = Date.now() - startTime;
      eventBus.emit(`refresh:complete:${id}`, { duration, forced: true });
    } catch (error) {
      console.error(`❌ Erro durante refresh forçado '${id}':`, error);
      eventBus.emit(`refresh:error:${id}`, error);
    }
  }

  /**
   * Parar refresh automático.
   * @param {string} id - ID do refresh
   */
  stop(id) {
    if (!this.refreshes[id]) return;

    if (this.refreshes[id].mode === 'mqtt') {
      mqttVehicleService.stop();
    } else {
      clearTimeout(this.refreshes[id].timeout);
    }

    delete this.refreshes[id];
    eventBus.emit(`refresh:stopped:${id}`);
  }

  /** Parar todos os refreshes */
  stopAll() {
    Object.keys(this.refreshes).forEach(id => this.stop(id));
  }

  /**
   * Alterar intervalo de um refresh (só relevante no modo polling).
   * @param {string} id       - ID do refresh
   * @param {number} interval - Novo intervalo em ms
   */
  setInterval(id, interval) {
    if (!this.refreshes[id]) {
      console.warn(`⚠ Refresh '${id}' não encontrado`);
      return;
    }
    if (this.refreshes[id].mode === 'mqtt') {
      console.info(`ℹ️  setInterval ignorado — refresh '${id}' está em modo MQTT`);
      return;
    }
    this.refreshes[id].interval = interval;
  }

  /**
   * Obter informações sobre um refresh.
   * @param {string} id - ID do refresh
   */
  getStatus(id) {
    if (!this.refreshes[id]) return null;
    const r = this.refreshes[id];
    return {
      isActive:     true,
      mode:         r.mode,
      isRefreshing: r.isRefreshing(),
      interval:     r.interval ?? null,
      mqttConnected: r.mode === 'mqtt' ? mqttVehicleService.isConnected() : null,
    };
  }
}

export const autoRefreshManager = new AutoRefreshManager();

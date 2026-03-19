/**
 * Auto Refresh Manager - Centraliza a lógica de atualização automática
 * Reutilizável em qualquer componente que necessite de polling
 */

import { eventBus } from './eventBus.js';

class AutoRefreshManager {
  constructor() {
    this.refreshes = {}; // Map de refreshes por ID
  }

  /**
   * Iniciar refresh automático
   * @param {string} id - ID único para este refresh
   * @param {function} callback - Função a executar a cada intervalo
   * @param {number} interval - Intervalo em ms (padrão: 5000)
   */
  start(id, callback, interval = 5000) {
    if (this.refreshes[id]) {
      return;
    }


    let isRefreshing = false;

    const scheduleNext = async () => {
      const startTime = Date.now();
      try {
        if (isRefreshing) {
          return;
        }
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
      callback,
      interval,
      isRefreshing: () => isRefreshing,
      timeout: setTimeout(scheduleNext, interval)
    };
  }

  /**
   * Forçar refresh imediatamente
   * @param {string} id - ID do refresh
   */
  async forceRefresh(id) {
    if (!this.refreshes[id]) {
      console.warn(`⚠ Refresh '${id}' não encontrado`);
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
   * Parar refresh automático
   * @param {string} id - ID do refresh
   */
  stop(id) {
    if (!this.refreshes[id]) {
      return;
    }

    clearTimeout(this.refreshes[id].timeout);
    delete this.refreshes[id];
    eventBus.emit(`refresh:stopped:${id}`);
  }

  /**
   * Parar todos os refreshes
   */
  stopAll() {
    Object.keys(this.refreshes).forEach(id => this.stop(id));
  }

  /**
   * Alterar intervalo de um refresh
   * @param {string} id - ID do refresh
   * @param {number} interval - Novo intervalo em ms
   */
  setInterval(id, interval) {
    if (!this.refreshes[id]) {
      console.warn(`⚠ Refresh '${id}' não encontrado`);
      return;
    }

    this.refreshes[id].interval = interval;
  }

  /**
   * Obter informações sobre um refresh
   * @param {string} id - ID do refresh
   */
  getStatus(id) {
    return this.refreshes[id] ? {
      isActive: true,
      isRefreshing: this.refreshes[id].isRefreshing(),
      interval: this.refreshes[id].interval
    } : null;
  }
}

export const autoRefreshManager = new AutoRefreshManager();

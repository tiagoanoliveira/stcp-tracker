/**
 * Event Bus - Sistema pub/sub centralizado para comunicação entre componentes
 * Permite desacoplamento entre diferentes partes da aplicação
 */

class EventBus {
  constructor() {
    this.events = {};
  }

  /**
   * Subscrever a um evento
   * @param {string} eventName - Nome do evento
   * @param {function} callback - Função a executar quando o evento é emitido
   */
  on(eventName, callback) {
    if (!this.events[eventName]) {
      this.events[eventName] = [];
    }
    this.events[eventName].push(callback);
    console.log(`🚤 Subscritor adicionado para evento: ${eventName}`);
  }

  /**
   * Desinscrever de um evento
   * @param {string} eventName - Nome do evento
   * @param {function} callback - Função a remover
   */
  off(eventName, callback) {
    if (!this.events[eventName]) return;
    this.events[eventName] = this.events[eventName].filter(cb => cb !== callback);
    console.log(`🚣 Subscritor removido do evento: ${eventName}`);
  }

  /**
   * Emitir um evento
   * @param {string} eventName - Nome do evento
   * @param {*} data - Dados a passar aos subscritores
   */
  emit(eventName, data) {
    if (!this.events[eventName]) return;
    console.log(`📰 Emitindo evento: ${eventName}`, data);
    this.events[eventName].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`❌ Erro ao executar callback para ${eventName}:`, error);
      }
    });
  }

  /**
   * Limpar todos os subscritores de um evento
   * @param {string} eventName - Nome do evento
   */
  clear(eventName) {
    if (eventName) {
      delete this.events[eventName];
      console.log(`🖮 Evento limpo: ${eventName}`);
    } else {
      this.events = {};
      console.log('🖮 Todos os eventos foram limpos');
    }
  }
}

export const eventBus = new EventBus();

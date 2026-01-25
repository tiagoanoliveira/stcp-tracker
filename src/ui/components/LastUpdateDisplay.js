/**
 * LastUpdateDisplay - Componente para mostrar timestamp da última atualização
 */

import { formatTime } from '../../utils/dateHelpers.js';

export class LastUpdateDisplay {
  constructor(elementId = 'last-update-time') {
    this.elementId = elementId;
    this.element = null;
    this.lastUpdateTime = null;
  }

  /**
   * Inicializar componente
   */
  initialize() {
    this.element = document.getElementById(this.elementId);
    if (!this.element) {
      console.warn(`⚠ Elemento #${this.elementId} não encontrado`);
    }
  }

  /**
   * Atualizar com timestamp atual
   */
  update(timestamp = new Date()) {
    const timeString = typeof timestamp === 'string' 
      ? timestamp 
      : formatTime(timestamp);
    
    this.lastUpdateTime = timeString;
    this.render();
  }

  /**
   * Renderizar no DOM
   */
  render() {
    if (!this.element) {
      this.initialize();
      if (!this.element) return;
    }

    if (this.lastUpdateTime) {
      this.element.innerHTML = `Última atualização: <strong>${this.lastUpdateTime}</strong>`;
    } else {
      this.element.innerHTML = 'Última atualização: <strong>--:--:--</strong>';
    }
  }

  /**
   * Limpar display
   */
  clear() {
    this.lastUpdateTime = null;
    this.render();
  }
}

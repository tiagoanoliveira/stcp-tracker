/**
 * LoadingSpinner - Componente de loading reutilizável
 */

class LoadingSpinner {
  /**
   * Cria um spinner de loading
   * @param {Object} options - Opções de configuração
   * @param {string} options.size - Tamanho ('small', 'medium', 'large')
   * @param {string} options.color - Cor do spinner
   * @param {string} options.message - Mensagem a exibir
   */
  constructor(options = {}) {
    this.size = options.size || 'medium';
    this.color = options.color || '#0072C6';
    this.message = options.message || 'A carregar...';
    this.element = null;
  }

  /**
   * Cria o elemento HTML do spinner
   */
  create() {
    const container = document.createElement('div');
    container.className = `loading-spinner loading-spinner--${this.size}`;
    
    container.innerHTML = `
      <div class="spinner-animation">
        <svg viewBox="0 0 50 50">
          <circle 
            cx="25" 
            cy="25" 
            r="20" 
            fill="none" 
            stroke="${this.color}" 
            stroke-width="4"
            stroke-dasharray="80, 200"
            stroke-linecap="round"
          />
        </svg>
      </div>
      ${this.message ? `<p class="spinner-message">${this.message}</p>` : ''}
    `;
    
    this.element = container;
    return container;
  }

  /**
   * Atualiza a mensagem do spinner
   */
  setMessage(message) {
    this.message = message;
    if (this.element) {
      const messageEl = this.element.querySelector('.spinner-message');
      if (messageEl) {
        messageEl.textContent = message;
      }
    }
  }

  /**
   * Mostra o spinner num elemento alvo
   */
  show(targetElement) {
    if (!this.element) {
      this.create();
    }
    
    // Limpar conteúdo anterior
    targetElement.innerHTML = '';
    targetElement.appendChild(this.element);
  }

  /**
   * Remove o spinner
   */
  remove() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }

  /**
   * Cria um overlay de loading em tela cheia
   */
  static createOverlay(message = 'A carregar...') {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    
    const spinner = new LoadingSpinner({
      size: 'large',
      message
    });
    
    overlay.appendChild(spinner.create());
    document.body.appendChild(overlay);
    
    return {
      update: (newMessage) => spinner.setMessage(newMessage),
      remove: () => {
        overlay.remove();
      }
    };
  }

  /**
   * Mostra loading inline num elemento
   */
  static showInline(element, message = 'A carregar...', size = 'small') {
    const spinner = new LoadingSpinner({ size, message });
    spinner.show(element);
    return spinner;
  }
}

export { LoadingSpinner };

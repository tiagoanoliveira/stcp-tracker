/**
 * AnnouncementBanner — Aviso flutuante abaixo da barra de filtros.
 *
 * API pública (estática):
 *
 *   AnnouncementBanner.show(message, options)
 *     message  {string}  Texto do aviso (pode conter HTML simples)
 *     options  {object}
 *       type        {'warning'|'info'|'error'}  Tipo visual  (default: 'warning')
 *       dismissible {boolean}                   Botão fechar  (default: true)
 *       id          {string}                    ID único para não repetir após fechar
 *
 *   AnnouncementBanner.hide()          — fecha o banner
 *   AnnouncementBanner.isVisible()     — true se visível
 */

export class AnnouncementBanner {
  static _el = null;
  static _dismissed = new Set();

  // ---------------------------------------------------------------------------
  // Pública
  // ---------------------------------------------------------------------------

  static show(message, options = {}) {
    const {
      type        = 'warning',
      dismissible = true,
      id          = null,
    } = options;

    if (id && AnnouncementBanner._dismissed.has(id)) return;

    AnnouncementBanner._ensureStyles();
    AnnouncementBanner._render(message, { type, dismissible, id });
  }

  static hide() {
    const el = AnnouncementBanner._el;
    if (!el) return;
    el.classList.add('ab-exit');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    AnnouncementBanner._el = null;
    window.removeEventListener('resize', AnnouncementBanner._reposition);
  }

  static isVisible() {
    return Boolean(AnnouncementBanner._el?.isConnected);
  }

  // ---------------------------------------------------------------------------
  // Interno
  // ---------------------------------------------------------------------------

  static _render(message, { type, dismissible, id }) {
    AnnouncementBanner._el?.remove();

    const el = document.createElement('div');
    el.id        = 'announcement-banner';
    el.className = `ab ab-${type}`;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    const icons = {
      warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
      error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    };

    el.innerHTML = `
      <span class="ab-icon">${icons[type] ?? icons.warning}</span>
      <span class="ab-message">${message}</span>
      ${dismissible ? `
        <button class="ab-close" aria-label="Fechar aviso" title="Fechar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>` : ''}
    `;

    if (dismissible) {
      el.querySelector('.ab-close').addEventListener('click', () => {
        if (id) AnnouncementBanner._dismissed.add(id);
        AnnouncementBanner.hide();
      });
    }

    document.body.appendChild(el);
    AnnouncementBanner._el = el;

    // Aguarda um frame para o elemento estar no DOM antes de posicionar
    requestAnimationFrame(() => {
      AnnouncementBanner._reposition();
      window.addEventListener('resize', AnnouncementBanner._reposition, { passive: true });
    });
  }

  static _reposition() {
    const el = AnnouncementBanner._el;
    if (!el) return;

    const filterRow = document.getElementById('filter-row');
    if (filterRow) {
      const rect = filterRow.getBoundingClientRect();
      // Alinha exatamente com o filter-row: mesma posição left, mesma largura
      el.style.width     = `${rect.width}px`;
      el.style.transform = 'none';   // cancela o translateX(-50%) do CSS base
      el.style.top       = `${rect.bottom + 8}px`;
    } else {
      // Fallback centrado
      const header = document.querySelector('.header-overlay, .search-overlay, header');
      const bottom = header ? header.getBoundingClientRect().bottom : 70;
      el.style.top       = `${bottom + 8}px`;
      el.style.left      = '50%';
      el.style.width     = '';
      el.style.transform = 'translateX(-50%)';
    }
  }

  static _ensureStyles() {
    if (document.getElementById('ab-styles')) return;
    const link = document.createElement('link');
    link.id   = 'ab-styles';
    link.rel  = 'stylesheet';
    link.href = new URL('../styles/announcement.css', import.meta.url).href;
    document.head.appendChild(link);
  }
}

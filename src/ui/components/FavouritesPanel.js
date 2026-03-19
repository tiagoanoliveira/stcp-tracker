/**
 * FavouritesPanel - Drawer lateral com lista de paragens favoritas.
 *
 * Interface pública:
 *   mount()       injeta o HTML no body e activa o botão flutuante
 *   refresh()     re-renderiza a lista (chamar após toggle)
 *   destroy()
 */

import { favouritesManager } from '../../services/FavouritesManager.js';

export class FavouritesPanel {
  constructor() {
    this.element    = null;
    this.fabBtn     = null;
    this.isOpen     = false;
    this._onChange  = (list) => this._renderList(list);
  }

  mount() {
    if (this.element) return;

    // FAB (Floating Action Button) — estrela no canto superior direito
    this.fabBtn = document.createElement('button');
    this.fabBtn.id        = 'fav-fab';
    this.fabBtn.className = 'fav-fab';
    this.fabBtn.title     = 'Os meus favoritos';
    this.fabBtn.setAttribute('aria-label', 'Ver favoritos');
    this.fabBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
           fill="currentColor" stroke="currentColor" stroke-width="1.5"
           stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>`;
    this.fabBtn.addEventListener('click', () => this.toggle());
    document.body.appendChild(this.fabBtn);

    // Drawer
    this.element = document.createElement('div');
    this.element.id        = 'fav-panel';
    this.element.className = 'fav-panel';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.innerHTML = `
      <div class="fav-panel-header">
        <h3 class="fav-panel-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
               fill="currentColor" stroke="currentColor" stroke-width="1.5">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          Favoritos
        </h3>
        <button class="fav-panel-close" title="Fechar" aria-label="Fechar favoritos">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="fav-panel-hint">Guarda as tuas paragens favoritas para acesso rápido. No telemóvel, abre o link e usa "Adicionar ao ecrã inicial" para criar um atalho.</div>
      <ul class="fav-list" id="fav-list"></ul>
      <p class="fav-empty" id="fav-empty" style="display:none">Ainda não tens favoritos.<br>Abre uma paragem e clica na ⭐ para guardar.</p>`;

    this.element.querySelector('.fav-panel-close').addEventListener('click', () => this.close());

    // Fechar ao clicar fora
    document.addEventListener('click', (e) => {
      if (this.isOpen && !this.element.contains(e.target) && e.target !== this.fabBtn && !this.fabBtn.contains(e.target)) {
        this.close();
      }
    });

    document.body.appendChild(this.element);

    favouritesManager.onChange(this._onChange);
    this._renderList(favouritesManager.getAll());
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    this.isOpen = true;
    this.element.classList.add('open');
    this.element.setAttribute('aria-hidden', 'false');
    this.fabBtn.classList.add('active');
    this._renderList(favouritesManager.getAll());
  }

  close() {
    this.isOpen = false;
    this.element.classList.remove('open');
    this.element.setAttribute('aria-hidden', 'true');
    this.fabBtn.classList.remove('active');
  }

  refresh() { this._renderList(favouritesManager.getAll()); }

  _renderList(list) {
    const ul    = this.element?.querySelector('#fav-list');
    const empty = this.element?.querySelector('#fav-empty');
    if (!ul) return;

    ul.innerHTML = '';

    if (!list || list.length === 0) {
      ul.style.display   = 'none';
      empty.style.display = 'block';
      return;
    }

    ul.style.display    = '';
    empty.style.display = 'none';

    list.forEach(fav => {
      const li = document.createElement('li');
      li.className = 'fav-item';

      const label = fav.line
        ? `${fav.name} <span class="fav-line-badge">${fav.line}${fav.dir != null ? (fav.dir === 0 ? ' →' : ' ←') : ''}</span>`
        : fav.name;

      li.innerHTML = `
        <a class="fav-item-link" href="${fav.url}" title="Abrir ${fav.name}">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="3" x2="12" y2="21"/>
            <rect x="4" y="3" width="16" height="11" rx="1" fill="#5EDDC1" stroke="#0072C6"/>
            <rect x="7" y="6" width="10" height="4" rx="0.5" fill="#0072C6"/>
          </svg>
          <span class="fav-item-name">${label}</span>
        </a>
        <button class="fav-item-remove" data-id="${fav.id}" title="Remover favorito" aria-label="Remover ${fav.name} dos favoritos">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>`;

      li.querySelector('.fav-item-remove').addEventListener('click', (e) => {
        e.preventDefault();
        favouritesManager.remove(fav.id);
      });

      ul.appendChild(li);
    });
  }

  destroy() {
    favouritesManager.offChange(this._onChange);
    if (this.element) { this.element.remove(); this.element = null; }
    if (this.fabBtn)  { this.fabBtn.remove();  this.fabBtn  = null; }
  }
}

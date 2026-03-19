/**
 * FavouritesManager - Gestão de paragens favoritas em localStorage.
 *
 * Cada favorito:
 * {
 *   id: string,           // stop_id
 *   name: string,         // stop_name
 *   line: string|null,    // número da linha (opcional)
 *   dir: 0|1|null,        // direcção (opcional)
 *   url: string,          // deep-link completo
 *   addedAt: number       // timestamp
 * }
 */

const STORAGE_KEY = 'stcp_favourites';

export class FavouritesManager {
  constructor() {
    this._listeners = [];
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch { return []; }
  }

  _save(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    this._listeners.forEach(fn => fn(list));
  }

  getAll() { return this._load(); }

  isFavourite(stopId) {
    return this._load().some(f => f.id === String(stopId));
  }

  /**
   * Adiciona ou actualiza um favorito.
   * @param {string} stopId
   * @param {string} stopName
   * @param {object} [opts] - { line, dir, baseUrl }
   */
  add(stopId, stopName, opts = {}) {
    const list = this._load().filter(f => f.id !== String(stopId));
    const params = new URLSearchParams({ stop: stopId });
    if (opts.line) { params.set('line', opts.line); params.set('dir', opts.dir ?? 0); }
    const base = opts.baseUrl || window.location.pathname;
    list.unshift({
      id:      String(stopId),
      name:    stopName || `Paragem ${stopId}`,
      line:    opts.line || null,
      dir:     opts.dir  ?? null,
      url:     `${base}?${params.toString()}`,
      addedAt: Date.now()
    });
    this._save(list);
  }

  remove(stopId) {
    this._save(this._load().filter(f => f.id !== String(stopId)));
  }

  toggle(stopId, stopName, opts = {}) {
    if (this.isFavourite(stopId)) { this.remove(stopId); return false; }
    this.add(stopId, stopName, opts); return true;
  }

  onChange(fn) { this._listeners.push(fn); }
  offChange(fn) { this._listeners = this._listeners.filter(l => l !== fn); }
}

export const favouritesManager = new FavouritesManager();

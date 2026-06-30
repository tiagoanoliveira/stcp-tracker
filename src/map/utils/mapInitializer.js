// mapInitializer.js - Wrapper em torno do Leaflet para inicializar mapas

/**
 * Cria o marcador SVG da localização actual do utilizador.
 *
 * Design: círculo azul sólido com anel branco, montado como DivIcon
 * para evitar dependências de imagens externas. O CSS em busmap.css
 * adiciona o anel de pulse animado via ::before.
 */
export function createUserMarker(map, position) {
  const size = 22; // diâmetro do ponto central em px

  const svgIcon = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <!-- Sombra suave -->
      <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="rgba(0,0,0,0.12)" transform="translate(1,1)"/>
      <!-- Anel branco -->
      <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="#fff"/>
      <!-- Ponto azul central -->
      <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 3}" fill="#0072c6"/>
    </svg>`;

  const icon = L.divIcon({
    className:   'user-marker-icon',
    html:        svgIcon,
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)]
  });

  const marker = L.marker(position, {
    icon,
    title:     'Você está aqui',
    zIndexOffset: 1000   // garantir que fica acima dos marcadores de paragem
  }).addTo(map);

  marker.bindPopup(
    `<div style="font-size:13px;font-weight:600;color:#0072c6;padding:2px 4px">📍 A sua localização</div>`,
    { offset: [0, -4] }
  );

  return marker;
}

export class MapInitializer {
  constructor(elementId, center=[41.1579,-8.6291], zoom=13) {
    this.elementId = elementId;
    this.center = center;
    this.zoom = zoom;
    this.map = null;
  }

  initialize(getUserPosition = null) {
    // Criar mapa com zoomControl desativado para reposicionar
    const map = L.map(this.elementId, {
      center: this.center,
      zoom: this.zoom,
      zoomControl: false // Desativar controlo padrão
    });

    // Adicionar controlo de zoom no canto inferior direito
    L.control.zoom({
      position: 'bottomright'
    }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Não adicionar controlos aqui - serão adicionados pelas apps específicas
    // (BusMapApp, StopsMapApp, etc) conforme necessário

    this.map = map;
    return map;
  }

  createUserMarker(position) {
    if (!this.map) return null;
    return createUserMarker(this.map, position);
  }
}

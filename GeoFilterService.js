// GeoFilterService.js
class GeoFilterService {
  constructor() {
    this.polygons = [];
  }

  async carregarPolygons() {
    try {
      const response = await fetch('recolha_stcp.json');
      const data = await response.json();
      this.polygons = [];
      for (const key in data) {
        if (Array.isArray(data[key])) {
          for (const feature of data[key]) {
            this.polygons.push(feature.geometry);
          }
        }
      }
    } catch (error) {
      console.error('Erro ao carregar polygons:', error);
    }
  }

  pontoProximoDePoligono(lat, lon) {
  if (!window.turf) {
    console.error('Turf.js não está carregado!');
    return false;
  }
  const point = turf.point([lon, lat]);
  for (const polygon of this.polygons) {
    const turfPolygon = turf.polygon(polygon.coordinates);
    if (turf.booleanPointInPolygon(point, turfPolygon)) {
      return true;
    }
    // converter polígono em linha para medir distância
    const polygonLine = turf.polygonToLine(turfPolygon);
    // medir distância ponto-linha em metros
    const dist = turf.pointToLineDistance(point, polygonLine, { units: 'meters' });
    if (dist <= 50) {
      return true;
    }
  }
  return false;
}

}

export const geoFilterService = new GeoFilterService();

// GeoFilterService.js
class GeoFilterService {
    constructor() {
        this.polygons = [];
        this.sedecoordinates=[
            [-8.609756, 41.111492],
            [-8.58837, 41.1652]
        ]
    }

    async carregarPolygons() {
        try {
            const response = await fetch('./spam_filter/recolha_stcp.json');
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
        for (const [fLon, fLat] of this.sedecoordinates) {
            // Usa precisão suficiente, exemplo 6 casas decimais
            if (lat === fLat && lon === fLon) {
                return true;
            }
        }
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
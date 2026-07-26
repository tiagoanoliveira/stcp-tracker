// src/services/routeOverlayService.js
import {routeService} from './routeService.js';

function getRouteNumber(routeObj) {
    return String(routeObj?.id ?? routeObj?.number ?? '');
}

function getRouteDirection(routeObj) {
    return routeObj?.direction ?? 0;
}

function getRouteColor(routeObj) {
    return routeObj?.color || '#187EC2';
}

function getRouteTextColor(routeObj) {
    return routeObj?.text_color || routeObj?.textcolor || '#FFFFFF';
}

/**
 * Detecta a operadora com base no número da linha.
 * Regra atual:
 * - UNIR: linhas >= 1000
 * - STCP: restantes
 */
export function detectOperator(routeObj) {
    const n = parseInt(getRouteNumber(routeObj), 10);
    if (Number.isFinite(n) && n >= 1000) return 'UNIR';
    return 'STCP';
}

/**
 * Normaliza qualquer overlay para o formato esperado pelo LineOverlayManager.
 */
function normalizeOverlay(routeObj, partial = {}) {
    return {
        routeId: getRouteNumber(routeObj),
        color: getRouteColor(routeObj),
        text_color: getRouteTextColor(routeObj),
        direction: getRouteDirection(routeObj),
        shapes: Array.isArray(partial.shapes) ? partial.shapes : [],
        stops: Array.isArray(partial.stops) ? partial.stops : [],
    };
}

/**
 * Converte vários formatos possíveis de ficheiro UNIR para
 * [{ points: [[lat, lon], ...] }]
 */
function normalizeUnirShapesPayload(payload) {
    // Caso 1: array simples de pontos
    if (Array.isArray(payload)) {
        const points = payload
            .map(p => {
                const lat = Number(p?.shape_pt_lat ?? p?.lat);
                const lon = Number(p?.shape_pt_lon ?? p?.lon);
                return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
            })
            .filter(Boolean);

        return points.length ? [{ points }] : [];
    }

    // Caso 2: GeoJSON Feature
    if (payload?.type === 'Feature' && payload?.geometry) {
        return normalizeUnirShapesPayload(payload.geometry);
    }

    // Caso 3: GeoJSON FeatureCollection
    if (payload?.type === 'FeatureCollection' && Array.isArray(payload.features)) {
        const shapes = payload.features.flatMap(feature => normalizeUnirShapesPayload(feature));
        return shapes;
    }

    // Caso 4: GeoJSON geometry LineString
    if (payload?.type === 'LineString' && Array.isArray(payload.coordinates)) {
        const points = payload.coordinates
            .map(([lon, lat]) => {
                lat = Number(lat);
                lon = Number(lon);
                return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
            })
            .filter(Boolean);

        return points.length ? [{ points }] : [];
    }

    // Caso 5: GeoJSON geometry MultiLineString
    if (payload?.type === 'MultiLineString' && Array.isArray(payload.coordinates)) {
        return payload.coordinates
            .map(line => {
                const points = line
                    .map(([lon, lat]) => {
                        lat = Number(lat);
                        lon = Number(lon);
                        return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
                    })
                    .filter(Boolean);
                return points.length ? { points } : null;
            })
            .filter(Boolean);
    }

    return [];
}

/**
 * Carrega overlay STCP via routeService existente.
 */
async function fetchStcpOverlay(routeObj) {
    const routeId = getRouteNumber(routeObj);
    const direction = getRouteDirection(routeObj);

    const overlays = await routeService.fetchMultipleRoutesOverlay([{
        routeId,
        direction,
        color: getRouteColor(routeObj),
        text_color: getRouteTextColor(routeObj),
    }]);

    if (!Array.isArray(overlays) || overlays.length === 0) {
        return normalizeOverlay(routeObj);
    }

    return normalizeOverlay(routeObj, overlays[0]);
}

/**
 * Carrega overlay UNIR a partir dos ficheiros locais de shapes.
 * Por agora sem paragens.
 */
async function fetchUnirOverlay(routeObj) {
    const routeId = getRouteNumber(routeObj);
    const res = await fetch(`./resources/unir-gtfs/shapes/${routeId}.json`);

    if (!res.ok) {
        return normalizeOverlay(routeObj);
    }

    const payload = await res.json();
    const shapes = normalizeUnirShapesPayload(payload);

    return normalizeOverlay(routeObj, {
        shapes,
        stops: [],
    });
}

/**
 * Dispatcher por operadora.
 */
export async function fetchRouteOverlay(routeObj) {
    const operator = detectOperator(routeObj);

    switch (operator) {
        case 'UNIR':
            return fetchUnirOverlay(routeObj);
        case 'STCP':
        default:
            return fetchStcpOverlay(routeObj);
    }
}

/**
 * Carrega várias linhas e devolve lista pronta para setRoutes().
 * Remove overlays vazios se necessário? Aqui mantemos todos,
 * para preservar consistência com o estado selecionado.
 */
export async function buildOverlays(routeObjs = []) {
    return await Promise.all(
        routeObjs.map(async routeObj => {
            try {
                return await fetchRouteOverlay(routeObj);
            } catch (err) {
                console.warn('routeOverlayService: erro ao carregar overlay', routeObj, err);
                return normalizeOverlay(routeObj);
            }
        })
    );
}

const routeOverlayService = {
    detectOperator,
    fetchRouteOverlay,
    buildOverlays,
};

export default routeOverlayService;
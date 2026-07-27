// src/services/routeOverlayService.js
import {routeService} from './routeService.js';

function getRouteNumber(routeObj) {
    return String(routeObj?.routeId ?? routeObj?.id ?? routeObj?.number ?? '');
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
    const explicit = String(routeObj?.operator ?? routeObj?.source ?? '').toLowerCase();
    if (explicit === 'unir') return 'UNIR';
    if (explicit === 'stcp') return 'STCP';
    if (explicit === 'metrobus') return 'METROBUS';
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
                const lon = Number(p?.shape_pt_lon ?? p?.lon ?? p?.lng); // ← adicionar ?? p?.lng
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

    const raw = overlays[0];

    const shapesForOverlay = raw.shape?.coordinates?.length
        ? [{ points: (raw.shape.coordinates).map(c => [c.lat, c.lng]) }]
        : (Array.isArray(raw.shapes) ? raw.shapes : []);

    const stopsForOverlay = Array.isArray(raw.stops?.stops)
        ? raw.stops.stops
        : Array.isArray(raw.stops)
            ? raw.stops
            : [];

    return normalizeOverlay(routeObj, { shapes: shapesForOverlay, stops: stopsForOverlay });
}

/**
 * Carrega overlay UNIR a partir dos ficheiros locais de shapes.
 */
// Pré-carregar unir-stops.json uma vez (no topo do ficheiro, fora das funções)
let _unirStopsMap = null;
async function _getUnirStopsMap() {
    if (_unirStopsMap) return _unirStopsMap;
    try {
        const res = await fetch('./resources/stops/unir-stops.json');
        if (!res.ok) { _unirStopsMap = new Map(); return _unirStopsMap; }
        const arr = await res.json();
        _unirStopsMap = new Map((arr || []).map(s => [String(s.stop_id), s]));
    } catch {
        _unirStopsMap = new Map();
    }
    return _unirStopsMap;
}

async function fetchUnirOverlay(routeObj) {
    const rawRouteId = getRouteNumber(routeObj);
    // Extrair apenas o número da linha (ex: "rt:1001:0:1" → "1001", "1001" → "1001")
    const routeId = String(rawRouteId).replace(/^rt:(\d+):.*$/, '$1');
    const direction = getRouteDirection(routeObj); // 0 ou 1

    // ── 1. Carregar shape ──────────────────────────────────────────────────
    let shapes = [];
    try {
        const res = await fetch(`./resources/unir-gtfs/shapes/${routeId}.json`);
        if (res.ok) {
            const payload = await res.json();
            let coordinatesArray = [];
            if (payload?.shapes && Array.isArray(payload.shapes)) {
                // shape_id: "rt:XXXX:0:1" → dir 0 | "rt:XXXX:0:2" → dir 1
                const targetSuffix = direction === 1 ? ':2' : ':1';
                const shapeEntry = payload.shapes.find(s => s.shape_id?.endsWith(targetSuffix))
                    ?? payload.shapes[0];
                if (shapeEntry?.coordinates) {
                    coordinatesArray = shapeEntry.coordinates;
                }
            }
            shapes = normalizeUnirShapesPayload(coordinatesArray);
        }
    } catch (e) {
        console.warn('routeOverlayService: erro ao carregar shape UNIR', routeId, e);
    }

    // ── 2. Carregar paragens ───────────────────────────────────────────────
    // Ficheiro: stops/{routeId}_0_1.json (dir 0) ou stops/{routeId}_1_1.json (dir 1)
    let stops = [];
    try {
        const correctDirection = direction + 1;
        const stopFileName = `${routeId}_0_${correctDirection}`;
        const stopsRes = await fetch(`./resources/unir-gtfs/stops/${stopFileName}.json`);
        if (stopsRes.ok) {
            const stopSeq = await stopsRes.json();
            const stopsMap = await _getUnirStopsMap();

            stops = (stopSeq || [])
                .map(entry => {
                    const master = stopsMap.get(String(entry.id));
                    if (!master) return null;
                    return {
                        stop_id:       String(entry.id),
                        stopid:        String(entry.id),
                        stop_code:     String(entry.id),
                        stopcode:      String(entry.id),
                        stop_name:     master.stop_name || String(entry.id),
                        stopname:      master.stop_name || String(entry.id),
                        latitude:      Number(master.stop_lat),
                        longitude:     Number(master.stop_lon),
                        stop_sequence: Number(entry.sequence),
                        zone_id:       master.zone_id || null,
                        operator:      'unir',
                        source:        'unir',
                    };
                })
                .filter(s => s && Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
        } else if (direction === 0) {
            // Fallback: tentar apenas a primeira variante com dir 0
            console.warn(`[UNIR] Sem ficheiro de paragens para ${stopFileName}`);
        }
    } catch (e) {
        console.warn('routeOverlayService: erro ao carregar paragens UNIR', routeId, direction, e);
    }

    return normalizeOverlay(routeObj, { shapes, stops });
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
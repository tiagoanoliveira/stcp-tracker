// src/services/routeOverlayService.js
import { routeService } from './routeService.js';

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

async function fetchRouteOverlay(routeObj) {
    const routeId   = getRouteNumber(routeObj);
    const direction = getRouteDirection(routeObj);

    const overlay = await routeService.fetchRouteOverlay({
        routeId,
        direction,
        color:      getRouteColor(routeObj),
        text_color: getRouteTextColor(routeObj),
    });

    if (!overlay) return normalizeOverlay(routeObj);

    const shapesForOverlay = overlay.shape?.coordinates?.length
        ? [{ points: overlay.shape.coordinates.map(c => [c.lat, c.lng]) }]
        : (Array.isArray(overlay.shapes) ? overlay.shapes : []);

    const stopsForOverlay = Array.isArray(overlay.stops?.stops)
        ? overlay.stops.stops
        : Array.isArray(overlay.stops)
            ? overlay.stops
            : [];

    return normalizeOverlay(routeObj, { shapes: shapesForOverlay, stops: stopsForOverlay });
}

export async function buildOverlays(routeObjs = []) {
    return await Promise.all(
        (routeObjs || []).map(async routeObj => {
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
    fetchRouteOverlay,
    buildOverlays,
};

export default routeOverlayService;
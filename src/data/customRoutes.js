/**
 * customRoutes.js
 * Dados estáticos de linhas não disponibilizadas pela API STCP.
 * Cada entrada segue a mesma estrutura retornada pelo proxy.
 */

// ---------------------------------------------------------------------------
// Mapeamento de service_id STCP -> serviceType interno
// ---------------------------------------------------------------------------

/**
 * Mapeia o active_service_id devolvido pelo endpoint /stops/{id}/services
 * para um dos três tipos de grelha de horários da MB1.
 * Qualquer service_id que contenha 'SABADO' ou 'SÁBADO' (case-insensitive)
 * é tratado como sábado; 'DOMINGO' ou 'FERIADO' como feriado;
 * tudo o resto (incluindo períodos não escolares) como dia útil.
 * @param {string} serviceId
 * @returns {'weekday'|'saturday'|'holiday'}
 */
export function serviceIdToType(serviceId) {
  if (!serviceId) return 'weekday';
  const s = serviceId.toUpperCase();
  if (s.includes('DOMINGO') || s.includes('FERIADO')) return 'holiday';
  if (s.includes('SABADO')  || s.includes('SÁBADO'))  return 'saturday';
  return 'weekday';
}

// ---------------------------------------------------------------------------
// Gerador de horários para rotas com frequência fixa e períodos de ponta
// ---------------------------------------------------------------------------

/**
 * Gera um mapa de horários para uma rota custom, por paragem,
 * para um dado serviceType ('weekday' | 'saturday' | 'holiday').
 *
 * Frequências MB1:
 *   - weekday  : 10 min entre 8h00-10h00 e 16h30-19h30; 15 min nos restantes
 *   - saturday : 15 min constantes entre 6h30-22h
 *   - holiday  : 15 min constantes entre 6h30-22h
 *
 * @param {object} config       - route config (ver MB1_ROUTE)
 * @param {string} serviceType  - 'weekday' | 'saturday' | 'holiday'
 * @returns {object} mapa { stop_id: { schedule, routes, display_routes } }
 */
function generateSchedule(config, serviceType = 'weekday') {
  const {
    number:          route_number,
    name:            route_name,
    color,
    text_color,
    operating_hours,
    frequency,
    travel_time,
    stops,
  } = config;

  // Seleccionar os períodos de ponta conforme serviceType
  const rushPeriods = serviceType === 'weekday' ? frequency.rush_periods : [];

  // 1. Gerar todos os horários de partida nos dois extremos
  const departures = [];
  const startTotal = operating_hours.start_hour * 60 + operating_hours.start_minute;
  const endTotal   = operating_hours.end_hour   * 60 + operating_hours.end_minute;

  let cursor = startTotal;
  while (cursor <= endTotal) {
    departures.push(cursor);
    // Verifica se o minuto ACTUAL está dentro de algum período de ponta
    const inRush = rushPeriods.some(p => {
      const pStart = p.start_hour * 60 + (p.start_minute || 0);
      const pEnd   = p.end_hour   * 60 + (p.end_minute   || 0);
      return cursor >= pStart && cursor < pEnd;
    });
    cursor += inRush ? frequency.rush_hour : frequency.normal;
  }

  const minutesPerStop = Math.round(travel_time / (stops.length - 1));
  const firstStopName  = stops[0].stop_name;
  const lastStopName   = stops[stops.length - 1].stop_name;

  // 2. Inicializar estrutura de horários por paragem
  const stopSchedules = {};
  stops.forEach(stop => {
    const routes = [{
      route_id:         route_number,
      number:           route_number,
      route_short_name: route_number,
      route_long_name:  route_name,
      route_color:      color,
      route_text_color: text_color,
    }];
    stopSchedules[stop.stop_id] = { schedule: {}, routes, display_routes: routes };
  });

  // 3. Viagens no sentido origem → destino (Boavista → Praça do Império)
  departures.forEach((depTotal, tripIdx) => {
    stops.forEach((stop, idx) => {
      const arrTotal  = depTotal + idx * minutesPerStop;
      const arrHour   = Math.floor(arrTotal / 60);
      const arrMinute = arrTotal % 60;
      const tripId    = `${route_number}_F_${serviceType.charAt(0).toUpperCase()}_${String(tripIdx).padStart(4, '0')}`;
      const entry     = stopSchedules[stop.stop_id];
      if (!entry.schedule[arrHour]) entry.schedule[arrHour] = [];
      entry.schedule[arrHour].push({
        minute:   String(arrMinute).padStart(2, '0'),
        trip_id:  tripId,
        headsign: lastStopName,
      });
    });
  });

  // 4. Viagens no sentido destino → origem (Praça do Império → Boavista)
  departures.forEach((depTotal, tripIdx) => {
    stops.forEach((stop, idx) => {
      const distanceFromEnd = (stops.length - 1 - idx) * minutesPerStop;
      const arrTotal        = depTotal + distanceFromEnd;
      const arrHour         = Math.floor(arrTotal / 60);
      const arrMinute       = arrTotal % 60;
      const tripId          = `${route_number}_B_${serviceType.charAt(0).toUpperCase()}_${String(tripIdx).padStart(4, '0')}`;
      const entry           = stopSchedules[stop.stop_id];
      if (!entry.schedule[arrHour]) entry.schedule[arrHour] = [];
      entry.schedule[arrHour].push({
        minute:   String(arrMinute).padStart(2, '0'),
        trip_id:  tripId,
        headsign: firstStopName,
      });
    });
  });

  return stopSchedules;
}

// ---------------------------------------------------------------------------
// MB1 - Metrobus 1 (Boavista – Praça do Império)
// ---------------------------------------------------------------------------

export const MB1_ROUTE = {
  id:           'MB1',
  number:       'MB1',
  name:         'Boavista - Praça do Império',
  color:        '#00a7b0',
  text_color:   '#FFFFFF',
  type:         'metrobus',
  operating_hours: { start_hour: 6, start_minute: 30, end_hour: 22, end_minute: 0 },
  frequency: {
    normal:    15,
    rush_hour: 10,
    // Períodos de ponta APENAS em dias úteis (ignorados ao sábado/feriado)
    rush_periods: [
      { start_hour: 8,  start_minute: 0,  end_hour: 10, end_minute: 0  },
      { start_hour: 16, start_minute: 30, end_hour: 19, end_minute: 30 },
    ],
  },
  travel_time: 12,
  stops: [
    { stop_id: 'MB1_01', stop_code: 'MB1_01', stop_name: 'Boavista',         latitude: 41.158239, longitude: -8.630995, stop_sequence: 1, zone_id: '1' },
    { stop_id: 'MB1_02', stop_code: 'MB1_02', stop_name: 'Guerra Junqueiro', latitude: 41.159209, longitude: -8.636708, stop_sequence: 2, zone_id: '1' },
    { stop_id: 'MB1_03', stop_code: 'MB1_03', stop_name: 'Bessa',            latitude: 41.160582, longitude: -8.645091, stop_sequence: 3, zone_id: '1' },
    { stop_id: 'MB1_04', stop_code: 'MB1_04', stop_name: 'Pinheiro Manso',   latitude: 41.161878, longitude: -8.653037, stop_sequence: 4, zone_id: '2' },
    { stop_id: 'MB1_05', stop_code: 'MB1_05', stop_name: 'Serralves',        latitude: 41.160617, longitude: -8.658885, stop_sequence: 5, zone_id: '2' },
    { stop_id: 'MB1_06', stop_code: 'MB1_06', stop_name: 'João De Barros',   latitude: 41.158491, longitude: -8.664280, stop_sequence: 6, zone_id: '2' },
    { stop_id: 'MB1_07', stop_code: 'MB1_07', stop_name: 'Praça do Império', latitude: 41.155539, longitude: -8.671809, stop_sequence: 7, zone_id: '2' },
  ],
  coordinates: [
    { lat: 41.158239, lng: -8.630995, sequence: 1 },
    { lat: 41.159209, lng: -8.636708, sequence: 2 },
    { lat: 41.160582, lng: -8.645091, sequence: 3 },
    { lat: 41.161924, lng: -8.653029, sequence: 4 },
    { lat: 41.162323, lng: -8.655446, sequence: 5 },
    { lat: 41.160858, lng: -8.658241, sequence: 6 },
    { lat: 41.155539, lng: -8.671809, sequence: 7 },
  ],
};

// Pré-computar os três tipos de grelha uma só vez ao carregar o módulo
const MB1_SCHEDULES = {
  weekday:  generateSchedule(MB1_ROUTE, 'weekday'),
  saturday: generateSchedule(MB1_ROUTE, 'saturday'),
  holiday:  generateSchedule(MB1_ROUTE, 'holiday'),
};

// ---------------------------------------------------------------------------
// Exports agregados
// ---------------------------------------------------------------------------

/** Lista de rotas custom no formato do endpoint /routes/list */
export const CUSTOM_ROUTES_LIST = [
  { id: MB1_ROUTE.id, number: MB1_ROUTE.number, name: MB1_ROUTE.name, color: MB1_ROUTE.color, text_color: MB1_ROUTE.text_color },
];

/** Map de stop_id -> dados de paragem (para getNearbyStops e stopService) */
export const CUSTOM_STOPS_MAP = new Map(
  MB1_ROUTE.stops.map(s => [s.stop_id, {
    stop_id:   s.stop_id,
    stop_code: s.stop_code,
    stop_name: s.stop_name,
    latitude:  s.latitude,
    longitude: s.longitude,
    zone_id:   s.zone_id,
    routes: [{
      id:               MB1_ROUTE.id,
      number:           MB1_ROUTE.number,
      route_short_name: MB1_ROUTE.number,
      name:             MB1_ROUTE.name,
      color:            MB1_ROUTE.color,
      text_color:       MB1_ROUTE.text_color,
    }],
    distance: null,
    _custom:  true,
  }])
);

/**
 * Verifica se um stop_id pertence a uma rota custom.
 * @param {string} stopId
 * @returns {boolean}
 */
export function isCustomStop(stopId) {
  return CUSTOM_STOPS_MAP.has(stopId);
}

/**
 * Retorna os dados de schedule de uma paragem custom para um dado serviceType.
 * @param {string} stopId
 * @param {'weekday'|'saturday'|'holiday'} serviceType
 * @returns {{ schedule: object, display_routes: Array } | null}
 */
export function getScheduleForService(stopId, serviceType = 'weekday') {
  const type  = ['weekday', 'saturday', 'holiday'].includes(serviceType) ? serviceType : 'weekday';
  const entry = MB1_SCHEDULES[type]?.[stopId];
  return entry ?? null;
}

/**
 * Retorna os dados de shape da rota custom.
 * @param {string} routeId
 * @returns {object|null}
 */
export function getCustomRouteShape(routeId) {
  if (routeId === 'MB1') {
    return {
      success:      true,
      route_id:     'MB1',
      direction_id: 0,
      coordinates:  MB1_ROUTE.coordinates,
    };
  }
  return null;
}

/**
 * Retorna as paragens da rota custom.
 * @param {string} routeId
 * @returns {object|null}
 */
export function getCustomRouteStops(routeId) {
  if (routeId === 'MB1') {
    return {
      success:      true,
      route_id:     'MB1',
      direction_id: 0,
      stops:        MB1_ROUTE.stops,
    };
  }
  return null;
}

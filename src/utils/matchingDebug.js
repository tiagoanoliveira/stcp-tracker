/**
 * matchingDebug.js
 * Utilitário de diagnóstico para a associação chegada ↔ veículo.
 *
 * Expõe `window.stcpDebug` para uso na consola do browser:
 *
 *   stcpDebug.diagnose()       — imprime tabela detalhada por chegada
 *   stcpDebug.sampleVehicle()  — mostra anotações brutas de um veículo
 *   stcpDebug.sampleArrival()  — mostra um arrival de exemplo
 *   stcpDebug.lastArrivals     — array das últimas chegadas recebidas
 *   stcpDebug.lastVehicles     — array dos últimos veículos recebidos
 */

import { vehicleService } from '../services/vehicleService.js';

class MatchingDebug {
  constructor() {
    this.lastArrivals = [];
    this.lastVehicles = [];
    this._enabled = true;
  }

  /**
   * Regista uma nova ronda de dados e imprime diagnóstico condensado.
   * Chamado por StopsMapApp.updateBusMap().
   */
  record(arrivals, vehicles) {
    if (!this._enabled) return;
    this.lastArrivals = arrivals || [];
    this.lastVehicles = vehicles || [];

    const realtime = this.lastArrivals.filter(a => a.is_realtime);
    const matched  = realtime.filter(a => vehicleService.matchVehicleToTrip(this.lastVehicles, a.trip_id));
    const missed   = realtime.filter(a => !vehicleService.matchVehicleToTrip(this.lastVehicles, a.trip_id));

    console.groupCollapsed(
      `[stcpDebug] ${new Date().toLocaleTimeString()} — ` +
      `${realtime.length} realtime | ✅ ${matched.length} com veículo | ❌ ${missed.length} sem veículo`
    );

    if (missed.length > 0) {
      console.warn('Chegadas sem veículo correspondente:');
      missed.forEach(a => {
        const key = vehicleService.tripMatchKey(a.trip_id);
        const vehicleKeys = this.lastVehicles
          .map(v => vehicleService.extractTripId(v))
          .filter(Boolean)
          .map(t => `${t} → ${vehicleService.tripMatchKey(t)}`);
        console.warn(
          `  Linha ${a.route_short_name} | trip_id: "${a.trip_id}" | matchKey: "${key}"\n` +
          `  Veículos disponíveis (${this.lastVehicles.length}):`,
          vehicleKeys.slice(0, 10)
        );
      });
    }

    if (matched.length > 0) {
      console.log('Chegadas associadas a veículo:');
      matched.forEach(a => {
        const v = vehicleService.matchVehicleToTrip(this.lastVehicles, a.trip_id);
        console.log(
          `  ✅ Linha ${a.route_short_name} | trip_id: "${a.trip_id}" → veículo ${v?.id}`
        );
      });
    }

    console.groupEnd();
  }

  /**
   * Diagnóstico detalhado — chamar na consola: stcpDebug.diagnose()
   */
  diagnose() {
    if (this.lastArrivals.length === 0) {
      console.warn('[stcpDebug] Sem dados — abre uma paragem primeiro.');
      return;
    }

    console.group('[stcpDebug] Diagnóstico completo');
    console.log(`Total chegadas: ${this.lastArrivals.length}`);
    console.log(`  → realtime:   ${this.lastArrivals.filter(a => a.is_realtime).length}`);
    console.log(`  → scheduled:  ${this.lastArrivals.filter(a => !a.is_realtime).length}`);
    console.log(`Total veículos: ${this.lastVehicles.length}`);

    // Mapa trip_id → veículo (chave normalizada)
    const vehicleMap = new Map();
    this.lastVehicles.forEach(v => {
      const raw = vehicleService.extractTripId(v);
      if (raw) vehicleMap.set(vehicleService.tripMatchKey(raw), { raw, vehicle: v });
    });

    console.log('\n— Chegadas realtime —');
    this.lastArrivals.filter(a => a.is_realtime).forEach(a => {
      const key   = vehicleService.tripMatchKey(a.trip_id);
      const found = vehicleMap.get(key);
      console.log(
        `${found ? '✅' : '❌'} Linha ${a.route_short_name.padEnd(4)} ` +
        `| trip_id: "${a.trip_id}"\n` +
        `     matchKey: "${key}"` +
        (found ? `\n     → veículo trip_id raw: "${found.raw}"` : `\n     → SEM MATCH (${vehicleMap.size} chaves de veículo disponíveis)`)
      );
    });

    console.log('\n— Chaves trip_id dos veículos disponíveis —');
    vehicleMap.forEach((val, key) => console.log(`  "${key}" (raw: "${val.raw}") → ${val.vehicle.id}`));

    console.groupEnd();
  }

  /** Mostra as anotações brutas de um veículo aleatório */
  sampleVehicle(index = 0) {
    const v = this.lastVehicles[index];
    if (!v) { console.warn('[stcpDebug] Sem veículos registados.'); return; }
    console.log(`[stcpDebug] Veículo [${index}]:`, v.id);
    console.log('  annotations:', v.annotations?.value);
    console.log('  nr_viagem:', vehicleService.extractTripId(v));
    console.log('  matchKey:', vehicleService.tripMatchKey(vehicleService.extractTripId(v)));
  }

  /** Mostra o primeiro arrival realtime de exemplo */
  sampleArrival(index = 0) {
    const realtime = this.lastArrivals.filter(a => a.is_realtime);
    const a = realtime[index];
    if (!a) { console.warn('[stcpDebug] Sem chegadas realtime registadas.'); return; }
    console.log(`[stcpDebug] Arrival realtime [${index}]:`, a);
    console.log('  trip_id:', a.trip_id);
    console.log('  matchKey:', vehicleService.tripMatchKey(a.trip_id));
  }

  /** Liga/desliga o logging automático */
  toggle() {
    this._enabled = !this._enabled;
    console.log(`[stcpDebug] logging ${this._enabled ? 'ACTIVADO' : 'DESACTIVADO'}`);
  }
}

export const matchingDebug = new MatchingDebug();

// Expor globalmente para uso na consola do browser
if (typeof window !== 'undefined') {
  window.stcpDebug = matchingDebug;
}

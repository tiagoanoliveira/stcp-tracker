// GhostBusService.js
class GhostBusService {
    constructor() {
        this.vehicleHistory = new Map(); // Armazena histórico de cada veículo
        this.ghostVehicles = new Set(); // IDs de veículos fantasma
        this.STATIONARY_THRESHOLD = 30 * 1000; // 30 minutos em milissegundos
        this.POSITION_TOLERANCE = 0.0001; // ~11 metros de tolerância
        this.SPEED_TOLERANCE = 1; // 1 km/h de tolerância
    }

    // Verificar se veículo está estacionário
    checkVehicleStatus(bus) {
        const now = Date.now();
        const vehicleId = bus.id;

        if (!this.vehicleHistory.has(vehicleId)) {
            // Primeiro registo do veículo
            this.vehicleHistory.set(vehicleId, {
                firstSeenAt: now,
                lastSeenAt: now,
                latitude: bus.latitude,
                longitude: bus.longitude,
                speed: bus.speed,
                isStationary: false,
                stationarySince: now
            });
            return false; // Não é ghost
        }

        const history = this.vehicleHistory.get(vehicleId);
        
        // Verificar se posição e velocidade mudaram significativamente
        const positionChanged = Math.abs(history.latitude - bus.latitude) > this.POSITION_TOLERANCE ||
                               Math.abs(history.longitude - bus.longitude) > this.POSITION_TOLERANCE;
        const speedChanged = Math.abs(history.speed - bus.speed) > this.SPEED_TOLERANCE;

        if (positionChanged || speedChanged) {
            // Veículo moveu-se, atualizar histórico
            history.latitude = bus.latitude;
            history.longitude = bus.longitude;
            history.speed = bus.speed;
            history.stationarySince = now;
            history.isStationary = false;
            history.lastSeenAt = now;
            
            // Remover de ghost se estava marcado
            if (this.ghostVehicles.has(vehicleId)) {
                this.ghostVehicles.delete(vehicleId);
                console.log(`Veículo ${vehicleId} removido de ghost_bus - voltou a mover-se`);
            }
            return false;
        }

        // Veículo continua parado na mesma posição/velocidade
        const stationaryDuration = now - history.stationarySince;
        history.lastSeenAt = now;

        if (stationaryDuration >= this.STATIONARY_THRESHOLD && !history.isStationary) {
            history.isStationary = true;
            this.ghostVehicles.add(vehicleId);
            this.saveGhostBus(vehicleId, bus, stationaryDuration);
            console.log(`Veículo ${vehicleId} marcado como ghost após ${Math.floor(stationaryDuration / 60000)} minutos parado`);
            return true; // É ghost
        }

        return history.isStationary;
    }

    // Salvar veículo fantasma no ficheiro
    async saveGhostBus(vehicleId, bus, duration) {
        try {
            // Carregar ficheiro existente
            let ghostBuses = {};
            try {
                const response = await fetch('ghost_bus.json');
                if (response.ok) {
                    ghostBuses = await response.json();
                }
            } catch (e) {
                console.log('Criar novo ficheiro ghost_bus.json');
            }

            // Adicionar novo veículo fantasma
            ghostBuses[vehicleId] = {
                id: vehicleId,
                line: bus.line,
                busNumber: bus.busNumber,
                latitude: bus.latitude,
                longitude: bus.longitude,
                speed: bus.speed,
                destino: bus.destino,
                markedAt: new Date().toISOString(),
                stationaryDuration: Math.floor(duration / 60000), // em minutos
                reason: 'stationary_position_speed'
            };

            // Salvar ficheiro (requer backend)
            await this.saveToFile('ghost_bus.json', ghostBuses);
        } catch (error) {
            console.error('Erro ao salvar ghost_bus:', error);
        }
    }

    // Salvar para ficheiro (necessita endpoint backend)
    async saveToFile(filename, data) {
        // Esta função requer um endpoint backend para escrever ficheiros
        // Alternativa: usar localStorage para browser
        localStorage.setItem('ghost_buses', JSON.stringify(data));
        console.log('Ghost buses salvos em localStorage');
    }

    // Carregar veículos fantasma conhecidos
    async loadGhostBuses() {
        try {
            const stored = localStorage.getItem('ghost_buses');
            if (stored) {
                const ghostBuses = JSON.parse(stored);
                Object.keys(ghostBuses).forEach(id => this.ghostVehicles.add(id));
            }
        } catch (error) {
            console.error('Erro ao carregar ghost buses:', error);
        }
    }

    // Verificar se veículo é ghost
    isGhostVehicle(vehicleId) {
        return this.ghostVehicles.has(vehicleId);
    }

    // Limpar histórico de veículos não vistos recentemente
    cleanupOldVehicles() {
        const now = Date.now();
        const CLEANUP_THRESHOLD = 60 * 60 * 1000; // 1 hora

        for (const [vehicleId, history] of this.vehicleHistory.entries()) {
            if (now - history.lastSeenAt > CLEANUP_THRESHOLD) {
                this.vehicleHistory.delete(vehicleId);
                console.log(`Removido histórico de veículo ${vehicleId} - não visto há muito tempo`);
            }
        }
    }
}

export const ghostBusService = new GhostBusService();

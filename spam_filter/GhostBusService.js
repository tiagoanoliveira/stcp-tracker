// spam_filter/GhostBusService.js
class GhostBusService {
    constructor() {
        this.ghostVehicles = new Set();
    }

    // Carregar ghost buses do ficheiro atualizado pelo GitHub Actions
    async loadGhostBuses() {
        try {
            const response = await fetch('./spam_filter/ghost_bus.json');
            if (response.ok) {
                const ghostBuses = await response.json();
                this.ghostVehicles.clear();
                Object.keys(ghostBuses).forEach(id => {
                    this.ghostVehicles.add(id);
                });
                console.log(`✅ ${this.ghostVehicles.size} ghost buses carregados`);
            }
        } catch (error) {
            console.error('Erro ao carregar ghost buses:', error);
        }
    }

    // Verificar se veículo é ghost
    isGhostVehicle(vehicleId) {
        return this.ghostVehicles.has(vehicleId);
    }

    // Recarregar ghost buses periodicamente (opcional)
    startAutoReload(intervalMinutes = 10) {
        setInterval(() => {
            this.loadGhostBuses();
        }, intervalMinutes * 60 * 1000);
    }
}

export const ghostBusService = new GhostBusService();

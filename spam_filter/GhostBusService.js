// spam_filter/GhostBusService.js
class GhostBusService {
    constructor() {
        this.ghostVehicles = new Set();
    }

    // Carregar ghost buses com tratamento robusto de erros
    async loadGhostBuses() {
        try {
            const response = await fetch('spam_filter/ghost_bus.json');
            
            // Verificar se o fetch foi bem-sucedido
            if (!response.ok) {
                console.warn(`⚠ Ghost buses file não encontrado (${response.status}). Usando lista vazia.`);
                return;
            }
            
            // Obter texto primeiro para debug
            const text = await response.text();
            
            // Verificar se não está vazio
            if (!text || text.trim() === '') {
                console.warn('⚠ Ghost buses file está vazio. Usando lista vazia.');
                return;
            }
            
            // Tentar fazer parse do JSON
            const ghostBuses = JSON.parse(text);
            
            // Limpar e popular o Set
            this.ghostVehicles.clear();
            Object.keys(ghostBuses).forEach(id => {
                this.ghostVehicles.add(id);
            });
            
            console.log(`✅ ${this.ghostVehicles.size} ghost buses carregados`);
            
        } catch (error) {
            if (error instanceof SyntaxError) {
                console.error('❌ Erro ao fazer parse de ghost_bus.json:', error.message);
                console.warn('💡 Certifique-se que o ficheiro contém JSON válido (pelo menos {})');
            } else {
                console.error('❌ Erro ao carregar ghost buses:', error);
            }
            // Continuar com Set vazio em caso de erro
            this.ghostVehicles.clear();
        }
    }

    // Verificar se veículo é ghost
    isGhostVehicle(vehicleId) {
        return this.ghostVehicles.has(vehicleId);
    }

    // Recarregar ghost buses periodicamente
    startAutoReload(intervalMinutes = 10) {
        console.log(`🔄 Auto-reload de ghost buses ativado (a cada ${intervalMinutes} minutos)`);
        setInterval(() => {
            console.log('🔄 Recarregando ghost buses...');
            this.loadGhostBuses();
        }, intervalMinutes * 60 * 1000);
    }
}

export const ghostBusService = new GhostBusService();

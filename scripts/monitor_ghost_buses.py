import requests
import json
from datetime import datetime
import os

class GhostBusMonitor:
    def __init__(self):
        self.api_url = 'https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType==bus&limit=1000'
        self.ghost_file = 'spam_filter/ghost_bus.json'
        self.history_file = 'spam_filter/bus_history.json'
        self.STATIONARY_THRESHOLD = 30 * 60  # 30 minutos em segundos
        self.POSITION_TOLERANCE = 0.0001
        self.SPEED_TOLERANCE = 1

    def load_history(self):
        """Carregar histórico de veículos"""
        if os.path.exists(self.history_file):
            with open(self.history_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}

    def save_history(self, history):
        """Salvar histórico de veículos"""
        with open(self.history_file, 'w', encoding='utf-8') as f:
            json.dump(history, f, indent=2, ensure_ascii=False)

    def load_ghost_buses(self):
        """Carregar lista de ghost buses"""
        if os.path.exists(self.ghost_file):
            with open(self.ghost_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}

    def save_ghost_buses(self, ghost_buses):
        """Salvar lista de ghost buses"""
        with open(self.ghost_file, 'w', encoding='utf-8') as f:
            json.dump(ghost_buses, f, indent=2, ensure_ascii=False)

    def extract_line_number(self, bus):
        """Extrair número da linha"""
        if 'annotations' not in bus or 'value' not in bus['annotations']:
            return None
        for annotation in bus['annotations']['value']:
            if annotation.startswith('stcp:route:'):
                return annotation.replace('stcp:route:', '')
        return None

    def fetch_bus_data(self):
        """Buscar dados dos autocarros da API"""
        try:
            response = requests.get(self.api_url, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            buses = []
            for bus in data:
                if 'location' not in bus or 'value' not in bus['location']:
                    continue
                
                coords = bus['location']['value'].get('coordinates')
                if not coords or len(coords) < 2:
                    continue
                
                bus_info = {
                    'id': bus.get('id'),
                    'line': self.extract_line_number(bus),
                    'latitude': coords[1],
                    'longitude': coords[0],
                    'speed': bus.get('speed', {}).get('value', 0),
                    'busNumber': bus.get('fleetVehicleId', {}).get('value', 'N/A')
                }
                buses.append(bus_info)
            
            return buses
        except Exception as e:
            print(f"Erro ao buscar dados: {e}")
            return []

    def check_ghost_status(self, bus, history, ghost_buses):
        """Verificar se autocarro é ghost"""
        now = datetime.utcnow().timestamp()
        bus_id = bus['id']
        
        if bus_id not in history:
            # Primeiro registo
            history[bus_id] = {
                'firstSeenAt': now,
                'lastSeenAt': now,
                'latitude': bus['latitude'],
                'longitude': bus['longitude'],
                'speed': bus['speed'],
                'stationarySince': now,
                'isGhost': False
            }
            return False
        
        h = history[bus_id]
        
        # Verificar se mudou posição ou velocidade
        pos_changed = (abs(h['latitude'] - bus['latitude']) > self.POSITION_TOLERANCE or
                      abs(h['longitude'] - bus['longitude']) > self.POSITION_TOLERANCE)
        speed_changed = abs(h['speed'] - bus['speed']) > self.SPEED_TOLERANCE
        
        if pos_changed or speed_changed:
            # Veículo moveu-se
            h['latitude'] = bus['latitude']
            h['longitude'] = bus['longitude']
            h['speed'] = bus['speed']
            h['stationarySince'] = now
            h['lastSeenAt'] = now
            h['isGhost'] = False
            
            # Remover de ghost se estava
            if bus_id in ghost_buses:
                del ghost_buses[bus_id]
                print(f"✓ Veículo {bus_id} removido de ghost - voltou a mover-se")
            return False
        
        # Continua parado
        stationary_duration = now - h['stationarySince']
        h['lastSeenAt'] = now
        
        if stationary_duration >= self.STATIONARY_THRESHOLD and not h['isGhost']:
            h['isGhost'] = True
            ghost_buses[bus_id] = {
                'id': bus_id,
                'line': bus['line'],
                'busNumber': bus['busNumber'],
                'latitude': bus['latitude'],
                'longitude': bus['longitude'],
                'speed': bus['speed'],
                'markedAt': datetime.utcnow().isoformat(),
                'stationaryDuration': int(stationary_duration / 60),  # minutos
                'reason': 'stationary_position_speed'
            }
            print(f"⚠ Veículo {bus_id} (linha {bus['line']}) marcado como GHOST após {int(stationary_duration/60)} min parado")
            return True
        
        return h['isGhost']

    def cleanup_old_vehicles(self, history):
        """Remover veículos não vistos há mais de 2 horas"""
        now = datetime.utcnow().timestamp()
        CLEANUP_THRESHOLD = 2 * 60 * 60  # 2 horas
        
        to_remove = []
        for bus_id, h in history.items():
            if now - h['lastSeenAt'] > CLEANUP_THRESHOLD:
                to_remove.append(bus_id)
        
        for bus_id in to_remove:
            del history[bus_id]
            print(f"🗑 Removido histórico de {bus_id} - não visto há muito tempo")

    def run(self):
        """Executar monitorização"""
        print(f"🚌 Iniciando monitorização em {datetime.utcnow().isoformat()}")
        
        history = self.load_history()
        ghost_buses = self.load_ghost_buses()
        
        bus_data = self.fetch_bus_data()
        print(f"📡 {len(bus_data)} autocarros recebidos da API")
        
        ghost_count = 0
        for bus in bus_data:
            if self.check_ghost_status(bus, history, ghost_buses):
                ghost_count += 1
        
        self.cleanup_old_vehicles(history)
        
        self.save_history(history)
        self.save_ghost_buses(ghost_buses)
        
        print(f"✅ Concluído: {len(ghost_buses)} ghost buses ativos")
        print(f"📊 Estatísticas: {ghost_count} novos ghosts detetados")

if __name__ == '__main__':
    monitor = GhostBusMonitor()
    monitor.run()

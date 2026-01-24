# STCP Tracker - Reestruturação de Código e Redesign da UI

## 🎉 Visão Geral

Esta branch implementa uma refactorização completa do projeto com:
- **Reorganização de código**: Eliminação de duplicações, melhor separção de responsabilidades
- **UI Redesign**: Interface moderna, intuitiva e responsive inspirada em Linha Viva
- **Arquitetura escalável**: Fácil de manter, testar e estender

---

## 📄 Estrutura de Pastas

```
src/
├── core/                     # Funcionalidades core reutilizáveis
│  ├── apiService.js          # Centraliza todas as chamadas API
│  ├── geolocationService.js # Gestão de geolocalização
│  ├── eventBus.js           # Sistema de eventos pub/sub
│  ├── autoRefreshManager.js # Gestão de auto-refresh
│  ├── constants.js          # Constantes globais
│  └── logger.js             # Sistema de logging
│
├── services/                # Serviços de negócio
│  ├── vehicleService.js     # Lógica de autocarros
│  ├── scheduleService.js    # Trips, calendar, service_id
│  ├── stopService.js        # Lógica de paragens
│  └── routeService.js       # Informações de rotas
│
├── map/                    # Componentes de mapa
│  ├── MapManager.js         # Classe base para mapas
│  ├── markers/
│  │  ├── BusMarkerManager.js
│  │  ├── StopMarkerManager.js
│  │  └── UserMarkerManager.js
│  ├── controls/
│  │  ├── CenterControl.js
│  │  ├── ReloadControl.js
│  └── utils/
│     ├── mapInitializer.js
│     └── distanceCalculator.js
│
├── ui/                     # Componentes de interface
│  ├── design/
│  │  ├── busIcon.js
│  │  ├── busColors.js
│  │  └── iconCache.js
│  ├── components/
│  │  ├── Header.js
│  │  ├── Sidebar.js
│  │  ├── ArrivalsList.js
│  │  ├── LastUpdateDisplay.js
│  │  └── ErrorDisplay.js
│  └── styles/
│     ├── base.css
│     ├── layout.css
│     ├── components.css
│     ├── responsive.css
│     └── theme.css
│
├── pages/                  # Aplicações/páginas principais
│  ├── BusMapApp.js          # App de mapa de autocarros
│  ├── StopsMapApp.js        # App de mapa de paragens
│  └── StopDetailApp.js      # App de detalhes de paragem
│
├── utils/                  # Utiliários gerais
│  ├── dateHelpers.js
│  ├── formatters.js
│  └── validators.js
│
└── resources/              # Dados estáticos
   ├── trips.json
   ├── calendar.json
   ├── stops.json
   └── images/
```

---

## 🚀 Progresso da Implementação

### ✅ Concluído (Core)
- [x] `apiService.js` - Centraliza chamadas API
- [x] `geolocationService.js` - Gestão de geolocalização
- [x] `eventBus.js` - Sistema de eventos
- [x] `autoRefreshManager.js` - Gestão de polling
- [x] `vehicleService.js` - Lógica de autocarros

### ⏳ Em Progresso
- [ ] `scheduleService.js` - Lógica simplificada de service_id
- [ ] `stopService.js` - Lógica de paragens
- [ ] Componentes de mapa
- [ ] Componentes de UI
- [ ] Estilos CSS modernos
- [ ] Páginas aplicacionais

---

## 🔘 Eventos Disponibilizados

### Geolocalização
- `geolocation:update` - Localização atualizada
- `geolocation:error` - Erro na localização

### Auto-Refresh
- `refresh:complete:{id}` - Refresh completado
- `refresh:error:{id}` - Erro no refresh
- `refresh:stopped:{id}` - Refresh parado

### Chegadas
- `arrival:clicked` - Chegada clicada
- `arrivals:updated` - Lista de chegadas atualizada

---

## 📚 Exemplos de Uso

### Inicializar um mapa com auto-refresh
```javascript
import { BusMapApp } from './pages/BusMapApp.js';

const app = new BusMapApp();
await app.initialize();
```

### Usar geolocalização
```javascript
import { geolocationService } from './core/geolocationService.js';
import { eventBus } from './core/eventBus.js';

geolocationService.watchPosition();
eventBus.on('geolocation:update', (position) => {
  console.log('Nova localização:', position);
});
```

### Usar auto-refresh
```javascript
import { autoRefreshManager } from './core/autoRefreshManager.js';

autoRefreshManager.start('buses', async () => {
  const buses = await apiService.fetchBusData();
  console.log(buses);
}, 5000);
```

---

## 🚪 Breaking Changes

### Imports antigos vs. novos

**Antes:**
```javascript
import { dataService } from './realtime_bus_map/dataService.js';
import { mapService } from './realtime_bus_map/mapService.js';
```

**Depois:**
```javascript
import { apiService } from './src/core/apiService.js';
import { vehicleService } from './src/services/vehicleService.js';
import { scheduleService } from './src/services/scheduleService.js';
import { MapManager } from './src/map/MapManager.js';
```

---

## 🎨 UI/UX Melhorias

### Design Inspirado em Linha Viva
- Layout limpo e minimalista
- Sidebar inteligente (cabeçalho + filtros + lista)
- Mapa em destaque (70-80% do espaço)
- Cores modernas e contrast adequado
- Ícones intuitivos
- Responsive design

### Componentes Novos
- Header com logo + busca
- Sidebar colapsável
- Last update timestamp
- Loading states
- Error messages claros
- Toast notifications

---

## 🧨 Testes

Cada serviço pode ser testado isoladamente:

```javascript
// Testar geolocação
import { geolocationService } from './src/core/geolocationService.js';
const pos = await geolocationService.getCurrentPosition();
console.assert(Array.isArray(pos) && pos.length === 2);

// Testar vehicleService
import { vehicleService } from './src/services/vehicleService.js';
const line = vehicleService.extractLineNumber({ annotations: { value: ['stcp:route:7'] } });
console.assert(line === '7');
```

---

## 📃 Nota de Mudança de Service ID

O `scheduleService` implementa a lógica simplificada descrita anteriormente:
- Determina service_id sempre baseado no dia (U/S/D)
- Consulta calendar.json apenas para períodos especiais (FERIADOS, FERIAS)
- Nunca retorna null
- Suporta siglas: U (Uteis), S (Sabado), D (Domingo), F (Uteis Ferias), G (Sabado Ferias), H (Domingo Ferias)

---

## 🗄 Migração de Código Existente

Para migrar páginas antigas:

1. Substituir imports antigos pelos novos
2. Remover lógica duplicada (usar services centralizados)
3. Usar `eventBus` para comunicação entre componentes
4. Implementar componentes UI novos
5. Aplicar estilos CSS modernos

---

## 🚀 Próximos Passos

1. Implementar scheduleService.js
2. Implementar stopService.js
3. Criar MapManager.js e markers managers
4. Criar componentes UI
5. Implementar estilos CSS
6. Reescrever BusMapApp.js
7. Reescrever StopsMapApp.js
8. Reescrever StopDetailApp.js
9. Testes
10. Deploy

---

## 📧 Dúvidas?

Consulte os ficheiros individuais para documentação detalhada e exemplos de uso.

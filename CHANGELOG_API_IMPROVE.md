# 🚀 Changelog - API Improve Branch

## 🎯 Objetivo
Refatoração completa para usar **100% APIs da STCP** em vez de ficheiros estáticos, com **estados de loading claros** e **código limpo e organizado**.

---

## ✨ Principais Mudanças

### 1. 🌐 **Cloudflare Worker - Novos Endpoints**

#### **ANTES:**
- `/STOP_ID/realtime` - Dados em tempo real
- `/STOP_ID/routes` - Rotas de uma paragem
- `/STOP_ID/schedule` - Horário de uma paragem

#### **DEPOIS (v3.0):**
- ✅ `/STOP_ID/realtime` - Dados em tempo real (10s cache)
- ✅ `/STOP_ID/routes` - Rotas de uma paragem (30min cache)
- ✅ `/STOP_ID/schedule` - Horário de uma paragem (30min cache)
- ⭐ **NOVO:** `/nearby/{LAT}/{LNG}/{RADIUS}` - Paragens próximas (5min cache)
- ⭐ **NOVO:** `/route/{ROUTE_ID}/schedule` - Schedule completo de uma rota (30min cache)

**Benefícios:**
- Cache agressivo reduz chamadas à API STCP
- Estrutura de URLs REST clara e intuitiva
- Documentação automática no endpoint raiz

---

### 2. 📦 **Remoção de Ficheiros Estáticos**

#### **Ficheiros Removidos:**
- ❌ `stops.json` (~500KB) - Agora usa API `/nearby`
- ❌ `trips.json` (~200KB) - Agora usa API `/route/{id}/schedule`

#### **Ficheiros Mantidos:**
- ✅ `calendar.json` - Necessário para determinar tipo de dia (U/S/D/F/G/H)

**Impacto:**
- **-700KB** de payload inicial
- Dados sempre atualizados (sem necessidade de regenerar ficheiros)
- Aplicação mais rápida e leve

---

### 3. 🎨 **Componente LoadingSpinner**

#### **Novo Ficheiro:** `src/ui/components/LoadingSpinner.js`

**Funcionalidades:**
- 3 tamanhos: `small`, `medium`, `large`
- Métodos: `show()`, `remove()`, `setMessage()`
- Overlay de tela cheia: `LoadingSpinner.createOverlay(message)`
- Animação suave de spinner SVG rotativo

**CSS:** `src/ui/styles/loading.css`
- Animações fluidas
- Estilos para: overlay, panel-loading, map-loading
- Skeleton loading (alternativa)

#### **Uso nos Componentes:**

**NextArrivals:**
```javascript
// Ao abrir painel
this.showLoading('A carregar próximas chegadas...');

// Ao receber dados
this.hideLoading();
```

**StopsMapApp:**
```javascript
// Loading inicial
this.loadingOverlay = LoadingSpinner.createOverlay('A carregar mapa...');

// Após carregamento
this.loadingOverlay.remove();
```

**BusMapApp:**
```javascript
this.loadingOverlay = LoadingSpinner.createOverlay('A carregar autocarros...');
this.loadingOverlay.update('A carregar calendário...');
this.loadingOverlay.remove();
```

---

### 4. 🔧 **apiService.js - Novos Métodos**

#### **Métodos Adicionados:**

```javascript
// Paragens próximas
await apiService.fetchNearbyStops(lat, lng, radius);
// Retorna: { stops: [{ code, name, latitude, longitude, distance, routes }] }

// Schedule de rota completa
await apiService.fetchRouteSchedule(routeId, serviceId, directionId);
// Retorna: { schedule: [{ trip_id, trip_headsign, stop_times }] }
```

#### **Métodos Removidos (Deprecados):**
- ❌ `fetchTripsData()` - Substituído por `fetchRouteSchedule()`
- ❌ `fetchStopsData()` - Substituído por `fetchNearbyStops()`

#### **Configurações:**
- Timeout aumentado: **10s** (APIs STCP podem ser lentas)
- Retries: **3x** com delay de 500ms

---

### 5. 📍 **stopService.js - Refatoração Completa**

#### **ANTES:**
```javascript
await stopService.loadStopsData(); // Carrega stops.json (~500KB)
const stops = stopService.getAllStops(); // Retorna array local
```

#### **DEPOIS:**
```javascript
// Busca paragens próximas via API
const stops = await stopService.getNearbyStops(lat, lng, radius);
// Cache automático: 5 minutos
// Retorna: Array de paragens ordenadas por distância
```

#### **Cache Inteligente:**
- **TTL:** 5 minutos
- **Chave:** `lat_lng_radius` (arredondado para 4 casas decimais)
- **Fallback:** Se API falhar, usa cache expirado
- **Limpeza:** Automática a cada 10 minutos

#### **Métodos:**
- `getNearbyStops(lat, lng, radius)` - Busca via API
- `searchStops(query)` - Pesquisa no cache local
- `getStopById(id)` - Obtém do cache
- `clearCache()` - Força refresh

---

### 6. 📅 **scheduleService.js - Refatoração**

#### **ANTES:**
```javascript
// Síncrono, usa trips.json
const destination = scheduleService.getDestination(line, direction);
```

#### **DEPOIS:**
```javascript
// ⭐ Assíncrono, usa API
const destination = await scheduleService.getHeadsignForTrip(tripId, routeId, directionId);
```

#### **Novo Método:**
```javascript
// Obtém schedule completo de uma rota
const schedule = await scheduleService.getRouteSchedule(routeId, serviceId, directionId);
// Cache: 30 minutos
```

#### **Cache:**
- Schedules de rotas cacheados por 30 minutos
- Chave: `routeId_serviceId_directionId`
- Fallback para cache expirado em caso de erro

---

### 7. 🚗 **vehicleService.js - Assíncrono**

#### **ANTES (Síncrono):**
```javascript
const bus = vehicleService.processBusData(rawBus, destination);
```

#### **DEPOIS (Assíncrono):**
```javascript
// Processa um autocarro (busca destino via API)
const bus = await vehicleService.processBusData(rawBus);

// ⭐ NOVO: Processa múltiplos em paralelo
const buses = await vehicleService.processBusDataBatch(rawBuses);
```

#### **Benefícios:**
- Destinos sempre corretos (via API)
- Processamento paralelo (mais rápido)
- Código mais limpo (sem parâmetro `destination`)

---

### 8. 🗺️ **StopsMapApp.js - Raio Dinâmico**

#### **NOVO: Raio Dinâmico Baseado no Zoom**

| Zoom    | Raio    | Descrição           |
|---------|---------|---------------------|
| 18+     | 300m    | Muito próximo      |
| 16-17   | 500m    | Próximo            |
| 14-15   | 1000m   | Médio              |
| 12-13   | 2000m   | Afastado            |
| < 12    | 3000m   | Muito afastado      |

#### **Listeners de Mapa:**
```javascript
// Recarrega paragens ao fazer zoom/pan
this.mapManager.map.on('zoomend', () => this.handleMapChange());
this.mapManager.map.on('moveend', () => this.handleMapChange());
```

#### **Debounce:**
- 500ms de delay para evitar múltiplas chamadas
- Não recarrega se NextArrivals estiver aberto

#### **Loading States:**
- Overlay inicial ao abrir o mapa
- Loading no painel de chegadas (substitui dados antigos)
- Mensagem clara: "A carregar próximas chegadas..."

---

### 9. 🚌 **BusMapApp.js - Loading e Async**

#### **Loading States:**
```javascript
// Inicialização
this.loadingOverlay = LoadingSpinner.createOverlay('A carregar mapa...');
this.loadingOverlay.update('A carregar calendário...');
this.loadingOverlay.update('A carregar autocarros...');
this.loadingOverlay.remove();
```

#### **Processamento Assíncrono:**
```javascript
// ANTES: Síncrono, um por um
const buses = rawBuses.map(b => processBus(b));

// DEPOIS: Assíncrono, em paralelo
const buses = await vehicleService.processBusDataBatch(rawBuses);
```

---

### 10. 🔀 **Redirects para URLs Antigas**

#### **Ficheiros Criados:**
- `busmap.html` - Redireciona para `/`
- `stop.html` - Redireciona para `/`
- `_redirects` (Netlify) - Redirects 301

#### **URLs Antigas -> Nova:**
- `/busmap` → `/` (301)
- `/stop` → `/` (301)
- `/index.html` → `/` (301)

#### **Método:**
1. Meta refresh: `<meta http-equiv="refresh" content="0; url=/">`
2. JavaScript fallback: `window.location.href = '/'`
3. Netlify `_redirects`: Redirect 301 permanente

---

## 📊 Estatísticas de Impacto

### **Performance:**
- ⚡ **-700KB** payload inicial (stops.json + trips.json removidos)
- ⚡ Cache agressivo: 5-30min (menos chamadas API)
- ⚡ Processamento paralelo (async batch)

### **UX:**
- ✨ Loading states claros em todos os componentes
- ✨ Nunca mostra dados antigos enquanto carrega
- ✨ Animações suaves de loading

### **Manutenção:**
- 🧹 **-500 linhas** de código obsoleto
- 🧹 Sem necessidade de regenerar stops.json/trips.json
- 🧹 Dados sempre atualizados automaticamente

### **Código:**
- 📝 Mais limpo e organizado
- 📝 Padrão async/await consistente
- 📝 Cache multi-nível inteligente

---

## ✅ Checklist de Implementação

### **Backend (Cloudflare Worker):**
- [x] Endpoint `/nearby/{lat}/{lng}/{radius}`
- [x] Endpoint `/route/{routeId}/schedule`
- [x] Cache otimizado (5min, 30min)
- [x] Tratamento de erros robusto

### **Frontend - Core:**
- [x] `LoadingSpinner` component
- [x] `loading.css` styles
- [x] `apiService` - novos métodos
- [x] `stopService` - refatoração completa
- [x] `scheduleService` - async refactor
- [x] `vehicleService` - async + batch

### **Frontend - Apps:**
- [x] `StopsMapApp` - raio dinâmico + loading
- [x] `BusMapApp` - loading states
- [x] `NextArrivals` - loading states

### **HTML/CSS:**
- [x] `index.html` - adicionar loading.css
- [x] `stopsmap.html` - adicionar loading.css
- [x] Redirects (`busmap.html`, `stop.html`, `_redirects`)

### **Documentação:**
- [x] Este CHANGELOG
- [x] Comentários inline no código
- [x] JSDoc em métodos principais

---

## 🚀 Próximos Passos

1. **Testar** todas as funcionalidades:
   - Mapa de autocarros (index.html)
   - Mapa de paragens (stopsmap.html)
   - Loading states
   - Redirects

2. **Fazer merge** para `main` após validação

3. **Deploy** Cloudflare Worker atualizado

4. **Monitorizar** performance e cache hit rate

---

## 📝 Notas Técnicas

### **Cache Strategy:**
- **Nearby stops:** 5min (dados podem mudar com obras)
- **Routes/Schedule:** 30min (dados estáveis)
- **Realtime:** 10s (dados voláteis)

### **Error Handling:**
- Fallback para cache expirado
- Retry logic (3x)
- User feedback claro

### **Browser Compatibility:**
- ES6+ (async/await, Promises, Maps)
- Target: Chrome 90+, Firefox 88+, Safari 14+

---

**Data:** 27 Janeiro 2026  
**Autor:** Tiago Oliveira  
**Versão:** 3.0 (API Improve)

# Porto Live Tracker - Documentação Completa

> **Rastreamento em tempo real dos autocarros da STCP no Porto e arredores**

Aplicação web progressiva (PWA) que permite visualizar a localização em tempo real dos autocarros da STCP, consultar paragens próximas e ver as próximas chegadas combinando dados em **tempo real** com **horários programados**.

---

## 📚 Índice

- [Visão Geral](#-visão-geral)
- [Novidades](#-novidades)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Páginas HTML](#-páginas-html)
- [Módulos JavaScript](#-módulos-javascript)
- [Cloudflare Worker Proxy](#-cloudflare-worker-proxy)
- [Service Worker](#-service-worker)
- [Fluxo de Dados](#-fluxo-de-dados)
- [Como Usar](#-como-usar)

---

## 🎯 Visão Geral

### Tecnologias Utilizadas

- **Frontend**: Vanilla JavaScript (ES6 modules)
- **Mapas**: Leaflet.js
- **APIs**: 
  - FIWARE Urban Platform (dados em tempo real dos autocarros)
  - STCP API (horários programados, rotas)
  - Cloudflare Worker (proxy CORS)
- **PWA**: Service Worker, Manifest, Cache API
- **Arquitetura**: Modular, orientada a serviços

### Funcionalidades Principais

1. **Bus Map** (`index.html`) - Mapa com todos os autocarros em circulação
2. **Stops Map** (`stopsmap.html`) - Mapa de paragens com próximas chegadas
3. **Chegadas Híbridas** - Combina tempo real + horários programados
4. **Suporte 24h+** - Horários após meia-noite (24:00-01:00)
5. **Detecção de Atrasos** - Calcula atrasos em tempo real
6. **Geolocatização** - Localização do utilizador
7. **Atualização automática** - Dados em tempo real
8. **Offline-first** - Funciona sem Internet (Service Worker)

---

## ✨ Novidades

### 🆕 Sistema de Horários Programados

- **plannedArrivalsService**: Combina chegadas em tempo real com horários programados
- **scheduleService**: Determina automaticamente o tipo de dia (UTEIS, SAB, DOM, FÉRIAS, FERIADOS)
- **Remoção de duplicados**: Elimina chegadas duplicadas entre tempo real e schedule (±5 min)
- **Suporte 24h+**: Horários após meia-noite (API STCP usa 24, 25, 26 para 00h, 01h, 02h)

### 🌐 Cloudflare Worker Proxy

- **3 endpoints**: `/realtime`, `/routes`, `/schedule`
- **Cache inteligente**: 10s (realtime), 30min (routes/schedule)
- **CORS habilitado**: Permite chamadas do frontend
- **Deploy automático**: Integração GitHub → Cloudflare
- **Domínio personalizado**: `stcp-worker.tiagoanoliveira.pt`

### 🕒 Cálculo de Atrasos

- Compara tempo real com horário programado
- Fórmula: `arrival_minutes - delay_minutes = scheduled_time`
- Evita duplicados mesmo com atrasos

---

## 📁 Estrutura do Projeto

```
stcp-tracker/
├── index.html              # Página principal (Bus Map)
├── stopsmap.html           # Página de paragens (Stops Map)
├── manifest.json           # Manifesto PWA
├── sw.js                   # Service Worker
├── proxy/                  # ⭐ Cloudflare Worker
│   ├── index.js            # Código do worker
│   ├── wrangler.toml       # Configuração
│   ├── package.json        # Dependências
│   └── .gitignore
├── resources/              # Recursos estáticos
│   ├── favicon.svg
│   ├── header.js
│   ├── stops.json          # Paragens GTFS
│   ├── trips.json          # Viagens GTFS
│   └── calendar.json       # Calendário GTFS
└── src/
    ├── core/              # Serviços fundamentais
    │   ├── apiService.js
    │   ├── geolocationService.js
    │   ├── eventBus.js
    │   └── autoRefreshManager.js
    ├── services/          # Lógica de negócio
    │   ├── vehicleService.js
    │   ├── stopService.js
    │   ├── scheduleService.js       # ⭐ Determina tipo de dia
    │   └── plannedArrivalsService.js # ⭐ Combina tempo real + schedule
    ├── map/               # Gestão de mapas
    │   ├── MapManager.js
    │   ├── markers/
    │   │   ├── BusMarkerManager.js
    │   │   └── StopMarkerManager.js
    │   ├── controls/
    │   │   ├── BusMapControl.js
    │   │   ├── CenterControl.js
    │   │   └── StopsControl.js
    │   └── utils/
    │       ├── mapInitializer.js
    │       └── distanceCalculator.js
    ├── ui/                # Interface de utilizador
    │   ├── components/
    │   │   ├── NextArrivals.js
    │   │   └── LastUpdateDisplay.js
    │   ├── design/
    │   │   └── iconCache.js
    │   └── styles/
    │       ├── base.css
    │       ├── busmap.css
    │       ├── stopsmap.css
    │       ├── stopDetail.css
    │       ├── components.css
    │       └── layout.css
    ├── pages/             # Aplicações principais
    │   ├── BusMapApp.js
    │   └── StopsMapApp.js
    └── utils/
        └── dateHelpers.js
```

---

## 🔄 Cloudflare Worker Proxy

### Localização: `proxy/`

O Cloudflare Worker atua como proxy CORS para a API da STCP, resolvendo problemas de cross-origin e adicionando cache inteligente.

### Endpoints Disponíveis

#### 1. **GET `/{STOP_ID}/realtime`**
Chegadas em tempo real de uma paragem.

- **Cache**: 10 segundos
- **Exemplo**: `https://stcp-worker.tiagoanoliveira.pt/PLNT1/realtime`
- **Resposta**: Dados GTFS Realtime

#### 2. **GET `/{STOP_ID}/routes`**
Rotas que servem uma paragem.

- **Cache**: 30 minutos
- **Exemplo**: `https://stcp-worker.tiagoanoliveira.pt/PLNT1/routes`
- **Resposta**:
  ```json
  {
    "display_routes": [
      {
        "route_id": "200",
        "route_short_name": "200",
        "route_color": "#FFD700",
        "route_text_color": "#000000"
      }
    ]
  }
  ```

#### 3. **GET `/{STOP_ID}/schedule?route_id={ROUTE}&service_id={SERVICE}`**
Horário programado de uma rota numa paragem.

- **Cache**: 30 minutos
- **Exemplo**: `https://stcp-worker.tiagoanoliveira.pt/PLNT1/schedule?route_id=200&service_id=DIAS%20UTEIS`
- **Resposta**:
  ```json
  {
    "stop_id": "PLNT1",
    "route_id": "200",
    "service_id": "DIAS UTEIS",
    "schedule": {
      "6": [{"minute": "30", "headsign": "Campanhaã", ...}],
      "7": [{"minute": "00", ...}, {"minute": "30", ...}],
      "24": [{"minute": "15", "headsign": "...", ...}]
    }
  }
  ```

### Suporte 24h+

A API da STCP usa horas >= 24 para horários após meia-noite:
- **24:00** = 00:00 (meia-noite)
- **24:30** = 00:30
- **25:15** = 01:15

O `plannedArrivalsService` trata automaticamente estes casos.

### Deploy

```bash
cd proxy
npx wrangler deploy
```

Deploy automático configurado via GitHub Actions.

---

## 🛠️ Módulos JavaScript

### ⭐ Novos Serviços

#### **`scheduleService.js`**

**Descrição**: Determina automaticamente o tipo de serviço (service_id) com base na data atual.

**Classe**: `ScheduleService`

**Métodos**:

```javascript
loadScheduleData()
```
- Carrega `trips.json` e `calendar.json`

```javascript
getServiceIdAtual()
```
- **Retorna**: `string` - Código do serviço atual
- **Possíveis valores**:
  - `UTEIS` - Dias úteis (segunda a sexta)
  - `SAB` - Sábado
  - `DOM` - Domingo
  - Feriados usam `DOM`
  - Férias escolares: `F` (dias úteis), `G` (sábado), `H` (domingo)
- **Descrição**: Verifica calendário para feriados e férias escolares
- **Cache**: Resultado cacheado por dia

```javascript
getDestination(line, direction)
```
- **Parâmetros**: Número da linha, direção (0 ou 1)
- **Retorna**: `string` - Destino da viagem (headsign)
- **Descrição**: Obtém destino considerando service_id atual

```javascript
isHoliday(yyyyMMdd)
```
- **Retorna**: `boolean`

```javascript
isSchoolHoliday(yyyyMMdd)
```
- **Retorna**: `boolean`

```javascript
clearCache()
```
- Força recalcular service_id

**Exportação**: `export const scheduleService = new ScheduleService()`

---

#### **`plannedArrivalsService.js`** ⭐

**Descrição**: Combina chegadas em tempo real com horários programados, removendo duplicados e suportando horários 24h+.

**Classe**: `PlannedArrivalsService`

**Propriedades**:
- `routesCache` - Cache de rotas por paragem (30 min)
- `schedulesCache` - Cache de horários (30 min)

**Métodos**:

```javascript
getNextArrivals(stopId, maxMinutes = 3600)
```
- **Parâmetros**: Código da paragem, tempo máximo em minutos
- **Retorna**: `Promise<Array>` - Chegadas ordenadas por tempo
- **Descrição**: 
  1. Busca chegadas em tempo real
  2. Busca rotas que servem a paragem
  3. Para cada rota, busca schedule
  4. Extrai próximas viagens (até 59min)
  5. Combina tempo real + programadas
  6. Remove duplicados (±5 min)
  7. Ordena por tempo de chegada

**Exemplo de chegada retornada**:
```javascript
{
  route_short_name: "200",
  route_color: "#FFD700",
  route_text_color: "#000000",
  trip_headsign: "Campanhaã",
  arrival_minutes: 15,
  arrival_time: "14:35",
  trip_id: "200_1_14:35",
  status: "SCHEDULED",  // ou "ON_TIME", "DELAYED"
  delay_minutes: 0,
  is_realtime: false
}
```

```javascript
extractUpcomingTrips(schedule, maxMinutes, route)
```
- **Descrição**: Extrai viagens futuras do schedule
- **Suporte 24h+**: 
  - Se estamos às 23:30 e `maxMinutes=60`, verifica:
    - Hora 23 (restantes 30min)
    - Hora 24 (primeiros 30min do dia seguinte)
  - Converte hora de exibição: 24 → 00, 25 → 01

```javascript
combineArrivals(realtimeArrivals, scheduledArrivals)
```
- **Descrição**: Combina e remove duplicados
- **Critério de duplicado**:
  - Mesma linha
  - Mesmo destino (normalizado)
  - Tempo próximo (±5 min)
  - **Importante**: Para tempo real, usa `arrival_minutes - delay_minutes` para comparar
- **Exemplo**:
  - Tempo real: linha 200, chega em 15min, atraso 5min → `scheduled_time = 15 - 5 = 10min`
  - Schedule: linha 200, mesmo destino, 9min → `|10 - 9| = 1 ≤ 5` → **Duplicado!**

**Exportação**: `export const plannedArrivalsService = new PlannedArrivalsService()`

---

### apiService.js (Atualizado)

**Novos métodos**:

```javascript
fetchStopRealtime(stopId)
```
- **URL**: `{proxyUrl}/{stopId}/realtime`
- **Retorna**: Chegadas em tempo real da STCP

```javascript
fetchStopRoutes(stopId)
```
- **URL**: `{proxyUrl}/{stopId}/routes`
- **Retorna**: Rotas que servem a paragem

```javascript
fetchStopSchedule(stopId, routeId, serviceId)
```
- **URL**: `{proxyUrl}/{stopId}/schedule?route_id={routeId}&service_id={serviceId}`
- **Retorna**: Horário programado

---

## 📊 Fluxo de Dados

### Stops Map (stopsmap.html) - Atualizado

```
1. StopsMapApp.initialize()
   ↓
2. stopService.loadStopsData() → stops.json
   ↓
3. geolocationService.getCurrentPosition()
   ↓
4. stopService.getNearbyStops() → Paragens próximas
   ↓
5. stopMarkerManager.updateStopMarkers()
   ↓
6. Utilizador clica numa paragem:
   ↓
7. ⭐ plannedArrivalsService.getNextArrivals(stopId, 3600)
   ↓
   7.1. apiService.fetchStopRealtime(stopId) → Tempo real
   ↓
   7.2. apiService.fetchStopRoutes(stopId) → Rotas
   ↓
   7.3. scheduleService.getServiceIdAtual() → "UTEIS"/"SAB"/"DOM"
   ↓
   7.4. Para cada rota:
        apiService.fetchStopSchedule(stopId, routeId, serviceId)
   ↓
   7.5. extractUpcomingTrips() → Viagens futuras (suporta 24h+)
   ↓
   7.6. combineArrivals() → Remove duplicados (usa delay_minutes)
   ↓
8. apiService.fetchBusData() → Veículos
   ↓
9. Para cada chegada:
   - vehicleService.matchVehicleToTrip()
   - vehicleService.extractVehicleLocation()
   ↓
10. nextArrivals.setArrivals() → Renderiza painel
    ↓
11. busMarkerManager.updateBusMarkers() → Só autocarros da paragem
    ↓
12. Auto-refresh a cada 5s
```

---

## 🚀 Como Usar

### Desenvolvimento Local

```bash
# Clonar repositório
git clone https://github.com/tiagoanoliveira/stcp-tracker.git
cd stcp-tracker

# Servir com servidor HTTP local (ex: Python)
python -m http.server 8000

# Ou com Node.js
npx http-server

# Abrir no navegador
open http://localhost:8000
```

### Deploy do Worker

```bash
cd proxy
npm install
npx wrangler login
npx wrangler deploy
```

### Deploy da Aplicação

A aplicação é estática e pode ser hospedada em:
- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages

---

## 🛡️ Service Worker

### `sw.js`

**Versão**: `stcp-live-v5`

**Estratégia de Cache**:

1. **Recursos Estáticos** - Cache First + Stale-While-Revalidate
   - HTML, CSS, JS, JSON estáticos

2. **APIs** - Network Only (sem cache)
   - FIWARE Urban Platform
   - Cloudflare Worker (sempre dados frescos)

**Ficheiros Cacheados**:
- Páginas HTML
- Módulos JavaScript (incluindo novos serviços)
- Estilos CSS
- Recursos (favicon, header, manifest, JSONs)

---

## 📝 Features Principais

### ✅ Chegadas Híbridas

- Combina tempo real (GTFS Realtime) com horários programados (GTFS Static)
- Remove duplicados inteligentemente
- Mostra até 60 minutos de chegadas

### ✅ Detecção Automática de Serviço

- Identifica automaticamente se é dia útil, sábado ou domingo
- Verifica feriados e férias escolares
- Ajusta horários em conformidade

### ✅ Suporte Horários 24h+

- Trata corretamente horários após meia-noite
- Às 23:30, mostra autocarros até 00:30 do dia seguinte
- À 00:30, mostra autocarros até 01:30

### ✅ Cálculo Preciso de Atrasos

- Compara tempo estimado com horário programado
- Evita duplicação mesmo com grandes atrasos
- Visual: 🟢 No horário | 🔴 Atrasado

---

## 💻 Tecnologias

- **Vanilla JavaScript** - ES6 modules, async/await
- **Leaflet.js** - Mapas interativos
- **GTFS Realtime** - Dados em tempo real
- **GTFS Static** - Horários programados
- **Cloudflare Workers** - Edge computing, CORS proxy
- **Service Workers** - PWA, offline-first
- **Geolocation API** - Localização do utilizador

---

## 📝 Licença

Este projeto é open source e está disponível sob a licença MIT.

---

## 👥 Contribuir

Contribuições são bem-vindas! Por favor:

1. Fork o repositório
2. Crie uma branch para a feature (`git checkout -b feature/NovaFeature`)
3. Commit as alterações (`git commit -m 'Adiciona NovaFeature'`)
4. Push para a branch (`git push origin feature/NovaFeature`)
5. Abra um Pull Request

---

## 📡 APIs Utilizadas

### FIWARE Urban Platform (Porto Digital)
- **URL**: `https://broker.fiware.urbanplatform.portodigital.pt/v2/entities`
- **Dados**: Localização em tempo real dos autocarros
- **Atualização**: Aprox. a cada 30 segundos

### STCP API (via Cloudflare Worker)
- **URL**: `https://stcp-worker.tiagoanoliveira.pt`
- **Endpoints**: `/realtime`, `/routes`, `/schedule`
- **Dados**: Chegadas previstas, rotas, horários

---

## 📞 Contacto

**Autor**: Tiago Oliveira  
**GitHub**: [@tiagoanoliveira](https://github.com/tiagoanoliveira)  
**Repositório**: [stcp-tracker](https://github.com/tiagoanoliveira/stcp-tracker)

---

**Última atualização**: 27 de Janeiro de 2026

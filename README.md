# STCP Live Tracker - Documentação Completa

> **Rastreamento em tempo real dos autocarros da STCP no Porto e arredores**

Aplicação web progessiva (PWA) que permite visualizar a localização em tempo real dos autocarros da STCP, consultar paragens próximas e ver as próximas chegadas.

---

## 📚 Índice

- [Visão Geral](#-visão-geral)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Páginas HTML](#-páginas-html)
- [Módulos JavaScript](#-módulos-javascript)
  - [Core Services](#1-core-services-srccore)
  - [Business Services](#2-business-services-srcservices)
  - [Map Management](#3-map-management-srcmap)
  - [UI Components](#4-ui-components-srcui)
  - [Pages (Apps)](#5-pages-aplicacoes-srcpages)
  - [Utils](#6-utils-srcutils)
- [Recursos Estáticos](#-recursos-estáticos)
- [Service Worker](#-service-worker)
- [Fluxo de Dados](#-fluxo-de-dados)
- [Como Usar](#-como-usar)

---

## 🎯 Visão Geral

### Tecnologias Utilizadas

- **Frontend**: Vanilla JavaScript (ES6 modules)
- **Mapas**: Leaflet.js
- **APIs**: 
  - FIWARE Urban Platform (dados em tempo real)
  - Cloudflare Worker (proxy para GTFS Realtime)
- **PWA**: Service Worker, Manifest, Cache API
- **Arquitetura**: Modular, orientada a serviços

### Funcionalidades Principais

1. **Bus Map** (`index.html`) - Mapa com todos os autocarros em circulação
2. **Stops Map** (`stopsmap.html`) - Mapa de paragens com próximas chegadas
3. **Geolocalização** - Localização do utilizador
4. **Atualização automática** - Dados em tempo real
5. **Offline-first** - Funciona sem Internet (Service Worker)

---

## 📁 Estrutura do Projeto

```
stcp-tracker/
├── index.html              # Página principal (Bus Map)
├── stopsmap.html           # Página de paragens (Stops Map)
├── manifest.json           # Manifesto PWA
├── sw.js                   # Service Worker
├── resources/              # Recursos estáticos
│   ├── favicon.svg
│   ├── header.js          # Header comum HTML
│   ├── stops.json         # Dados de paragens GTFS
│   ├── trips.json         # Dados de viagens GTFS
│   └── calendar.json      # Calendário GTFS
└── src/
    ├── core/              # Serviços fundamentais
    │   ├── apiService.js
    │   ├── geolocationService.js
    │   ├── eventBus.js
    │   └── autoRefreshManager.js
    ├── services/          # Lógica de negócio
    │   ├── vehicleService.js
    │   ├── stopService.js
    │   └── scheduleService.js
    ├── map/               # Gestão de mapas
    │   ├── MapManager.js
    │   ├── markers/       # Managers de marcadores
    │   │   ├── BusMarkerManager.js
    │   │   └── StopMarkerManager.js
    │   ├── controls/      # Controlos do mapa
    │   │   ├── BusMapControl.js
    │   │   ├── CenterControl.js
    │   │   └── StopsControl.js
    │   └── utils/
    │       ├── mapInitializer.js
    │       └── distanceCalculator.js
    ├── ui/                # Interface de utilizador
    │   ├── components/    # Componentes reutilizáveis
    │   │   ├── NextArrivals.js
    │   │   └── LastUpdateDisplay.js
    │   ├── design/
    │   │   └── iconCache.js
    │   └── styles/        # CSS modular
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

## 📝 Páginas HTML

### `index.html` - Bus Map

**Objetivo**: Visualizar todos os autocarros em circulação em tempo real.

**Componentes**:
- Header com navegação
- Filtro por linha de autocarro
- Mapa Leaflet (fullscreen)
- Controlo de centrar na localização
- Controlo para navegar para Stops Map
- Rodapé com última atualização e contador de autocarros

**Estilos**:
- `src/ui/styles/base.css`
- `src/ui/styles/busmap.css`
- `src/ui/styles/layout.css`
- `src/ui/styles/components.css`

**Script principal**: `src/pages/BusMapApp.js`

---

### `stopsmap.html` - Stops Map

**Objetivo**: Ver paragens próximas e consultar próximas chegadas.

**Componentes**:
- Header com navegação
- Barra de pesquisa de paragens
- Mapa Leaflet com marcadores de paragens
- Painel NextArrivals (metade inferior do ecrã)
- Controlo de centrar na localização
- Controlo para voltar ao Bus Map

**Estilos**:
- `src/ui/styles/base.css`
- `src/ui/styles/stopsmap.css`
- `src/ui/styles/stopDetail.css`
- `src/ui/styles/layout.css`

**Script principal**: `src/pages/StopsMapApp.js`

---

## 🛠️ Módulos JavaScript

### 1. Core Services (`src/core/`)

Serviços fundamentais da aplicação, independentes da lógica de negócio.

---

#### **`apiService.js`**

**Descrição**: Centraliza todas as chamadas à API. Implementa retry logic, timeout e tratamento de erros.

**Classe**: `ApiService`

**Propriedades**:
- `fiwareUrl` - URL da API FIWARE
- `proxyUrl` - URL do Cloudflare Worker (proxy GTFS Realtime)
- `retries` - Número de tentativas (3)
- `delayMs` - Delay entre tentativas (500ms)
- `timeoutMs` - Timeout por pedido (1000ms)

**Métodos**:

```javascript
fetchWithRetry(url, options, retries, delayMs, timeoutMs)
```
- **Parâmetros**: URL, opções fetch, número de retries, delay, timeout
- **Retorna**: Promise com dados JSON
- **Descrição**: Fetch genérico com retry automático e timeout

```javascript
fetchBusData()
```
- **Retorna**: `Array<Object>` - Lista de autocarros da API FIWARE
- **Descrição**: Obtém dados em tempo real de todos os autocarros

```javascript
fetchStopRealtime(stopId)
```
- **Parâmetros**: `stopId` (string) - Código da paragem
- **Retorna**: `Object` - Dados da paragem (arrivals, stop_times)
- **Descrição**: Obtém próximas chegadas de uma paragem via proxy

```javascript
fetchJSON(filePath)
```
- **Parâmetros**: `filePath` (string) - Caminho do ficheiro JSON
- **Retorna**: `Object|Array` - Dados parseados
- **Descrição**: Carrega ficheiro JSON estático

```javascript
fetchTripsData()
```
- **Retorna**: `Array` - Dados de trips.json
- **Descrição**: Carrega informação de viagens GTFS

```javascript
fetchCalendarData()
```
- **Retorna**: `Object` - Dados de calendar.json
- **Descrição**: Carrega calendário GTFS

```javascript
fetchStopsData()
```
- **Retorna**: `Array` - Dados de stops.json
- **Descrição**: Carrega informação de paragens GTFS

**Exportação**: `export const apiService = new ApiService()`

---

#### **`geolocationService.js`**

**Descrição**: Gestão de geolocalização do utilizador. Emite eventos via EventBus.

**Classe**: `GeolocationService`

**Propriedades**:
- `userPosition` - `[lat, lon]` ou `null`
- `watchId` - ID do watch (navigator.geolocation.watchPosition)
- `isWatching` - Boolean indicando se está a monitorizar

**Métodos**:

```javascript
getCurrentPosition(options)
```
- **Parâmetros**: `options` (object) - Opções de geolocação
- **Retorna**: `Promise<[lat, lon]>`
- **Descrição**: Obtém localização atual uma única vez
- **Eventos**: Emite `geolocation:update` ou `geolocation:error`

```javascript
watchPosition(options)
```
- **Parâmetros**: `options` (object)
- **Descrição**: Monitoriza localização em tempo real
- **Eventos**: Emite `geolocation:update` continuamente

```javascript
stopWatching()
```
- **Descrição**: Para de monitorizar localização

```javascript
getPosition()
```
- **Retorna**: `[lat, lon]` ou `null`
- **Descrição**: Obtém localização em cache (sem fazer novo pedido)

```javascript
isAvailable()
```
- **Retorna**: `boolean`
- **Descrição**: Verifica se a localização está disponível

**Exportação**: `export const geolocationService = new GeolocationService()`

---

#### **`eventBus.js`**

**Descrição**: Sistema de eventos pub/sub para comunicação entre módulos.

**Classe**: `EventBus`

**Métodos**:

```javascript
on(eventName, callback)
```
- **Parâmetros**: Nome do evento, função callback
- **Descrição**: Subscreve a um evento

```javascript
off(eventName, callback)
```
- **Descrição**: Remove subscrição de evento

```javascript
emit(eventName, data)
```
- **Descrição**: Emite um evento com dados

**Eventos Principais**:
- `geolocation:update` - Localização atualizada
- `geolocation:error` - Erro na geolocalização
- `buses:updated` - Lista de autocarros atualizada
- `map:ready` - Mapa inicializado

**Exportação**: `export const eventBus = new EventBus()`

---

#### **`autoRefreshManager.js`**

**Descrição**: Gestão de atualizações automáticas periódicas.

**Classe**: `AutoRefreshManager`

**Métodos**:

```javascript
start(callback, interval)
```
- **Parâmetros**: Função a executar, intervalo em ms
- **Descrição**: Inicia refresh automático

```javascript
stop()
```
- **Descrição**: Para o refresh automático

```javascript
restart()
```
- **Descrição**: Reinicia o timer

**Exportação**: `export const autoRefreshManager = new AutoRefreshManager()`

---

### 2. Business Services (`src/services/`)

Lógica de negócio específica da aplicação.

---

#### **`vehicleService.js`**

**Descrição**: Processamento e extração de dados de veículos da API FIWARE.

**Classe**: `VehicleService`

**Métodos**:

```javascript
extractAnnotation(bus, prefix)
```
- **Parâmetros**: Objeto do autocarro, prefixo da anotação
- **Retorna**: `string|null`
- **Descrição**: Extrai anotação do autocarro (ex: "stcp:route:")

```javascript
extractLineNumber(bus)
```
- **Retorna**: `string|null` - Número da linha
- **Descrição**: Extrai número da linha (ex: "500", "207")

```javascript
extractDirection(bus)
```
- **Retorna**: `string|null` - Sentido (0 ou 1)
- **Descrição**: Extrai sentido/direção do autocarro

```javascript
extractTripId(bus)
```
- **Retorna**: `string|null` - Trip ID
- **Descrição**: Extrai ID da viagem

```javascript
matchVehicleToTrip(vehicles, tripId)
```
- **Parâmetros**: Array de veículos, trip_id
- **Retorna**: `Object|null` - Veículo correspondente
- **Descrição**: Encontra veículo que corresponde a um trip_id

```javascript
extractVehicleLocation(vehicle)
```
- **Retorna**: `{latitude, longitude, bearing, speed}|null`
- **Descrição**: Extrai coordenadas e informação de movimento

```javascript
processBusData(bus, destination)
```
- **Parâmetros**: Objeto raw do autocarro, destino
- **Retorna**: `Object|null` - Autocarro processado e pronto a usar
- **Descrição**: Processa todos os dados do autocarro numa estrutura consistente
- **Estrutura retornada**:
  ```javascript
  {
    id: string,
    line: string,
    latitude: number,
    longitude: number,
    speed: number,
    busNumber: string,
    destination: string,
    direction: string,
    tripId: string
  }
  ```

```javascript
shouldIncludeBus(bus, filterValue)
```
- **Parâmetros**: Autocarro processado, valor de filtro
- **Retorna**: `boolean`
- **Descrição**: Verifica se autocarro deve ser incluído (filtro)

**Exportação**: `export const vehicleService = new VehicleService()`

---

#### **`stopService.js`**

**Descrição**: Gestão de paragens usando dados de stops.json.

**Classe**: `StopService`

**Propriedades**:
- `stops` - Array de todas as paragens

**Métodos**:

```javascript
loadStopsData()
```
- **Retorna**: `Promise<Array>` - Lista de paragens
- **Descrição**: Carrega e processa stops.json
- **Estrutura da paragem**:
  ```javascript
  {
    stop_id: string,
    stop_name: string,
    latitude: number,
    longitude: number,
    stop_url: string
  }
  ```

```javascript
getAllStops()
```
- **Retorna**: `Array` - Todas as paragens

```javascript
getNearbyStops(userLat, userLon, maxDistance)
```
- **Parâmetros**: Latitude, longitude, distância máxima em metros (padrão: 1000)
- **Retorna**: `Array` - Paragens próximas ordenadas por distância
- **Descrição**: Encontra paragens num raio específico

```javascript
searchStops(query)
```
- **Parâmetros**: Texto de pesquisa
- **Retorna**: `Array` - Paragens que correspondem à pesquisa
- **Descrição**: Pesquisa por nome ou código de paragem

```javascript
getStopById(id)
```
- **Parâmetros**: ID da paragem
- **Retorna**: `Object|null` - Paragem encontrada

**Exportação**: `export const stopService = new StopService()`

---

#### **`scheduleService.js`**

**Descrição**: Processamento de horários GTFS (trips.json, calendar.json).

**Classe**: `ScheduleService`

**Métodos**:

```javascript
loadScheduleData()
```
- **Descrição**: Carrega trips.json e calendar.json

```javascript
getHeadsignForTrip(tripId)
```
- **Parâmetros**: Trip ID
- **Retorna**: `string` - Destino da viagem (headsign)

```javascript
getServiceForTrip(tripId)
```
- **Retorna**: `Object` - Informação do service_id

```javascript
isTripActiveToday(tripId)
```
- **Retorna**: `boolean` - Se a viagem está ativa hoje

**Exportação**: `export const scheduleService = new ScheduleService()`

---

### 3. Map Management (`src/map/`)

Gestão de mapas Leaflet e marcadores.

---

#### **`MapManager.js`**

**Descrição**: Classe base para todos os mapas. API unificada para operações comuns.

**Classe**: `MapManager`

**Construtor**:
```javascript
constructor(elementId, options = {})
```
- **Parâmetros**: ID do elemento HTML, opções (center, zoom)

**Propriedades**:
- `map` - Instância do Leaflet
- `markers` - Objeto com todos os marcadores
- `userMarker` - Marcador do utilizador
- `userPosition` - `[lat, lon]`

**Métodos**:

```javascript
initialize(getUserPosition)
```
- **Retorna**: Instância do mapa Leaflet
- **Descrição**: Inicializa o mapa

```javascript
waitForReady()
```
- **Retorna**: `Promise`
- **Descrição**: Aguarda que o mapa esteja completamente carregado

```javascript
addMarker(id, position, icon, popupContent)
```
- **Parâmetros**: ID único, [lat, lon], ícone Leaflet, HTML do popup
- **Retorna**: Marcador Leaflet
- **Descrição**: Adiciona marcador genérico ao mapa

```javascript
removeMarker(id)
```
- **Descrição**: Remove marcador pelo ID

```javascript
updateMarker(id, position, icon, popupContent)
```
- **Descrição**: Atualiza posição e/ou ícone de um marcador

```javascript
centerOn(position, zoom)
```
- **Parâmetros**: [lat, lon], nível de zoom (opcional)
- **Descrição**: Centra o mapa numa posição

```javascript
fitBounds(positions, options)
```
- **Parâmetros**: Array de [lat, lon], opções (padding, maxZoom)
- **Descrição**: Ajusta zoom para mostrar todos os pontos

```javascript
setUserPosition(lat, lon)
```
- **Descrição**: Define localização do utilizador

```javascript
getUserPosition()
```
- **Retorna**: `[lat, lon]|null`

```javascript
updateUserMarker(position)
```
- **Descrição**: Cria/atualiza marcador azul do utilizador

```javascript
centerOnUser(zoom)
```
- **Descrição**: Centra mapa na localização do utilizador

```javascript
clearAllMarkers()
```
- **Descrição**: Remove todos os marcadores

```javascript
cleanup()
```
- **Descrição**: Limpeza completa (marcadores + mapa)

**Exportação**: `export { MapManager }`

---

#### **`markers/BusMarkerManager.js`**

**Descrição**: Gestão especializada de marcadores de autocarros.

**Classe**: `BusMarkerManager`

**Métodos**:

```javascript
updateBusMarkers(buses)
```
- **Parâmetros**: Array de autocarros processados
- **Descrição**: Atualiza marcadores (adiciona novos, atualiza existentes, remove antigos)

```javascript
createBusIcon(line, bearing)
```
- **Retorna**: Ícone Leaflet customizado
- **Descrição**: Cria ícone de autocarro com rotação

```javascript
createBusPopup(bus)
```
- **Retorna**: HTML string
- **Descrição**: Cria conteúdo do popup do autocarro

```javascript
clearAllMarkers()
```
- **Descrição**: Remove todos os marcadores de autocarros

**Exportação**: `export { BusMarkerManager }`

---

#### **`markers/StopMarkerManager.js`**

**Descrição**: Gestão especializada de marcadores de paragens.

**Classe**: `StopMarkerManager`

**Métodos**:

```javascript
updateStopMarkers(stops, showDistance, onClickCallback)
```
- **Parâmetros**: Array de paragens, mostrar distância?, callback ao clicar
- **Descrição**: Atualiza todos os marcadores de paragens

```javascript
addStopMarker(stop, showDistance)
```
- **Descrição**: Adiciona marcador de uma paragem

```javascript
createStopIcon()
```
- **Retorna**: Ícone Leaflet (formato paragem de autocarro)

```javascript
createPopupContent(stop, showDistance)
```
- **Retorna**: HTML string

```javascript
hideAllMarkers()
```
- **Descrição**: Esconde marcadores (sem remover)

```javascript
showAllMarkers()
```
- **Descrição**: Mostra marcadores escondidos

```javascript
showOnlyMarker(stopId)
```
- **Descrição**: Mostra apenas um marcador específico (esconde outros)

```javascript
openPopup(stopId)
```
- **Descrição**: Abre popup de uma paragem

```javascript
clearAllMarkers()
```

**Exportação**: `export { StopMarkerManager }`

---

#### **`controls/`**

**`BusMapControl.js`** - Botão para navegar para o Bus Map

**`CenterControl.js`** - Botão para centrar na localização do utilizador

**`StopsControl.js`** - Botão para navegar para o Stops Map

**Funções exportadas**:
```javascript
createBusMapControl(map)
createCenterControl(map, getUserPosition)
createStopsControl(map)
```
- **Retorna**: Controlo Leaflet
- **Descrição**: Cria controlo customizado para o mapa

---

#### **`utils/`**

**`mapInitializer.js`** - Inicialização de mapas Leaflet

**`distanceCalculator.js`** - Cálculo de distância Haversine

```javascript
calculateDistance(lat1, lon1, lat2, lon2)
```
- **Retorna**: Distância em metros

---

### 4. UI Components (`src/ui/`)

Componentes de interface reutilizáveis.

---

#### **`components/NextArrivals.js`**

**Descrição**: Painel de próximas chegadas (metade inferior do ecrã).

**Classe**: `NextArrivals`

**Métodos**:

```javascript
create()
```
- **Descrição**: Cria elemento HTML do painel

```javascript
show(stopName, stopId)
```
- **Parâmetros**: Nome da paragem, código da paragem
- **Descrição**: Mostra o painel com animação

```javascript
hide()
```
- **Descrição**: Esconde o painel

```javascript
setArrivals(arrivals, vehicles)
```
- **Parâmetros**: Array de chegadas, array de veículos
- **Descrição**: Renderiza lista de próximas chegadas com ícones de localização

```javascript
updateLastUpdate()
```
- **Descrição**: Atualiza timestamp da última atualização

```javascript
onClose(callback)
```
- **Descrição**: Define callback para botão fechar

```javascript
onRefresh(callback)
```
- **Descrição**: Define callback para botão refresh

```javascript
onArrivalClick(callback)
```
- **Descrição**: Define callback ao clicar numa chegada

```javascript
getActiveLocationIcon()
```
- **Retorna**: SVG string
- **Descrição**: Ícone verde animado (autocarro com GPS)

```javascript
getInactiveLocationIcon()
```
- **Retorna**: SVG string
- **Descrição**: Ícone vermelho (autocarro sem GPS)

```javascript
destroy()
```
- **Descrição**: Remove componente do DOM

**Exportação**: `export { NextArrivals }`

---

#### **`components/LastUpdateDisplay.js`**

**Descrição**: Componente de exibição de última atualização.

**Classe**: `LastUpdateDisplay`

**Métodos**:
```javascript
update()
```
- **Descrição**: Atualiza timestamp para agora

**Exportação**: `export { LastUpdateDisplay }`

---

#### **`design/iconCache.js`**

**Descrição**: Cache de ícones SVG inline para melhor performance.

**Objeto**: `iconCache`

**Propriedades**:
- `bus` - Ícone SVG de autocarro
- `stop` - Ícone SVG de paragem
- `user` - Ícone SVG de utilizador

**Exportação**: `export { iconCache }`

---

### 5. Pages (Aplicações) (`src/pages/`)

Aplicações principais que orquestram todos os módulos.

---

#### **`BusMapApp.js`**

**Descrição**: Aplicação do mapa de autocarros (`index.html`).

**Classe**: `BusMapApp`

**Fluxo**:
1. Inicializa MapManager
2. Adiciona controlos (centrar, navegar para stops)
3. Configura geolocalização
4. Carrega dados de trips/calendar
5. Inicia auto-refresh (30s)
6. Renderiza autocarros no mapa
7. Aplica filtro de linha

**Métodos principais**:

```javascript
initialize()
```
- **Descrição**: Inicializa toda a aplicação

```javascript
loadBusData()
```
- **Descrição**: Carrega dados dos autocarros da API

```javascript
processAndDisplayBuses(buses)
```
- **Descrição**: Processa e renderiza autocarros no mapa

```javascript
setupEventListeners()
```
- **Descrição**: Configura listeners (filtro, geoloocação)

```javascript
startAutoRefresh()
```
- **Descrição**: Inicia refresh automático de 30 em 30s

```javascript
cleanup()
```
- **Descrição**: Limpeza ao sair da página

**Auto-inicialização**: Executa automaticamente quando DOM está pronto

---

#### **`StopsMapApp.js`**

**Descrição**: Aplicação do mapa de paragens (`stopsmap.html`).

**Classe**: `StopsMapApp`

**Fluxo**:
1. Inicializa MapManager
2. Carrega stops.json
3. Adiciona controlos
4. Configura geolocalização
5. Mostra paragens no mapa
6. Ao clicar numa paragem:
   - Abre painel NextArrivals
   - Mostra apenas marcador da paragem selecionada
   - Fecha popup da paragem
   - Carrega próximas chegadas
   - Mostra autocarros que vão à paragem
   - Inicia auto-refresh (5s)
7. Ao fechar painel:
   - Para auto-refresh
   - Limpa autocarros
   - Mostra todas as paragens
   - Centra na paragem consultada

**Métodos principais**:

```javascript
initialize()
```

```javascript
setupGeolocation()
```

```javascript
displayAllStops()
```
- **Descrição**: Mostra todas as paragens no mapa

```javascript
displayNearbyStops()
```
- **Descrição**: Mostra paragens num raio de 2km

```javascript
handleSearch()
```
- **Descrição**: Pesquisa de paragens

```javascript
handleStopClick(stop)
```
- **Descrição**: Gestor ao clicar numa paragem

```javascript
loadStopArrivals(stopId)
```
- **Descrição**: Carrega próximas chegadas da paragem

```javascript
updateBusMap(arrivals, vehicles)
```
- **Descrição**: Filtra e mostra autocarros que vão à paragem

```javascript
handleArrivalClick(data)
```
- **Descrição**: Faz zoom no autocarro ao clicar na chegada

```javascript
handleCloseArrivals()
```
- **Descrição**: Fecha painel e volta ao estado inicial

```javascript
startAutoRefresh()
```
- **Descrição**: Auto-refresh de 5 em 5s

```javascript
cleanup()
```

**Auto-inicialização**: Executa automaticamente quando DOM está pronto

---

### 6. Utils (`src/utils/`)

Funções auxiliares.

---

#### **`dateHelpers.js`**

**Funções**:

```javascript
formatTime(date)
```
- **Retorna**: String "HH:MM"

```javascript
formatDate(date)
```
- **Retorna**: String "DD/MM/YYYY"

```javascript
formatDateTime(date)
```
- **Retorna**: String "DD/MM/YYYY HH:MM"

```javascript
getCurrentTime()
```
- **Retorna**: String "HH:MM:SS"

```javascript
timeAgo(date)
```
- **Retorna**: String "há X segundos/minutos/horas"

---

## 💾 Recursos Estáticos

### `resources/`

#### **`stops.json`**
Dados GTFS de todas as paragens da STCP.

**Estrutura**:
```json
[
  {
    "stop_code": "HER1",
    "stop_name": "Heroismo",
    "stop_lat": 41.157,
    "stop_lon": -8.629,
    "stop_url": "https://..."
  }
]
```

#### **`trips.json`**
Dados GTFS de viagens (trip_id, headsign, route_id, service_id).

**Estrutura**:
```json
[
  {
    "trip_id": "500_1_1",
    "trip_headsign": "Matosinhos Sul",
    "route_id": "500",
    "service_id": "1",
    "direction_id": "1"
  }
]
```

#### **`calendar.json`**
Calendário GTFS (dias de operação dos serviços).

**Estrutura**:
```json
{
  "1": {
    "monday": 1,
    "tuesday": 1,
    "wednesday": 1,
    "thursday": 1,
    "friday": 1,
    "saturday": 0,
    "sunday": 0,
    "start_date": "20240101",
    "end_date": "20241231"
  }
}
```

#### **`header.js`**
Header HTML comum injetado em ambas as páginas.

#### **`favicon.svg`**
Ícone da aplicação.

---

## 👷 Service Worker

### `sw.js`

**Versão**: `stcp-live-v4`

**Estratégia de Cache**:

1. **Recursos Estáticos** - Cache First + Stale-While-Revalidate
   - HTML, CSS, JS, JSON estáticos
   - Serve de cache imediatamente
   - Atualiza cache em background

2. **APIs** - Network Only (sem cache)
   - FIWARE Urban Platform
   - Cloudflare Worker (GTFS Realtime)
   - Dados sempre frescos

3. **Offline Fallback**
   - Se API falhar offline, retorna erro JSON apropriado

**Ficheiros Cacheados** (23 ficheiros):
- Páginas HTML
- Módulos JavaScript (todos)
- Estilos CSS (todos)
- Recursos (favicon, header, manifest, JSONs)

**Limpeza Automática**:
- Remove caches antigas (v1, v2, v3) ao ativar v4

---

## 🔄 Fluxo de Dados

### Bus Map (index.html)

```
1. BusMapApp.initialize()
   ↓
2. apiService.fetchBusData() → API FIWARE
   ↓
3. scheduleService.loadScheduleData() → trips.json + calendar.json
   ↓
4. Para cada autocarro:
   - vehicleService.processBusData()
   - vehicleService.extractLineNumber()
   - scheduleService.getHeadsignForTrip()
   ↓
5. busMarkerManager.updateBusMarkers()
   ↓
6. Renderiza marcadores no mapa
   ↓
7. Auto-refresh a cada 30s
```

### Stops Map (stopsmap.html)

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
7. apiService.fetchStopRealtime(stopId) → Proxy GTFS
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

### Deploy

A aplicação é estática e pode ser hospedada em:
- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages
- Qualquer servidor HTTP

### Requisitos

- Navegador moderno (suporte ES6 modules)
- Ligação à Internet (para APIs)
- Permissão de geolocalização (opcional)

---

## 🛠️ Arquitetura

### Princípios

1. **Modularidade**: Código organizado em módulos ES6
2. **Separação de Responsabilidades**: Core, Services, UI, Map separados
3. **Reutilização**: Componentes e serviços reutilizáveis
4. **Single Responsibility**: Cada classe/ficheiro tem um propósito claro
5. **Event-Driven**: Comunicação via EventBus
6. **Progressive Enhancement**: Funciona mesmo sem geolocalização

### Camadas

```
Presentação (UI)
    ↓
Aplicações (Pages)
    ↓
Serviços de Negócio (Services)
    ↓
Serviços Core (Core)
    ↓
APIs Externas (FIWARE, GTFS Realtime)
```

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

## 📞 Contacto

**Autor**: Tiago Oliveira  
**GitHub**: [@tiagoanoliveira](https://github.com/tiagoanoliveira)  
**Repositório**: [stcp-tracker](https://github.com/tiagoanoliveira/stcp-tracker)

---

**Última atualização**: 26 de Janeiro de 2026

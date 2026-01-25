/**
 * NextArrivals - Componente de UI para mostrar próximas chegadas numa paragem
 * Aparece na metade inferior do ecrã sobre o mapa
 */

export class NextArrivals {
  constructor() {
    this.element = null;
    this.isVisible = false;
    this.onArrivalClickCallback = null;
    this.onCloseCallback = null;
  }

  create() {
    if (this.element) return this.element;

    const sheet = document.createElement('div');
    sheet.id = 'next-arrivals';
    sheet.className = 'next-arrivals';
    sheet.innerHTML = `
      <div class="next-arrivals-header">
        <div class="next-arrivals-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <h2 id="arrivals-stop-name">Paragem</h2>
        </div>
        <button class="next-arrivals-close" title="Fechar">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="next-arrivals-content">
        <div id="arrivals-list-panel" class="arrivals-list-panel">
          <p class="loading-message">A carregar...</p>
        </div>
      </div>
      <div class="next-arrivals-footer">
        <p id="arrivals-last-update">Última atualização: <strong>--:--:--</strong></p>
      </div>
    `;

    document.body.appendChild(sheet);
    this.element = sheet;

    // Event listeners
    const closeBtn = sheet.querySelector('.next-arrivals-close');
    closeBtn.addEventListener('click', () => this.hide());

    // Fechar ao clicar fora (opcional)
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) {
        this.hide();
      }
    });

    return sheet;
  }

  show(stopName) {
    if (!this.element) {
      this.create();
    }

    const titleElement = this.element.querySelector('#arrivals-stop-name');
    if (titleElement && stopName) {
      titleElement.textContent = stopName;
    }

    this.element.classList.add('visible');
    this.isVisible = true;
    console.log('✅ NextArrivals aberto');
  }

  hide() {
    if (this.element) {
      this.element.classList.remove('visible');
      this.isVisible = false;
      console.log('🚫 NextArrivals fechado');
      
      if (this.onCloseCallback) {
        this.onCloseCallback();
      }
    }
  }

  setArrivals(arrivals, vehicles) {
    if (!this.element) return;

    const listContainer = this.element.querySelector('#arrivals-list-panel');
    
    if (!arrivals || arrivals.length === 0) {
      listContainer.innerHTML = `
        <p class="no-arrivals">
          ⚠️ Foram registadas anomalias na informação prestada sobre as próximas chegadas em tempo real pela STCP.<br><br>
          Consulte <a href="index.html">aqui a localização em tempo real dos autocarros</a> ou verifique o horário planeado na paragem.
        </p>
      `;
      return;
    }

    listContainer.innerHTML = '';

    arrivals.forEach(arrival => {
      const vehicle = this.matchVehicleToTrip(vehicles, arrival.trip_id);
      const arrivalElement = this.createArrivalElement(arrival, vehicle);
      listContainer.appendChild(arrivalElement);
    });

    console.log(`✓ ${arrivals.length} chegadas mostradas no painel`);
  }

  createArrivalElement(arrival, vehicle) {
    const statusClass = arrival.status === 'ON_TIME' ? 'status-ontime' : 'status-delayed';
    const lineColors = this.getLineColors(arrival.route_short_name);
    
    const div = document.createElement('div');
    div.className = 'arrival-item';
    
    if (vehicle) {
      const location = this.extractVehicleLocation(vehicle);
      if (location) {
        div.style.cursor = 'pointer';
        div.setAttribute('data-vehicle-id', vehicle.id);
        div.addEventListener('click', () => {
          if (this.onArrivalClickCallback) {
            this.onArrivalClickCallback({
              vehicleId: vehicle.id,
              location: location,
              arrival: arrival
            });
          }
        });
      }
    }
    
    div.innerHTML = `
      <div class="arrival-line" style="background-color: ${lineColors.busColor}; color: ${lineColors.textColor};">
        ${arrival.route_short_name}
      </div>
      <div class="arrival-info">
        <div class="arrival-destination">${arrival.trip_headsign}</div>
        <div class="arrival-status">
          ${this.getStatusText(arrival.status)}
          ${arrival.delay_minutes > 1 ? `<span class="status-badge ${statusClass}">+${Math.round(arrival.delay_minutes)} min</span>` : ''}
        </div>
      </div>
      <div class="arrival-time">
        ${this.formatArrivalTime(arrival.arrival_minutes)}
      </div>
    `;
    
    return div;
  }

  matchVehicleToTrip(vehicles, tripId) {
    if (!vehicles || !tripId) return null;
    
    return vehicles.find(vehicle => {
      const annotations = vehicle['vehicle-tracking:annotations'];
      if (!annotations || !annotations.value) return false;
      
      try {
        const data = JSON.parse(annotations.value);
        return data.tripId === tripId;
      } catch (e) {
        return false;
      }
    });
  }

  extractVehicleLocation(vehicle) {
    if (!vehicle.location?.value?.coordinates) return null;
    
    const [longitude, latitude] = vehicle.location.value.coordinates;
    const speed = vehicle.speed?.value || 0;
    
    return { latitude, longitude, speed };
  }

  getLineColors(line) {
    // Import colors from busColors.js ou usar default
    const BUS_COLORS = {
      '2': { busColor: '#E30613', textColor: '#fff' },
      '3': { busColor: '#FFCD00', textColor: '#000' },
      '5': { busColor: '#00A651', textColor: '#fff' },
      '6': { busColor: '#662D91', textColor: '#fff' },
      '7': { busColor: '#FF6600', textColor: '#fff' },
      '8': { busColor: '#00AEEF', textColor: '#fff' },
      '9': { busColor: '#E30613', textColor: '#fff' },
      'Z': { busColor: '#000000', textColor: '#fff' },
      'M': { busColor: '#0072C6', textColor: '#fff' },
    };

    if (!line) return { busColor: '#0072C6', textColor: '#fff' };
    if (BUS_COLORS[line]) return BUS_COLORS[line];
    
    const prefix = line[0];
    if (BUS_COLORS[prefix]) return BUS_COLORS[prefix];
    
    return { busColor: '#0072C6', textColor: '#fff' };
  }

  getStatusText(status) {
    const statusMap = {
      'ON_TIME': 'No horário',
      'DELAYED': 'Atrasado',
      'EARLY': 'Adiantado',
      'SCHEDULED': 'Programado'
    };
    return statusMap[status] || status;
  }

  formatArrivalTime(minutes) {
    if (minutes === undefined || minutes === null) return 'N/A';
    
    if (minutes < 1) return 'A chegar';
    if (minutes === 1) return '1 min';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h${mins.toString().padStart(2, '0')}`;
  }

  updateLastUpdate(timestamp) {
    if (!this.element) return;
    
    const updateElement = this.element.querySelector('#arrivals-last-update');
    if (updateElement) {
      const time = timestamp || new Date();
      const hours = time.getHours().toString().padStart(2, '0');
      const minutes = time.getMinutes().toString().padStart(2, '0');
      const seconds = time.getSeconds().toString().padStart(2, '0');
      updateElement.innerHTML = `Última atualização: <strong>${hours}:${minutes}:${seconds}</strong>`;
    }
  }

  onArrivalClick(callback) {
    this.onArrivalClickCallback = callback;
  }

  onClose(callback) {
    this.onCloseCallback = callback;
  }

  destroy() {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}

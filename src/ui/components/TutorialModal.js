/**
 * TutorialModal - Modal de tutorial passo-a-passo.
 *
 * Utilização:
 *   const t = new TutorialModal({ page: 'busmap' | 'stopsmap' });
 *   t.mount();
 *   t.showIfFirstVisit();  // mostra automaticamente na 1.ª visita
 *   t.open();              // abre manualmente (botão ?)
 */

const STEPS = {
  busmap: [
    {
      icon: '\uD83D\uDE8C',
      title: 'Bem-vindo ao STCP Live!',
      body: 'Este mapa mostra a localização em <strong>tempo real</strong> de todos os autocarros STCP no Porto. Os marcadores actualizam-se automaticamente a cada 5 segundos.'
    },
    {
      icon: '\uD83D\uDDF3\uFE0F',
      title: 'Filtrar por linha',
      body: 'Usa a barra de linhas no topo para ver apenas os autocarros de uma linha específica. Clica na seta \u2192/\u2190 no chip para alternar entre o sentido de ida e de volta.'
    },
    {
      icon: '\uD83D\uDEBE',
      title: 'Mapa de paragens',
      body: 'No canto inferior esquerdo encontras o botão <strong>"Paragens"</strong>. Clica nele para aceder ao mapa de todas as paragens STCP — o mapa centra-se automaticamente na tua localização.'
    },
    {
      icon: '\uD83D\uDCCD',
      title: 'Próximas chegadas',
      body: 'Clica em cima de qualquer paragem para ver as próximas chegadas em tempo real. Podes filtrar por linha dentro do próprio painel.'
    },
    {
      icon: '\u2B50',
      title: 'Favoritos',
      body: 'Guarda as tuas paragens favoritas clicando na estrela (\u2B50) no cabeçalho do painel de chegadas. Acede a elas a qualquer momento pelo botão \u2B50 no canto superior direito.'
    },
    {
      icon: '\uD83D\uDD17',
      title: 'Links directos',
      body: 'Podes guardar um link directo para a tua paragem. Abre o painel de chegadas e copia o URL — inclui a paragem e a linha. No telemóvel usa <em>"Adicionar ao ecrã inicial"</em> para criar um atalho.'
    },
    {
      icon: '\uD83C\uDF19',
      title: 'Linhas nocturnas',
      body: 'As linhas nocturnas (identificadas com <strong>M</strong>) só aparecem nos filtros entre as <strong>00:30 e as 06:30</strong>. As linhas diurnas são ocultadas entre as 01:30 e as 05:30.'
    }
  ],
  stopsmap: [
    {
      icon: '\uD83D\uDEBF',
      title: 'Bem-vindo ao mapa de paragens!',
      body: 'Aqui podes explorar todas as paragens STCP do Porto. O mapa centra-se automaticamente na tua localização e mostra as paragens mais próximas da área visível.'
    },
    {
      icon: '\uD83D\uDD0D',
      title: 'Pesquisar paragem',
      body: 'Usa a barra de pesquisa no topo para encontrar uma paragem pelo nome ou código. Clica no resultado para centrar o mapa nessa paragem.'
    },
    {
      icon: '\uD83D\uDDF3\uFE0F',
      title: 'Filtrar por linha',
      body: 'A barra de linhas no topo mostra as paragens e o percurso de uma linha específica no mapa. Usa a seta \u2192/\u2190 para ver a ida ou a volta.'
    },
    {
      icon: '\uD83D\uDE8C',
      title: 'Mapa de autocarros em tempo real',
      body: 'No canto inferior esquerdo encontras o botão <strong>"Autocarros"</strong>. Clica nele para aceder ao mapa de localização em tempo real de todos os autocarros STCP — o mapa centra-se automaticamente na tua localização.'
    },
    {
      icon: '\uD83D\uDCCD',
      title: 'Próximas chegadas',
      body: 'Clica em qualquer paragem — ou em <em>"Próximos autocarros"</em> no popup — para ver as próximas chegadas em tempo real com o estado de cada autocarro.'
    },
    {
      icon: '\u2B50',
      title: 'Favoritos',
      body: 'No painel de chegadas, clica na estrela (\u2B50) para guardar a paragem como favorita. Os favoritos ficam acessíveis pelo botão \u2B50 no canto superior direito.'
    },
    {
      icon: '\uD83D\uDD17',
      title: 'Links directos',
      body: 'O URL actualiza-se automaticamente quando abres uma paragem. Copia o link e partilha-o — quem o abrir verá directamente as chegadas dessa paragem. No telemóvel usa <em>"Adicionar ao ecrã inicial"</em>.'
    }
  ]
};

const STORAGE_KEY = {
  busmap:   'stcp_tutorial_busmap_seen',
  stopsmap: 'stcp_tutorial_stopsmap_seen'
};

export class TutorialModal {
  constructor(options = {}) {
    this.page    = options.page || 'busmap';
    this.steps   = STEPS[this.page] || STEPS.busmap;
    this.current = 0;
    this.element = null;
  }

  mount() {
    if (this.element) return;

    this.element = document.createElement('div');
    this.element.id        = 'tutorial-modal';
    this.element.className = 'tutorial-modal';
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-hidden', 'true');
    this.element.innerHTML = `
      <div class="tutorial-backdrop"></div>
      <div class="tutorial-card">
        <button class="tutorial-close" title="Fechar" aria-label="Fechar tutorial">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <div class="tutorial-step-icon" id="tut-icon"></div>
        <h2 class="tutorial-step-title" id="tut-title"></h2>
        <p class="tutorial-step-body" id="tut-body"></p>
        <div class="tutorial-dots" id="tut-dots"></div>
        <div class="tutorial-actions">
          <button class="tutorial-btn tutorial-btn-secondary" id="tut-prev">&#8592; Anterior</button>
          <button class="tutorial-btn tutorial-btn-primary" id="tut-next">Próximo &#8594;</button>
        </div>
      </div>`;

    document.body.appendChild(this.element);

    this.element.querySelector('.tutorial-close').addEventListener('click', () => this.close());
    this.element.querySelector('.tutorial-backdrop').addEventListener('click', () => this.close());
    this.element.querySelector('#tut-prev').addEventListener('click', () => this._go(this.current - 1));
    this.element.querySelector('#tut-next').addEventListener('click', () => {
      if (this.current < this.steps.length - 1) this._go(this.current + 1);
      else this.close();
    });

    document.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') this.close();
      if (e.key === 'ArrowRight') this._go(this.current + 1);
      if (e.key === 'ArrowLeft')  this._go(this.current - 1);
    });
  }

  get isOpen() {
    return this.element?.getAttribute('aria-hidden') === 'false';
  }

  showIfFirstVisit() {
    const key = STORAGE_KEY[this.page];
    if (!localStorage.getItem(key)) this.open();
  }

  open() {
    if (!this.element) this.mount();
    this.current = 0;
    this._render();
    this.element.setAttribute('aria-hidden', 'false');
    this.element.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }

  close() {
    if (!this.element) return;
    this.element.setAttribute('aria-hidden', 'true');
    this.element.classList.remove('visible');
    document.body.style.overflow = '';
    const key = STORAGE_KEY[this.page];
    if (key) localStorage.setItem(key, '1');
  }

  _go(index) {
    if (index < 0 || index >= this.steps.length) return;
    this.current = index;
    this._render();
  }

  _render() {
    const step  = this.steps[this.current];
    const last  = this.current === this.steps.length - 1;
    const first = this.current === 0;

    this.element.querySelector('#tut-icon').textContent  = step.icon;
    this.element.querySelector('#tut-title').textContent = step.title;
    this.element.querySelector('#tut-body').innerHTML    = step.body;

    const dotsEl = this.element.querySelector('#tut-dots');
    dotsEl.innerHTML = '';
    this.steps.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = `tut-dot${i === this.current ? ' active' : ''}`;
      dot.addEventListener('click', () => this._go(i));
      dotsEl.appendChild(dot);
    });

    const prevBtn = this.element.querySelector('#tut-prev');
    const nextBtn = this.element.querySelector('#tut-next');
    prevBtn.style.visibility = first ? 'hidden' : 'visible';
    nextBtn.textContent = last ? 'Concluir \u2713' : 'Próximo \u2192';
    nextBtn.classList.toggle('tutorial-btn-finish', last);
  }

  destroy() {
    if (this.element) { this.element.remove(); this.element = null; }
  }
}

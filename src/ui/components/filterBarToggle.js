import { getSetting, setSetting, SETTINGS_KEYS } from '../../config/filterSettings.js';

/**
 * Liga o botão #filter-toggle-btn ao elemento da barra de filtros indicada,
 * persistindo a preferência em localStorage. Usar em BusMapApp e StopsMapApp.
 */
export function wireFilterToggleButton(routeFilterBar, filterRowId = 'filter-row') {
    const filterToggleBtn = document.getElementById('filter-toggle-btn');
    const filterRow = document.getElementById(filterRowId);
    if (!filterToggleBtn || !filterRow) return;

    const barOpen = getSetting(SETTINGS_KEYS.FILTER_BAR_OPEN, true);
    filterRow.style.display = barOpen ? '' : 'none';
    filterToggleBtn.classList.toggle('active', barOpen);

    filterToggleBtn.addEventListener('click', () => {
        const nowOpen = filterRow.style.display !== 'none';
        filterRow.style.display = nowOpen ? 'none' : '';
        filterToggleBtn.classList.toggle('active', !nowOpen);
        setSetting(SETTINGS_KEYS.FILTER_BAR_OPEN, String(!nowOpen));
        if (routeFilterBar) routeFilterBar._filterBarOpen = !nowOpen;
    });
}
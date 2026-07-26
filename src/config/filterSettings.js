// Chaves de localStorage
export const SETTINGS_KEYS = {
    FILTER_BAR_OPEN:        'setting_filterBarOpen',        // bool
    STCP_GROUPS_EXPANDED:   'setting_stcpGroupsExpanded',   // bool
    UNIR_GROUPS_EXPANDED:   'setting_unirGroupsExpanded',   // bool
    UNIR_SUBLOTS_EXPANDED:  'setting_unirSublotsExpanded',  // bool
};

export function getSetting(key, defaultValue) {
    const v = localStorage.getItem(key);
    if (v === null) return defaultValue;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return v;
}

export function setSetting(key, value) {
    localStorage.setItem(key, String(value));
}
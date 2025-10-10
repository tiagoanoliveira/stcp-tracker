// busIcon.js - Função para criar ícones de autocarro personalizados

export function createBusIcon(line, colors, customTexts) {
  const customLineTexts = customTexts || {};
  const lineColors = colors || {};

  const prefix = (line && line.length > 0) ? line[0] : '';
  const colorSet = lineColors[line] || lineColors[prefix] || { busColor: '#000000', textColor: '#fff' };
  const displayText = customLineTexts[line] || line;

  const svg = `<svg width="17" height="8" xmlns="http://www.w3.org/2000/svg">
    <path d="M 1.2 1
      H 15
      A 1 1 0 0 1 16 2
      V 6.5
      H 12.5
      A 0.7 0.7 0 0 1 10.5 6.5
      H 6
      A 0.7 0.7 0 0 1 4 6.5
      H 0.5
      V 1.7
      A 0.7 0.7 0 0 1 1.2 1
      Z"
      stroke="#18d8d0" stroke-width="0.7" fill="none"/>
    <path d="M 1.7 1.6
      H 14.8
      A 0.5 0.6 0 0 1 15.3 2.2
      V 5.8
      H 1.2
      V 2.2
      A 0.5 0.6 0 0 1 1.7 1.6
      Z" 
      stroke="#fff" stroke-width="0.4"  
      fill="${colorSet.busColor}"/>
    <rect x="3.5" y="0.3" width="3" height="0.6" rx="0.1" stroke="#18d8d0" stroke-width="0.4" fill="none"/>
    <rect x="10" y="0.3" width="3" height="0.6" rx="0.1" stroke="#18d8d0" stroke-width="0.4" fill="none"/>
    <circle cx="5" cy="6.5" r="1" stroke="#18d8d0" stroke-width="0.7" fill="none"/>
    <circle cx="11.5" cy="6.5" r="1" stroke="#18d8d0" stroke-width="0.7" fill="none"/>
    <text x="8.5" y="4" text-anchor="middle" alignment-baseline="middle" font-family="Calibri" font-size="4" font-weight="bold" fill="${colorSet.textColor}">${displayText}</text>
  </svg>`;

  const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);

  return L.icon({
    iconUrl: url,
    iconSize: [40, 28],
    iconAnchor: [20, 14],
    popupAnchor: [0, -20]
  });
}

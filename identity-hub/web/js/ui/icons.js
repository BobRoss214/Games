// Icons are drawn here as inline SVG (the CSP allows no remote images and no icon fonts).
// One line weight, 24 x 24 grid, simple geometry.
import { s } from '../lib/dom.js';

// name -> list of shapes. A string is a path "d". An array is [tag, attributes].
const ICONS = {
  home: ['M4 20.25V10.5a8 8 0 0 1 16 0v9.75', 'M2.5 20.25h19', ['circle', { cx: 15.2, cy: 14.6, r: 0.9, fill: 'currentColor', stroke: 'none' }]],
  mail: [['rect', { x: 3, y: 5.5, width: 18, height: 13, rx: 1.5 }], 'M3.6 6.6 12 13l8.4-6.4'],
  inbox: ['M3.5 13.5 6 5.5h12l2.5 8', 'M3.5 13.5v4a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1v-4h-5a3 3 0 0 1-6 0h-5Z'],
  alias: [['circle', { cx: 12, cy: 12, r: 3.4 }], 'M15.4 8.8v4.6a2.3 2.3 0 0 0 4.6 0V12a8 8 0 1 0-3.2 6.4'],
  phone: ['M6.2 3.8h2.6l1.4 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.4v2.6a1.9 1.9 0 0 1-2 1.9A15.6 15.6 0 0 1 4.3 5.8a1.9 1.9 0 0 1 1.9-2Z'],
  funds: [['circle', { cx: 12, cy: 12, r: 8.25 }], 'M14.6 9.4c-.4-.9-1.4-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2s1 1.7 2.6 2 2.7.8 2.7 2-1.2 2-2.7 2c-1.3 0-2.3-.6-2.7-1.5', 'M12 6.4V8M12 16v1.6'],
  settings: ['M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1', ['circle', { cx: 15, cy: 7, r: 2 }], ['circle', { cx: 9, cy: 12, r: 2 }], ['circle', { cx: 17, cy: 17, r: 2 }]],
  copy: [['rect', { x: 8.5, y: 8.5, width: 11, height: 11, rx: 1.5 }], 'M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  more: [['circle', { cx: 5.5, cy: 12, r: 1.3, fill: 'currentColor', stroke: 'none' }], ['circle', { cx: 12, cy: 12, r: 1.3, fill: 'currentColor', stroke: 'none' }], ['circle', { cx: 18.5, cy: 12, r: 1.3, fill: 'currentColor', stroke: 'none' }]],
  plus: ['M12 5v14M5 12h14'],
  search: [['circle', { cx: 10.5, cy: 10.5, r: 6 }], 'm15 15 5 5'],
  close: ['m6 6 12 12M18 6 6 18'],
  chevronRight: ['m9 5 7 7-7 7'],
  chevronLeft: ['m15 5-7 7 7 7'],
  chevronDown: ['m5 9 7 7 7-7'],
  arrowRight: ['M4 12h15M13 6l6 6-6 6'],
  arrowLeft: ['M20 12H5M11 6l-6 6 6 6'],
  lock: [['rect', { x: 5, y: 10.5, width: 14, height: 9.5, rx: 1.5 }], 'M8 10.5V8a4 4 0 0 1 8 0v2.5'],
  key: [['circle', { cx: 8, cy: 15, r: 4 }], 'm11 12 8.5-8.5M16 7l2.5 2.5M13.5 9.5l2 2'],
  trash: ['M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 10.5v5.5M14 10.5v5.5'],
  edit: ['M4.5 19.5l1-4.2L16.3 4.5l3.2 3.2L8.7 18.5l-4.2 1Z', 'm14 6.8 3.2 3.2'],
  move: ['M4 8h14M14 4l4 4-4 4', 'M20 16H6M10 12l-4 4 4 4'],
  attach: ['M19 11.5 12.2 18.3a4.5 4.5 0 0 1-6.4-6.4l7-7a3 3 0 0 1 4.3 4.3l-7 7a1.5 1.5 0 0 1-2.2-2.2l6.3-6.3'],
  reply: ['M10 6 4.5 11.5 10 17', 'M4.5 11.5H14a5.5 5.5 0 0 1 5.5 5.5v1.5'],
  send: ['M20.5 3.5 10 14', 'M20.5 3.5 14 20.5l-4-6.5-6.5-4 17-6.5Z'],
  download: ['M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15'],
  shield: ['M12 3.5 5 6v5.5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6l-7-2.5Z'],
  eye: ['M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z', ['circle', { cx: 12, cy: 12, r: 2.75 }]],
  eyeOff: ['M4 4l16 16', 'M9.9 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M14 17.2a8 8 0 0 1-2 .3c-6 0-9.5-6.5-9.5-6.5a17 17 0 0 1 4-4.4'],
  warning: ['M12 4 2.8 19.5h18.4L12 4Z', 'M12 10v4.5', ['circle', { cx: 12, cy: 17, r: 0.9, fill: 'currentColor', stroke: 'none' }]],
  info: [['circle', { cx: 12, cy: 12, r: 8.5 }], 'M12 11v5.5', ['circle', { cx: 12, cy: 7.9, r: 0.9, fill: 'currentColor', stroke: 'none' }]],
  signOut: ['M14 4.5h4.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H14', 'M4 12h11M11 8l4 4-4 4'],
  sun: [['circle', { cx: 12, cy: 12, r: 3.75 }], 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4'],
  moon: ['M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7Z'],
  system: [['rect', { x: 3, y: 4.5, width: 18, height: 12, rx: 1.5 }], 'M9 20h6M12 16.5V20'],
  callIn: ['M18 6 7 17', 'M7 9v8h8'],
  callOut: ['M6 18 17 7', 'M9 7h8v8'],
  callMissed: ['M4 8l8 8 8-8', 'M20 13V8h-5'],
  message: ['M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H11l-4.5 3.5v-3.5h-2a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z'],
  refresh: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4.5v4h-4'],
  external: ['M13 5h6v6M19 5l-8 8', 'M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10'],
  tools: ['M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5L16 12l-2.5-.5L13 9l2.5-2.5-1-1Z'],
  file: ['M7 3.5h7l4 4V19.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z', 'M14 3.5V8h4'],
  globe: [['circle', { cx: 12, cy: 12, r: 8.5 }], 'M3.5 12h17M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.2-3.8-8.5S9.5 5.8 12 3.5Z'],
  passkey: [['circle', { cx: 9, cy: 8, r: 3.5 }], 'M3.5 19.5c0-3.3 2.5-5.5 5.5-5.5 1.2 0 2.3.3 3.2.9', ['circle', { cx: 17.5, cy: 13, r: 2.5 }], 'M17.5 15.5V21l1.5-1.2M17.5 18.5l1.2-.9'],
  sent: ['M4 12h13M12 6.5l5.5 5.5-5.5 5.5', 'M20 5v14'],
  person: [['circle', { cx: 12, cy: 8.5, r: 3.5 }], 'M5 19.5c0-3.6 3-6 7-6s7 2.4 7 6'],
  folder: ['M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v7.8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-10Z'],
  group: [['rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 1.5 }], 'M3.5 9.5h17', 'M8 13.5h8M8 16.5h5'],
  dot: [['circle', { cx: 12, cy: 12, r: 4, fill: 'currentColor', stroke: 'none' }]],
};

export function icon(name, { size = 20, label = '', cls = '' } = {}) {
  const shapes = ICONS[name] || ICONS.dot;
  const svg = s('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    class: `icon ${cls}`.trim(), focusable: 'false',
  });
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); } else svg.setAttribute('aria-hidden', 'true');
  for (const shape of shapes) {
    if (typeof shape === 'string') svg.appendChild(s('path', { d: shape }));
    else svg.appendChild(s(shape[0], shape[1]));
  }
  return svg;
}

// The postern mark: a small arched door with a handle, standing on a threshold line.
export function logoMark({ size = 28, cls = '' } = {}) {
  const svg = s('svg', { viewBox: '0 0 32 40', width: Math.round(size * 0.8), height: size, fill: 'none', class: `logo-mark ${cls}`.trim(), 'aria-hidden': 'true', focusable: 'false' });
  svg.appendChild(s('path', { d: 'M4.75 39.25V16a11.25 11.25 0 0 1 22.5 0v23.25', stroke: 'currentColor', 'stroke-width': 1.75 }));
  svg.appendChild(s('path', { d: 'M9.5 39.25V16.5a6.5 6.5 0 0 1 13 0v22.75', fill: 'currentColor', opacity: 0.16 }));
  svg.appendChild(s('path', { d: 'M1 39.25h30', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round' }));
  svg.appendChild(s('circle', { cx: 19, cy: 26, r: 1.4, fill: 'currentColor' }));
  return svg;
}

// A larger arch, used sparingly: empty states and the lock screen.
export function archFigure({ width = 72, keyhole = false, cls = '' } = {}) {
  const height = Math.round(width * 1.25);
  const svg = s('svg', { viewBox: '0 0 80 100', width, height, fill: 'none', class: `arch-figure ${cls}`.trim(), 'aria-hidden': 'true', focusable: 'false' });
  svg.appendChild(s('path', { d: 'M10 98V40a30 30 0 0 1 60 0v58', stroke: 'currentColor', 'stroke-width': 1.25 }));
  svg.appendChild(s('path', { d: 'M17 98V41a23 23 0 0 1 46 0v57', class: 'arch-door' }));
  svg.appendChild(s('path', { d: 'M2 98.5h76', stroke: 'currentColor', 'stroke-width': 1.25, 'stroke-linecap': 'round' }));
  if (keyhole) {
    svg.appendChild(s('circle', { cx: 40, cy: 58, r: 4, stroke: 'currentColor', 'stroke-width': 1.25 }));
    svg.appendChild(s('path', { d: 'M38.2 61.5 36.5 71h7l-1.7-9.5', stroke: 'currentColor', 'stroke-width': 1.25, 'stroke-linejoin': 'round' }));
  } else {
    svg.appendChild(s('circle', { cx: 53, cy: 66, r: 1.75, fill: 'currentColor' }));
  }
  return svg;
}

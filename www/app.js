/* BusSev — app Android para los autobuses de TUSSAM (Sevilla).
   Datos: backend.js (paradas incluidas + tiempos directos de TUSSAM).
   Mapa: MapLibre + OpenFreeMap (sin clave), recorridos por calle de recorridos.js. */
'use strict';

/* ================================================================== */
/* Almacenamiento y ajustes                                            */
/* ================================================================== */
const store = {
  get(k, d) { try { const v = localStorage.getItem('bussev.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bussev.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const DEFAULTS = {
  theme: 'dark', color: 'rojo', refresh: 30, liveLines: true, mapStyle: 'oscuro',
  tematicaAuto: true, tematica: 'normal',
  voz: false, vozAuto: false, letraGrande: false, escalaTexto: 1.22, altoContraste: false, menosAnimaciones: false, vibrar: true, botonesGrandes: false,
  modoSencillo: false,
  revisarCada: 3, avisosTussam: 'mias', saldoURL: '', tiemposServidor: false, fondo: '', vehiculosFiesta: false, avisarVersion: true,
};
const settings = { ...DEFAULTS, ...store.get('settings', {}) };
if (!['oscuro', 'claro', 'tema'].includes(settings.mapStyle)) settings.mapStyle = 'oscuro';
const saveSettings = () => store.set('settings', settings);

// [acento, acento suave, texto sobre acento] para tema claro y oscuro
const PALETTES = {
  rojo:    { label: 'Rojo',    light: ['#d41c2b', '#fce6e8', '#ffffff'], dark: ['#ff4f5b', '#3a1a1e', '#ffffff'] },
  azul:    { label: 'Azul',    light: ['#1f4fbf', '#e3eafb', '#ffffff'], dark: ['#7d9fff', '#1f2b4f', '#0b0f1a'] },
  verde:   { label: 'Verde',   light: ['#12805c', '#ddf3ea', '#ffffff'], dark: ['#3fcb97', '#14352a', '#06140f'] },
  morado:  { label: 'Morado',  light: ['#6a3fc4', '#eee7fb', '#ffffff'], dark: ['#b294ff', '#2a2148', '#130b26'] },
  naranja: { label: 'Naranja', light: ['#c75a00', '#fbebdc', '#ffffff'], dark: ['#ff9e4f', '#3a2614', '#1f1000'] },
  grafito: { label: 'Grafito', light: ['#2b3445', '#e6e9ef', '#ffffff'], dark: ['#d0d6e2', '#2a2f3a', '#111318'] },
  rosa:    { label: 'Rosa',    light: ['#c2185b', '#fbe4ee', '#ffffff'], dark: ['#ff79b0', '#3b1a2a', '#2a0716'] },
  turquesa:{ label: 'Turquesa',light: ['#00838f', '#dcf3f5', '#ffffff'], dark: ['#4dd0e1', '#123236', '#002a2f'] },
  // Pasteles (texto oscuro encima para que se lea bien)
  rosaP:   { label: 'Rosa pastel',     pastel: true, light: ['#f2a7c3', '#fdeef4', '#3d0f22'], dark: ['#f5b5cd', '#3a2430', '#2a0b18'] },
  menta:   { label: 'Menta',           pastel: true, light: ['#8fd8bf', '#e6f8f1', '#0d3a2c'], dark: ['#9de3ca', '#1d3a31', '#0b2a20'] },
  lavanda: { label: 'Lavanda',         pastel: true, light: ['#b9a6f0', '#f1edfd', '#24164d'], dark: ['#c6b6f6', '#2c2645', '#1a1036'] },
  celeste: { label: 'Celeste',         pastel: true, light: ['#8cc8f0', '#e8f4fc', '#0c2f48'], dark: ['#9fd3f5', '#1d3242', '#0a2233'] },
  melocoton:{ label: 'Melocotón',      pastel: true, light: ['#f7b98b', '#fef0e5', '#4a2209'], dark: ['#f9c6a0', '#3d2a1d', '#2e1606'] },
  limon:   { label: 'Limón',           pastel: true, light: ['#e8d566', '#fbf7dc', '#3a3200'], dark: ['#efe08a', '#3a3620', '#2a2400'] },
};
/* Colores de fondo (además del blanco y el negro de siempre) */
const FONDOS = {
  crema:   { label: 'Crema',        base: 'light', bg: '#f7f1e6', surface: '#fffaf1', s2: '#efe6d6', line: '#e4d8c3', muted: '#6d6457' },
  niebla:  { label: 'Gris azulado', base: 'light', bg: '#eef1f5', surface: '#fbfcfe', s2: '#e1e6ee', line: '#d5dce6', muted: '#5b6474' },
  salvia:  { label: 'Salvia',       base: 'light', bg: '#edf3ee', surface: '#fafdfb', s2: '#dfeae2', line: '#d0dfd4', muted: '#56665a' },
  rosado:  { label: 'Rosado',       base: 'light', bg: '#f8eef1', surface: '#fffafb', s2: '#f0e1e6', line: '#e8d3da', muted: '#6c5960' },
  noche:   { label: 'Azul noche',   base: 'dark',  bg: '#0d1422', surface: '#162033', s2: '#1f2b42', line: '#2a3853', muted: '#93a0b8' },
  pizarra: { label: 'Pizarra',      base: 'dark',  bg: '#1a1d21', surface: '#24282e', s2: '#2e333a', line: '#3a4048', muted: '#a0a7b1' },
  bosque:  { label: 'Bosque',       base: 'dark',  bg: '#0f1712', surface: '#18241c', s2: '#213027', line: '#2c3e33', muted: '#98ab9e' },
  vino:    { label: 'Vino',         base: 'dark',  bg: '#1a0f13', surface: '#26171d', s2: '#322028', line: '#432b35', muted: '#b79aa6' },
  cafe:    { label: 'Café',         base: 'dark',  bg: '#17120e', surface: '#231b15', s2: '#2e241c', line: '#3d3026', muted: '#b0a091' },
};
// Temáticas: colores de la app y autobús del mapa (dibujos del usuario en /img/buses)
const TEMATICAS = {
  normal:      { nombre: 'Normal', bus: 'normal' },
  navidad:     { nombre: 'Navidad', bus: 'navidad', light: ['#c8102e', '#fbe3e6', '#ffffff'], dark: ['#ff4d5e', '#3d1418', '#ffffff'] },
  semanasanta: { nombre: 'Semana Santa', bus: 'semanasanta', light: ['#5b2a86', '#efe6f7', '#ffffff'], dark: ['#c39be8', '#2a1a3d', '#140a20'] },
  feria:       { nombre: 'Feria de Abril', bus: 'feria', light: ['#0f8a3c', '#dff3e6', '#ffffff'], dark: ['#3ccf76', '#12301e', '#04140a'] },
  halloween:   { nombre: 'Halloween', bus: 'halloween', light: ['#e86a00', '#fdebd9', '#ffffff'], dark: ['#ff8a1f', '#3a220d', '#1a0d00'] },
};
/* Domingo de Resurrección (algoritmo de Meeus/Jones/Butcher) */
function pascua(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, mes - 1, dia);
}
/* Fechas de cada temática para un año (la Feria se calcula: del sábado 13 días después de Pascua al sábado siguiente) */
function fechasTematicas(y) {
  const p = pascua(y), dd = (n) => new Date(p.getFullYear(), p.getMonth(), p.getDate() + n);
  return {
    semanasanta: [dd(-9), dd(0)],
    feria: [dd(13), dd(20)],
    halloween: [new Date(y, 9, 25), new Date(y, 10, 1)],
    navidad: [new Date(y, 11, 1), new Date(y + 1, 0, 6)],
  };
}
function tematicaPorFecha(d = new Date()) {
  const hoy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  for (const y of [d.getFullYear() - 1, d.getFullYear()]) {
    for (const [k, [ini, fin]] of Object.entries(fechasTematicas(y))) if (hoy >= ini && hoy <= fin) return k;
  }
  return 'normal';
}
const tematicaActiva = () => (settings.modoSencillo ? 'normal' : (settings.tematicaAuto ? tematicaPorFecha() : (TEMATICAS[settings.tematica] ? settings.tematica : 'normal')));
/* Festivos de Sevilla (nacionales + Andalucía + Jueves y Viernes Santo). En festivo y domingo
   TUSSAM circula con horario reducido; se avisa en Favoritas. Pueden faltar los 2 locales que
   fija el Ayuntamiento cada año, que cambian. */
const FESTIVOS_FIJOS = ['01-01', '01-06', '02-28', '05-01', '08-15', '10-12', '11-01', '12-06', '12-08', '12-25'];
const claveDia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function festivosDe(y) {
  const s = new Set(FESTIVOS_FIJOS.map((m) => `${y}-${m}`));
  const p = pascua(y), sem = (n) => claveDia(new Date(p.getFullYear(), p.getMonth(), p.getDate() + n));
  s.add(sem(-3)); s.add(sem(-2)); // Jueves y Viernes Santo
  return s;
}
function tipoDia(d = new Date()) {
  if (festivosDe(d.getFullYear()).has(claveDia(d))) return 'festivo';
  const wd = d.getDay();
  return wd === 0 ? 'domingo' : wd === 6 ? 'sabado' : 'laborable';
}
function servicioHoyHTML() {
  const t = tipoDia();
  if (t === 'laborable') return '';
  const txt = t === 'festivo' ? 'Hoy es festivo: TUSSAM circula con horario de domingos y festivos (menos autobuses de lo normal).'
    : t === 'domingo' ? 'Hoy es domingo: horario reducido, pasan menos autobuses.'
      : 'Hoy es sábado: horario de sábado, distinto al de diario.';
  return `<div class="dia-aviso dia-${t}">📅 <span>${txt}</span></div>`;
}
/* Tarjetas con saldo bajo: se enseñan también en Favoritas (debajo de los avisos), no solo como notificación. */
function tarjetasBajasHTML() {
  try {
    if (typeof tarjeta === 'undefined' || !tarjeta.list) return '';
    const bajas = tarjeta.list().filter((c) => c.avisoSaldo?.on && c.ultimo && c.ultimo.saldo != null && c.ultimo.saldo < Number(c.avisoSaldo.importe));
    if (!bajas.length) return '';
    return `<div class="set-group sb-group"><h3>⚠️ Saldo bajo</h3>${bajas.map((c) => {
      const nombre = esc(c.name || `Tarjeta ${tarjeta.fmt(c.num)}`);
      return `<a class="row-flat sb-row" href="#tarjeta"><span class="sb-punto"></span><div style="flex:1;min-width:0"><b>${nombre}</b><p class="help">Le quedan ${fmtEuro(c.ultimo.saldo)} · recárgala pronto</p></div>${ICON.chev}</a>`;
    }).join('')}</div>`;
  } catch { return ''; }
}
/* Tarjetas que caducan pronto (o ya caducadas): se avisan también en Favoritas, como el saldo bajo. */
function tarjetasCaducanHTML() {
  try {
    if (typeof tarjeta === 'undefined' || !tarjeta.list) return '';
    const hoy = Date.now();
    const cad = tarjeta.list().filter((c) => {
      const a = c.avisoCaducidad, u = c.ultimo;
      if (!a?.on || !u?.caducaEl || u.sinCaducidad) return false;
      const dias = Math.max(...((a.dias && a.dias.length) ? a.dias : [15]));
      return u.caducaEl - hoy <= dias * 86400000;
    });
    if (!cad.length) return '';
    return `<div class="set-group sb-group"><h3>⚠️ Caducidad</h3>${cad.map((c) => {
      const nombre = esc(c.name || `Tarjeta ${tarjeta.fmt(c.num)}`);
      const d = Math.ceil((c.ultimo.caducaEl - hoy) / 86400000);
      const txt = d < 0 ? 'Ya caducada · renuévala' : d === 0 ? 'Caduca hoy · renuévala' : `Caduca en ${d} día${d === 1 ? '' : 's'} · renuévala`;
      return `<a class="row-flat sb-row" href="#tarjeta"><span class="sb-punto"></span><div style="flex:1;min-width:0"><b>${nombre}</b><p class="help">${txt}</p></div>${ICON.chev}</a>`;
    }).join('')}</div>`;
  } catch { return ''; }
}
/* Vehículos de fiesta (opcional en Ajustes): cada autobús elige uno al azar, siempre el mismo para ese autobús */
const VEHICULOS_FIESTA = { semanasanta: { n: 8, nombre: 'pasos de Semana Santa', clase: 'veh-paso' }, feria: { n: 8, nombre: 'coches de caballos', clase: 'veh-coche' }, navidad: { n: 11, nombre: 'carrozas', clase: 'veh-carroza' } };
const vehiculoFiesta = () => (settings.vehiculosFiesta ? VEHICULOS_FIESTA[tematicaActiva()] || null : null);
const hashTexto = (t) => { let h = 2166136261; for (const ch of String(t)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const busImg = (clave) => {
  const tem = tematicaActiva();
  const v = vehiculoFiesta();
  if (v) return `/img/fiesta/${tem}-${(clave == null ? 0 : hashTexto(clave) % v.n) + 1}.webp`;
  return `/img/buses/${TEMATICAS[tem].bus}.webp`;
};
// Iconito del autobús bueno (el de la leyenda del mapa), para usar en textos en vez del emoji 🚌
const busIco = () => `<img class="lg-busimg" src="${busImg()}" alt="autobús" style="height:1.05em;vertical-align:-2px">`;
// Colores para personalizar favoritas y tarjetas
const TAGS = ['#e5303c', '#f08c00', '#f2c400', '#2fb36d', '#1fa3c9', '#3d6bff', '#8a5cf6', '#e0479e', '#7a7f8a'];

const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
let resolvedTheme = 'dark';
function applyTheme() {
  resolvedTheme = settings.theme === 'auto' ? (darkMQ.matches ? 'dark' : 'light') : settings.theme;
  const F = FONDOS[settings.fondo];
  if (F) resolvedTheme = F.base;          // un fondo de color fija si es claro u oscuro
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  const props = { '--bg': F?.bg, '--surface': F?.surface, '--surface-2': F?.s2, '--line': F?.line, '--muted': F?.muted, '--top-bg': F && F.base === 'dark' ? F.surface : null };
  for (const [k, v] of Object.entries(props)) { if (v) root.style.setProperty(k, v); else root.style.removeProperty(k); }
  root.dataset.fondo = settings.fondo || '';
  const tem = tematicaActiva();
  root.dataset.tematica = tem;
  const fuente = TEMATICAS[tem][resolvedTheme] ? TEMATICAS[tem] : (PALETTES[settings.color] || PALETTES.rojo);
  const pal = fuente[resolvedTheme];
  root.style.setProperty('--accent', pal[0]);
  root.style.setProperty('--accent-soft', pal[1]);
  root.style.setProperty('--on-accent', pal[2]);
  root.classList.toggle('a-letra', !!settings.letraGrande);
  root.style.setProperty('--escala-texto', settings.escalaTexto || 1.22);
  root.classList.toggle('a-contraste', !!settings.altoContraste);
  root.classList.toggle('a-quieto', !!settings.menosAnimaciones || reduceMQ.matches);
  root.classList.toggle('a-botones', !!settings.botonesGrandes);
  root.classList.toggle('a-sencillo', !!settings.modoSencillo);
  const v = vehiculoFiesta();
  document.querySelectorAll('img.busmk-img').forEach((i) => {
    i.src = busImg(i.dataset.k);
    const mk = i.closest('.busmk');
    if (mk) { mk.classList.remove('veh-paso', 'veh-coche', 'veh-carroza'); if (v) mk.classList.add(v.clase); }
  });
  document.querySelectorAll('img.lg-busimg').forEach((i) => { i.src = busImg(); });
  updateMapStyles();
  fiesta(tem);
}
/* Decoración festiva: unos pocos elementos que caen o flotan (solo CSS, se paran en segundo plano
   y con «Reducir animaciones»). Nada de imágenes externas ni bucles en JavaScript. */
/* Dibujos propios (SVG) para cada fiesta. Escudos e insignias genéricos, no de ninguna hermandad concreta. */
const PIEZAS = {"escudo": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path d=\"M14 5l3 3 3-4 3 4 3-3v4H14z\" fill=\"#e2b74a\"/><path d=\"M8 10h24v11q0 11-12 16Q8 32 8 21z\" fill=\"#6d1a2a\" stroke=\"#e2b74a\" stroke-width=\"2\"/><path d=\"M20 14v18M14 20h12\" stroke=\"#e2b74a\" stroke-width=\"3\" stroke-linecap=\"round\"/><circle cx=\"20\" cy=\"20\" r=\"2\" fill=\"#6d1a2a\" stroke=\"#e2b74a\"/></svg>", "capirote": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path d=\"M20 1 29 25H11z\" fill=\"#4b1f6f\"/><path d=\"M11 25q9 4 18 0l4 14H7z\" fill=\"#4b1f6f\"/><path d=\"M11 25q9 4 18 0\" fill=\"none\" stroke=\"#3a1557\" stroke-width=\"1\"/><ellipse cx=\"17\" cy=\"19\" rx=\"1.5\" ry=\"1\" fill=\"#120818\"/><ellipse cx=\"23\" cy=\"19\" rx=\"1.5\" ry=\"1\" fill=\"#120818\"/><circle cx=\"20\" cy=\"32\" r=\"2.6\" fill=\"#e2b74a\"/><path d=\"M7 39h26\" stroke=\"#f4efe1\" stroke-width=\"1.5\"/></svg>", "cirial": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path d=\"M19.2 14h1.6v25h-1.6z\" fill=\"#c99a2e\"/><circle cx=\"20\" cy=\"22\" r=\"1.6\" fill=\"#e2b74a\"/><circle cx=\"20\" cy=\"30\" r=\"1.6\" fill=\"#e2b74a\"/><path d=\"M13 13h14l-3 4h-8z\" fill=\"#e2b74a\"/><path d=\"M15 11h10v2H15z\" fill=\"#c99a2e\"/><path d=\"M18 5h4v6h-4z\" fill=\"#f6f1e2\"/><path d=\"M20 .5q3 2.6 0 4.5-3-1.9 0-4.5z\" fill=\"#ffb02e\"/></svg>", "candelabro": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path d=\"M20 38V14M20 31 8 19M20 31l12-12M20 25l-7-10M20 25l7-10\" stroke=\"#e2b74a\" stroke-width=\"1.8\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M15 38h10\" stroke=\"#c99a2e\" stroke-width=\"3\"/><rect x=\"18.8\" y=\"8\" width=\"2.4\" height=\"6\" fill=\"#f6f1e2\"/><path d=\"M20 4.5q2 1.8 0 3.3-2-1.5 0-3.3z\" fill=\"#ffb02e\"/><rect x=\"6.8\" y=\"13\" width=\"2.4\" height=\"6\" fill=\"#f6f1e2\"/><path d=\"M8 9.5q2 1.8 0 3.3-2-1.5 0-3.3z\" fill=\"#ffb02e\"/><rect x=\"30.8\" y=\"13\" width=\"2.4\" height=\"6\" fill=\"#f6f1e2\"/><path d=\"M32 9.5q2 1.8 0 3.3-2-1.5 0-3.3z\" fill=\"#ffb02e\"/><rect x=\"11.8\" y=\"9\" width=\"2.4\" height=\"6\" fill=\"#f6f1e2\"/><path d=\"M13 5.5q2 1.8 0 3.3-2-1.5 0-3.3z\" fill=\"#ffb02e\"/><rect x=\"25.8\" y=\"9\" width=\"2.4\" height=\"6\" fill=\"#f6f1e2\"/><path d=\"M27 5.5q2 1.8 0 3.3-2-1.5 0-3.3z\" fill=\"#ffb02e\"/></svg>", "incensario": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path d=\"M20 1v8M13 2l4 10M27 2l-4 10\" stroke=\"#c99a2e\" stroke-width=\"1.1\"/><circle cx=\"20\" cy=\"2\" r=\"1.6\" fill=\"#e2b74a\"/><path d=\"M12 14q8-6 16 0z\" fill=\"#e2b74a\"/><path d=\"M11 15h18q0 11-9 13-9-2-9-13z\" fill=\"#d9a93a\"/><path d=\"M14 18h12M15 22h10\" stroke=\"#a87b1e\" stroke-width=\"1\"/><path d=\"M17 28h6v3h-6zM13 33h14v2H13z\" fill=\"#c99a2e\"/><path d=\"M31 10q4-3 1-7M34 13q4-4 1-9\" stroke=\"#d8d2c4\" stroke-width=\"1.3\" fill=\"none\" opacity=\".8\"/></svg>", "naveta": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path d=\"M4 18q16 13 32 0-16 4-32 0z\" fill=\"#e2b74a\"/><path d=\"M6 18q14 3 28 0\" stroke=\"#a87b1e\" fill=\"none\"/><path d=\"M8 15q12-5 24 0\" fill=\"#d9a93a\"/><circle cx=\"20\" cy=\"12\" r=\"1.8\" fill=\"#e2b74a\"/><path d=\"M18 26h4l2 7h-8z\" fill=\"#c99a2e\"/><path d=\"M13 34h14\" stroke=\"#c99a2e\" stroke-width=\"2.5\"/></svg>", "regalo": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><rect x=\"7\" y=\"17\" width=\"26\" height=\"20\" rx=\"2\" fill=\"#d42a3c\"/><rect x=\"5\" y=\"12\" width=\"30\" height=\"7\" rx=\"2\" fill=\"#ef4655\"/><rect x=\"18\" y=\"12\" width=\"4\" height=\"25\" fill=\"#f5c518\"/><path d=\"M20 12C14 3 7 9 20 12 33 9 26 3 20 12z\" fill=\"none\" stroke=\"#f5c518\" stroke-width=\"2.4\"/></svg>", "arbol": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path d=\"M20 4l9 12h-4l8 10h-6l8 9H5l8-9H7l8-10h-4z\" fill=\"#1d7a3a\"/><rect x=\"17\" y=\"35\" width=\"6\" height=\"4\" fill=\"#7a4a1f\"/><circle cx=\"15\" cy=\"22\" r=\"1.8\" fill=\"#ff3b3b\"/><circle cx=\"25\" cy=\"29\" r=\"1.8\" fill=\"#ffd23b\"/><circle cx=\"23\" cy=\"17\" r=\"1.6\" fill=\"#3bb8ff\"/><circle cx=\"13\" cy=\"31\" r=\"1.6\" fill=\"#ffd23b\"/><path d=\"M20 0l1.4 2.9 3.2.4-2.3 2.2.6 3.1L20 7l-2.9 1.6.6-3.1-2.3-2.2 3.2-.4z\" fill=\"#f5c518\"/></svg>", "estrella": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path d=\"M20 3l4.7 10.2 11.1 1.2-8.3 7.5 2.4 11L20 27.3 10.1 33l2.4-11-8.3-7.5 11.1-1.2z\" fill=\"#f5c518\"/></svg>", "copo": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><g stroke=\"#fff\" stroke-width=\"2.2\" stroke-linecap=\"round\" fill=\"none\"><path d=\"M20 3v34M5.3 11.5l29.4 17M5.3 28.5l29.4-17\"/><path d=\"M15 6l5 4 5-4M15 34l5-4 5 4M5 17l6 1-1-6M35 23l-6-1 1 6M5 23l6-1-1 6M35 17l-6 1 1-6\"/></g></svg>", "abanico": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path d=\"M20 34 3 17a24 24 0 0 1 34 0z\" fill=\"#e5303c\"/><g stroke=\"#9c1420\" stroke-width=\".8\"><path d=\"M20 34 32.0 21.9\"/><path d=\"M20 34 29.4 19.8\"/><path d=\"M20 34 26.4 18.3\"/><path d=\"M20 34 23.3 17.3\"/><path d=\"M20 34 19.9 17.0\"/><path d=\"M20 34 16.6 17.3\"/><path d=\"M20 34 13.5 18.3\"/><path d=\"M20 34 10.5 19.9\"/><path d=\"M20 34 8.0 22.0\"/></g><g fill=\"#fff\"><circle cx=\"10\" cy=\"19\" r=\"1.6\"/><circle cx=\"16\" cy=\"14\" r=\"1.6\"/><circle cx=\"24\" cy=\"14\" r=\"1.6\"/><circle cx=\"30\" cy=\"19\" r=\"1.6\"/><circle cx=\"13\" cy=\"24\" r=\"1.6\"/><circle cx=\"20\" cy=\"19\" r=\"1.6\"/><circle cx=\"27\" cy=\"24\" r=\"1.6\"/></g><path d=\"M3 17a24 24 0 0 1 34 0\" fill=\"none\" stroke=\"#f7f3e8\" stroke-width=\"1.5\"/><rect x=\"18\" y=\"33\" width=\"4\" height=\"6\" rx=\"1\" fill=\"#6b3b1f\"/></svg>", "sombrero": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><ellipse cx=\"20\" cy=\"28\" rx=\"18\" ry=\"5\" fill=\"#1d1d1d\"/><path d=\"M11 27V16q0-4 9-4t9 4v11z\" fill=\"#262626\"/><rect x=\"11\" y=\"22\" width=\"18\" height=\"3\" fill=\"#7a1f2b\"/><ellipse cx=\"20\" cy=\"16\" rx=\"9\" ry=\"2.4\" fill=\"#333\"/></svg>", "castanuelas": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path d=\"M14 8q8 0 8 12t-8 12q-8 0-8-12t8-12z\" fill=\"#8a4a1f\"/><path d=\"M26 10q8 0 8 12t-8 12q-6 0-7.5-6\" fill=\"#a85d28\"/><path d=\"M14 8q2-5 6-4 4-1 6 6\" stroke=\"#e5303c\" stroke-width=\"2\" fill=\"none\"/><circle cx=\"14\" cy=\"20\" r=\"2\" fill=\"#5e2f12\"/></svg>", "farolillo": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path d=\"M20 0v5\" stroke=\"#5b4a2a\"/><rect x=\"15\" y=\"5\" width=\"10\" height=\"3\" rx=\"1\" fill=\"#2b2b2b\"/><ellipse cx=\"20\" cy=\"21\" rx=\"13\" ry=\"13\" fill=\"#0f8a3c\"/><path d=\"M20 8q-12 13 0 26M20 8q12 13 0 26M20 8q-6 13 0 26M20 8q6 13 0 26\" stroke=\"#0a6129\" fill=\"none\" stroke-width=\".9\"/><g fill=\"#fff\"><circle cx=\"13\" cy=\"17\" r=\"1.6\"/><circle cx=\"20\" cy=\"14\" r=\"1.6\"/><circle cx=\"27\" cy=\"17\" r=\"1.6\"/><circle cx=\"16\" cy=\"25\" r=\"1.6\"/><circle cx=\"24\" cy=\"25\" r=\"1.6\"/></g><rect x=\"16\" y=\"33\" width=\"8\" height=\"3\" rx=\"1\" fill=\"#2b2b2b\"/></svg>", "murcielago": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path d=\"M20 17c-3-4-5-4-6-2-2-4-7-5-12-2 4 1 5 4 5 7 2-2 5-2 6 1 2-2 4-1 7 2 3-3 5-4 7-2 1-3 4-3 6-1 0-3 1-6 5-7-5-3-10-2-12 2-1-2-3-2-6 2z\" fill=\"#1b0d24\"/><path d=\"M17 13l1 3M23 13l-1 3\" stroke=\"#1b0d24\" stroke-width=\"2\"/><circle cx=\"18.6\" cy=\"17\" r=\".9\" fill=\"#ffb02e\"/><circle cx=\"21.4\" cy=\"17\" r=\".9\" fill=\"#ffb02e\"/></svg>", "calabaza": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><ellipse cx=\"20\" cy=\"24\" rx=\"16\" ry=\"12\" fill=\"#ff8a1f\"/><path d=\"M20 12q-9 12 0 24M20 12q9 12 0 24M20 12q-15 12 0 24M20 12q15 12 0 24\" stroke=\"#d9650a\" fill=\"none\" stroke-width=\"1.2\"/><path d=\"M19 13q0-6 4-9\" stroke=\"#3c7a2a\" stroke-width=\"3\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M11 20l5 3-5 2zM29 20l-5 3 5 2z\" fill=\"#3a1500\"/><path d=\"M11 28q9 7 18 0l-3 1-2-2-2 2-2-2-2 2-2-2-2 2z\" fill=\"#3a1500\"/></svg>", "fantasma": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path d=\"M8 37V18Q8 5 20 5t12 13v19l-4-3-4 3-4-3-4 3-4-3z\" fill=\"#f4f1ff\"/><ellipse cx=\"16\" cy=\"18\" rx=\"2\" ry=\"3\" fill=\"#222\"/><ellipse cx=\"24\" cy=\"18\" rx=\"2\" ry=\"3\" fill=\"#222\"/><ellipse cx=\"20\" cy=\"26\" rx=\"2.4\" ry=\"2\" fill=\"#222\"/></svg>", "arana": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path d=\"M20 0v14\" stroke=\"#ddd\" stroke-width=\".7\"/><g stroke=\"#111\" stroke-width=\"1.4\" fill=\"none\"><path d=\"M17 18l-7-4-3 5M17 21l-9 0-2 5M17 23l-7 4-1 6M23 18l7-4 3 5M23 21l9 0 2 5M23 23l7 4 1 6\"/></g><ellipse cx=\"20\" cy=\"21\" rx=\"5\" ry=\"6\" fill=\"#111\"/><circle cx=\"20\" cy=\"15\" r=\"3\" fill=\"#111\"/><circle cx=\"19\" cy=\"14.5\" r=\".7\" fill=\"#ff3b3b\"/><circle cx=\"21\" cy=\"14.5\" r=\".7\" fill=\"#ff3b3b\"/></svg>"};
const FIESTA = {
  navidad: { cosas: ['copo', 'regalo', 'copo', 'arbol', 'estrella', 'copo'], modo: 'caer', giro: 360, saludo: '🎄 ¡Feliz Navidad!', sub: 'BusSev se viste de fiesta hasta Reyes.' },
  semanasanta: { cosas: ['escudo1', 'escudo2', 'escudo3', 'escudo4', 'escudo5'], img: 'escudos', modo: 'caer', giro: 20, saludo: '✝️ Semana Santa en Sevilla', sub: 'Muchas líneas cambian de recorrido: mira los avisos de TUSSAM.' },
  feria: { cosas: ['💃', 'abanico', 'sombrero', '💃', 'castanuelas', 'farolillo'], modo: 'mecer', giro: 30, saludo: '💃 ¡Feliz Feria de Abril!', sub: 'Las lanzaderas al Real salen en los avisos de TUSSAM.' },
  halloween: { cosas: ['murcielago', 'calabaza', 'fantasma', 'murcielago', 'arana', 'calabaza'], modo: 'volar', giro: 20, saludo: '🎃 ¡Feliz Halloween!', sub: 'Cuidado con los murciélagos de la parada…' },
};
function fiesta(tem) {
  let capa = document.getElementById('fiesta');
  const f = FIESTA[tem];
  const quieto = settings.menosAnimaciones || reduceMQ.matches;
  if (!f || quieto) { capa?.remove(); return; }
  if (capa?.dataset.t === tem) return;
  capa?.remove();
  capa = document.createElement('div');
  capa.id = 'fiesta'; capa.className = `fiesta f-${f.modo}`; capa.dataset.t = tem; capa.setAttribute('aria-hidden', 'true');
  const n = 11;
  let h = '';
  for (let i = 0; i < n; i++) {
    const c = f.cosas[i % f.cosas.length];
    const x = Math.round((i + Math.random() * 0.8) * (100 / n));
    const dur = (11 + Math.random() * 9).toFixed(1), del = (-Math.random() * 20).toFixed(1), tam = Math.round(22 + Math.random() * 16);
    const dx = Math.round(Math.random() * 80 - 40), r = Math.round((Math.random() * 2 - 1) * f.giro);
    const dentro = f.img ? `<img class="fiesta-img" src="/img/${f.img}/${c}.webp" alt="" loading="lazy">` : (PIEZAS[c] || c);
    h += `<span style="left:${x}%;font-size:${Math.round(tam * 0.8)}px;width:${tam}px;height:${tam}px;animation-duration:${dur}s;animation-delay:${del}s;--dx:${dx}px;--r:${r}deg">${dentro}</span>`;
  }
  capa.innerHTML = h;
  // Detrás del contenido: se ve en los huecos, no tapa los textos
  (document.querySelector('main') || document.body).prepend(capa);
}
function saludoFiestaHTML() {
  const tem = tematicaActiva();
  const f = FIESTA[tem];
  if (!f) return '';
  const especial = tem === 'feria' || tem === 'semanasanta';
  return `<div class="saludo-fiesta"><b>${f.saludo}</b><span>${f.sub}</span>${especial ? `<a class="sf-btn" href="#avisos">${busIco()} Ver servicios especiales de ${tem === 'feria' ? 'Feria' : 'Semana Santa'}</a>` : ''}</div>`;
}
darkMQ.addEventListener?.('change', () => { if (settings.theme === 'auto') applyTheme(); });
const animMs = (ms) => (settings.menosAnimaciones || reduceMQ.matches ? 0 : ms);
const vibrar = (ms) => { if (settings.vibrar) navigator.vibrate?.(ms); };
/* Cambia el contenido solo si ha cambiado (evita parpadeos y trabajo de más) */
function setHTML(el, html) { if (el && el.__h !== html) { el.innerHTML = html; el.__h = html; } }

const REFRESH_LINE_MIN = 30_000;
const SEVILLA = [37.3891, -5.9845];

/* ================================================================== */
/* Utilidades                                                          */
/* ================================================================== */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const safeColor = (c, d = '#d41c2b') => (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(c || '')) ? c : d);
function fmtDist(m) {
  if (m == null || Number.isNaN(m)) return '';
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}
const fmtClock = (d = new Date()) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtEuro = (n) => `${n.toFixed(2).replace('.', ',')} €`;
function textOn(hex) {
  const h = safeColor(hex, '#000000').replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111111' : '#ffffff';
}
function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
const isNative = () => !!window.Capacitor?.isNativePlatform?.();
function openWeb(url) {
  // Por seguridad solo se abren páginas web cifradas (https): nunca otro tipo de enlace, venga de donde venga.
  try { if (new URL(String(url)).protocol !== 'https:') return; } catch { return; }
  // Dentro de la app (pestaña del navegador encima de BusSev); si no se puede, en el navegador.
  if (window.Capacitor?.isPluginAvailable?.('Browser')) {
    window.Capacitor.nativePromise('Browser', 'open', { url, toolbarColor: '#1c1d21' }).catch(() => { location.href = url; });
  } else location.href = url;
}

/* Descargar la actualización: abre GitHub y, al volver a la app (tras bajar/instalar el APK),
   cierra esa pestaña del navegador para que no se quede abierta y vuelva a descargar al reabrirla. */
function descargarApp(url) {
  openWeb(url);
  const onVis = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onVis);
    setTimeout(() => { try { window.Capacitor?.nativePromise?.('Browser', 'close', {}); } catch { /* */ } }, 300);
  };
  document.addEventListener('visibilitychange', onVis);
}

const ICON = {
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  arriba: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  abajo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mas: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="19" r="2.2"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/></svg>',
  bus: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 11h16M8 21v-3M16 21v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="14.5" r="1.1" fill="currentColor"/><circle cx="16" cy="14.5" r="1.1" fill="currentColor"/></svg>',
  off: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M3 3l18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/></svg>',
  nfc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 7.5a6.5 6.5 0 0 1 0 9M9.8 5a10 10 0 0 1 0 14M13 2.8a13 13 0 0 1 0 18.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="15.5" y="6" width="6" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  route: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 6H15a3.5 3.5 0 0 1 0 7H9a3.5 3.5 0 0 0 0 7h6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  silla: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4" r="2" fill="currentColor"/><path d="M10 6.5v4.5h4.5l2.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.8 15.5A5 5 0 1 1 9 11.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

/* ================================================================== */
/* Datos                                                               */
/* ================================================================== */
class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function api(path, { timeout, prioridad, maxEdad } = {}) {
  // Las consultas de tiempos esperan su turno en la fila (ver backend.js): el límite es más largo
  timeout ??= /\/tiempos$/.test(path) ? 50000 : 12000;
  let t;
  try {
    return await Promise.race([
      window.BusSevBackend.get(path, { prioridad, maxEdad }),
      new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'AbortError' })), timeout + 3000); }),
    ]);
  } catch (e) {
    if (e.status === 429) throw new ApiError('TUSSAM va saturado ahora mismo. BusSev lo vuelve a intentar solo en unos segundos.', 429);
    if (e.status === 404) throw new ApiError('No se ha encontrado.', 404);
    if (e.status === 408) throw new ApiError('Hay muchas consultas en cola. Se actualizará en un momento.', 408);
    if (e.status === 499) throw new ApiError('Cancelado', 499);
    if (e.name === 'AbortError') throw new ApiError('La conexión está tardando demasiado. Comprueba tu cobertura.');
    throw new ApiError('No hay conexión con TUSSAM. Comprueba tu conexión a internet.');
  } finally { clearTimeout(t); }
}
const cache = { paradasP: null, paradaByCode: new Map(), lineasP: null, lineaByNum: new Map(), rutas: new Map(), shapes: new Map() };
function getParadas() {
  cache.paradasP ??= api('/paradas').then((list) => { for (const p of list) cache.paradaByCode.set(p.codigo, p); return list; })
    .catch((e) => { cache.paradasP = null; throw e; });
  return cache.paradasP;
}
function getLineas() {
  cache.lineasP ??= api('/lineas').then((list) => { for (const l of list) cache.lineaByNum.set(l.numero, l); return list; })
    .catch((e) => { cache.lineasP = null; throw e; });
  return cache.lineasP;
}
function lineaFor(label) {
  const s = String(label ?? '');
  return cache.lineaByNum.get(s) || cache.lineaByNum.get(s.padStart(2, '0')) || cache.lineaByNum.get(s.replace(/^0+(?=\w)/, '')) || null;
}
/* #52 Widget de inicio: la app guarda en el widget nativo las credenciales de TUSSAM y las
   paradas favoritas (con su nombre), para que pueda consultar y para elegir parada al añadirlo. */
function actualizarWidget() {
  try {
    if (!window.Capacitor?.isPluginAvailable?.('BusSevWidget')) return;
    const creds = window.BUSSEV_TUSSAM || {};
    const favoritas = (favs.list() || []).map((f) => ({
      codigo: String(f.codigo),
      nombre: f.alias || cache.paradaByCode.get(String(f.codigo))?.nombre || ('Parada ' + f.codigo),
      lineas: Array.isArray(f.lineas) ? f.lineas.map(String) : [],
    }));
    window.Capacitor.nativePromise('BusSevWidget', 'setConfig', {
      clientId: creds.clientId || '', clientSecret: creds.clientSecret || '',
      user: creds.user || '', pass: creds.pass || '', favoritas,
    }).catch(() => { /* */ });
  } catch { /* */ }
}
function getRuta(numero) {
  if (!cache.rutas.has(numero)) {
    cache.rutas.set(numero, api(`/lineas/${encodeURIComponent(numero)}/paradas`).then((stops) => {
      const by = {};
      for (const p of stops) (by[p.sentido] ??= []).push(p);
      for (const k of Object.keys(by)) by[k].sort((a, b) => a.orden - b.orden);
      return by;
    }).catch((e) => { cache.rutas.delete(numero); throw e; }));
  }
  return cache.rutas.get(numero);
}
getParadas().catch(() => null);
getLineas().catch(() => null);

/* Recorrido por calles (si está calculado) o en recta entre paradas. */
function getShape(numero, sentido, stops) {
  const key = `${numero}|${sentido}`;
  if (cache.shapes.has(key)) return cache.shapes.get(key);
  let pts, idx;
  const r = window.BUSSEV_RECORRIDOS?.[key];
  const tieneTrazado = r && Array.isArray(r.d) && r.d.length >= 4;
  if (tieneTrazado) {
    // Siempre se usa la geometría real por calle si existe.
    pts = []; let la = 0, lo = 0;
    for (let i = 0; i + 1 < r.d.length; i += 2) { la += r.d[i]; lo += r.d[i + 1]; pts.push([la / 1e5, lo / 1e5]); }
    if (Array.isArray(r.s) && r.s.length === stops.length) {
      idx = r.s;   // las paradas cuadran con las guardadas: se usan tal cual
    } else {
      // El nº de paradas en vivo no coincide con el guardado: se recoloca cada parada sobre el trazado real
      // (antes, al no coincidir, se tiraba el trazado y se dibujaban líneas rectas).
      idx = []; let desde = 0;
      for (const p of stops) {
        let best = desde, bd = Infinity;
        for (let j = desde; j < pts.length; j++) { const dd = haversine([p.latitud, p.longitud], pts[j]); if (dd < bd) { bd = dd; best = j; } }
        idx.push(best); desde = best;
      }
    }
  } else {
    pts = stops.map((p) => [p.latitud, p.longitud]);
    idx = stops.map((_, i) => i);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const shape = { pts, idx, cum, porCalle: tieneTrazado };
  cache.shapes.set(key, shape);
  return shape;
}

/* ================================================================== */
/* Favoritas (con nombre, color y líneas a mostrar)                    */
/* ================================================================== */
const favs = {
  list() { return store.get('favs', []); },
  get(c) { return this.list().find((f) => f.codigo === c) || null; },
  has(c) { return !!this.get(c); },
  add(p) { const l = this.list(); if (!l.some((f) => f.codigo === p.codigo)) l.push({ codigo: p.codigo, nombre: p.nombre }); store.set('favs', l); },
  remove(c) { store.set('favs', this.list().filter((f) => f.codigo !== c)); },
  update(c, patch) { store.set('favs', this.list().map((f) => (f.codigo === c ? { ...f, ...patch } : f))); },
  move(c, d) {
    const l = this.list(); const i = l.findIndex((f) => f.codigo === c); const j = i + d;
    if (i < 0 || j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]]; store.set('favs', l);
  },
};
function filtrarLineas(tiempos, fav) {
  if (!fav?.lineas?.length) return tiempos;
  const set = new Set(fav.lineas.map((n) => lineaFor(n)?.numero || n));
  return (tiempos || []).filter((t) => set.has(lineaFor(t.linea)?.numero || t.linea));
}

/* ================================================================== */
/* Piezas de interfaz                                                  */
/* ================================================================== */
/* ---------- Actualizaciones de la app (las publica GitHub en «Releases») ---------- */
const actualizaciones = {
  version: () => window.BUSSEV_VERSION || { build: 0, fecha: '', repo: '' },
  paginaVersiones() { const r = this.version().repo; return r ? `https://github.com/${r}/releases/latest` : ''; },
  /* Solo se abren enlaces de GitHub (por seguridad) */
  enlaceSeguro(u) { try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)github\.com$|(^|\.)githubusercontent\.com$/.test(x.hostname) ? x.href : ''; } catch { return ''; } },
  /* «v1.1.2» → [1,1,2] */
  partes(t) { const m = String(t || '').match(/(\d+)\.(\d+)\.(\d+)/); return m ? m.slice(1).map(Number) : null; },
  comparar(a, b) { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; },
  nombre() { const v = this.version(); return v.version ? `v${v.version}` : 'de prueba'; },
  async buscar() {
    const v = this.version();
    if (!/^[\w.-]+\/[\w.-]+$/.test(v.repo || '')) return { estado: 'sin-repo' };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(`https://api.github.com/repos/${v.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, signal: ctrl.signal, credentials: 'omit' });
      if ([401, 403, 404].includes(r.status)) return { estado: 'privado' };   // repositorio privado: GitHub no deja mirarlo sin entrar
      if (!r.ok) throw new Error(`GitHub ha respondido con un error (${r.status}).`);
      const j = await r.json();
      const tag = String(j.tag_name || '');
      // Cada versión publicada lleva escondido su número de compilación: así se sabe si es más nueva
      // aunque tenga el mismo nombre (p. ej. la v1.1.2 recompilada con los horarios nuevos).
      const buildRemota = Number(String(j.body || '').match(/bussev-build:(\d+)/)?.[1]) || 0;
      const pr = this.partes(tag), pm = this.partes(v.version);
      let hay;
      if (buildRemota && v.build) hay = buildRemota > v.build;
      else if (pr && pm) hay = this.comparar(pr, pm) > 0;
      else hay = (Number(tag.replace(/\D/g, '')) || 0) > (v.build || 0);
      const mismoNombre = pr && pm && this.comparar(pr, pm) === 0;
      const apk = (j.assets || []).find((a) => /\.apk$/i.test(a.name || ''))?.browser_download_url;
      const url = this.enlaceSeguro(apk || j.html_url || '') || this.paginaVersiones();
      store.set('ultimaRevisionVersion', Date.now());
      return { estado: hay ? 'nueva' : 'al-dia', nueva: pr ? `v${pr.join('.')}` : tag, mismoNombre, clave: `${tag}#${buildRemota}`, url, fecha: j.published_at || '' };
    } finally { clearTimeout(t); }
  },
  /* Al abrir la app y cada vez que vuelves a ella: si hay versión nueva, te avisa.
     - Se consulta a GitHub como mucho cada 15 minutos, y solo cuenta si ha contestado (sin conexión, se
       reintenta la próxima vez). Buscar a mano en Ajustes ya no retrasa este aviso.
     - Si dices «Ahora no», te lo recuerda pasado medio día; si sale otra compilación más nueva, avisa enseguida. */
  async revisarSola() {
    if (!settings.avisarVersion || !this.version().build || this.mirando) return;
    if (document.querySelector('.modal-bg')) return;   // hay otra ventana abierta: no se pisa
    if (Date.now() - store.get('ultimaRevisionAuto', 0) < 15 * 60_000) return;
    this.mirando = true;
    let r = null;
    try { r = await this.buscar(); } catch { /* sin conexión: se reintenta al volver a la app */ } finally { this.mirando = false; }
    if (!r || !['nueva', 'al-dia'].includes(r.estado)) return;
    store.set('ultimaRevisionAuto', Date.now());
    const av = store.get('versionAvisada', null);
    const previa = av && typeof av === 'object' ? av : { clave: String(av || ''), t: 0 };
    if (r.estado === 'nueva' && !(previa.clave === r.clave && Date.now() - previa.t < 12 * 3600_000) && !document.querySelector('.modal-bg')) {
      store.set('versionAvisada', { clave: r.clave, t: Date.now() });
      // Pop-up de versión nueva (se puede desactivar aquí mismo o en Ajustes → «Avisarme si hay una versión nueva»)
      openModal(`<h2>✨ Hay una versión nueva</h2>
        <p class="help">${r.mismoNombre ? 'Hay una actualización de BusSev disponible.' : `BusSev ${esc(r.nueva)} ya está disponible.`} Se instala encima de la que tienes, sin perder tus favoritas ni tus tarjetas.</p>
        <div class="actions"><button class="btn ghost" type="button" id="upd-no">Ahora no</button>${r.url ? '<button class="btn" type="button" id="upd-ok">Descargar</button>' : '<a class="btn" href="#ajustes" id="upd-aj">Ver en Ajustes</a>'}</div>
        <button class="link-btn" type="button" id="upd-never" style="margin:6px auto 0;display:block">No volver a avisarme de versiones</button>`, (m, close) => {
        $('#upd-no', m).onclick = close;
        $('#upd-ok', m)?.addEventListener('click', () => { openWeb(r.url); close(); });
        $('#upd-aj', m)?.addEventListener('click', close);
        $('#upd-never', m).onclick = () => { settings.avisarVersion = false; saveSettings(); close(); toast('No te avisaré de versiones. Puedes reactivarlo en Ajustes.'); };
      });
    }
  },
};
setTimeout(() => actualizaciones.revisarSola(), 4000);
// Android suele dejar la app abierta en segundo plano: se mira también al volver a ella, no solo al arrancarla
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => actualizaciones.revisarSola(), 1500); });

/* Animación de carga: un autobús (o el vehículo de la fiesta) que avanza por una carretera */
function cargandoHTML(texto = 'Cargando…', sub = '') {
  return `<div class="cargando" role="status" aria-live="polite"><div class="cg-pista"><span class="cg-raya"></span><img class="cg-bus" src="${busImg()}" alt=""></div><p>${esc(texto)}</p>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
}
const cargandoMini = () => '<span class="cg-mini" aria-hidden="true"></span>';
/* «3» → «03» (solo números de una cifra); el resto igual: «34», «A6», «C1» */
function etiquetaLinea(n) { const v = String(n).replace(/^0+(?=\d)/, ''); return /^\d$/.test(v) ? '0' + v : v; }
/* Orden: primero las numéricas por número (03, 06, 34), luego las demás (A6, C1, EA…) */
function ordenLineas(a, b) {
  const x = String(a).replace(/^0+(?=\d)/, ''), y = String(b).replace(/^0+(?=\d)/, '');
  const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
  if (nx && ny) return Number(x) - Number(y);
  if (nx !== ny) return nx ? -1 : 1;
  return x.localeCompare(y, 'es', { numeric: true });
}
function badge(label, color, { sm = false, href = null } = {}) {
  const c = safeColor(color || lineaFor(label)?.color, '#555555');
  const tag = href ? 'a' : 'span';
  return `<${tag} class="badge${sm ? ' sm' : ''}" ${href ? `href="${esc(href)}"` : ''} style="background:${c};color:${textOn(c)}" aria-label="Línea ${esc(label)}">${esc(label)}</${tag}>`;
}
function groupArrivals(tiempos) {
  const g = new Map();
  for (const t of tiempos || []) {
    const k = `${t.linea}|${t.destino}`;
    if (!g.has(k)) g.set(k, { linea: t.linea, color: t.color, destino: t.destino, sentido: t.sentido, buses: [] });
    g.get(k).buses.push(t);
  }
  const out = [...g.values()];
  for (const x of out) x.buses.sort((a, b) => a.tiempo_minutos - b.tiempo_minutos);
  return out.sort((a, b) => a.buses[0].tiempo_minutos - b.buses[0].tiempo_minutos);
}
const minutesHTML = (m) => (m <= 0 ? '<span class="t-now">Llegando</span>' : `<span class="t-main">${m}<small>min</small></span>`);
function boardHTML(tiempos, status, { limit = 99, filtrado = false, codigo = null } = {}) {
  const groups = groupArrivals(tiempos);
  if (!groups.length) {
    const msg = status && status !== 'ok'
      ? 'TUSSAM no está dando tiempos para esta parada ahora mismo. Vuelve a intentarlo en un momento.'
      : filtrado ? 'Ahora mismo no viene ninguna de las líneas que elegiste para esta parada.' : 'No hay autobuses previstos ahora mismo en esta parada.';
    return `<div class="board-empty">${msg}</div>`;
  }
  const rows = groups.slice(0, limit).map((g) => {
    const first = g.buses[0];
    const next = g.buses[1];
    // #8 Si el bus está pegado a la parada (p. ej. 10 m) pero TUSSAM da varios minutos, suele estar
    //    parado en cabecera; no mostramos la distancia para que no parezca un error ("a 10 m · 6 min").
    const distIncoherente = first.distancia_metros != null && first.distancia_metros < 50 && first.tiempo_minutos >= 3;
    const sub = (!first.distancia_metros || distIncoherente) ? '' : `a ${fmtDist(first.distancia_metros)}`;
    const label = `Línea ${g.linea} hacia ${g.destino}: ${first.tiempo_minutos <= 0 ? 'llegando' : first.tiempo_minutos + ' minutos'}${next ? `, el siguiente en ${next.tiempo_minutos} minutos` : ''}`;
    const av = codigo ? ` data-av="${esc(JSON.stringify([codigo, g.linea, g.destino, first.tiempo_minutos, safeColor(g.color, '#555555')]))}" role="button" tabindex="0"` : '';
    const bell = codigo && window.avisos?.find?.(codigo, g.linea, g.destino) ? '<span class="bell" title="Aviso activo">🔔</span>' : '';
    return `<li class="arr${codigo ? ' tappable' : ''}" aria-label="${esc(label)}${codigo ? '. Toca para crear un aviso de llegada' : ''}"${av}>
      ${badge(g.linea, g.color)}
      <div class="arr-dest"><b>${esc(g.destino || 'Sin destino')}</b>${sub ? `<span>${sub}</span>` : ''}</div>
      <div class="arr-times" aria-hidden="true">${bell}${minutesHTML(first.tiempo_minutos)}${next ? `<span class="t-next">${next.tiempo_minutos}′</span>` : ''}</div>
    </li>`;
  }).join('');
  const more = groups.length > limit ? `<div class="board-empty">y ${groups.length - limit} más…</div>` : '';
  return `<ul class="board">${rows}</ul>${more}`;
}
function freshnessPill(d) {
  if (d?.stale) {
    const when = d.cached_at ? new Date(d.cached_at) : null;
    const ok = when && !Number.isNaN(+when);
    const hoy = ok && when.toDateString() === new Date().toDateString();
    const hora = ok ? when.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
    const cuando = ok ? (hoy ? 'de las ' + hora : 'del ' + when.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ', ' + hora) : '';
    const prefijo = navigator.onLine === false ? 'Sin conexión' : 'Últimos datos';
    return `<span class="pill stale">${prefijo}${cuando ? ' · ' + cuando : ''}</span>`;
  }
  return '<span class="pill live">En directo</span>';
}
function stopCardHTML(p, { tiempos, status, distancia, limit = 4, fav = null }) {
  const sub = [distancia != null ? `a ${fmtDist(distancia)}` : '', p.direccion_completa || p.calle || ''].filter(Boolean).join(' · ');
  const color = fav?.color ? safeColor(fav.color) : null;
  const filtered = fav?.lineas?.length ? filtrarLineas(tiempos, fav) : tiempos;
  return `<article class="card${fav ? ' fav' : ''}" ${color ? `style="--fc:${color}"` : ''}>
    <a class="card-head" href="#parada-${esc(p.codigo)}">
      <span class="stop-num" aria-label="Parada número ${esc(p.codigo)}">${esc(p.codigo)}</span>
      <div class="card-title">${fav?.alias ? `<div class="fav-alias">${esc(fav.alias)}</div>` : ''}<h3>${esc(p.nombre)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}
        ${fav?.lineas?.length ? `<p>Solo líneas ${fav.lineas.map(esc).join(', ')}</p>` : ''}</div>
      ${ICON.chev}
    </a>
    ${tiempos === undefined ? '<div class="board-empty">Cargando tiempos…</div>' : boardHTML(filtered, status, { limit, filtrado: !!fav?.lineas?.length, codigo: p.codigo })}
    ${fav ? `<div class="card-tools">${settings.voz ? `<button type="button" data-speak="${esc(p.codigo)}">🔊 Escuchar</button>` : ''}<button type="button" data-edit-fav="${esc(p.codigo)}">Personalizar</button></div>` : ''}
  </article>`;
}
const emptyHTML = (icon, title, text, actions = '') => `<div class="empty">${icon}<h2>${title}</h2><p>${text}</p>${actions}</div>`;
const skeletons = (n = 3) => `<div class="stack">${'<div class="skeleton"></div>'.repeat(n)}</div>`;
const errorHTML = (e, retryId) => emptyHTML(ICON.off, 'No se han podido cargar los datos', esc(e.message || 'Error desconocido.'), `<button class="btn" type="button" id="${retryId}">Reintentar</button>`);
const backHead = (inner = '') => `<div class="detail-head"><button class="back-btn" type="button" aria-label="Volver">${ICON.back}</button>${inner}</div>`;
const swatchesHTML = (cur, attr) => `<div class="swatches">${TAGS.map((c) => `<button class="swatch" type="button" ${attr}="${c}" aria-pressed="${cur === c}" aria-label="Color" style="background:${c};color:${textOn(c)}">${cur === c ? ICON.check : ''}</button>`).join('')}</div>`;

/* Últimos tiempos de cada parada (para leerlos en voz alta) */
const ultimosTiempos = new Map();
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-speak]');
  if (!b) return;
  e.preventDefault();
  const c = b.dataset.speak;
  const p = cache.paradaByCode.get(c);
  const f = favs.get(c);
  hablar(textoParaVoz(f?.alias || p?.nombre || `Parada ${c}`, filtrarLineas(ultimosTiempos.get(c) || [], f)));
});

/* Ventana desde abajo */
function openModal(html, mount) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="modal-grip" type="button" aria-label="Cerrar"><span class="sheet-grip"></span></button>${html}</div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const modal = bg.firstElementChild;
  modal.querySelector('.modal-grip').onclick = close;
  /* Deslizar hacia abajo para cerrar (desde la barrita o con el contenido arriba del todo) */
  let y0 = null, dy = 0, t0 = 0, arrastrando = false;
  const scrollArriba = (el) => { for (let n = el; n && n !== bg; n = n.parentElement) if (n.scrollTop > 0) return false; return true; };
  modal.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || !scrollArriba(e.target)) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; t0 = Date.now(); arrastrando = false;
  }, { passive: true });
  modal.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (!arrastrando && dy > 8) { arrastrando = true; modal.style.transition = 'none'; }
    if (!arrastrando) { if (dy < -4) y0 = null; return; }
    e.preventDefault();
    modal.style.transform = `translateY(${Math.max(0, dy)}px)`;
    bg.style.backgroundColor = `rgb(0 0 0 / ${Math.max(0.1, 0.55 - dy / 800)})`;
  }, { passive: false });
  const soltar = () => {
    if (y0 == null || !arrastrando) { y0 = null; return; }
    const rapido = dy / Math.max(1, Date.now() - t0) > 0.6;
    y0 = null; arrastrando = false;
    modal.style.transition = 'transform .2s ease-out';
    if (dy > Math.min(140, modal.offsetHeight * 0.25) || (rapido && dy > 40)) {
      modal.style.transform = 'translateY(100%)'; bg.style.backgroundColor = 'transparent';
      setTimeout(close, settings.menosAnimaciones ? 0 : 180);
    } else { modal.style.transform = ''; bg.style.backgroundColor = ''; }
  };
  modal.addEventListener('touchend', soltar);
  modal.addEventListener('touchcancel', soltar);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  mount?.(bg.firstElementChild, close);
  return close;
}

/* Estrella de favorita con animación */
function favButton(p, onChange) {
  const on = favs.has(p.codigo);
  return { html: `<button class="fav-btn" type="button" data-fav aria-pressed="${on}" aria-label="${on ? 'Quitar de favoritas' : 'Guardar en favoritas'}">${ICON.star}</button>`,
    bind(root) {
      const b = $('[data-fav]', root);
      if (!b) return;
      b.onclick = () => {
        const now = !favs.has(p.codigo);
        if (now) favs.add(p); else favs.remove(p.codigo);
        b.setAttribute('aria-pressed', now);
        b.setAttribute('aria-label', now ? 'Quitar de favoritas' : 'Guardar en favoritas');
        b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
        vibrar(now ? 25 : 10);
        toast(now ? 'Guardada en favoritas. Pulsa «Personalizar» para elegir nombre, color y líneas.' : 'Quitada de favoritas');
        onChange?.(now);
      };
    } };
}
async function editFavorite(codigo, onDone) {
  const fav = favs.get(codigo);
  if (!fav) return;
  await getLineas().catch(() => null);
  const lineas = await api(`/paradas/${encodeURIComponent(codigo)}/lineas`).catch(() => []);
  let elegidas = new Set(fav.lineas?.length ? fav.lineas : lineas);
  let color = fav.color || '';
  openModal(`<h2>Personalizar parada</h2>
    <p class="help">${esc(fav.nombre)} · parada ${esc(codigo)}</p>
    <div class="field"><label for="fv-alias">Nombre</label><input id="fv-alias" maxlength="30" placeholder="Por ejemplo: Casa, Trabajo, Facultad" value="${esc(fav.alias || '')}"></div>
    <div class="field"><label>Color</label>${swatchesHTML(color, 'data-fc')}</div>
    <div class="field"><label>Líneas que quieres ver</label>
      <p class="help">En Favoritas solo saldrán los tiempos de las líneas marcadas. Sirve para no ver autobuses que nunca coges en esta parada. Si las dejas todas marcadas, se ven todas.</p>
      <div class="line-picks">${[...lineas].sort(ordenLineas).map((n) => `<button class="line-pick" type="button" data-ln="${esc(n)}" aria-pressed="${elegidas.has(n)}">${badge(etiquetaLinea(lineaFor(n)?.numero || n), lineaFor(n)?.color)}</button>`).join('') || '<span class="help">Sin datos de líneas.</span>'}</div></div>
    ${favs.list().length > 1 ? `<div class="field"><label>Posición en Favoritas <span class="orden-pos" id="fv-pos"></span></label>
      <div class="orden-box"><ol class="orden-lista" id="fv-orden"></ol>
        <div class="orden-btns"><button class="btn ghost" type="button" data-mv="-1">${ICON.arriba}Subir</button><button class="btn ghost" type="button" data-mv="1">${ICON.abajo}Bajar</button></div></div></div>` : ''}
    <div class="actions"><button class="btn danger" type="button" id="fv-del">Quitar de favoritas</button><button class="btn" type="button" id="fv-ok">Guardar</button></div>`,
  (m, close) => {
    m.querySelectorAll('[data-fc]').forEach((b) => { b.onclick = () => {
      color = color === b.dataset.fc ? '' : b.dataset.fc;
      m.querySelectorAll('[data-fc]').forEach((x) => { const on = x.dataset.fc === color; x.setAttribute('aria-pressed', on); x.innerHTML = on ? ICON.check : ''; });
    }; });
    m.querySelectorAll('[data-ln]').forEach((b) => { b.onclick = () => {
      const n = b.dataset.ln; if (elegidas.has(n)) elegidas.delete(n); else elegidas.add(n);
      b.setAttribute('aria-pressed', elegidas.has(n));
    }; });
    /* Lista en miniatura: ves dónde queda la parada al subirla o bajarla */
    const pintarOrden = (animar) => {
      const box = $('#fv-orden', m);
      if (!box) return;
      const l = favs.list();
      const i = l.findIndex((f) => f.codigo === codigo);
      box.innerHTML = l.map((f, j) => `<li class="${f.codigo === codigo ? 'yo' + (animar ? ' movido' : '') : ''}"><span class="o-n">${j + 1}</span><span class="o-t">${esc(f.alias || f.nombre)}</span></li>`).join('');
      $('#fv-pos', m).textContent = `· ${i + 1} de ${l.length}`;
      const [sube, baja] = [m.querySelector('[data-mv="-1"]'), m.querySelector('[data-mv="1"]')];
      if (sube) sube.disabled = i <= 0;
      if (baja) baja.disabled = i >= l.length - 1;
      box.querySelector('.yo')?.scrollIntoView({ block: 'nearest', behavior: animar && !settings.menosAnimaciones ? 'smooth' : 'auto' });
    };
    pintarOrden(false);
    m.querySelectorAll('[data-mv]').forEach((b) => { b.onclick = () => { favs.move(codigo, Number(b.dataset.mv)); vibrar(15); pintarOrden(true); onDone?.(); }; });
    $('#fv-del', m).onclick = () => { favs.remove(codigo); close(); toast('Quitada de favoritas'); onDone?.(); };
    $('#fv-ok', m).onclick = () => {
      const sel = lineas.filter((n) => elegidas.has(n));
      favs.update(codigo, { alias: $('#fv-alias', m).value.trim().slice(0, 30), color, lineas: sel.length && sel.length < lineas.length ? sel : null });
      close(); toast('Cambios guardados'); onDone?.();
    };
  });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-edit-fav]');
  if (b) { e.preventDefault(); editFavorite(b.dataset.editFav, () => active.rerender?.()); }
});

/* ================================================================== */
/* Ciclo de vida: no gastar batería en segundo plano                   */
/* ================================================================== */
let appVisible = document.visibilityState !== 'hidden';
const resumeHandlers = new Set();
// Al recuperar la conexión, se actualiza lo que estés viendo sin tocar nada
window.addEventListener('online', () => { if (appVisible) { toast('Conexión recuperada'); active?.rerender?.(); setTimeout(() => active?.refresh?.(), 400); } });
window.addEventListener('offline', () => { toast('Sin conexión: se muestran los últimos horarios guardados'); active?.rerender?.(); });
function setVisible(v) { const was = appVisible; appVisible = v; document.documentElement.classList.toggle('oculta', !v); if (v && !was) { repintar(); for (const fn of resumeHandlers) fn(); } }
/* Al volver de otra app, a veces Android no vuelve a pintar la pantalla (se queda gris hasta tocar algo).
   Se fuerza un repintado, se recolocan los mapas (y se rehacen si el móvil les quitó la gráfica)
   y se arreglan las ventanas que se abrieron mientras la app estaba en segundo plano. */
function repintar() {
  const h = document.documentElement;
  h.classList.add('repinta');
  void h.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => h.classList.remove('repinta')));
  document.querySelectorAll('.modal-bg').forEach((bg) => {
    const m = bg.querySelector('.modal');
    if (!m) { bg.remove(); return; }
    m.style.animation = 'none'; m.style.transform = ''; m.style.opacity = ''; bg.style.backgroundColor = '';
  });
  for (const bm of liveMaps) {
    try {
      if (bm.perdido?.()) { bm.rehacer?.(); continue; }
      bm.m.resize(); bm.m.triggerRepaint();
    } catch { /* mapa ya cerrado */ }
  }
}
window.busSevVuelve = () => { if (!appVisible) setVisible(true); else repintar(); };
/* El widget (al tocarlo) abre directamente la parada elegida */
window.busSevAbrirParada = (c) => { c = String(c == null ? '' : c).replace(/[^0-9]/g, ''); if (c) location.hash = '#parada-' + c; };
document.addEventListener('visibilitychange', () => setVisible(document.visibilityState === 'visible'));
document.addEventListener('pause', () => setVisible(false));
document.addEventListener('resume', () => setVisible(true));
function autoRefresh(fn, { min = 0 } = {}) {
  const ms = settings.refresh ? Math.max(settings.refresh * 1000, min) : 0;
  const id = ms ? setInterval(() => { if (appVisible) fn(); }, ms) : null;
  const onResume = () => fn();
  resumeHandlers.add(onResume);
  return () => { if (id) clearInterval(id); resumeHandlers.delete(onResume); };
}
const refreshNote = () => (settings.refresh ? `se actualiza cada ${settings.refresh === 60 ? 'minuto' : settings.refresh + ' s'}` : 'pulsa ⟳ para actualizar');

/* ================================================================== */
/* Ubicación                                                           */
/* ================================================================== */
function getPosition(precise = false) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(Object.assign(new Error('Este móvil no permite obtener la ubicación.'), { code: 0 })); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { store.set('geoOk', true); resolve([p.coords.latitude, p.coords.longitude]); },
      (err) => reject(err),
      { enableHighAccuracy: precise, timeout: 15000, maximumAge: 60000 },
    );
  });
}
function geoErrorText(err) {
  if (err?.code === 1) return 'No has dado permiso para usar tu ubicación. Puedes activarlo en Ajustes del móvil → Aplicaciones → BusSev → Permisos, o buscar la parada arriba.';
  if (err?.code === 3) return 'No hemos podido saber dónde estás a tiempo. Comprueba que la ubicación del móvil está activada o busca la parada arriba.';
  return err?.message || 'No hemos podido obtener tu ubicación. Busca la parada arriba.';
}

/* ================================================================== */
/* Mapas (MapLibre + OpenFreeMap, sin clave)                           */
/* ================================================================== */
if (window.maplibregl) window.maplibregl.setWorkerUrl('/vendor/maplibre/maplibre-gl-csp-worker.js');
const mapIsDark = () => settings.mapStyle === 'oscuro' || (settings.mapStyle === 'tema' && resolvedTheme === 'dark');
const styleUrl = () => (mapIsDark() ? '/map/oscuro.json' : '/map/claro.json');
const liveMaps = new Set();
function updateMapStyles() { for (const bm of liveMaps) bm.setStyle(); }
const ll = ([lat, lon]) => [lon, lat];

/* Envoltorio pequeño sobre MapLibre: guarda nuestras capas y las vuelve a
   poner si cambia el estilo (claro/oscuro). */
function createMap(el, center, zoom) {
  if (!window.maplibregl) { el.innerHTML = '<div class="map-fallback">El mapa no está disponible en este dispositivo.</div>'; return null; }
  let m;
  try {
    m = new maplibregl.Map({
      container: el, style: styleUrl(), center: ll(center), zoom,
      attributionControl: false, dragRotate: true, pitchWithRotate: false, touchPitch: false, maxPitch: 0,
      fadeDuration: 0, renderWorldCopies: false, maxTileCacheSize: 120, refreshExpiredTiles: false,
      maxBounds: [[-6.35, 37.15], [-5.65, 37.6]], minZoom: 10,
    });
  } catch {
    el.innerHTML = '<div class="map-fallback">No se ha podido abrir el mapa (el móvil no admite WebGL).</div>';
    return null;
  }
  m.touchZoomRotate.enableRotation();   // girar el mapa con dos dedos
  m.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-right');   // brújula: tócala para volver a poner el norte arriba
  el.insertAdjacentHTML('beforeend', '<span class="osm-credito">© OpenStreetMap</span>');
  const data = new Map();        // id -> geojson
  const installers = [];
  const bm = {
    m, style: styleUrl(),
    ready: new Promise((r) => m.once('style.load', r)),
    setStyle() { const u = styleUrl(); if (u !== bm.style) { bm.style = u; estiloListo = false; m.setStyle(u, { diff: false }); } },
    source(id, geojson) {
      data.set(id, geojson);
      const s = m.getSource(id);
      if (s) s.setData(geojson);
    },
    layer(def) { installers.push(def); install(def); },
    fit(points, opts = {}) {
      if (!points.length) return;
      const b = new maplibregl.LngLatBounds(ll(points[0]), ll(points[0]));
      for (const p of points) b.extend(ll(p));
      m.fitBounds(b, { padding: opts.padding ?? 40, maxZoom: opts.maxZoom ?? 16, duration: opts.anim ? animMs(400) : 0 });
    },
    remove() { liveMaps.delete(bm); m.remove(); },
  };
  // El estilo está listo para añadir capas aunque falten teselas o iconos (p. ej. sin cobertura).
  let estiloListo = false;
  function styleReady() { return estiloListo; }
  function install(def) {
    if (!styleReady()) return;
    if (!m.getSource(def.source)) m.addSource(def.source, { type: 'geojson', data: data.get(def.source) || { type: 'FeatureCollection', features: [] } });
    if (!m.getLayer(def.id)) m.addLayer(def);
  }
  m.on('style.load', () => { estiloListo = true; for (const d of installers) install(d); aplicarCapasMapa(bm); });
  m.on('error', () => { /* teselas que no cargan sin cobertura: no es un fallo de la app */ });
  /* Si Android le quita la gráfica al mapa (pasa al estar un rato en otra app), el mapa se queda gris:
     se avisa a la pantalla para que lo vuelva a crear. */
  let perdido = false;
  const lienzo = m.getCanvas();
  lienzo.addEventListener('webglcontextlost', (e) => { e.preventDefault(); perdido = true; }, false);
  lienzo.addEventListener('webglcontextrestored', () => { perdido = false; try { m.resize(); m.triggerRepaint(); } catch { /* */ } }, false);
  bm.perdido = () => { if (perdido) return true; try { return !!m.painter?.context?.gl?.isContextLost?.(); } catch { return false; } };
  bm.rehacer = () => { setTimeout(() => { if (bm.perdido()) window.dispatchEvent(new CustomEvent('bussev-mapa-perdido', { detail: bm })); }, 1200); };
  liveMaps.add(bm);
  return bm;
}
/* #64 Mostrar u ocultar capas del mapa (paradas, recorridos, nombres de calles). Por defecto todo visible. */
function aplicarCapasMapa(bm) {
  if (!bm?.m) return;
  const m = bm.m;
  const vis = (id, on) => { try { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); } catch { /* */ } };
  vis('bs-stops', settings.mapaParadas !== false);
  vis('bs-stops-hit', settings.mapaParadas !== false);
  for (const id of ['bs-route-casing', 'bs-route', 'bs-route-stops', 'bs-paths-casing', 'bs-paths']) vis(id, settings.mapaRecorridos !== false);
  // Nombres de calles y sitios = las capas de texto del mapa base
  try { for (const l of m.getStyle()?.layers || []) if (l.type === 'symbol') m.setLayoutProperty(l.id, 'visibility', settings.mapaCalles !== false ? 'visible' : 'none'); } catch { /* */ }
}
const fc = (features) => ({ type: 'FeatureCollection', features });
const pointF = (pos, props = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: ll(pos) }, properties: props });
const lineF = (pts, props = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(ll) }, properties: props });

/* Todas las paradas como puntos rojos */
async function addStopDots(bm, onClick) {
  const list = await getParadas().catch(() => []);
  bm.source('bs-stops', fc(list.map((p) => pointF([p.latitud, p.longitud], { codigo: p.codigo }))));
  bm.layer({ id: 'bs-stops', type: 'circle', source: 'bs-stops', paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 13, 2.6, 15, 4.2, 17, 6.5, 19, 8],
    'circle-color': '#e5303c', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 1.2], 'circle-stroke-color': mapIsDark() ? '#1d1f23' : '#ffffff',
  } });
  // Capa de toque invisible, más ancha que el punto: se toca mucho mejor sin que el punto se vea más grande.
  bm.layer({ id: 'bs-stops-hit', type: 'circle', source: 'bs-stops', paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 9, 13, 11, 15, 13, 17, 16, 19, 18],
    'circle-color': '#000000', 'circle-opacity': 0,
  } });
  const tocar = (e) => { const c = e.features?.[0]?.properties?.codigo; const p = c && cache.paradaByCode.get(String(c)); if (p) onClick(p); };
  bm.m.on('click', 'bs-stops-hit', tocar);
  bm.m.on('mouseenter', 'bs-stops-hit', () => { bm.m.getCanvas().style.cursor = 'pointer'; });
  bm.m.on('mouseleave', 'bs-stops-hit', () => { bm.m.getCanvas().style.cursor = ''; });
}
/* Capas para recorrido de línea y caminos de los buses */
function addRouteLayers(bm) {
  bm.layer({ id: 'bs-route-casing', type: 'line', source: 'bs-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000000', 'line-opacity': 0.35, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 10] } });
  bm.layer({ id: 'bs-route', type: 'line', source: 'bs-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 6.5] } });
  bm.layer({ id: 'bs-route-stops', type: 'circle', source: 'bs-route-stops', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5.5], 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2.2 } });
  // Desplazamiento lateral (carril) que pone tramosConCarril SOLO donde varias líneas comparten calle: ahí se
  // dibujan pegadas una a otra, centradas sobre la calzada. Donde una línea va sola, carril 0 (encima de la calle).
  const offsetPaths = ['interpolate', ['linear'], ['zoom'], 12, ['*', ['coalesce', ['get', 'carril'], 0], 3], 16, ['*', ['coalesce', ['get', 'carril'], 0], 6]];
  // Grosor: el normal, o más fino (propiedad «ancho») donde se juntan muchas líneas, para que quepan todas.
  const anchoPaths = ['coalesce', ['get', 'ancho'], 1];
  // Borde oscuro debajo de cada camino: así dos líneas de color parecido (p. ej. dos azules) se separan.
  bm.layer({ id: 'bs-paths-casing', type: 'line', source: 'bs-paths', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': mapIsDark() ? '#0b0c0f' : '#ffffff', 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, ['+', ['*', anchoPaths, 2.6], 1.8], 16, ['+', ['*', anchoPaths, 5], 2.5]], 'line-offset': offsetPaths } });
  bm.layer({ id: 'bs-paths', type: 'line', source: 'bs-paths', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, ['*', anchoPaths, 2.6], 16, ['*', anchoPaths, 5]], 'line-opacity': 0.98, 'line-offset': offsetPaths } });
}
/* Marcadores HTML (autobuses y parada) */
function busEl(label, color, clave) {
  const c = safeColor(color, '#3d8bfd');
  const root = document.createElement('div');   // MapLibre coloca este elemento; no le damos posición propia
  const d = document.createElement('div');
  const v = vehiculoFiesta();
  d.className = 'busmk' + (v ? ' ' + v.clase : '');
  root.appendChild(d);
  const k = clave == null ? `${label}` : String(clave);
  d.innerHTML = `<span class="busmk-l" style="background:${c};border-color:${c};color:${textOn(c)}">${esc(label)}</span><img class="busmk-img" src="${busImg(k)}" data-k="${esc(k)}" alt="" draggable="false">`;
  return root;
}
function stopPinEl() {
  const d = document.createElement('div');
  d.innerHTML = '<svg class="stop-pin" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 39S2 24.5 2 14.5a13 13 0 0 1 26 0C28 24.5 15 39 15 39Z" style="fill:var(--accent)" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14.5" r="5" fill="#fff"/></svg>';
  return d;
}
function meEl() { const r = document.createElement('div'); const d = document.createElement('div'); d.className = 'me-pin'; r.appendChild(d); return r; }
function marker(bm, pos, el, popupHTML, anchor = 'bottom') {
  const mk = new maplibregl.Marker({ element: el, anchor }).setLngLat(ll(pos));
  if (popupHTML) mk.setPopup(new maplibregl.Popup({ offset: 28, maxWidth: '260px' }).setHTML(popupHTML));
  return mk.addTo(bm.m);
}
class MarkerSet {
  constructor(bm) { this.bm = bm; this.items = new Map(); this.timer = null; this.raf = 0; }
  clear() { for (const it of this.items.values()) it.mk.remove(); this.items.clear(); this.stopAnim(); }
  add(pos, el, html) { this.items.set(`f${Math.random()}`, { mk: marker(this.bm, pos, el, html) }); }
  /* Autobuses: actualiza los que ya están (sin crearlos de nuevo).
     La posición NUNCA va hacia atrás: si el dato nuevo de TUSSAM deja al bus algo por detrás
     de donde lo habíamos dibujado, se queda quieto hasta que el avance real lo alcanza.
     Solo si la diferencia es enorme (más de 1,5 km, otro bus o un dato raro) se recoloca. */
  sync(buses, label, color, { parcial = false } = {}) {
    const seen = new Set();
    const now = Date.now();
    for (const b of buses) {
      const lab = b.linea || label, col = b.color || color;
      const key = b.vehiculo != null ? `v${b.vehiculo}` : `${lab}|${b.seg}|${Math.round(b.dist / 250)}`;
      seen.add(key);
      let it = this.items.get(key);
      const nuevo = !it;
      if (nuevo) { it = { mk: marker(this.bm, b.pos, busEl(lab, col, key), busPopup(b, lab)) }; this.items.set(key, it); }
      else it.mk.getPopup()?.setHTML(busPopup(b, lab));
      if (!b.shape) { it.st = null; if (!nuevo) this.deslizar(it, b.pos); this.face(it, b.path?.[1], b.pos); continue; }
      const parada = b.shape.cum[b.shape.idx[b.k]];
      const real = Math.max(0, parada - distEf(b.shape, b.dist));   // metros recorridos desde el inicio de la línea
      // velocidad prudente (un poco por debajo de la que sale de TUSSAM) para no adelantarse a la realidad
      const v = 0.8 * Math.min(10, Math.max(1.4, b.dist / Math.max(45, (b.min || 0) * 60)));
      const mismo = it.st && it.st.shape === b.shape;
      // Si el dato nuevo lo deja algo por detrás, NO retrocede: se queda quieto hasta que el avance real lo alcanza.
      // Solo si la diferencia es enorme (más de 1,5 km: otro autobús o un dato erróneo) se recoloca, deslizándolo.
      if (!mismo || it.d == null || real < it.d - 1500) { if (it.d != null && mismo) it.largo = true; it.d = real; }
      it.st = { shape: b.shape, k: b.k, parada, base: real, t0: now, v };
      if (nuevo) { it.d = Math.max(it.d, real); this.colocar(it, false); }
      else this.colocar(it, true);
    }
    if (!parcial) for (const [k, it] of this.items) if (it.st !== undefined && !seen.has(k)) { it.mk.remove(); this.items.delete(k); }
    this.startAnim();
  }
  /* Calcula dónde dibujar el bus ahora (sin retroceder) y lo lleva allí */
  colocar(it, suave) {
    const st = it.st;
    if (!st) return;
    // Entre datos de TUSSAM se avanza a su velocidad, pero como mucho 60 s de camino (sin datos nuevos, se para)
    const estimado = settings.menosAnimaciones ? st.base : st.base + st.v * Math.min(60, (Date.now() - st.t0) / 1000);
    // lo calculado no pasa de la parada desde la que se midió, y lo ya dibujado nunca va hacia atrás
    it.d = Math.max(it.d ?? 0, Math.min(st.parada, estimado));
    const w = locateOnShape(st.shape, st.k, st.parada - it.d, true);
    if (w.fuera) return;
    if (suave && !settings.menosAnimaciones) { this.deslizar(it, w.pos, it.largo ? 1800 : 900); it.largo = false; } else it.mk.setLngLat(ll(w.pos));
    this.face(it, w.path[1], w.pos);
  }
  /* Desliza el marcador hasta el punto nuevo en menos de un segundo (en vez de saltar) */
  deslizar(it, pos, dur = 900) {
    const a = it.mk.getLngLat();
    it.anim = { de: [a.lat, a.lng], a: pos, t0: performance.now(), dur };
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.paso(t));
  }
  paso(t) {
    this.raf = 0;
    let quedan = false;
    for (const it of this.items.values()) {
      const an = it.anim;
      if (!an) continue;
      const f = Math.min(1, (t - an.t0) / an.dur);
      const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;   // suave al empezar y al terminar
      it.mk.setLngLat(ll([an.de[0] + (an.a[0] - an.de[0]) * e, an.de[1] + (an.a[1] - an.de[1]) * e]));
      if (f < 1) quedan = true; else it.anim = null;
    }
    if (quedan) this.raf = requestAnimationFrame((x) => this.paso(x));
  }
  /* El dibujo mira hacia donde va el autobús */
  face(it, next, pos) {
    if (!next) return;
    const dx = next[1] - pos[1];
    if (Math.abs(dx) < 0.00003) return;
    it.mk.getElement().querySelector('.busmk')?.classList.toggle('izq', dx < 0);
  }
  tick() {
    const cont = this.bm.m.getContainer();
    if (!appVisible || !cont.isConnected || cont.offsetParent === null) return;   // no se ve: no gasta
    for (const it of this.items.values()) if (it.st) this.colocar(it, true);
  }
  /* Cada 4 segundos (no hace falta más: ahorra batería y se ve más tranquilo) */
  startAnim() { if (this.timer || settings.menosAnimaciones) return; this.timer = setInterval(() => this.tick(), 4000); }
  stopAnim() { clearInterval(this.timer); this.timer = null; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
}

/* ================================================================== */
/* Dónde va cada autobús                                               */
/* TUSSAM no publica el GPS, pero sí cuántos metros le faltan a cada   */
/* bus para llegar a una parada. Recorriendo la línea hacia atrás por  */
/* las calles desde esa parada sabemos por dónde va.                   */
/* ================================================================== */
/* TUSSAM da la distancia por carretera. Si el recorrido está dibujado en línea recta entre paradas
   (cuando no se pudieron calcular las calles), la recta es más corta: se ajusta para no colocar mal
   (ni descartar) autobuses que de verdad están en la línea. */
const FACTOR_RECTA = 1.25;
const distEf = (shape, m) => Math.max(0, m || 0) / (shape?.porCalle ? 1 : FACTOR_RECTA);
function locateOnShape(shape, k, meters, efectivos = false) {
  const { pts, idx, cum } = shape;
  const end = idx[k];
  let target = cum[end] - (efectivos ? Math.max(0, meters || 0) : distEf(shape, meters));
  if (target < 0) {
    // un poco «antes del inicio»: está en la cabecera saliendo; mucho más: es de otro sentido o de otra vuelta
    if (-target <= Math.max(400, cum[end] * 0.5)) target = 0;
    else return { fuera: true, pos: pts[0], path: pts.slice(0, end + 1), seg: 0 };
  }
  let lo = 0, hi = end;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= target) lo = mid; else hi = mid - 1; }
  const i = lo;
  const segLen = (cum[i + 1] ?? cum[i]) - cum[i];
  const f = segLen > 0 ? (target - cum[i]) / segLen : 0;
  const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
  const pos = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  let seg = k;
  for (let j = 0; j <= k; j++) if (cum[idx[j]] >= target) { seg = j; break; }
  return { pos, path: [pos, ...pts.slice(i + 1, end + 1)], seg };
}
function sentidoDe(ruta, codigo, sentido) {
  if (sentido && ruta[sentido]) return sentido;
  return Object.keys(ruta).map(Number).find((k) => ruta[k].some((p) => p.codigo === codigo));
}
async function estimateBuses(codigo, tiempos) {
  await getLineas().catch(() => null);
  const out = []; const seen = new Set();
  for (const t of (tiempos || []).slice().sort((a, b) => a.tiempo_minutos - b.tiempo_minutos)) {
    if (t.distancia_metros == null) continue;
    const key = t.vehiculo != null ? `v${t.vehiculo}` : `${t.linea}|${t.destino}|${t.tiempo_minutos}`;
    if (seen.has(key)) continue;
    const linea = lineaFor(t.linea);
    if (!linea) continue;
    const ruta = await getRuta(linea.numero).catch(() => null);
    if (!ruta) continue;
    const s = sentidoDe(ruta, codigo, t.sentido);
    const stops = ruta[s];
    const k = stops ? stops.findIndex((p) => p.codigo === codigo) : -1;
    if (k < 0) continue;
    const shape = getShape(linea.numero, s, stops);
    const w = locateOnShape(shape, k, t.distancia_metros);
    if (w.fuera) continue;
    seen.add(key);
    out.push({ linea: t.linea, color: t.color || linea.color, destino: t.destino, min: t.tiempo_minutos, dist: t.distancia_metros, vehiculo: t.vehiculo, shape, k, ...w });
    if (out.length >= 8) break;
  }
  return out;
}
/* Autobuses de toda una línea con MUY pocas consultas.
   TUSSAM da, para cada parada, los 2 próximos autobuses de cada línea (y a cuántos metros vienen).
   Se empieza por la última parada: da los 2 autobuses más cercanos a ella. Luego se pregunta en la
   parada que queda justo por detrás del más lejano de esos dos, que da los 2 siguientes, y así
   hasta llegar al principio de la línea (o hasta que TUSSAM dé menos de 2: ya no hay más).
   Una línea con 6 autobuses se resuelve con 3-4 consultas, una detrás de otra, en vez de 10-15 a la vez. */
const porParadaTussam = 2;  // cuántos autobuses por línea da TUSSAM en cada parada
async function liveBusesLine(linea, sentido, stops, alAvanzar, cancelado = () => false) {
  if (!stops?.length) return { buses: [], ok: 0, total: 0 };
  const shape = getShape(linea.numero, sentido, stops);
  if (window.BusSevBackend.viaServidor) return lineaDeGolpe(linea, sentido, stops, shape, alAvanzar, cancelado);
  const best = new Map();
  const MAX_CONSULTAS = 8;
  let ok = 0, hechas = 0, limited = false, fallos = 0;
  let k = stops.length - 1;
  const consultadas = new Set();
  while (k >= 0 && hechas < MAX_CONSULTAS) {
    if (consultadas.has(k) || cancelado()) break;
    consultadas.add(k);
    hechas++;
    let d;
    try { d = await api(`/paradas/${encodeURIComponent(stops[k].codigo)}/tiempos`, { prioridad: 'baja', maxEdad: 25_000 }); } catch (e) {
      if (e.status === 429) { limited = true; break; }
      if (e.status === 408 || e.status === 499 || cancelado()) break;
      // parada sin datos: se prueba con la anterior (dos fallos seguidos: se para)
      if (++fallos >= 2) break;
      k -= 3; continue;
    }
    fallos = 0;
    if (cancelado()) break;
    if (d.upstream_status === 'unavailable') { k -= 3; continue; }
    ok++;
    const mias = (d.tiempos || []).filter((t) => lineaFor(t.linea)?.numero === linea.numero && (!t.sentido || t.sentido === sentido) && t.distancia_metros != null);
    let masLejos = null;
    for (const t of mias) {
      const w = locateOnShape(shape, k, t.distancia_metros);
      if (w.fuera) continue;
      const key = t.vehiculo != null ? `v${t.vehiculo}` : `${w.seg}-${Math.round(w.pos[0] * 2000)}-${Math.round(w.pos[1] * 2000)}`;
      const cur = best.get(key);
      if (!cur || t.distancia_metros < cur.dist) best.set(key, { ...w, shape, k, dist: t.distancia_metros, min: t.tiempo_minutos, vehiculo: t.vehiculo, destino: t.destino, hacia: stops[k].nombre });
      if (!masLejos || w.seg < masLejos.seg) masLejos = w;
    }
    alAvanzar?.([...best.values()]);
    // Menos autobuses de los que da TUSSAM por parada: no hay más por detrás
    if (mias.length < porParadaTussam || !masLejos) break;
    // Siguiente: la parada justo por detrás del autobús más lejano (siempre más atrás que la actual)
    k = Math.min(masLejos.seg - 1, k - 1);
  }
  return { buses: [...best.values()], ok, total: hechas, limited, porCalle: shape.porCalle };
}
/* Con tu servidor (como SeviBus): la línea entera en UNA sola consulta.
   Se pregunta por una de cada 3 paradas a la vez (el servidor lo hace por nosotros y guarda las respuestas),
   así cada autobús se mide desde la parada que tiene justo delante: posición más exacta y sin saltos. */
async function lineaDeGolpe(linea, sentido, stops, shape, alAvanzar, cancelado) {
  const paso = Math.max(3, Math.ceil(stops.length / 16));
  const ks = [];
  for (let i = stops.length - 1; i >= 0 && ks.length < 16; i -= paso) ks.push(i);
  const best = new Map();
  let ok = 0, limited = false;
  const res = await Promise.allSettled(ks.map((k) => api(`/paradas/${encodeURIComponent(stops[k].codigo)}/tiempos`, { prioridad: 'baja', maxEdad: 15_000 })));
  if (cancelado()) return { buses: [], ok: 0, total: ks.length, cancelado: true };
  res.forEach((r, n) => {
    if (r.status !== 'fulfilled') { if (r.reason?.status === 429) limited = true; return; }
    if (r.value.upstream_status === 'unavailable') return;
    ok++;
    const k = ks[n];
    for (const t of r.value.tiempos || []) {
      if (lineaFor(t.linea)?.numero !== linea.numero || (t.sentido && t.sentido !== sentido) || t.distancia_metros == null) continue;
      const w = locateOnShape(shape, k, t.distancia_metros);
      if (w.fuera) continue;
      const key = t.vehiculo != null ? `v${t.vehiculo}` : `${w.seg}-${Math.round(w.pos[0] * 2000)}-${Math.round(w.pos[1] * 2000)}`;
      const cur = best.get(key);
      // la medida más fiable es la de la parada más cercana (menos metros por delante)
      if (!cur || t.distancia_metros < cur.dist) best.set(key, { ...w, shape, k, dist: t.distancia_metros, min: t.tiempo_minutos, vehiculo: t.vehiculo, destino: t.destino, hacia: stops[k].nombre });
    }
  });
  alAvanzar?.([...best.values()]);
  return { buses: [...best.values()], ok, total: ks.length, limited, porCalle: shape.porCalle };
}
const busPopup = (b, label) => `<b>Línea ${esc(label)}</b> → ${esc(b.destino)}<br>${b.hacia ? `Llega a ${esc(b.hacia)} en ${b.min <= 0 ? 'nada' : b.min + ' min'}` : `${b.min <= 0 ? 'Llegando' : `Llega en ${b.min} min`} · a ${fmtDist(b.dist)}`}${b.vehiculo ? `<br><span class="muted">Autobús ${esc(b.vehiculo)}</span>` : ''}`;

/* Dibuja una línea completa con sus buses en directo sobre un mapa */
function lineController(bm, markers, { onStatus, onBuses } = {}) {
  let stopLive = null, seq = 0, cur = null;
  async function show(l, sentido) {
    const ruta = await getRuta(l.numero);
    const stops = ruta[sentido] || [];
    const lc = safeColor(l.color, '#555555');
    const shape = getShape(l.numero, sentido, stops);
    bm.source('bs-route', fc([lineF(shape.pts, { color: lc })]));
    // Los puntos de parada se colocan SOBRE la línea (el punto del trazado más cercano a cada parada), no en
    // la coordenada de la acera, para que se vean pegados al recorrido y no flotando a un lado.
    bm.source('bs-route-stops', fc(stops.map((p, i) => pointF(shape.pts[shape.idx[i]] || [p.latitud, p.longitud], { color: lc, codigo: p.codigo }))));
    bm.source('bs-paths', fc([]));
    markers.clear();
    bm.fit(shape.pts, { padding: { top: 120, bottom: 40, left: 30, right: 30 } });
    cur = { l, sentido, stops };
    parar();
    if (!settings.liveLines) { onStatus?.('Autobuses en directo desactivados (botón ' + busIco() + ' del mapa o Ajustes).', true); return; }
    live();
    stopLive = autoRefresh(live, { min: REFRESH_LINE_MIN });
  }
  async function live() {
    if (!cur) return;
    const my = ++seq; const { l, sentido, stops } = cur;
    onStatus?.(`${cargandoMini()} Buscando los autobuses de esta línea…`, true);
    spin(true);
    try {
      const r = await liveBusesLine(l, sentido, stops, (parcial) => {
        if (my !== seq) return;
        markers.sync(parcial.map((b) => ({ ...b, linea: l.numero, color: l.color })), l.numero, l.color, { parcial: true });
        onStatus?.(`${cargandoMini()} Buscando autobuses…${parcial.length ? ` ${parcial.length} encontrado${parcial.length === 1 ? '' : 's'}` : ''}`, true);
      }, () => my !== seq || !settings.liveLines);
      if (my !== seq) return;
      markers.sync(r.buses.map((b) => ({ ...b, linea: l.numero, color: l.color })), l.numero, l.color);
      onBuses?.(r.buses);
      onStatus?.(r.ok === 0
        ? (r.limited ? 'TUSSAM está limitando las consultas. Los autobuses aparecerán en un momento.' : 'No se ha podido saber dónde están los autobuses ahora.')
        : `${r.buses.length ? `${r.buses.length} ${r.buses.length === 1 ? 'autobús' : 'autobuses'} en este sentido` : 'Ahora mismo no hay autobuses en este sentido'} · ${fmtClock()}`);
    } finally { if (my === seq) spin(false); }
  }
  /* Dejar de consultar: se corta también la búsqueda que esté a medias y se para el ⟳ */
  function parar() { stopLive?.(); stopLive = null; seq++; spin(false); window.BusSevBackend.cancelarFondo?.(); }
  function clear() { parar(); cur = null; markers.clear(); bm.source('bs-route', fc([])); bm.source('bs-route-stops', fc([])); }
  return { show, live: () => { if (cur && settings.liveLines) return live(); }, clear, stop: parar, resume: () => { if (cur && !stopLive && settings.liveLines) { live(); stopLive = autoRefresh(live, { min: REFRESH_LINE_MIN }); } }, get current() { return cur; } };
}
/* CARRILES-INI */
/* Reparte en «carriles» los caminos de los buses que vienen a una parada, SOLO en los trozos de calle donde
   de verdad coinciden varias líneas (misma calle y mismo sentido). Donde una línea va sola, su camino va
   centrado, justo encima de la calle. Antes cada línea llevaba el mismo desplazamiento en todo su camino,
   también donde iba sola, y por eso se veía dibujada al lado de la carretera.
   caminos: [{ linea, color, path:[[lat,lon]…] }]  ->  [{ i, pts, carril }]  (i = posición en «caminos») */
function tramosConCarril(caminos) {
  const PASO = 10, CERCA = 16, CELDA = 20, MIN_TRAMO = 60, ANG = 40 * Math.PI / 180;
  // Orden fijo de las líneas (no según qué bus llega antes): así no cambian de lado al refrescar.
  const lineas = [...new Set(caminos.map((c) => String(c.linea)))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  if (lineas.length < 2) return caminos.map((c, i) => ({ i, pts: c.path, carril: 0, ancho: 1 }));
  const colorDe = lineas.map((l) => String(caminos.find((c) => String(c.linea) === l).color ?? l));
  const lat0 = caminos[0].path[0][0], kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  // Cada camino, en puntos cada ~10 m con su rumbo
  const denso = (path) => {
    const out = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i], b = path[i + 1];
      const dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * ky, len = Math.hypot(dx, dy);
      if (!(len > 0)) continue;
      const n = Math.max(1, Math.ceil(len / PASO)), ang = Math.atan2(dy, dx);
      for (let k = 0; k < n; k++) { const t = k / n; out.push({ ll: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ang, paso: len / n }); }
      if (i + 2 === path.length) out.push({ ll: b, ang, paso: 0 });
    }
    for (const q of out) { q.x = q.ll[1] * kx; q.y = q.ll[0] * ky; }
    return out;
  };
  const D = caminos.map((c) => denso(c.path));
  // Rejilla con los puntos del camino más largo de cada línea (los demás buses de la línea van por dentro de él)
  const rej = new Map();
  lineas.forEach((l, li) => {
    let mejor = null;
    caminos.forEach((c, i) => { if (String(c.linea) === l && (!mejor || D[i].length > mejor.length)) mejor = D[i]; });
    for (const q of mejor || []) {
      const k = `${Math.floor(q.x / CELDA)},${Math.floor(q.y / CELDA)}`;
      let cel = rej.get(k); if (!cel) rej.set(k, cel = []);
      cel.push({ x: q.x, y: q.y, ang: q.ang, li });
    }
  });
  const juntas = (q, propia) => {   // máscara de líneas que pasan por aquí en el mismo sentido
    let mask = 1 << propia;
    const cx = Math.floor(q.x / CELDA), cy = Math.floor(q.y / CELDA);
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iy = cy - 1; iy <= cy + 1; iy++) {
      const cel = rej.get(`${ix},${iy}`); if (!cel) continue;
      for (const o of cel) {
        if (mask & (1 << o.li)) continue;
        if (Math.hypot(o.x - q.x, o.y - q.y) > CERCA) continue;
        let d = Math.abs(o.ang - q.ang) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d;
        if (d <= ANG) mask |= 1 << o.li;
      }
    }
    return mask;
  };
  const salida = [];
  caminos.forEach((c, i) => {
    const pts = D[i];
    if (pts.length < 2) { salida.push({ i, pts: c.path, carril: 0, ancho: 1 }); return; }
    const li = lineas.indexOf(String(c.linea));
    const car = pts.map((q) => {
      const mask = juntas(q, li);
      let n = 0, pos = 0;
      for (let b = 0; b < lineas.length; b++) if (mask & (1 << b)) { if (b === li) pos = n; n++; }
      // Con más de 4 líneas juntas, las del MISMO color comparten franja (de todos modos no se distinguirían):
      // así cada color se ve bien ancho en vez de quedar tapado por varias líneas iguales.
      if (n > 4) {
        const vistos = [];
        for (let b = 0; b < lineas.length; b++) if (mask & (1 << b)) { if (!vistos.includes(colorDe[b])) vistos.push(colorDe[b]); }
        n = vistos.length; pos = vistos.indexOf(colorDe[li]);
      }
      // Hasta 4 líneas van una al lado de otra con su grosor normal. Con más, el conjunto no crece (se saldría
      // de la calzada): cada línea se hace más fina y se reparten el mismo hueco, así se ven TODAS como franjas
      // de su color en vez de taparse unas a otras.
      const paso = n > 4 ? 3 / (n - 1) : 1;                       // separación entre vecinas, en «carriles»
      const ancho = n > 4 ? Math.max(0.3, (paso * 6 - 0.6) / 5) : 1;   // grosor respecto al normal
      return Math.round((pos - (n - 1) / 2) * paso * 1000) / 1000 + '|' + Math.round(ancho * 100) / 100;
    });
    // Tramos seguidos con el mismo carril; los muy cortos (un cruce, un hueco) se funden con el de al lado
    let runs = [];
    for (let k = 0; k < pts.length; k++) {
      const u = runs[runs.length - 1];
      if (u && u.carril === car[k]) { u.fin = k; u.m += pts[k].paso; } else runs.push({ ini: k, fin: k, carril: car[k], m: pts[k].paso });
    }
    for (let cambio = true; cambio && runs.length > 1;) {
      cambio = false;
      for (let r = 0; r < runs.length; r++) {
        if (runs[r].m >= MIN_TRAMO) continue;
        const v = runs[r - 1] && runs[r + 1] ? (runs[r - 1].m >= runs[r + 1].m ? r - 1 : r + 1) : (runs[r - 1] ? r - 1 : r + 1);
        runs[v].ini = Math.min(runs[v].ini, runs[r].ini); runs[v].fin = Math.max(runs[v].fin, runs[r].fin); runs[v].m += runs[r].m;
        runs.splice(r, 1); cambio = true; break;
      }
      const f = [];
      for (const r of runs) { const u = f[f.length - 1]; if (u && u.carril === r.carril) { u.fin = r.fin; u.m += r.m; } else f.push(r); }
      runs = f;
    }
    runs.forEach((r, n) => {
      const hasta = n + 1 < runs.length ? r.fin + 1 : r.fin;   // comparte un punto con el tramo siguiente (sin huecos)
      const t = pts.slice(r.ini, hasta + 1).map((q) => q.ll);
      if (t.length > 1) { const [ca, an] = String(r.carril).split('|').map(Number); salida.push({ i, pts: t, carril: ca, ancho: an }); }
    });
  });
  return salida;
}
/* CARRILES-FIN */
/* Dibuja los buses que vienen a una parada y su camino */
function drawApproaching(bm, markers, buses) {
  const conPath = buses.filter((b) => b.path?.length > 1);
  // Cada camino va centrado sobre su calle; solo donde coinciden varias líneas se separan en paralelo.
  const tramos = tramosConCarril(conPath.map((b) => ({ linea: String(b.linea ?? b.color), color: safeColor(b.color, '#3d8bfd'), path: b.path })));
  bm.source('bs-paths', fc(tramos.map((t) => lineF(t.pts, { color: safeColor(conPath[t.i].color, '#3d8bfd'), carril: t.carril, ancho: t.ancho }))));
  markers.sync(buses);
}

/* ================================================================== */
/* Vistas                                                              */
/* ================================================================== */
const views = {};
const TABS = ['favoritas', 'mapa', 'lineas', 'tarjeta', 'cerca'];
let active = { name: null, cleanup: null, refresh: null, rerender: null };
let lastTab = 'favoritas';
let routeCount = 0;
const goBack = () => { if (routeCount > 1) history.back(); else location.hash = lastTab; };
const spin = (on) => $('#btn-refresh').classList.toggle('spinning', !!on);

/* Autobuses nocturnos (Búho): de noche se enseñan en Favoritas con su última hora */
function esHoraNoche() { const h = new Date().getHours(); return h >= 22 || h < 6; }
function lineasNocturnas() {
  return [...cache.lineaByNum.values()]
    .filter((l) => l.nocturna || /^A\d/.test(String(l.numero || '')))
    .sort((a, b) => String(a.numero).localeCompare(String(b.numero), 'es', { numeric: true }));
}
function nocturnasHTML() {
  if (!esHoraNoche()) return '';
  const ls = lineasNocturnas();
  if (!ls.length) return '';
  const rows = ls.map((l) => {
    const fin = l.hora_fin_ida || l.hora_fin_vuelta;
    return `<a class="row" href="#linea-${esc(l.numero)}">${badge(l.numero, l.color)}<div class="row-main"><b>${esc(l.nombre)}</b><span>${fin ? `Último bus sobre las ${esc(fin)}` : 'Autobús nocturno'}</span></div>${ICON.chev}</a>`;
  }).join('');
  return `<div class="set-group"><h3>🌙 Autobuses nocturnos</h3><div class="list">${rows}</div><p class="small muted" style="margin:.4rem 0 0">Las líneas Búho circulan de madrugada. Toca una para ver su recorrido y los tiempos.</p></div>`;
}

/* Sin conexión: aviso en Favoritas de que los horarios son orientativos, no en tiempo real */
function offlineHTML() {
  if (navigator.onLine !== false) return '';
  return `<div class="dia-aviso dia-offline">📴 <span>Sin conexión: estos <b>no son los tiempos reales</b>. Son los últimos guardados y pueden no ser exactos.</span></div>`;
}

/* ---------- Favoritas ---------- */
views.favoritas = (el) => {
  let stop = null, loading = false, results = null, dead = false;
  // Últimos tiempos guardados (< 10 min) para enseñarlos al instante al abrir, en vez de «Cargando…»
  const recientes = (codigo) => { const u = window.BusSevBackend?.ultimo?.(codigo); if (!u || !u.cached_at) return null; return (navigator.onLine === false || Date.now() - Date.parse(u.cached_at) < 600000) ? u : null; };
  function paint() {
    const list = favs.list();
    if (!list.length) {
      el.innerHTML = `<div class="page-head"><h1>Favoritas</h1></div>` + emptyHTML(ICON.star, 'Aún no tienes paradas favoritas', 'Abre una parada (desde el mapa, el buscador o Cerca) y pulsa la estrella. Luego podrás ponerle nombre, color y elegir qué líneas ver.', '<a class="btn" href="#mapa">Buscar en el mapa</a><a class="btn ghost" href="#avisos">Avisos de TUSSAM</a>');
      return false;
    }
    const avs = window.avisos ? avisos.list() : [];
    const cards = list.map((f) => {
        const p = cache.paradaByCode.get(f.codigo) || { codigo: f.codigo, nombre: f.nombre };
        const r = results?.get(f.codigo);
        if (r && r.status === 'fulfilled') return stopCardHTML(p, { tiempos: r.value.tiempos || [], status: r.value.upstream_status || 'ok', limit: 5, fav: f });
        // Sin respuesta fresca todavía (o falló): si hay tiempos guardados recientes, se enseñan ya
        const u = recientes(f.codigo);
        if (u) return stopCardHTML(p, { tiempos: u.tiempos || [], status: 'ok', limit: 5, fav: f });
        if (r && r.status === 'rejected') return stopCardHTML(p, { tiempos: [], status: 'error', fav: f });
        return stopCardHTML(p, { fav: f });
      }).join('');
    const marco = `${list.map((f) => f.codigo).join(',')}|${avs.map((a) => a.id + ':' + a.at).join(',')}`;
    if (el.__marco === marco && $('#fav-cards', el)) {
      setHTML($('#fav-cards', el), cards);
      const nb = $('#fav-noche', el); if (nb) setHTML(nb, nocturnasHTML());
      const sb = $('#fav-saldo', el); if (sb) setHTML(sb, tarjetasBajasHTML());
      const cd = $('#fav-caduca', el); if (cd) setHTML(cd, tarjetasCaducanHTML());
      const ob = $('#fav-offline', el); if (ob) setHTML(ob, offlineHTML());
      $('#fav-upd', el).textContent = results ? `Actualizado a las ${fmtClock()} · ${refreshNote()}` : '';
      return true;
    }
    el.__marco = marco;
    el.innerHTML = `<div class="stack view-anim"><div class="page-head row-between"><div><h1>Favoritas</h1><p>Tus paradas con los tiempos en directo.</p></div><a class="btn ghost sm" href="#ruta">${ICON.route}Cómo llegar</a></div>
      <div id="fav-offline">${offlineHTML()}</div>
      ${servicioHoyHTML()}
      ${avs.length ? `<div class="set-group"><h3>Avisos de llegada</h3>${avs.map((a) => `<div class="row-flat"><a class="av-ll-link" href="#parada-${esc(a.codigo)}">${badge(a.linea, lineaFor(a.linea)?.color, { sm: true })}<div style="flex:1;min-width:0"><b>${esc(a.parada)}</b><p class="help">Cuando falten ${a.antes} min · sobre las ${new Date(a.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</p></div></a><button class="back-btn" type="button" data-av-del="${a.id}" aria-label="Quitar aviso">${ICON.close}</button></div>`).join('')}</div>` : ''}
      ${saludoFiestaHTML()}
      <div id="fav-noche">${nocturnasHTML()}</div>
      <div id="fav-avisos"></div>
      <div id="fav-saldo">${tarjetasBajasHTML()}</div>
      <div id="fav-caduca">${tarjetasCaducanHTML()}</div>
      <div class="stack" id="fav-cards">${cards}</div>
      <p class="updated" id="fav-upd">${results ? `Actualizado a las ${fmtClock()} · ${refreshNote()}` : ''}</p>
      <p class="small muted" style="text-align:center;margin:0">Toca un autobús para que te avise cuando esté llegando.</p></div>`;
    $('#fav-cards', el).__h = cards;
    el.querySelectorAll('[data-av-del]').forEach((b) => { b.onclick = async () => { await avisos.cancelar(Number(b.dataset.avDel)); toast('Aviso quitado'); paint(); }; });
    pintarAvisos();
    return true;
  }
  async function load() {
    const list = favs.list();
    if (!list.length || loading) return;
    loading = true; spin(true);
    if (!results) results = new Map();
    try {
      getLineas().catch(() => null);   // en paralelo: no bloquea los tiempos
      // Cada parada se pinta en cuanto responde, sin esperar a las demás (antes se esperaba a todas)
      await Promise.all(list.map(async (f) => {
        try {
          const v = await api(`/paradas/${encodeURIComponent(f.codigo)}/tiempos`);
          results.set(f.codigo, { status: 'fulfilled', value: v });
          ultimosTiempos.set(f.codigo, v.tiempos || []); window.avisos?.actualizar(f.codigo, v.tiempos);
        } catch (e) {
          results.set(f.codigo, { status: 'rejected', reason: e });
        }
        if (!dead) paint();
      }));
      const vals = [...results.values()];
      const failed = vals.filter((r) => r.status === 'rejected');
      if (failed.length === vals.length && failed.length) { const u = $('#fav-upd', el); if (u) u.textContent = failed[0].reason.message; }
    } finally { loading = false; spin(false); }
  }
  function pintarAvisos() {
    window.avisosTussam?.favoritasHTML().then((h) => setHTML($('#fav-avisos', el), h)).catch(() => null);
  }
  window.addEventListener('bussev-avisos', pintarAvisos);
  getParadas().then(() => { if (paint()) load(); actualizarWidget(); }).catch(() => { if (paint()) load(); });
  getLineas().then(() => { if (!dead) { const nb = $('#fav-noche', el); if (nb) setHTML(nb, nocturnasHTML()); } }).catch(() => null);
  stop = autoRefresh(load);
  active.rerender = () => { el.__marco = null; if (paint()) load(); };
  return { cleanup: () => { dead = true; stop?.(); window.removeEventListener('bussev-avisos', pintarAvisos); }, refresh: load };
};

/* ---------- Mapa: paradas, línea elegida y hoja inferior ---------- */
const mapState = { bm: null, me: null, sel: null, pin: null, markers: null, lineMarkers: null, line: null, stopTimer: null, reload: null, linea: null, sentido: 1 };
/* La hoja de la parada se pliega tocando la barrita o deslizando hacia abajo */
function bindSheetGestures(sheet) {
  const alto = () => sheet.offsetHeight || 400;
  const snaps = () => [0, Math.round(alto() * 0.42), alto() - 124];   // completo, mitad, pequeño
  let y = snaps()[1];
  const poner = (v, anim = true) => {
    const [, , peq] = snaps();
    y = Math.max(0, Math.min(peq, v));
    sheet.classList.toggle('dragging', !anim);
    sheet.style.transform = `translateY(${y}px)`;
    sheet.classList.toggle('collapsed', y >= peq - 4);
    mapState.sheetVisible = alto() - y;
    $('#sh-grip')?.setAttribute('aria-expanded', String(y < peq - 4));
  };
  mapState.sheetTo = (n) => poner(snaps()[n]);
  mapState.sheetCollapsed = () => y >= snaps()[2] - 4;
  poner(y, false);
  requestAnimationFrame(() => poner(snaps()[1]));
  $('#sh-grip').onclick = () => { const [, mid, peq] = snaps(); poner(y >= peq - 4 ? mid : y > 4 ? 0 : peq); };
  let y0 = null, ys = 0, t0 = 0;
  const down = (e) => { if (e.target.closest('button:not(#sh-grip),a')) return; y0 = e.clientY; ys = y; t0 = performance.now(); e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (y0 == null) return; poner(ys + (e.clientY - y0), false); };
  const up = (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0, vel = dy / Math.max(1, performance.now() - t0);
    y0 = null;
    if (Math.abs(dy) < 6) return;   // ha sido un toque, no un arrastre
    const sn = snaps();
    // El destino se calcula desde la posición ACTUAL (y), no desde donde empezó el arrastre:
    // así, al bajar la hoja del todo, se queda abajo en vez de rebotar a la mitad.
    let destino;
    if (vel > 0.5) destino = sn.find((v) => v > y + 4) ?? sn[sn.length - 1];        // lanzada hacia abajo → siguiente tope por debajo (o el más bajo)
    else if (vel < -0.5) destino = [...sn].reverse().find((v) => v < y - 4) ?? sn[0]; // lanzada hacia arriba → siguiente tope por encima (o arriba del todo)
    else destino = sn.reduce((best, v) => (Math.abs(v - y) < Math.abs(best - y) ? v : best), sn[0]); // sin impulso → el tope más cercano
    poner(destino);
  };
  for (const zone of [$('#sh-grip'), $('#sh-head')]) {
    zone.addEventListener('pointerdown', down);
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
  }
}
function closeSheet() {
  mapState.stopTimer?.(); mapState.stopTimer = null;
  mapState.sel = null;
  mapState.markers?.clear();
  mapState.bm?.source('bs-paths', fc([]));
  if (mapState.pin) { mapState.pin.remove(); mapState.pin = null; }
  $('#map-sheet').hidden = true;
  if (mapState.linea) mapState.line.resume();   // los buses de zona están desactivados: solo se ven al elegir línea
}
function selectStop(p) {
  const bm = mapState.bm;
  const sheet = $('#map-sheet');
  mapState.sel = p;
  mapState.stopTimer?.();
  if (mapState.linea) mapState.line.stop();
  mapState.zona?.ocultar();
  mapState.markers.clear();
  if (mapState.pin) mapState.pin.setLngLat(ll([p.latitud, p.longitud]));
  else mapState.pin = marker(bm, [p.latitud, p.longitud], stopPinEl(), null);
  const fb = favButton(p, () => {});
  sheet.hidden = false;
  sheet.classList.remove('collapsed');
  sheet.innerHTML = `<button class="sheet-grip-btn" type="button" id="sh-grip" aria-label="Plegar o desplegar"><span class="sheet-grip"></span></button>
    <div class="sheet-head" id="sh-head">
      <div style="flex:1;min-width:0"><h3>${esc(p.nombre)}</h3><p>Parada ${esc(p.codigo)}${p.direccion_completa ? ' · ' + esc(p.direccion_completa) : ''}</p></div>
      ${fb.html}
      <button class="back-btn" type="button" id="sh-close" aria-label="Cerrar">${ICON.close}</button>
    </div>
    <div class="chips-wrap" id="sh-lines" style="margin-top:6px"></div>
    <div id="sh-board"><div class="board-empty" style="border:0">Cargando tiempos…</div></div><p class="updated" id="sh-upd" style="text-align:left"></p>
    <div class="sheet-actions">${settings.voz ? `<button class="btn ghost" type="button" data-speak="${esc(p.codigo)}">🔊 Escuchar</button>` : ''}<a class="btn ghost" href="#parada-${esc(p.codigo)}">Ver parada</a></div>`;
  fb.bind(sheet);
  bindSheetGestures(sheet);
  $('#sh-close').onclick = closeSheet;
  api(`/paradas/${encodeURIComponent(p.codigo)}/lineas`).then((nums) => {
    if (mapState.sel !== p) return;
    $('#sh-lines').innerHTML = nums.map((n) => `<button type="button" class="line-pick" style="opacity:1" data-mapline="${esc(n)}">${badge(n, lineaFor(n)?.color, { sm: true })}</button>`).join('');
    $('#sh-lines').querySelectorAll('[data-mapline]').forEach((b) => { b.onclick = () => { closeSheet(); chooseMapLine(b.dataset.mapline); }; });
  }).catch(() => null);
  bm.m.easeTo({ center: ll([p.latitud, p.longitud]), zoom: Math.max(bm.m.getZoom(), 16), duration: animMs(350) });
  let first = true;
  async function load() {
    if (mapState.sel !== p) return;
    spin(true);
    try {
      const d = await api(`/paradas/${encodeURIComponent(p.codigo)}/tiempos`);
      if (mapState.sel !== p) return;
      await getLineas().catch(() => null);
      ultimosTiempos.set(p.codigo, d.tiempos || []); window.avisos?.actualizar(p.codigo, d.tiempos);
      setHTML($('#sh-board'), boardHTML(d.tiempos, d.upstream_status || 'ok', { limit: 6, codigo: p.codigo }));
      $('#sh-upd').textContent = `${d.upstream_status && d.upstream_status !== 'ok' ? 'TUSSAM no responde' : 'En directo'} · ${fmtClock()}`;
      const buses = await estimateBuses(p.codigo, d.tiempos);
      if (mapState.sel !== p) return;
      drawApproaching(bm, mapState.markers, buses);
      if (first && buses.length) {
        first = false;
        bm.fit([[p.latitud, p.longitud], ...buses.slice(0, 4).map((b) => b.pos)], { padding: { top: 90, left: 40, right: 40, bottom: (mapState.sheetVisible || sheet.offsetHeight * 0.58) + 30 }, anim: true });
      }
    } catch (e) {
      if (mapState.sel !== p) return;
      if (e.status === 429) {
        $('#sh-board').innerHTML = cargandoHTML('TUSSAM va saturado', 'Lo intentamos de nuevo en unos segundos…');
        setTimeout(() => { if (mapState.sel === p) load(); }, Math.max(4000, window.BusSevBackend.pausa + 500));
      } else $('#sh-board').innerHTML = `<div class="board-empty" style="border:0">${esc(e.message)}</div>`;
    } finally { spin(false); }
  }
  load();
  mapState.reload = load;
  mapState.stopTimer = autoRefresh(load);
}
function renderLineBar() {
  const bar = $('#map-linebar');
  if (!mapState.linea) {
    bar.innerHTML = `<button class="map-chip" type="button" id="ml-pick">${ICON.route}<span class="txt">Ver una línea</span></button><a class="map-chip" href="#ruta">${ICON.pin}<span class="txt">Cómo llegar</span></a>`;
    $('#ml-pick').onclick = pickLineModal;
    return;
  }
  const l = mapState.linea;
  getRuta(l.numero).then((ruta) => {
    const sentidos = Object.keys(ruta).map(Number).filter((s) => ruta[s]?.length).sort();
    const lastName = (s) => ruta[s]?.[ruta[s].length - 1]?.nombre || `Sentido ${s}`;
    const same = sentidos.length > 1 && new Set(sentidos.map(lastName)).size === 1;
    bar.innerHTML = `<div class="map-linecard">
      <div class="top">${badge(l.numero, l.color, { sm: true })}<b>${esc(l.nombre)}</b>
        <button class="x" type="button" id="ml-change" aria-label="Elegir otra línea">${ICON.route}</button>
        <button class="x" type="button" id="ml-close" aria-label="Quitar la línea del mapa">${ICON.close}</button></div>
      ${sentidos.length > 1 ? `<div class="seg">${sentidos.map((s) => `<button type="button" data-ms="${s}" aria-pressed="${s === mapState.sentido}" aria-label="${esc(same ? (s === 1 ? 'Ida' : 'Vuelta') : 'Hacia ' + lastName(s))}">${same ? `<span class="dst">${s === 1 ? 'Ida' : 'Vuelta'}</span>` : `<small>Hacia</small><span class="dst">${esc(lastName(s))}</span>`}</button>`).join('')}</div>` : ''}
      <div class="live" id="ml-live"></div></div>`;
    $('#ml-close').onclick = () => { mapState.line.clear(); mapState.linea = null; renderLineBar(); };
    $('#ml-change').onclick = pickLineModal;
    bar.querySelectorAll('[data-ms]').forEach((b) => { b.onclick = () => { mapState.sentido = Number(b.dataset.ms); renderLineBar(); mapState.line.show(l, mapState.sentido); }; });
  });
}
async function chooseMapLine(numero) {
  await getLineas().catch(() => null);
  const l = lineaFor(numero);
  if (!l) return;
  if (location.hash !== '#mapa') { mapState.pending = l.numero; location.hash = 'mapa'; return; }
  const ruta = await getRuta(l.numero);
  mapState.linea = l;
  mapState.zona?.ocultar();
  mapState.sentido = ruta[mapState.sentido]?.length ? mapState.sentido : Number(Object.keys(ruta)[0]);
  renderLineBar();
  mapState.line.show(l, mapState.sentido);
}
async function pickLineModal() {
  const lineas = await getLineas().catch(() => []);
  openModal(`<h2>¿Qué línea quieres ver?</h2><p class="help">Verás su recorrido y dónde están ahora sus autobuses.</p>
    <div class="line-grid">${lineas.map((l) => `<button class="line-pick" style="opacity:1" type="button" data-pl="${esc(l.numero)}" aria-label="Línea ${esc(l.numero)}: ${esc(l.nombre)}">${badge(l.numero, l.color)}</button>`).join('')}</div>`,
  (m, close) => { m.querySelectorAll('[data-pl]').forEach((b) => { b.onclick = () => { close(); closeSheet(); chooseMapLine(b.dataset.pl); }; }); });
}
let mapCompleto = false;
function mapaPantallaCompleta(on) {
  mapCompleto = on;
  document.documentElement.classList.toggle('mapa-tab-completo', on);
  document.documentElement.classList.toggle('con-mapa-completo', on);
  const b = $('#btn-mapfull');
  if (b) { b.innerHTML = on ? ICON.close : ICON.expand; b.setAttribute('aria-label', on ? 'Salir de pantalla completa' : 'Ver el mapa en pantalla completa'); }
  vibrar(10);
  setTimeout(() => mapState.bm?.m.resize(), 60);
}
function pintarBotonBuses() {
  const b = $('#btn-buses');
  if (!b) return;
  b.setAttribute('aria-pressed', String(!!settings.liveLines));
  b.setAttribute('aria-label', settings.liveLines ? 'Ocultar los autobuses en directo' : 'Ver los autobuses en directo');
}
/* Autobuses en directo en la zona del mapa que estás mirando (sin elegir línea).
   Para no saturar a TUSSAM se pregunta solo en 3-4 paradas repartidas por la pantalla
   (cada una da los próximos autobuses de todas sus líneas), y solo con el mapa cerca y a la vista. */
function zonaBuses(bm, markers, onStatus) {
  let seq = 0, parar = null, deb = 0, ultima = null;
  const ZOOM_MIN = 14.3, MAX_PARADAS = 4;
  // Desactivado a propósito: los autobuses en directo solo se muestran al ELEGIR una línea, no en toda la zona del mapa.
  const puede = () => false;
  function ocultar() { seq++; clearTimeout(deb); markers.clear(); onStatus(''); window.BusSevBackend.cancelarFondo?.(); }
  function elegir(lista, centro) {
    if (!lista.length) return [];
    const d = (a, b) => (a.latitud - b[0]) ** 2 + ((a.longitud - b[1]) * 0.8) ** 2;
    const out = [lista.reduce((m, p) => (d(p, centro) < d(m, centro) ? p : m))];
    const n = bm.m.getZoom() >= 16 ? 3 : MAX_PARADAS;
    while (out.length < n && out.length < lista.length) {
      let mejor = null, md = -1;
      for (const p of lista) { const x = Math.min(...out.map((q) => d(p, [q.latitud, q.longitud]))); if (x > md) { md = x; mejor = p; } }
      if (!mejor || md < 1e-6) break;
      out.push(mejor);
    }
    return out;
  }
  async function cargar(forzar = false) {
    if (!puede()) { if (!mapState.sel && !mapState.linea) ocultar(); return; }
    if (!appVisible) return;
    const c = bm.m.getCenter();
    if (bm.m.getZoom() < ZOOM_MIN) { seq++; markers.clear(); onStatus(busIco() + ' Acércate un poco para ver los autobuses', true); return; }
    // Si apenas has movido el mapa y es reciente, no se vuelve a preguntar
    if (!forzar && ultima && Date.now() - ultima.at < 20_000 && haversine([c.lat, c.lng], ultima.c) < 250) return;
    const my = ++seq;
    const b = bm.m.getBounds();
    const lista = (await getParadas().catch(() => [])).filter((p) => b.contains([p.longitud, p.latitud]));
    const elegidas = elegir(lista, [c.lat, c.lng]);
    if (!elegidas.length) { markers.clear(); onStatus('No hay paradas en esta zona'); return; }
    ultima = { at: Date.now(), c: [c.lat, c.lng] };
    if (!markers.items.size) onStatus(`${cargandoMini()} Buscando autobuses en esta zona…`, true);
    const vistos = new Map();
    let ok = 0, limitado = false;
    await Promise.all(elegidas.map((p) => api(`/paradas/${encodeURIComponent(p.codigo)}/tiempos`, { prioridad: 'baja', maxEdad: 25_000 })
      .then(async (d) => {
        ok++;
        const buses = await estimateBuses(p.codigo, d.tiempos);
        for (const x of buses) {
          const k = x.vehiculo != null ? `v${x.vehiculo}` : `${x.linea}|${Math.round(x.pos[0] * 3000)}|${Math.round(x.pos[1] * 3000)}`;
          const cur = vistos.get(k);
          if (!cur || x.dist < cur.dist) vistos.set(k, x);
        }
        if (my === seq && puede()) markers.sync([...vistos.values()], null, null, { parcial: true });
      }).catch((e) => { if (e.status === 429) limitado = true; })));
    if (my !== seq || !puede()) return;
    const todos = [...vistos.values()];
    if (ok) markers.sync(todos);
    onStatus(busIco() + ' ' + (ok === 0
      ? (limitado ? 'TUSSAM va saturado: los autobuses saldrán en un momento' : 'No se ha podido consultar a TUSSAM')
      : `${todos.length ? `${todos.length} ${todos.length === 1 ? 'autobús' : 'autobuses'} cerca` : 'Ningún autobús cerca ahora'} · ${fmtClock()}`), true);
  }
  bm.m.on('moveend', () => { clearTimeout(deb); if (puede()) deb = setTimeout(() => cargar(false), 1300); });
  return {
    cargar, ocultar,
    empezar() { parar?.(); parar = autoRefresh(() => cargar(true), { min: REFRESH_LINE_MIN }); cargar(true); },
    parar() { parar?.(); parar = null; clearTimeout(deb); seq++; window.BusSevBackend.cancelarFondo?.(); },
  };
}
views.mapa = (el) => {
  if (!mapState.bm) {
    const bm = mapState.bm = createMap($('#map-all', el), SEVILLA, 14);
    if (!bm) return {};
    mapState.markers = new MarkerSet(bm);
    mapState.lineMarkers = new MarkerSet(bm);
    addStopDots(bm, selectStop);
    addRouteLayers(bm);
    mapState.line = lineController(bm, mapState.lineMarkers, { onStatus: (t, html) => { const n = $('#ml-live'); if (n) { if (html) n.innerHTML = t; else n.textContent = t; } } });
    $('#btn-locate', el).onclick = async () => {
      try {
        const pos = await getPosition(true);
        if (mapState.me) mapState.me.setLngLat(ll(pos)); else mapState.me = marker(bm, pos, meEl(), null, 'center');
        bm.m.easeTo({ center: ll(pos), zoom: 17, duration: animMs(450) });
      } catch (err) { toast(geoErrorText(err)); }
    };
    if (store.get('geoOk', false)) getPosition().then((pos) => { mapState.me = marker(bm, pos, meEl(), null, 'center'); bm.m.jumpTo({ center: ll(pos), zoom: 16 }); }).catch(() => null);
    mapState.zona = zonaBuses(bm, new MarkerSet(bm), (t, html) => { const n = $('#map-zona'); if (!n) return; n.hidden = !t; if (html) n.innerHTML = t; else n.textContent = t || ''; });
    renderLineBar();
  } else {
    if (mapState.sel) { mapState.reload?.(); mapState.stopTimer?.(); mapState.stopTimer = autoRefresh(() => mapState.reload?.()); } else if (mapState.linea) mapState.line.resume();
  }
  pintarBotonBuses();
  $('#btn-buses', el).onclick = () => {
    settings.liveLines = !settings.liveLines; saveSettings(); vibrar(12);
    pintarBotonBuses();
    toast(settings.liveLines ? (mapState.linea ? 'Autobuses en directo activados' : 'Activado · elige una línea para ver sus autobuses') : 'Autobuses en directo desactivados');
    if (settings.liveLines) { if (mapState.linea && !mapState.sel) { mapState.line.stop(); mapState.line.resume(); } }
    else { mapState.zona?.ocultar(); mapState.line?.stop(); mapState.lineMarkers?.clear(); spin(false); const n = $('#ml-live'); if (n) n.innerHTML = 'Autobuses en directo desactivados (botón ' + busIco() + ' del mapa).'; }
  };
  $('#btn-mapfull', el).onclick = () => mapaPantallaCompleta(!mapCompleto);
  if (mapState.pending) { const n = mapState.pending; mapState.pending = null; chooseMapLine(n); }
  requestAnimationFrame(() => mapState.bm?.m.resize());
  return {
    back: () => {
      if (mapState.sel) { if (!mapState.sheetCollapsed?.()) mapState.sheetTo?.(2); else closeSheet(); return true; }
      if (mapCompleto) { mapaPantallaCompleta(false); return true; }
      if (mapState.linea) { mapState.line.clear(); mapState.linea = null; renderLineBar(); return true; }
      return false;
    },
    cleanup: () => { mapState.stopTimer?.(); mapState.stopTimer = null; mapState.line?.stop(); mapState.zona?.parar(); if (mapCompleto) mapaPantallaCompleta(false); },
    refresh: () => {
      if (mapState.sel) return mapState.reload?.();
      if (!settings.liveLines) { toast('Los autobuses en directo están desactivados'); return; }
      return mapState.linea ? mapState.line?.live() : null;   // buses solo con una línea elegida
    },
  };
};

/* ---------- Líneas ---------- */
const FAMILIAS = [
  { id: 'todas', label: 'Todas', test: () => true },
  { id: 'urbanas', label: 'Urbanas', test: (l) => /^\d/.test(l.numero) },
  { id: 'circulares', label: 'Circulares', test: (l) => /^C\d/.test(l.numero) },
  { id: 'nocturnas', label: 'Nocturnas', test: (l) => l.nocturna || /^A\d/.test(l.numero) },
  { id: 'otras', label: 'Especiales y tranvía', test: (l) => !/^\d/.test(l.numero) && !/^C\d/.test(l.numero) && !/^A\d/.test(l.numero) },
];
views.lineas = (el) => {
  let fam = store.get('fam', 'todas');
  async function load() {
    el.innerHTML = skeletons(2);
    try {
      const lineas = await getLineas();
      const render = () => {
        const f = FAMILIAS.find((x) => x.id === fam) || FAMILIAS[0];
        const rows = lineas.filter(f.test).map((l) => `<a class="row" href="#linea-${esc(l.numero)}">${badge(l.numero, l.color)}
            <div class="row-main"><b>${esc(l.nombre)}</b><span>${l.hora_inicio_ida && l.hora_fin_ida ? `Primer y último bus: ${esc(l.hora_inicio_ida)}–${esc(l.hora_fin_ida)}` : 'Consulta el recorrido'}</span></div>${ICON.chev}</a>`).join('');
        el.innerHTML = `<div class="stack"><div class="page-head"><h1>Líneas</h1><p>Recorrido, horario y autobuses en directo.</p></div>
          <div class="filters" role="group" aria-label="Tipo de línea">${FAMILIAS.map((x) => `<button class="chip" type="button" data-fam="${x.id}" aria-pressed="${x.id === fam}">${x.label}</button>`).join('')}</div>
          <div class="list">${rows || '<div class="board-empty">No hay líneas en este grupo.</div>'}</div>
          <p class="updated">${lineas.length} líneas de TUSSAM</p></div>`;
        el.querySelectorAll('[data-fam]').forEach((b) => { b.onclick = () => { fam = b.dataset.fam; store.set('fam', fam); render(); }; });
      };
      render();
    } catch (e) { el.innerHTML = errorHTML(e, 'retry-lin'); $('#retry-lin', el).onclick = load; }
  }
  load();
  return {};
};

/* ---------- Detalle de línea ---------- */
views.linea = (el, numero) => {
  let bm = null, dead = false, ctl = null, sentido = 1, avisoListener = null;
  el.innerHTML = backHead(`<div class="grow"><h2>Línea ${esc(numero)}</h2></div>`) + skeletons(2);
  $('.back-btn', el).onclick = goBack;
  async function init() {
    try {
      await getLineas();
      const l = lineaFor(numero);
      if (!l) throw new ApiError(`La línea ${numero} no existe.`, 404);
      const lc = safeColor(l.color, '#555555');
      const ruta = await getRuta(l.numero);
      if (dead) return;
      const sentidos = Object.keys(ruta).map(Number).filter((s) => ruta[s]?.length).sort();
      sentido = sentidos[0];
      const lastName = (s) => ruta[s]?.[ruta[s].length - 1]?.nombre || `Sentido ${s}`;
      const sameEnd = sentidos.length > 1 && new Set(sentidos.map(lastName)).size === 1;
      const segLabel = (s) => (sameEnd ? (s === 1 ? 'Ida' : 'Vuelta') : `Hacia ${lastName(s)}`);
      el.innerHTML = `<div class="stack">
        ${backHead(`<div class="grow" style="display:flex;gap:12px;align-items:flex-start"><div style="margin-top:6px">${badge(l.numero, lc)}</div><div style="min-width:0"><h2 style="margin-top:4px">${esc(l.nombre)}</h2><p id="l-horario"></p></div></div>`)}
        <div id="l-av-banner">${window.avisosTussam?.bannerHTML([l.numero]) || ''}</div>
        ${sentidos.length > 1 ? `<div class="seg" role="group" aria-label="Sentido">${sentidos.map((s) => `<button type="button" data-s="${s}" aria-pressed="${s === sentido}">${esc(segLabel(s))}</button>`).join('')}</div>` : ''}
        <div><div class="map-wrap"><div class="map-box" id="l-map"></div>
          <button class="map-buses-btn" type="button" id="l-buses" aria-pressed="${settings.liveLines}" aria-label="${settings.liveLines ? 'Ocultar los autobuses en directo' : 'Ver los autobuses en directo'}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M4 11h16M8 21v-3M16 21v-3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="8" cy="14.5" r="1.1" fill="currentColor"/><circle cx="16" cy="14.5" r="1.1" fill="currentColor"/><path class="tachon" d="M3 3l18 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button><a id="l-desvio" class="map-desvio" href="#avisos" hidden>⚠️ Posible desvío · ver aviso</a></div><p class="live-note" id="l-live"></p></div>
        <a class="btn ghost block" href="#mapa" id="l-open-map">${ICON.route}Ver en el mapa grande</a>
        <p class="live-note" style="margin:0"><img class="lg-busimg" src="${busImg()}" alt="" style="height:16px;vertical-align:-3px"> = parada a la que se acerca un autobús (y los minutos que le faltan) · Nº = número de la parada (el del poste)</p>
        <ol class="timeline" id="l-stops" style="--lc:${lc}"></ol>
      </div>`;
      $('.back-btn', el).onclick = goBack;
      $('#l-open-map', el).onclick = (e) => { e.preventDefault(); mapState.sentido = sentido; chooseMapLine(l.numero); };
      // #25 Botón para encender/apagar los autobuses en directo también en la pestaña Líneas
      $('#l-buses', el).onclick = () => {
        settings.liveLines = !settings.liveLines; saveSettings(); vibrar(12);
        const on = settings.liveLines, b = $('#l-buses', el);
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', on ? 'Ocultar los autobuses en directo' : 'Ver los autobuses en directo');
        pintarBotonBuses();   // mantiene en sincronía el botón del mapa principal
        toast(on ? 'Autobuses en directo activados' : 'Autobuses en directo desactivados');
        if (ctl && bm) bm.ready.then(() => { if (!dead) ctl.show(l, sentido); }); else drawTimeline([]);
      };
      bm = createMap($('#l-map', el), SEVILLA, 12);
      /* Nombre en dos líneas: «Camino de los Descubrimientos» y debajo «Torre Sevilla» */
      const partirNombre = (n) => { const m = String(n).match(/^(.*?)\s*\(([^()]+)\)\s*$/); return m ? [m[1], m[2]] : [String(n), '']; };
      const lpp = new Map();   // parada -> líneas que paran (sin esta)
      let ultimosBuses = [];
      const cargarLpp = async () => {
        const stops = ruta[sentido] || [];
        await Promise.all(stops.filter((p) => !lpp.has(p.codigo)).map(async (p) => {
          const ls = await api(`/paradas/${encodeURIComponent(p.codigo)}/lineas`).catch(() => []);
          lpp.set(p.codigo, ls.map((n) => lineaFor(n)?.numero || String(n)).filter((n) => n !== l.numero).sort(ordenLineas));
        }));
        if (!dead) drawTimeline(ultimosBuses);
      };
      const drawTimeline = (buses = []) => {
        ultimosBuses = buses;
        const stops = ruta[sentido] || [];
        const bySeg = new Map();
        for (const b of buses) { if (!bySeg.has(b.seg)) bySeg.set(b.seg, []); bySeg.get(b.seg).push(b); }
        $('#l-stops', el).innerHTML = stops.map((p, i) => {
          const bs = bySeg.get(i) || [];
          const mins = bs.map((b) => b.min).sort((x, y) => x - y);
          const llega = !bs.length ? '' : mins[0] <= 0 ? 'llegando' : `${mins.filter((x) => x > 0).slice(0, 2).join(' · ')} min`;
          const [nom, sub] = partirNombre(p.nombre);
          const otras = lpp.get(p.codigo) || [];
          return `<li><a href="#parada-${esc(p.codigo)}"><span class="dot${bs.length ? ' bus' : ''}"></span><span class="tl-txt"><b>${esc(nom)}</b>${sub ? `<span class="tl-sub">${esc(sub)}</span>` : ''}${otras.length ? `<span class="tl-lineas">${otras.slice(0, 8).map((n) => badge(etiquetaLinea(n), lineaFor(n)?.color, { sm: true })).join('')}${otras.length > 8 ? `<span class="tl-mas">+${otras.length - 8}</span>` : ''}</span>` : ''}</span><span class="tl-der">${bs.length ? `<span class="bus-tag">${llega}</span>` : ''}<span class="num-tag">Nº ${esc(p.codigo)}</span></span></a></li>`;
        }).join('') || '<li class="board-empty">No hay paradas para este sentido.</li>';
      };
      if (bm) {
        addRouteLayers(bm);
        bm.m.on('click', 'bs-route-stops', (e) => { const c = e.features?.[0]?.properties?.codigo; if (c) location.hash = `parada-${c}`; });
        ctl = lineController(bm, new MarkerSet(bm), { onStatus: (t, html) => { const n = $('#l-live', el); if (n) { if (html) n.innerHTML = t; else n.textContent = t; } }, onBuses: drawTimeline });
      }
      const draw = () => {
        const stops = ruta[sentido] || [];
        const ini = sentido === 2 ? l.hora_inicio_vuelta : l.hora_inicio_ida;
        const fin = sentido === 2 ? l.hora_fin_vuelta : l.hora_fin_ida;
        $('#l-horario', el).textContent = ini && fin ? `Primer bus ${ini} · último ${fin} · ${stops.length} paradas` : `${stops.length} paradas`;
        drawTimeline(); cargarLpp();
        el.querySelectorAll('[data-s]').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.s) === sentido));
        if (ctl) bm.ready.then(() => { if (!dead) ctl.show(l, sentido); });
      };
      el.querySelectorAll('[data-s]').forEach((b) => { b.onclick = () => { sentido = Number(b.dataset.s); draw(); }; });
      active.refresh = () => ctl?.live();
      draw();
      // #56 Desvíos: si esta línea tiene un aviso de TUSSAM, se marca en el mapa (recorrido discontinuo + pastilla)
      const pintarDesvio = () => {
        if (dead) return;
        const avs = window.avisosTussam?.avisosDeLinea?.(l.numero) || [];
        const banner = $('#l-av-banner', el); if (banner) setHTML(banner, window.avisosTussam?.bannerHTML([l.numero]) || '');
        const pill = $('#l-desvio', el);
        if (pill) { pill.hidden = !avs.length; if (avs.length) pill.onclick = (e) => { e.preventDefault(); window.avisosTussam?.abrir?.(avs[0].id); }; }
        if (bm && avs.length) bm.ready?.then(() => { if (!dead) { try { bm.m.setPaintProperty('bs-route', 'line-dasharray', [2, 1.5]); } catch { /* el estilo aún no está */ } } });
      };
      pintarDesvio();
      avisoListener = pintarDesvio;
      window.addEventListener('bussev-avisos', pintarDesvio);
      window.avisosTussam?.revisar?.().catch(() => null);   // asegura que los avisos estén cargados
    } catch (e) {
      if (dead) return;
      el.innerHTML = backHead() + errorHTML(e, 'retry-l');
      $('.back-btn', el).onclick = goBack;
      $('#retry-l', el).onclick = init;
    }
  }
  init();
  return { cleanup: () => { dead = true; if (avisoListener) window.removeEventListener('bussev-avisos', avisoListener); ctl?.clear(); bm?.remove(); } };
};

/* ---------- Detalle de parada ---------- */
/* Líneas elegidas en una parada: si es favorita, las de la favorita (se comparten con Favoritas) */
const lineasParada = {
  get(c) { const f = favs.get(c); return f ? (f.lineas || []) : (store.get('paradaLineas', {})[c] || []); },
  set(c, l) {
    if (favs.has(c)) { favs.update(c, { lineas: l }); return; }
    const m = store.get('paradaLineas', {});
    if (l.length) m[c] = l; else delete m[c];
    const ks = Object.keys(m); if (ks.length > 150) delete m[ks[0]];
    store.set('paradaLineas', m);
  },
};
views.parada = (el, codigo) => {
  let stop = null, bm = null, markers = null, info = null, dead = false, first = true, ultimo = null, lineasAqui = [], completo = false, reintento = 0;
  /* Mapa a pantalla completa (el botón Atrás también lo cierra) */
  function pantallaCompleta(on) {
    const w = $('#p-mapwrap', el);
    if (!w) return;
    completo = on;
    w.classList.toggle('mapa-completo', on);
    document.documentElement.classList.toggle('con-mapa-completo', on);
    const b = $('#p-full', el);
    if (b) { b.innerHTML = on ? ICON.close : ICON.expand; b.setAttribute('aria-label', on ? 'Salir de pantalla completa' : 'Ver el mapa en pantalla completa'); }
    vibrar(10);
    setTimeout(() => bm?.m?.resize(), 60);
  }
  el.innerHTML = backHead(`<div class="grow"><h2>Parada ${esc(codigo)}</h2></div>`) + skeletons(2);
  $('.back-btn', el).onclick = goBack;
  function headHTML() {
    const fb = favButton(info, () => paintTools());
    // Accesibilidad de la parada (del GTFS oficial, si TUSSAM lo publica): 1 = accesible, 0 = no accesible.
    const acc = info.accesible === 1
      ? `<span class="pill pill-acc" title="Parada accesible para silla de ruedas">${ICON.silla}Accesible</span>`
      : info.accesible === 0
        ? `<span class="pill pill-acc-no" title="Parada sin acceso para silla de ruedas">${ICON.silla}No accesible</span>`
        : '';
    return { fb, html: backHead(`<div class="grow"><h2>${esc(info.nombre)}</h2><p><span class="stop-num" style="display:inline-grid;height:22px;min-width:0;font-size:15px;vertical-align:-3px">${esc(codigo)}</span> ${esc(info.direccion_completa || '')}</p>${acc}</div>${fb.html}`) };
  }
  function paintTools() {
    const box = $('#p-tools', el);
    if (!box) return;
    const f = favs.get(codigo);
    box.innerHTML = f ? `<div class="fav-tools"><span class="pill" style="background:var(--accent-soft);color:var(--accent)">★ En favoritas${f.alias ? ': ' + esc(f.alias) : ''}</span><button class="btn ghost" type="button" data-edit-fav="${esc(codigo)}">${ICON.edit}Personalizar</button></div>` : '';
  }
  async function init() {
    try { await getParadas(); info = cache.paradaByCode.get(codigo) || await api(`/paradas/${encodeURIComponent(codigo)}`); } catch (e) {
      if (e.status === 404) { el.innerHTML = backHead() + emptyHTML(ICON.pin, `La parada ${esc(codigo)} no existe`, 'Comprueba el número que aparece en el poste de la parada.'); $('.back-btn', el).onclick = goBack; return; }
      info = { codigo, nombre: `Parada ${codigo}` };
    }
    if (dead) return;
    const h = headHTML();
    el.innerHTML = `<div class="stack">${h.html}<div id="p-tools"></div>
      <section class="card p-info"><h3 class="p-info-tit">Líneas que paran aquí</h3><div class="chips-wrap" id="p-lineas"><span class="muted small">Cargando…</span></div><div id="p-avisos"></div></section>
      <div id="p-filtro" class="lfiltro" hidden></div>
      <article class="card" id="p-board"><div class="board-empty">Cargando tiempos…</div></article>
      <div><div class="map-wrap" id="p-mapwrap"><div class="map-box" id="p-map"></div>
          <button class="map-full-btn" type="button" id="p-full" aria-label="Ver el mapa en pantalla completa">${ICON.expand}</button></div>
        <div class="map-legend"><span><i class="lg-stop"></i>Esta parada</span><span><img class="lg-busimg" src="${busImg()}" alt="">Autobús que viene</span><span><i class="lg-path"></i>Camino que le queda</span></div>
        <p class="small muted" id="p-map-note" style="margin:6px 2px 0"></p></div>
    </div>`;
    $('.back-btn', el).onclick = goBack;
    h.fb.bind(el);
    paintTools();
    active.rerender = () => { paintTools(); load(true); };
    $('#p-full', el).onclick = () => pantallaCompleta(!completo);
    if (info.latitud && info.longitud) {
      bm = createMap($('#p-map', el), [info.latitud, info.longitud], 16);
      if (bm) {
        markers = new MarkerSet(bm);
        addStopDots(bm, (p) => { if (p.codigo !== codigo) location.hash = `parada-${p.codigo}`; });
        addRouteLayers(bm);
        marker(bm, [info.latitud, info.longitud], stopPinEl(), `<b>${esc(info.nombre)}</b>`);
      }
    } else $('#p-map', el).parentElement.hidden = true;
    Promise.all([api(`/paradas/${encodeURIComponent(codigo)}/lineas`), getLineas().catch(() => null)]).then(([nums]) => {
      if (dead) return;
      nums = [...nums].sort(ordenLineas);
      $('#p-lineas', el).innerHTML = nums.length ? nums.map((n) => badge(etiquetaLinea(lineaFor(n)?.numero || n), lineaFor(n)?.color, { href: `#linea-${encodeURIComponent(n)}` })).join('') : '<span class="muted small">Sin datos de líneas.</span>';
      setHTML($('#p-avisos', el), window.avisosTussam?.bannerHTML(nums) || '');
      lineasAqui = nums.map((n) => lineaFor(n)?.numero || String(n));
      pintarFiltro();
    }).catch(() => { if (!dead) $('#p-lineas', el).innerHTML = '<span class="muted small">No se han podido cargar.</span>'; });
    await load();
    stop = autoRefresh(() => load(true));
  }
  /* Chips para elegir qué líneas ver en esta parada */
  function pintarFiltro() {
    const box = $('#p-filtro', el);
    if (!box) return;
    const enTiempos = (ultimo?.tiempos || []).map((t) => lineaFor(t.linea)?.numero || String(t.linea));
    const todas = [...new Set([...enTiempos, ...lineasAqui])].sort(ordenLineas);
    if (todas.length < 2) { box.hidden = true; return; }
    const sel = new Set(lineasParada.get(codigo).map((n) => lineaFor(n)?.numero || String(n)));
    const et = etiquetaLinea;
    setHTML(box, `<span class="lf-tit">Ver líneas</span><div class="lf-chips"><button type="button" class="chip" data-lf="" aria-pressed="${!sel.size}">Todas</button>${todas.map((n) => {
      const c = safeColor(lineaFor(n)?.color, '#555555');
      return `<button type="button" class="chip lchip" data-lf="${esc(n)}" aria-pressed="${sel.has(n)}" style="--lc:${c};--lt:${textOn(c)}"><i></i>${esc(et(n))}</button>`;
    }).join('')}</div>`);
    box.hidden = false;
    box.querySelectorAll('[data-lf]').forEach((b) => { b.onclick = () => {
      const n = b.dataset.lf;
      if (!n) sel.clear(); else if (sel.has(n)) sel.delete(n); else sel.add(n);
      if (sel.size === todas.length) sel.clear();
      lineasParada.set(codigo, [...sel]);
      vibrar(15);
      pintarFiltro(); paintTools();
      if (ultimo) pintar(ultimo, true);
    }; });
  }
  async function pintar(d, rapido = false) {
    const status = d.upstream_status || 'ok';
    const elegidas = lineasParada.get(codigo);
    const tiempos = elegidas.length ? filtrarLineas(d.tiempos, { lineas: elegidas }) : (d.tiempos || []);
    setHTML($('#p-board', el), `${boardHTML(tiempos, status, { codigo, filtrado: elegidas.length > 0 })}
        <div class="meta-row" style="padding-top:10px;border-top:1px solid var(--line)">${status === 'ok' ? freshnessPill(d) : '<span class="pill stale">TUSSAM no responde</span>'}<span>Actualizado <span class="p-hora"></span></span>${d?.via ? `<span class="muted">· ${d.via === 'api' ? 'vía API de TUSSAM' : 'vía tu servidor'}</span>` : ''}${settings.voz ? `<button class="link-btn" type="button" data-speak="${esc(codigo)}">🔊 Escuchar</button>` : ''}</div>
        <p class="small muted" style="margin:0;padding:0 14px 12px">Toca un autobús para que te avise cuando esté llegando.</p>`);
      const hora = $('#p-board .p-hora', el); if (hora) hora.textContent = fmtClock(d.__at);
      if (bm) {
        const buses = await estimateBuses(codigo, tiempos);
        if (dead) return;
        await bm.ready;
        drawApproaching(bm, markers, buses);
        if (first && buses.length) { first = false; bm.fit([[info.latitud, info.longitud], ...buses.slice(0, 4).map((b) => b.pos)], { padding: 50 }); }
        $('#p-map-note', el).textContent = buses.length
          ? 'Cada autobús aparece donde está ahora, calculado con la distancia que da TUSSAM. Toca uno para ver cuánto le falta.'
          : 'Cuando haya autobuses en camino, verás aquí por dónde vienen.';
      }
  }
  async function load(quiet = false) {
    if (dead || !info) return;
    spin(true);
    try {
      const d = await api(`/paradas/${encodeURIComponent(codigo)}/tiempos`);
      if (dead) return;
      await getLineas().catch(() => null);
      d.__at = new Date();
      ultimo = d;
      ultimosTiempos.set(codigo, d.tiempos || []); window.avisos?.actualizar(codigo, d.tiempos);
      if (!quiet && first && settings.voz && settings.vozAuto) hablar(textoParaVoz(favs.get(codigo)?.alias || info.nombre, filtrarLineas(d.tiempos, { lineas: lineasParada.get(codigo) })));
      pintarFiltro();
      await pintar(d);
    } catch (e) {
      if (dead) return;
      // TUSSAM pide esperar: se reintenta solo en cuanto deje (sin que tengas que tocar nada)
      if (e.status === 429) { clearTimeout(reintento); reintento = setTimeout(() => { if (!dead) load(true); }, Math.max(4000, window.BusSevBackend.pausa + 500)); }
      if (!quiet || !ultimo) $('#p-board', el).innerHTML = e.status === 429 ? cargandoHTML('TUSSAM va saturado', 'Lo intentamos de nuevo en unos segundos…') : `<div class="board-empty">${esc(e.message)}</div>`;
      else if (e.status !== 429) toast(e.message);
    } finally { spin(false); }
  }
  init();
  return {
    cleanup: () => { dead = true; clearTimeout(reintento); stop?.(); markers?.clear(); bm?.remove(); document.documentElement.classList.remove('con-mapa-completo'); },
    refresh: () => load(),
    back: () => { if (completo) { pantallaCompleta(false); return true; } return false; },
  };
};

/* ---------- Cerca ---------- */
views.cerca = (el) => {
  let pos = null, stop = null, loading = false, dead = false;
  /* ¿Está encendida la ubicación del móvil? Se pregunta al sistema: la respuesta es instantánea */
  const ubicacionActiva = async () => {
    if (!window.Capacitor?.isPluginAvailable?.('TarjetaNfc')) return true;
    try { return (await window.Capacitor.nativePromise('TarjetaNfc', 'ubicacion', {})).activada !== false; } catch { return true; }
  };
  const avisoGeoOff = () => `<div class="geo-off">${ICON.pin}<div><b>La ubicación del móvil está apagada</b><small>Enciéndela para ver las paradas que tienes cerca. En cuanto la actives, BusSev lo notará sola.</small></div><button class="btn sm" type="button" id="geo-on">Activar</button></div>`;
  const bindGeoOff = () => { $('#geo-on', el)?.addEventListener('click', () => window.Capacitor?.nativePromise('TarjetaNfc', 'ajustesUbicacion', {}).catch(() => toast('Abre los ajustes del móvil y enciende la ubicación.'))); };
  const intro = async () => {
    const on = await ubicacionActiva();
    if (dead) return;
    el.innerHTML = `<div class="stack">${on ? '' : avisoGeoOff()}${emptyHTML(ICON.pin, 'Paradas cerca de ti', 'Usa tu ubicación para ver las paradas más cercanas y cuánto le falta a cada autobús. Es opcional: también puedes buscar la parada arriba.', '<div class="btn-row" style="justify-content:center"><button class="btn" type="button" id="btn-geo">Usar mi ubicación</button><a class="btn ghost" href="#ruta">Cómo llegar</a></div>')}</div>`;
    $('#btn-geo', el).onclick = locate;
    bindGeoOff();
  };
  // Al volver de los ajustes del móvil, se comprueba otra vez sin tener que tocar nada
  const alVolver = async () => { if (dead || pos) return; if (await ubicacionActiva()) { if ($('#geo-on', el)) locate(); } };
  resumeHandlers.add(alVolver);
  async function locate() {
    if (!(await ubicacionActiva())) { if (!dead) { el.innerHTML = `<div class="stack">${avisoGeoOff()}${emptyHTML(ICON.pin, 'Paradas cerca de ti', 'Cuando enciendas la ubicación verás aquí las paradas más cercanas.', '<div class="btn-row" style="justify-content:center"><a class="btn ghost" href="#mapa">Ver el mapa</a><a class="btn ghost" href="#ruta">Cómo llegar</a></div>')}</div>`; bindGeoOff(); } return; }
    el.innerHTML = `<div class="stack view-anim">${cargandoHTML('Buscando paradas cerca de ti…', 'Un momento, localizando tu posición.')}</div>`;
    try { pos = await getPosition(); await load(); stop ??= autoRefresh(() => load(true)); } catch (err) {
      el.innerHTML = emptyHTML(ICON.pin, 'No sabemos dónde estás', esc(geoErrorText(err)), '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn" type="button" id="btn-geo">Reintentar</button><a class="btn ghost" href="#mapa">Ver el mapa</a></div>');
      $('#btn-geo', el).onclick = locate;
    }
  }
  async function load(quiet = false) {
    if (!pos || loading) return;
    loading = true; spin(true);
    try {
      const [lat, lon] = pos;
      const d = await api(`/cercanas?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&radio=600&max_paradas=6`);
      if (!d.paradas?.length) { el.innerHTML = emptyHTML(ICON.pin, 'No hay paradas a menos de 600 m', 'Prueba a buscar una parada por su nombre o número, o mira el mapa.', '<a class="btn" href="#mapa">Ver el mapa</a>'); return; }
      el.innerHTML = `<div class="stack"><div class="page-head row-between"><div><h1>Cerca de ti</h1><p>Paradas a menos de 600 m.</p></div><a class="btn ghost sm" href="#ruta">${ICON.route}Cómo llegar</a></div>
        ${d.paradas.map((p) => stopCardHTML(p, { tiempos: p.tiempos || [], status: p.tiempos_status, distancia: p.distancia })).join('')}
        <p class="updated">Actualizado a las ${fmtClock()} · ${refreshNote()}</p></div>`;
    } catch (e) {
      if (!quiet) { el.innerHTML = errorHTML(e, 'retry-cerca'); $('#retry-cerca', el).onclick = () => load(); } else toast(e.message);
    } finally { loading = false; spin(false); }
  }
  if (store.get('geoOk', false)) locate(); else intro();
  return { cleanup: () => { dead = true; stop?.(); resumeHandlers.delete(alVolver); }, refresh: () => (pos ? load() : locate()) };
};

/* ---------- Ajustes ---------- */
views.ajustes = (el) => {
  const segBtns = (name, opts, cur) => `<div class="seg" role="group">${opts.map(([v, t]) => `<button type="button" data-set="${name}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${t}</button>`).join('')}</div>`;
  const sw = (id, on, titulo, texto) => `<div class="switch-row"><div><h3>${titulo}</h3>${texto ? `<p>${texto}</p>` : ''}</div><input class="switch" type="checkbox" data-sw="${id}" ${on ? 'checked' : ''} aria-label="${esc(titulo)}"></div>`;
  const fechaCorta = (d) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  function render() {
    const tem = tematicaActiva();
    const y = new Date().getFullYear();
    const F = fechasTematicas(y), F2 = fechasTematicas(y + 1);
    const prox = (k) => { const [i, f] = F[k][1] >= new Date() ? F[k] : F2[k]; return `${fechaCorta(i)} – ${fechaCorta(f)}`; };
    const dc = window.BusSevBackend?.caduca ? new Date(window.BusSevBackend.caduca + 'T12:00') : null;
    el.innerHTML = `<div class="stack view-anim">
      ${backHead('<div class="grow"><h2>Ajustes</h2></div>')}
      <h2 class="section-title">Apariencia</h2>
      <div class="set-group"><h3>Tema</h3>${segBtns('theme', [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']], settings.theme)}
        <p>Automático sigue el modo claro u oscuro de tu móvil. El oscuro gasta menos batería en pantallas OLED.</p></div>
      <div class="set-group">
        ${sw('tematicaAuto', settings.tematicaAuto, 'Temáticas en fechas festivas', `Cambia sola en Navidad, Semana Santa, Feria y Halloween. Ahora: <b>${esc(TEMATICAS[tem].nombre)}</b>.`)}
        <div class="tem-grid">${Object.entries(TEMATICAS).map(([k, t]) => `<button type="button" class="tem${tem === k ? ' on' : ''}" data-tem="${k}" aria-pressed="${!settings.tematicaAuto && settings.tematica === k}">
          <span class="tem-prev" data-t="${k}"><img src="/img/buses/${t.bus}.webp" alt="" loading="lazy"></span><b>${esc(t.nombre)}</b>
          <small>${k === 'normal' ? 'Resto del año' : prox(k)}</small></button>`).join('')}</div>
        <p>Toca una para ponerla a mano (se queda hasta que vuelvas a activar el cambio automático). Las fechas de la Feria se calculan a partir de la Semana Santa; si un año no coinciden, ponla a mano.</p>
        ${sw('vehiculosFiesta', settings.vehiculosFiesta, 'Vehículos de fiesta en el mapa', `En vez de autobuses: pasos en Semana Santa, coches de caballos en la Feria y carrozas en Navidad (cada autobús, uno al azar). En Halloween y el resto del año, autobuses.${VEHICULOS_FIESTA[tem] ? ` Ahora: <b>${esc(VEHICULOS_FIESTA[tem].nombre)}</b>.` : ''}`)}</div>
      <div class="set-group"><h3>Color de la app</h3>
        <div class="swatches">${Object.entries(PALETTES).map(([k, p]) => `<button class="swatch" type="button" data-color="${k}" aria-pressed="${settings.color === k}" aria-label="${p.label}" style="background:${p[resolvedTheme][0]};color:${p[resolvedTheme][2]}">${settings.color === k ? ICON.check : ''}</button>`).join('')}</div>
        ${tem !== 'normal' ? '<p>Mientras haya una temática puesta, la app usa sus colores. Con la temática Normal vuelve tu color.</p>' : '<p>Los pasteles llevan el texto oscuro encima para que se lea bien.</p>'}</div>
      <div class="set-group"><h3>Color de fondo</h3>
        <div class="fondos">
          <button type="button" class="fondo" data-fondo="" aria-pressed="${!settings.fondo}"><span style="background:${resolvedTheme === 'dark' ? '#111214' : '#f4f4f6'}"></span><small>Normal</small></button>
          ${Object.entries(FONDOS).map(([k, f]) => `<button type="button" class="fondo" data-fondo="${k}" aria-pressed="${settings.fondo === k}"><span style="background:${f.bg};border-color:${f.line}"><i style="background:${f.surface}"></i></span><small>${esc(f.label)}</small></button>`).join('')}
        </div>
        <p>Los cuatro primeros son claros y el resto oscuros: al elegir uno, el tema cambia solo a claro u oscuro.</p></div>
      <div class="set-group"><h3>Mapa</h3>${segBtns('mapStyle', [['oscuro', 'Oscuro'], ['claro', 'Claro'], ['tema', 'Como el tema']], settings.mapStyle)}
        <h3 style="margin-top:14px">Qué ver en el mapa</h3>
        ${sw('mapaParadas', settings.mapaParadas !== false, 'Paradas', 'Los puntos de las paradas.')}
        ${sw('mapaRecorridos', settings.mapaRecorridos !== false, 'Recorridos', 'La línea del autobús cuando eliges una.')}
        ${sw('mapaCalles', settings.mapaCalles !== false, 'Nombres de calles', 'Las etiquetas de calles y sitios del mapa.')}
        <p class="help">Los autobuses en directo se encienden con el botón <img class="lg-busimg" src="${busImg()}" alt="autobús" style="height:18px;vertical-align:-4px"> del mapa.</p></div>

      <h2 class="section-title">Accesibilidad</h2>
      <div class="set-group">
        ${sw('voz', settings.voz, 'Leer en voz alta', 'Muestra el botón «Escuchar» en las paradas.')}
        ${settings.voz ? sw('vozAuto', settings.vozAuto, 'Leer al abrir una parada', 'Lee los tiempos nada más abrirla.') : ''}
        ${sw('modoSencillo', settings.modoSencillo, 'Modo sencillo', 'Todo más grande y sin adornos: pensado para quien quiere lo justo y claro.')}
        <div class="switch-row"><div><h3>Tamaño del texto</h3><p>Agranda la letra de toda la app.</p></div></div>
        ${segBtns('escalaTexto', [[1, 'Normal'], [1.22, 'Grande'], [1.35, 'Más'], [1.5, 'Máximo']], settings.letraGrande ? settings.escalaTexto : 1)}
        ${sw('botonesGrandes', settings.botonesGrandes, 'Botones más grandes', 'Más fáciles de tocar.')}
        ${sw('altoContraste', settings.altoContraste, 'Alto contraste', 'Textos y bordes más marcados.')}
        ${sw('menosAnimaciones', settings.menosAnimaciones, 'Reducir animaciones', 'Sin movimientos ni transiciones; también ahorra batería.')}
        ${sw('vibrar', settings.vibrar, 'Vibración', 'Al guardar favoritas y al leer la tarjeta.')}
      </div>

      <h2 class="section-title">Tiempos y avisos</h2>
      <div class="set-group"><h3>Actualizar los tiempos</h3>${segBtns('refresh', [[30, 'Cada 30 s'], [60, 'Cada minuto'], [0, 'Al pulsar ⟳']], settings.refresh)}
        <p>Cuanto menos a menudo, menos batería y datos. Con la app en segundo plano nunca se actualiza.</p></div>
      <div class="set-group">${sw('liveLines', settings.liveLines, 'Autobuses en directo en el mapa', 'Muestra dónde va cada autobús (en las líneas y en la zona del mapa que miras). También se activa con el botón ' + busIco() + ' del mapa.')}</div>
      <div class="set-group"><h3>Revisar al abrir la app</h3>${segBtns('revisarCada', [[0, 'Nunca'], [1, 'Cada hora'], [3, 'Cada 3 h'], [6, 'Cada 6 h']], settings.revisarCada)}
        <p>Comprueba el saldo y la caducidad de tus tarjetas guardadas al abrir la app, como mucho con esta frecuencia, y te avisa si el saldo está bajo.</p></div>
      <div class="set-group"><h3>Avisos de TUSSAM (desvíos, obras, horarios especiales)</h3>${segBtns('avisosTussam', [['mias', 'De mis líneas'], ['todas', 'Todos'], ['no', 'No avisar']], settings.avisosTussam)}
        <p>Al abrir la app (como mucho una vez por hora) mira la web de TUSSAM y te manda una notificación si hay un aviso nuevo. «Mis líneas» son las que paran en tus favoritas.</p>
        <a class="btn ghost" href="#avisos">Ver los avisos</a></div>
      <div class="set-group"><h3>Tarifas y títulos de viaje</h3><p>Los precios actuales de TUSSAM, leídos de su web (se actualizan solos).</p><a class="btn ghost" href="#tarifas">Ver las tarifas</a></div>

      <h2 class="section-title">Tus datos</h2>
      <div class="set-group"><h3>Tu servidor: saldo y tiempos (avanzado)</h3>
        <p>Si has montado tu propio servidor (carpeta <i>servidor-saldo</i>), pega aquí su dirección y BusSev te enseñará el saldo de la tarjeta. Déjalo vacío para no usarlo.</p>
        <div class="field"><input id="s-saldo-url" class="mini-input" style="width:100%" inputmode="url" autocomplete="off" placeholder="https://tu-servidor.deno.dev" value="${esc(settings.saldoURL || '')}"></div>
        <div class="btn-row"><button class="btn ghost" type="button" id="s-saldo-save">Guardar</button>${settings.saldoURL ? '<button class="btn ghost" type="button" id="s-saldo-test">Probar</button>' : ''}</div>${settings.saldoURL ? sw('tiemposServidor', settings.tiemposServidor === true, 'Pedir también los tiempos a mi servidor', 'Normalmente NO funciona: TUSSAM bloquea a los servidores de internet con Cloudflare. Actívalo solo si tu servidor está en un sitio que TUSSAM deja pasar (pulsa «Probar»).') : ''}</div>
      <div class="set-group"><h3>Copia de seguridad</h3>
        <p>Guarda tus favoritas, tarjetas y ajustes en un archivo para no perderlos si cambias de móvil.</p>
        <div class="btn-row"><button class="btn ghost" type="button" id="s-exp">Guardar copia</button><label class="btn ghost" for="s-imp" style="cursor:pointer">Recuperar copia</label></div>
        <input type="file" id="s-imp" accept="application/json,.json" hidden></div>
      <h2 class="section-title">Actualizaciones</h2>
      <div class="set-group">
        <div class="ver-fila"><div><h3>BusSev ${esc(actualizaciones.nombre())}</h3>
          <p>${actualizaciones.version().fecha ? `Compilada el ${new Date(actualizaciones.version().fecha + 'T12:00').toLocaleDateString('es-ES')}. ` : ''}Paradas y recorridos oficiales de TUSSAM${dc ? `, válidos hasta el <b>${dc.toLocaleDateString('es-ES')}</b>` : ''}.</p></div></div>
        <div id="s-ver-res"></div>
        <button class="btn block" type="button" id="s-ver">🔄 Buscar actualización</button>
        <p>Cada versión nueva lleva ya los horarios y recorridos oficiales más recientes (GitHub los descarga solo del Punto de Acceso Nacional de Transportes, y el día 1 de cada mes revisa si TUSSAM ha publicado otros). Se instala encima, sin perder nada.</p>
        ${sw('avisarVersion', settings.avisarVersion, 'Avisarme si hay una versión nueva', 'Lo mira al abrir la app y cada vez que vuelves a ella.')}
      </div>
      <div class="set-group"><h3>Privacidad y seguridad</h3>
        <p>BusSev solo se conecta con TUSSAM (tiempos, saldo y avisos), con OpenFreeMap (mapa) y, si lo configuras, con tu propio servidor del saldo. No tiene anuncios ni seguimiento. Tus favoritas y tarjetas se guardan solo en este móvil.</p>
        <p>Permisos: internet, ubicación (opcional), NFC (solo con la pestaña Tarjeta abierta) y notificaciones (solo si activas algún aviso).</p></div>
      <div class="set-group"><h3>Datos de líneas y paradas</h3><p>Datos oficiales de TUSSAM ${dc ? `válidos hasta el ${dc.toLocaleDateString('es-ES')}` : ''}. ${window.BusSevBackend?.caducados?.() ? 'Ya han caducado: la app pide los recorridos a TUSSAM en directo.' : 'Cuando caduquen, la app pedirá los recorridos a TUSSAM en directo.'} Recorridos por calle: ${Object.keys(window.BUSSEV_RECORRIDOS || {}).length ? 'sí' : 'en línea recta'}. Mapas: © OpenStreetMap, OpenFreeMap, OpenMapTiles.</p>
        <p>BusSev es una app personal, sin relación con TUSSAM.</p></div>
    </div>`;
    $('.back-btn', el).onclick = goBack;
    el.querySelectorAll('[data-set]').forEach((b) => { b.onclick = () => {
      const k = b.dataset.set; settings[k] = ['refresh', 'revisarCada', 'escalaTexto'].includes(k) ? Number(b.dataset.v) : b.dataset.v;
      if (k === 'theme' && FONDOS[settings.fondo] && (b.dataset.v === 'auto' || FONDOS[settings.fondo].base !== b.dataset.v)) settings.fondo = '';
      if (k === 'escalaTexto') settings.letraGrande = Number(b.dataset.v) > 1;
      saveSettings();
      if (k === 'theme' || k === 'mapStyle' || k === 'escalaTexto') applyTheme();
      if (k === 'avisosTussam' && b.dataset.v !== 'no' && isNative()) window.avisos?.permisoOk?.();
      render();
    }; });
    el.querySelectorAll('[data-sw]').forEach((b) => { b.onchange = () => {
      settings[b.dataset.sw] = b.checked;
      // Modo sencillo enciende «Reducir animaciones»; al quitarlo, se apaga.
      if (b.dataset.sw === 'modoSencillo') settings.menosAnimaciones = b.checked;
      saveSettings(); applyTheme(); render(); aplicarCapasMapa(mapState.bm);
    }; });
    el.querySelectorAll('[data-tem]').forEach((b) => { b.onclick = () => { settings.tematicaAuto = false; settings.tematica = b.dataset.tem; saveSettings(); applyTheme(); render(); }; });
    el.querySelectorAll('[data-color]').forEach((b) => { b.onclick = () => { settings.color = b.dataset.color; saveSettings(); applyTheme(); render(); }; });
    el.querySelectorAll('[data-fondo]').forEach((b) => { b.onclick = () => {
      settings.fondo = b.dataset.fondo;
      if (FONDOS[settings.fondo]) settings.theme = FONDOS[settings.fondo].base;
      saveSettings(); applyTheme(); render();
    }; });
    $('#s-ver', el).onclick = async () => {
      const box = $('#s-ver-res', el), b = $('#s-ver', el);
      b.disabled = true;
      box.innerHTML = cargandoHTML('Buscando versiones nuevas…');
      try {
        const r = await actualizaciones.buscar();
        if (r.estado === 'nueva') {
          box.innerHTML = `<div class="ver-res nueva"><b>✨ ${r.mismoNombre ? `Hay una actualización de la ${esc(r.nueva)}` : `Hay una versión nueva: la ${esc(r.nueva)}`}</b><span>Descárgala e instálala encima de esta.</span><button class="btn" type="button" id="s-ver-bajar">Descargar</button></div>`;
          $('#s-ver-bajar', el).onclick = () => descargarApp(r.url);
        } else if (r.estado === 'al-dia') {
          box.innerHTML = '<div class="ver-res"><b>✅ Tienes la última versión</b></div>';
        } else {
          const pag = actualizaciones.paginaVersiones();
          box.innerHTML = `<div class="ver-res"><b>Tu repositorio de GitHub es privado</b><span>La app no puede mirarlo sola. Ábrelo y entra con tu cuenta: si el número de la última versión es mayor que el tuyo, descarga <b>BusSev.apk</b>.</span>${pag ? '<button class="btn ghost" type="button" id="s-ver-gh">Abrir las versiones en GitHub</button>' : ''}</div>`;
          $('#s-ver-gh', el)?.addEventListener('click', () => openWeb(pag));
        }
      } catch (e) {
        box.innerHTML = `<div class="ver-res"><b>No se ha podido comprobar</b><span>${esc(e.name === 'AbortError' ? 'GitHub está tardando demasiado.' : (e.message || 'Revisa la conexión.'))}</span></div>`;
      } finally { b.disabled = false; }
    };
    $('#s-saldo-save', el).onclick = () => {
      const v = $('#s-saldo-url', el).value.trim().replace(/\/+$/, '');
      if (v && !/^https:\/\/[^\s/]+\.[^\s/]+/.test(v)) { toast('Pon una dirección que empiece por https://'); return; }
      settings.saldoURL = v; saveSettings(); toast(v ? 'Servidor del saldo guardado' : 'Servidor del saldo quitado'); render();
    };
    $('#s-saldo-test', el)?.addEventListener('click', async () => {
      toast('Probando el servidor…');
      try {
        const base = String(settings.saldoURL || '').replace(/\/+$/, '');
        const r = await fetch(`${base}/tiempos?p=2,3`, { headers: { Accept: 'application/json' } });
        if (r.status === 404 || r.status === 400) {
          const r2 = await fetch(`${base}/`, { headers: { Accept: 'text/html' } });
          toast(r2.ok ? 'Tu servidor responde, pero es la versión antigua: pon el código nuevo (mira su LEEME) para que dé los tiempos.' : `Responde con error ${r2.status}`);
        } else {
          const j = await r.json().catch(() => null);
          toast(j?.version >= 2 ? (Object.values(j.paradas || {}).some((x) => x?.ok) ? 'Tu servidor responde y además da los tiempos ✅' : 'Tu servidor responde ✅ (el saldo va), pero TUSSAM no le deja pedir los tiempos') : `Responde con error ${r.status}`);
        }
      } catch { toast('No se ha podido conectar con tu servidor'); }
    });
    $('#s-exp', el).onclick = () => copia.exportar().catch(() => toast('No se ha podido guardar la copia.'));
    $('#s-imp', el).onchange = async (e) => {
      try {
        const d = await copia.importar(e.target.files?.[0]);
        openModal(`<h2>Recuperar copia</h2><p class="help">Contiene ${d.favs.length} paradas favoritas y ${d.cards.length} tarjetas. Sustituirá lo que tienes ahora en BusSev.</p>
          <div class="actions"><button class="btn ghost" type="button" id="imp-no">Cancelar</button><button class="btn" type="button" id="imp-ok">Recuperar</button></div>`, (m, close) => {
          $('#imp-no', m).onclick = close;
          $('#imp-ok', m).onclick = () => { copia.aplicar(d); close(); toast('Copia recuperada'); render(); };
        });
      } catch (err) { toast(err.message); }
      e.target.value = '';
    };
  }
  render();
  return {};
};

/* ---------- Búsqueda ---------- */
const searchEl = $('#q');
const searchView = $('#view-buscar');
let searchSeq = 0;
/* Texto de cada parada ya preparado para buscar (sin tildes, en minúsculas). Se prepara una sola vez por
   parada: antes se rehacía para las más de mil paradas con cada letra que escribías. */
const textosBusqueda = new WeakMap();
function textoBusqueda(p) {
  let h = textosBusqueda.get(p);
  if (h === undefined) { h = norm(`${p.nombre} ${p.direccion_completa || ''} ${p.calle || ''}`); textosBusqueda.set(p, h); }
  return h;
}
async function runSearch() {
  const q = searchEl.value.trim();
  $('#q-clear').hidden = !q;
  if (!q) { searchView.hidden = true; document.querySelectorAll('.view').forEach((v) => { if (v.dataset.active === '1') v.hidden = false; }); return; }
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v !== searchView; });
  const seq = ++searchSeq;
  try {
    const [paradas, lineas] = await Promise.all([getParadas(), getLineas()]);
    if (seq !== searchSeq) return;
    const nq = norm(q);
    const isNum = /^\d+$/.test(q);
    let stops;
    if (isNum) stops = paradas.filter((p) => p.codigo.startsWith(q)).sort((a, b) => (a.codigo === q ? -1 : b.codigo === q ? 1 : a.codigo.length - b.codigo.length || a.codigo.localeCompare(b.codigo)));
    else { const words = nq.split(/\s+/); stops = paradas.filter((p) => { const h = textoBusqueda(p); return words.every((w) => h.includes(w)); }); }
    const lines = lineas.filter((l) => norm(l.numero) === nq || norm(l.numero).startsWith(nq) || (!isNum && norm(l.nombre).includes(nq)));
    const linesHTML = lines.slice(0, 8).map((l) => `<a class="row" href="#linea-${esc(l.numero)}">${badge(l.numero, l.color)}<div class="row-main"><b>${esc(l.nombre)}</b><span>Línea</span></div>${ICON.chev}</a>`).join('');
    const stopsHTML = stops.slice(0, 40).map((p) => { const f = favs.get(p.codigo); return `<a class="row" href="#parada-${esc(p.codigo)}"><span class="stop-num">${esc(p.codigo)}</span><div class="row-main"><b>${f ? '★ ' : ''}${esc(f?.alias || p.nombre)}</b><span>${esc(f?.alias ? p.nombre : (p.direccion_completa || ''))}</span></div>${ICON.chev}</a>`; }).join('');
    searchView.innerHTML = (!lines.length && !stops.length)
      ? emptyHTML(ICON.bus, 'Sin resultados', `No hay paradas ni líneas que coincidan con «${esc(q)}». Prueba con el número del poste de la parada o con el nombre de la calle.`)
      : `<div class="stack">${lines.length ? `<h2 class="section-title">Líneas</h2><div class="list">${linesHTML}</div>` : ''}${stops.length ? `<h2 class="section-title">Paradas${stops.length > 40 ? ` (40 de ${stops.length})` : ''}</h2><div class="list">${stopsHTML}</div>` : ''}</div>`;
  } catch (e) {
    if (seq === searchSeq) { searchView.innerHTML = errorHTML(e, 'retry-q'); $('#retry-q').onclick = runSearch; }
  }
}
let searchDebounce;
searchEl.addEventListener('input', () => { clearTimeout(searchDebounce); searchDebounce = setTimeout(runSearch, 120); });
searchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchEl.blur(); if (e.key === 'Escape') clearSearch(); });
$('#q-clear').onclick = () => { clearSearch(); searchEl.focus(); };
function clearSearch() { searchEl.value = ''; runSearch(); }
searchView.addEventListener('click', (e) => { if (e.target.closest('a[href^="#"]')) { searchEl.value = ''; $('#q-clear').hidden = true; searchView.hidden = true; } });

/* ================================================================== */
/* Router                                                              */
/* ================================================================== */
function show(name, arg) {
  active.cleanup?.();
  const el = $(`#view-${name}`);
  document.querySelectorAll('.view').forEach((v) => { v.hidden = true; v.dataset.active = ''; });
  if (TABS.includes(name)) {
    lastTab = name;
    document.querySelectorAll('.view-detail').forEach((v) => { v.innerHTML = ''; });
  }
  el.hidden = false; el.dataset.active = '1';
  document.body.dataset.view = name;   // para ocultar el buscador en Ajustes (y lo que haga falta por pantalla)
  if (name !== 'mapa') el.scrollTop = 0;
  document.querySelectorAll('.tabbar a').forEach((a) => { if (a.dataset.tab === lastTab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  active = { name, cleanup: null, refresh: null, rerender: null, back: null };
  const r = views[name](el, arg) || {};
  active.cleanup = r.cleanup; active.refresh = active.refresh || r.refresh; active.back = r.back || null;
  if (!settings.menosAnimaciones) { el.classList.remove('entrando'); void el.offsetWidth; el.classList.add('entrando'); }
}
/* ---------- Botón Atrás de Android ---------- */
const navStack = [];
let ultimoAtras = 0;
window.busSevBack = () => {
  const modal = document.querySelector('.modal-bg');
  if (modal) { modal.remove(); return true; }
  const ov = document.querySelector('.scan-overlay');
  if (ov) { ov.querySelector('button')?.click(); ov.remove(); return true; }
  if (searchEl.value) { clearSearch(); return true; }
  if (active.back?.()) return true;
  if (navStack.length > 1) { history.back(); return true; }
  if (active.name !== 'favoritas') { location.hash = 'favoritas'; return true; }
  if (Date.now() - ultimoAtras < 2000) return false;
  ultimoAtras = Date.now();
  toast('Pulsa otra vez Atrás para salir');
  return true;
};
function route() {
  routeCount++;
  const hh = location.hash || '#favoritas';
  if (navStack.length > 1 && navStack[navStack.length - 2] === hh) navStack.pop();
  else if (navStack[navStack.length - 1] !== hh) navStack.push(hh);
  if (navStack.length > 30) navStack.splice(0, navStack.length - 30);
  document.querySelector('.modal-bg')?.remove();
  window.BusSevBackend?.cancelarFondo?.();   // lo que se buscaba en la pantalla anterior ya no hace falta
  if (searchEl.value) { searchEl.value = ''; $('#q-clear').hidden = true; }
  const h = decodeURIComponent(location.hash.slice(1));
  // Modo sencillo: no hay Mapa, Cerca ni «Cómo llegar»; se redirige a Favoritas.
  if (settings.modoSencillo && (h === 'mapa' || h === 'cerca' || h === 'ruta')) { history.replaceState(null, '', '#favoritas'); return show('favoritas'); }
  let m;
  if ((m = h.match(/^parada-(\d{1,7})$/))) return show('parada', m[1]);
  if ((m = h.match(/^linea-([A-Za-z0-9]{1,8})$/))) return show('linea', m[1]);
  if (h === 'ajustes') return show('ajustes');
  if (h === 'ruta') return show('ruta');
  if (h === 'avisos') return show('avisos');
  if (h === 'tarifas') return show('tarifas');
  if (TABS.includes(h)) return show(h);
  history.replaceState(null, '', '#favoritas');
  return show('favoritas');
}
$('#btn-refresh').onclick = () => { if (active.refresh) active.refresh(); else toast('Esta pantalla ya está al día'); };
document.querySelectorAll('.tabbar a').forEach((a) => {
  a.addEventListener('click', (e) => { if (location.hash === `#${a.dataset.tab}`) { e.preventDefault(); clearSearch(); route(); } });
});
window.addEventListener('hashchange', route);
window.BusSevBackend?.precalentar?.();   // calienta el token OAuth nada más arrancar, para abrir más rápido
/* El móvil le quitó la gráfica a un mapa y no se la ha devuelto: se vuelve a crear la pantalla */
window.addEventListener('bussev-mapa-perdido', (e) => {
  const bm = e.detail;
  if (bm === mapState.bm) {
    const linea = mapState.linea;
    try { mapState.stopTimer?.(); mapState.zona?.parar(); mapState.line?.stop(); } catch { /* */ }
    try { bm.remove(); } catch { /* */ }
    const cont = $('#map-all'); if (cont) cont.innerHTML = '';
    const sh = $('#map-sheet'); if (sh) sh.hidden = true;
    Object.assign(mapState, { bm: null, me: null, sel: null, pin: null, markers: null, lineMarkers: null, line: null, stopTimer: null, reload: null, linea: null, zona: null, pending: linea ? linea.numero : null });
  } else { try { bm.remove(); } catch { /* */ } }
  route();
});


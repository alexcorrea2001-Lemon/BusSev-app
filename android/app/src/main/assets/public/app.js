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
const DEFAULTS = { theme: 'dark', color: 'rojo', refresh: 30, liveLines: true, mapStyle: 'oscuro' };
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
};
// Colores para personalizar favoritas y tarjetas
const TAGS = ['#e5303c', '#f08c00', '#f2c400', '#2fb36d', '#1fa3c9', '#3d6bff', '#8a5cf6', '#e0479e', '#7a7f8a'];

const darkMQ = matchMedia('(prefers-color-scheme: dark)');
let resolvedTheme = 'dark';
function applyTheme() {
  resolvedTheme = settings.theme === 'auto' ? (darkMQ.matches ? 'dark' : 'light') : settings.theme;
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  const pal = (PALETTES[settings.color] || PALETTES.rojo)[resolvedTheme];
  root.style.setProperty('--accent', pal[0]);
  root.style.setProperty('--accent-soft', pal[1]);
  root.style.setProperty('--on-accent', pal[2]);
  updateMapStyles();
}
darkMQ.addEventListener?.('change', () => { if (settings.theme === 'auto') applyTheme(); });

const REFRESH_LINE_MIN = 45_000;
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
  // Dentro de la app (pestaña del navegador encima de BusSev); si no se puede, en el navegador.
  if (window.Capacitor?.isPluginAvailable?.('Browser')) {
    window.Capacitor.nativePromise('Browser', 'open', { url, toolbarColor: '#1c1d21' }).catch(() => { location.href = url; });
  } else location.href = url;
}

const ICON = {
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/></svg>',
  bus: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 11h16M8 21v-3M16 21v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="14.5" r="1.1" fill="currentColor"/><circle cx="16" cy="14.5" r="1.1" fill="currentColor"/></svg>',
  off: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M3 3l18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/></svg>',
  nfc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 7.5a6.5 6.5 0 0 1 0 9M9.8 5a10 10 0 0 1 0 14M13 2.8a13 13 0 0 1 0 18.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="15.5" y="6" width="6" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  route: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 6H15a3.5 3.5 0 0 1 0 7H9a3.5 3.5 0 0 0 0 7h6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
};

/* ================================================================== */
/* Datos                                                               */
/* ================================================================== */
class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function api(path, { timeout = 12000 } = {}) {
  try {
    return await Promise.race([
      window.BusSevBackend.get(path),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'AbortError' })), timeout + 3000)),
    ]);
  } catch (e) {
    if (e.status === 429) throw new ApiError('TUSSAM está recibiendo demasiadas consultas. Espera unos segundos y vuelve a intentarlo.', 429);
    if (e.status === 404) throw new ApiError('No se ha encontrado.', 404);
    if (e.name === 'AbortError') throw new ApiError('La conexión está tardando demasiado. Comprueba tu cobertura.');
    throw new ApiError('No hay conexión con TUSSAM. Comprueba tu conexión a internet.');
  }
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
  if (r && Array.isArray(r.d) && Array.isArray(r.s) && r.s.length === stops.length) {
    pts = []; let la = 0, lo = 0;
    for (let i = 0; i + 1 < r.d.length; i += 2) { la += r.d[i]; lo += r.d[i + 1]; pts.push([la / 1e5, lo / 1e5]); }
    idx = r.s;
  } else {
    pts = stops.map((p) => [p.latitud, p.longitud]);
    idx = stops.map((_, i) => i);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const shape = { pts, idx, cum, porCalle: !!r };
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
function boardHTML(tiempos, status, { limit = 99, filtrado = false } = {}) {
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
    const sub = first.distancia_metros ? `a ${fmtDist(first.distancia_metros)}` : '';
    const label = `Línea ${g.linea} hacia ${g.destino}: ${first.tiempo_minutos <= 0 ? 'llegando' : first.tiempo_minutos + ' minutos'}${next ? `, el siguiente en ${next.tiempo_minutos} minutos` : ''}`;
    return `<li class="arr" aria-label="${esc(label)}">
      ${badge(g.linea, g.color)}
      <div class="arr-dest"><b>${esc(g.destino || 'Sin destino')}</b>${sub ? `<span>${sub}</span>` : ''}</div>
      <div class="arr-times" aria-hidden="true">${minutesHTML(first.tiempo_minutos)}${next ? `<span class="t-next">${next.tiempo_minutos}′</span>` : ''}</div>
    </li>`;
  }).join('');
  const more = groups.length > limit ? `<div class="board-empty">y ${groups.length - limit} más…</div>` : '';
  return `<ul class="board">${rows}</ul>${more}`;
}
function freshnessPill(d) {
  if (d?.stale) {
    const when = d.cached_at ? new Date(d.cached_at) : null;
    return `<span class="pill stale">Últimos datos${when && !Number.isNaN(+when) ? ' de las ' + when.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : ''}</span>`;
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
    ${tiempos === undefined ? '<div class="board-empty">Cargando tiempos…</div>' : boardHTML(filtered, status, { limit, filtrado: !!fav?.lineas?.length })}
    ${fav ? `<div class="card-tools"><button type="button" data-edit-fav="${esc(p.codigo)}">Personalizar</button></div>` : ''}
  </article>`;
}
const emptyHTML = (icon, title, text, actions = '') => `<div class="empty">${icon}<h2>${title}</h2><p>${text}</p>${actions}</div>`;
const skeletons = (n = 3) => `<div class="stack">${'<div class="skeleton"></div>'.repeat(n)}</div>`;
const errorHTML = (e, retryId) => emptyHTML(ICON.off, 'No se han podido cargar los datos', esc(e.message || 'Error desconocido.'), `<button class="btn" type="button" id="${retryId}">Reintentar</button>`);
const backHead = (inner = '') => `<div class="detail-head"><button class="back-btn" type="button" aria-label="Volver">${ICON.back}</button>${inner}</div>`;
const swatchesHTML = (cur, attr) => `<div class="swatches">${TAGS.map((c) => `<button class="swatch" type="button" ${attr}="${c}" aria-pressed="${cur === c}" aria-label="Color" style="background:${c};color:${textOn(c)}">${cur === c ? ICON.check : ''}</button>`).join('')}</div>`;

/* Ventana desde abajo */
function openModal(html, mount) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
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
        navigator.vibrate?.(now ? 25 : 10);
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
      <div class="line-picks">${lineas.map((n) => `<button class="line-pick" type="button" data-ln="${esc(n)}" aria-pressed="${elegidas.has(n)}">${badge(n, lineaFor(n)?.color)}</button>`).join('') || '<span class="help">Sin datos de líneas.</span>'}</div></div>
    <div class="fav-tools"><button class="btn ghost" type="button" data-mv="-1">Subir en la lista</button><button class="btn ghost" type="button" data-mv="1">Bajar en la lista</button></div>
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
    m.querySelectorAll('[data-mv]').forEach((b) => { b.onclick = () => { favs.move(codigo, Number(b.dataset.mv)); toast('Orden cambiado'); onDone?.(); }; });
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
function setVisible(v) { const was = appVisible; appVisible = v; if (v && !was) for (const fn of resumeHandlers) fn(); }
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
      attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0,
      fadeDuration: 0, renderWorldCopies: false, maxTileCacheSize: 120, refreshExpiredTiles: false,
      maxBounds: [[-6.35, 37.15], [-5.65, 37.6]], minZoom: 10,
    });
  } catch {
    el.innerHTML = '<div class="map-fallback">No se ha podido abrir el mapa (el móvil no admite WebGL).</div>';
    return null;
  }
  m.touchZoomRotate.disableRotation();
  m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
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
      m.fitBounds(b, { padding: opts.padding ?? 40, maxZoom: opts.maxZoom ?? 16, duration: 0 });
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
  m.on('style.load', () => { estiloListo = true; for (const d of installers) install(d); });
  m.on('error', () => { /* teselas que no cargan sin cobertura: no es un fallo de la app */ });
  liveMaps.add(bm);
  return bm;
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
  bm.m.on('click', 'bs-stops', (e) => { const c = e.features?.[0]?.properties?.codigo; const p = c && cache.paradaByCode.get(String(c)); if (p) onClick(p); });
  bm.m.on('mouseenter', 'bs-stops', () => { bm.m.getCanvas().style.cursor = 'pointer'; });
  bm.m.on('mouseleave', 'bs-stops', () => { bm.m.getCanvas().style.cursor = ''; });
}
/* Capas para recorrido de línea y caminos de los buses */
function addRouteLayers(bm) {
  bm.layer({ id: 'bs-route-casing', type: 'line', source: 'bs-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000000', 'line-opacity': 0.35, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 10] } });
  bm.layer({ id: 'bs-route', type: 'line', source: 'bs-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 6.5] } });
  bm.layer({ id: 'bs-route-stops', type: 'circle', source: 'bs-route-stops', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5.5], 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2.2 } });
  bm.layer({ id: 'bs-paths', type: 'line', source: 'bs-paths', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 6], 'line-opacity': 0.95 } });
}
/* Marcadores HTML (autobuses y parada) */
function busEl(label, color) {
  const c = safeColor(color, '#3d8bfd');
  const d = document.createElement('div');
  d.className = 'busmk';
  d.innerHTML = `<span class="busmk-l" style="background:${c};border-color:${c};color:${textOn(c)}">${esc(label)}</span><svg viewBox="0 0 46 22" aria-hidden="true"><rect x="1" y="1" width="44" height="15" rx="4" style="fill:var(--accent)"/><rect x="5" y="4" width="29" height="6" rx="1.5" fill="#15161a"/><rect x="36.5" y="4" width="6" height="9" rx="1.5" fill="#15161a"/><circle cx="11" cy="17" r="3.6" fill="#15161a" stroke="#fff" stroke-width="1.4"/><circle cx="35" cy="17" r="3.6" fill="#15161a" stroke="#fff" stroke-width="1.4"/></svg>`;
  return d;
}
function stopPinEl() {
  const d = document.createElement('div');
  d.innerHTML = '<svg class="stop-pin" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 39S2 24.5 2 14.5a13 13 0 0 1 26 0C28 24.5 15 39 15 39Z" style="fill:var(--accent)" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14.5" r="5" fill="#fff"/></svg>';
  return d;
}
function meEl() { const d = document.createElement('div'); d.className = 'me-pin'; return d; }
function marker(bm, pos, el, popupHTML, anchor = 'bottom') {
  const mk = new maplibregl.Marker({ element: el, anchor }).setLngLat(ll(pos));
  if (popupHTML) mk.setPopup(new maplibregl.Popup({ offset: 28, maxWidth: '260px' }).setHTML(popupHTML));
  return mk.addTo(bm.m);
}
class MarkerSet {
  constructor(bm) { this.bm = bm; this.list = []; }
  clear() { for (const m of this.list) m.remove(); this.list = []; }
  add(pos, el, html) { this.list.push(marker(this.bm, pos, el, html)); }
}

/* ================================================================== */
/* Dónde va cada autobús                                               */
/* TUSSAM no publica el GPS, pero sí cuántos metros le faltan a cada   */
/* bus para llegar a una parada. Recorriendo la línea hacia atrás por  */
/* las calles desde esa parada sabemos por dónde va.                   */
/* ================================================================== */
function locateOnShape(shape, k, meters) {
  const { pts, idx, cum } = shape;
  const end = idx[k];
  const target = cum[end] - Math.max(0, meters || 0);
  if (target < 0) return { fuera: true, pos: pts[0], path: pts.slice(0, end + 1), seg: 0 };
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
    seen.add(key);
    const w = locateOnShape(getShape(linea.numero, s, stops), k, t.distancia_metros);
    out.push({ linea: t.linea, color: t.color || linea.color, destino: t.destino, min: t.tiempo_minutos, dist: t.distancia_metros, vehiculo: t.vehiculo, ...w });
    if (out.length >= 8) break;
  }
  return out;
}
async function liveBusesLine(linea, sentido, stops) {
  if (!stops?.length) return { buses: [], ok: 0, total: 0 };
  const shape = getShape(linea.numero, sentido, stops);
  const step = stops.length > 36 ? 5 : 4;
  const ks = [];
  for (let i = Math.min(step - 1, stops.length - 1); i < stops.length; i += step) ks.push(i);
  if (ks[ks.length - 1] !== stops.length - 1) ks.push(stops.length - 1);
  const results = await Promise.allSettled(ks.map((i) => api(`/paradas/${encodeURIComponent(stops[i].codigo)}/tiempos`)));
  const best = new Map();
  let ok = 0, limited = false;
  results.forEach((r, n) => {
    if (r.status !== 'fulfilled') { if (r.reason?.status === 429) limited = true; return; }
    ok++;
    const k = ks[n];
    for (const t of r.value.tiempos || []) {
      if (lineaFor(t.linea)?.numero !== linea.numero) continue;
      if (t.sentido && t.sentido !== sentido) continue;
      if (t.distancia_metros == null) continue;
      const w = locateOnShape(shape, k, t.distancia_metros);
      if (w.fuera) continue;
      const key = t.vehiculo != null ? `v${t.vehiculo}` : `${w.seg}-${Math.round(w.pos[0] * 2000)}-${Math.round(w.pos[1] * 2000)}`;
      const cur = best.get(key);
      if (!cur || t.distancia_metros < cur.dist) best.set(key, { ...w, dist: t.distancia_metros, min: t.tiempo_minutos, vehiculo: t.vehiculo, destino: t.destino, hacia: stops[k].nombre });
    }
  });
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
    bm.source('bs-route-stops', fc(stops.map((p) => pointF([p.latitud, p.longitud], { color: lc, codigo: p.codigo }))));
    bm.source('bs-paths', fc([]));
    markers.clear();
    bm.fit(shape.pts, { padding: { top: 120, bottom: 40, left: 30, right: 30 } });
    cur = { l, sentido, stops };
    stopLive?.();
    if (!settings.liveLines) { onStatus?.('Autobuses en directo desactivados en Ajustes.'); return; }
    live();
    stopLive = autoRefresh(live, { min: REFRESH_LINE_MIN });
  }
  async function live() {
    if (!cur) return;
    const my = ++seq; const { l, sentido, stops } = cur;
    onStatus?.('Buscando los autobuses de esta línea…');
    spin(true);
    try {
      const r = await liveBusesLine(l, sentido, stops);
      if (my !== seq) return;
      markers.clear();
      for (const b of r.buses) markers.add(b.pos, busEl(l.numero, l.color), busPopup(b, l.numero));
      onBuses?.(r.buses);
      onStatus?.(r.ok === 0
        ? (r.limited ? 'TUSSAM está limitando las consultas. Los autobuses aparecerán en un momento.' : 'No se ha podido saber dónde están los autobuses ahora.')
        : `${r.buses.length ? `${r.buses.length} autobús${r.buses.length === 1 ? '' : 'es'} en este sentido` : 'Ahora mismo no hay autobuses en este sentido'} · ${fmtClock()}`);
    } finally { if (my === seq) spin(false); }
  }
  function clear() { stopLive?.(); stopLive = null; seq++; cur = null; markers.clear(); bm.source('bs-route', fc([])); bm.source('bs-route-stops', fc([])); }
  return { show, live, clear, stop: () => { stopLive?.(); stopLive = null; }, resume: () => { if (cur && !stopLive && settings.liveLines) { live(); stopLive = autoRefresh(live, { min: REFRESH_LINE_MIN }); } }, get current() { return cur; } };
}
/* Dibuja los buses que vienen a una parada y su camino */
function drawApproaching(bm, markers, buses) {
  bm.source('bs-paths', fc(buses.filter((b) => b.path?.length > 1).map((b) => lineF(b.path, { color: safeColor(b.color, '#3d8bfd') }))));
  markers.clear();
  for (const b of buses) markers.add(b.pos, busEl(b.linea, b.color), busPopup(b, b.linea));
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

/* ---------- Favoritas ---------- */
views.favoritas = (el) => {
  let stop = null, loading = false, results = null;
  function paint() {
    const list = favs.list();
    if (!list.length) {
      el.innerHTML = emptyHTML(ICON.star, 'Aún no tienes paradas favoritas', 'Abre una parada (desde el mapa, el buscador o Cerca) y pulsa la estrella. Luego podrás ponerle nombre, color y elegir qué líneas ver.', '<a class="btn" href="#mapa">Buscar en el mapa</a>');
      return false;
    }
    el.innerHTML = `<div class="stack"><h2 class="section-title">Tus paradas</h2>
      <div class="stack" id="fav-cards">${list.map((f, i) => {
        const p = cache.paradaByCode.get(f.codigo) || { codigo: f.codigo, nombre: f.nombre };
        const r = results?.get(f.codigo);
        if (!r) return stopCardHTML(p, { fav: f });
        if (r.status === 'rejected') return stopCardHTML(p, { tiempos: [], status: 'error', fav: f });
        return stopCardHTML(p, { tiempos: r.value.tiempos || [], status: r.value.upstream_status || 'ok', limit: 5, fav: f });
      }).join('')}</div>
      <p class="updated" id="fav-upd">${results ? `Actualizado a las ${fmtClock()} · ${refreshNote()}` : ''}</p></div>`;
    return true;
  }
  async function load() {
    const list = favs.list();
    if (!list.length || loading) return;
    loading = true; spin(true);
    try {
      await getLineas().catch(() => null);
      const rs = await Promise.allSettled(list.map((f) => api(`/paradas/${encodeURIComponent(f.codigo)}/tiempos`)));
      results = new Map(list.map((f, i) => [f.codigo, rs[i]]));
      paint();
      const failed = rs.filter((r) => r.status === 'rejected');
      if (failed.length === rs.length) $('#fav-upd', el).textContent = failed[0].reason.message;
    } finally { loading = false; spin(false); }
  }
  getParadas().then(() => { if (paint()) load(); }).catch(() => { if (paint()) load(); });
  stop = autoRefresh(load);
  active.rerender = () => { if (paint()) load(); };
  return { cleanup: stop, refresh: load };
};

/* ---------- Mapa: paradas, línea elegida y hoja inferior ---------- */
const mapState = { bm: null, me: null, sel: null, pin: null, markers: null, lineMarkers: null, line: null, stopTimer: null, reload: null, linea: null, sentido: 1 };
function closeSheet() {
  mapState.stopTimer?.(); mapState.stopTimer = null;
  mapState.sel = null;
  mapState.markers?.clear();
  mapState.bm?.source('bs-paths', fc([]));
  if (mapState.pin) { mapState.pin.remove(); mapState.pin = null; }
  $('#map-sheet').hidden = true;
  if (mapState.linea) mapState.line.resume();
}
function selectStop(p) {
  const bm = mapState.bm;
  const sheet = $('#map-sheet');
  mapState.sel = p;
  mapState.stopTimer?.();
  if (mapState.linea) mapState.line.stop();
  mapState.markers.clear();
  if (mapState.pin) mapState.pin.setLngLat(ll([p.latitud, p.longitud]));
  else mapState.pin = marker(bm, [p.latitud, p.longitud], stopPinEl(), null);
  const fb = favButton(p, () => {});
  sheet.hidden = false;
  sheet.innerHTML = `<div class="sheet-grip"></div>
    <div class="sheet-head">
      <div style="flex:1;min-width:0"><h3>${esc(p.nombre)}</h3><p>Parada ${esc(p.codigo)}${p.direccion_completa ? ' · ' + esc(p.direccion_completa) : ''}</p></div>
      ${fb.html}
      <button class="back-btn" type="button" id="sh-close" aria-label="Cerrar">${ICON.close}</button>
    </div>
    <div class="chips-wrap" id="sh-lines" style="margin-top:6px"></div>
    <div id="sh-board"><div class="board-empty" style="border:0">Cargando tiempos…</div></div>
    <div class="sheet-actions"><a class="btn ghost" href="#parada-${esc(p.codigo)}">Ver parada</a></div>`;
  fb.bind(sheet);
  $('#sh-close').onclick = closeSheet;
  api(`/paradas/${encodeURIComponent(p.codigo)}/lineas`).then((nums) => {
    if (mapState.sel !== p) return;
    $('#sh-lines').innerHTML = nums.map((n) => `<button type="button" class="line-pick" style="opacity:1" data-mapline="${esc(n)}">${badge(n, lineaFor(n)?.color, { sm: true })}</button>`).join('');
    $('#sh-lines').querySelectorAll('[data-mapline]').forEach((b) => { b.onclick = () => { closeSheet(); chooseMapLine(b.dataset.mapline); }; });
  }).catch(() => null);
  bm.m.easeTo({ center: ll([p.latitud, p.longitud]), zoom: Math.max(bm.m.getZoom(), 16), duration: 0 });
  let first = true;
  async function load() {
    if (mapState.sel !== p) return;
    spin(true);
    try {
      const d = await api(`/paradas/${encodeURIComponent(p.codigo)}/tiempos`);
      if (mapState.sel !== p) return;
      await getLineas().catch(() => null);
      $('#sh-board').innerHTML = `${boardHTML(d.tiempos, d.upstream_status || 'ok', { limit: 6 })}<p class="updated" style="text-align:left">${d.upstream_status && d.upstream_status !== 'ok' ? 'TUSSAM no responde' : 'En directo'} · ${fmtClock()}</p>`;
      const buses = await estimateBuses(p.codigo, d.tiempos);
      if (mapState.sel !== p) return;
      drawApproaching(bm, mapState.markers, buses);
      if (first && buses.length) {
        first = false;
        bm.fit([[p.latitud, p.longitud], ...buses.slice(0, 4).map((b) => b.pos)], { padding: { top: 90, left: 40, right: 40, bottom: sheet.offsetHeight + 30 } });
      }
    } catch (e) {
      if (mapState.sel === p) $('#sh-board').innerHTML = `<div class="board-empty" style="border:0">${esc(e.message)}</div>`;
    } finally { spin(false); }
  }
  load();
  mapState.reload = load;
  mapState.stopTimer = autoRefresh(load);
}
function renderLineBar() {
  const bar = $('#map-linebar');
  if (!mapState.linea) {
    bar.innerHTML = `<button class="map-chip" type="button" id="ml-pick">${ICON.route}<span class="txt">Ver una línea en el mapa</span></button>`;
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
      ${sentidos.length > 1 ? `<div class="seg">${sentidos.map((s) => `<button type="button" data-ms="${s}" aria-pressed="${s === mapState.sentido}">${esc(same ? (s === 1 ? 'Ida' : 'Vuelta') : 'Hacia ' + lastName(s))}</button>`).join('')}</div>` : ''}
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
views.mapa = (el) => {
  if (!mapState.bm) {
    const bm = mapState.bm = createMap($('#map-all', el), SEVILLA, 14);
    if (!bm) return {};
    mapState.markers = new MarkerSet(bm);
    mapState.lineMarkers = new MarkerSet(bm);
    addStopDots(bm, selectStop);
    addRouteLayers(bm);
    mapState.line = lineController(bm, mapState.lineMarkers, { onStatus: (t) => { const n = $('#ml-live'); if (n) n.textContent = t; } });
    $('#btn-locate', el).onclick = async () => {
      try {
        const pos = await getPosition(true);
        if (mapState.me) mapState.me.setLngLat(ll(pos)); else mapState.me = marker(bm, pos, meEl(), null, 'center');
        bm.m.easeTo({ center: ll(pos), zoom: 17, duration: 0 });
      } catch (err) { toast(geoErrorText(err)); }
    };
    if (store.get('geoOk', false)) getPosition().then((pos) => { mapState.me = marker(bm, pos, meEl(), null, 'center'); bm.m.jumpTo({ center: ll(pos), zoom: 16 }); }).catch(() => null);
    renderLineBar();
  } else {
    if (mapState.sel) { mapState.reload?.(); mapState.stopTimer?.(); mapState.stopTimer = autoRefresh(() => mapState.reload?.()); } else if (mapState.linea) mapState.line.resume();
  }
  if (mapState.pending) { const n = mapState.pending; mapState.pending = null; chooseMapLine(n); }
  requestAnimationFrame(() => mapState.bm?.m.resize());
  return {
    cleanup: () => { mapState.stopTimer?.(); mapState.stopTimer = null; mapState.line?.stop(); },
    refresh: () => (mapState.sel ? mapState.reload?.() : mapState.line?.live()),
  };
};

/* ---------- Líneas ---------- */
const FAMILIAS = [
  { id: 'todas', label: 'Todas', test: () => true },
  { id: 'urbanas', label: 'Urbanas', test: (l) => /^\d/.test(l.numero) },
  { id: 'circulares', label: 'Circulares', test: (l) => /^C\d/.test(l.numero) },
  { id: 'otras', label: 'Especiales y tranvía', test: (l) => !/^\d/.test(l.numero) && !/^C\d/.test(l.numero) },
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
        el.innerHTML = `<div class="stack">
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
  let bm = null, dead = false, ctl = null, sentido = 1;
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
        ${sentidos.length > 1 ? `<div class="seg" role="group" aria-label="Sentido">${sentidos.map((s) => `<button type="button" data-s="${s}" aria-pressed="${s === sentido}">${esc(segLabel(s))}</button>`).join('')}</div>` : ''}
        <div><div class="map-box" id="l-map"></div><p class="live-note" id="l-live"></p></div>
        <a class="btn ghost block" href="#mapa" id="l-open-map">${ICON.route}Ver en el mapa grande</a>
        <ol class="timeline" id="l-stops" style="--lc:${lc}"></ol>
      </div>`;
      $('.back-btn', el).onclick = goBack;
      $('#l-open-map', el).onclick = (e) => { e.preventDefault(); mapState.sentido = sentido; chooseMapLine(l.numero); };
      bm = createMap($('#l-map', el), SEVILLA, 12);
      const drawTimeline = (buses = []) => {
        const stops = ruta[sentido] || [];
        const bySeg = new Map();
        for (const b of buses) { if (!bySeg.has(b.seg)) bySeg.set(b.seg, []); bySeg.get(b.seg).push(b); }
        $('#l-stops', el).innerHTML = stops.map((p, i) => {
          const bs = bySeg.get(i) || [];
          const busTxt = bs.length ? `<span class="num" style="color:var(--accent)">bus ${bs.map((b) => (b.min <= 0 ? 'ya' : b.min + '′')).join(' · ')}</span>` : `<span class="num">${esc(p.codigo)}</span>`;
          return `<li><a href="#parada-${esc(p.codigo)}"><span class="dot${bs.length ? ' bus' : ''}"></span><b>${esc(p.nombre)}</b>${busTxt}</a></li>`;
        }).join('') || '<li class="board-empty">No hay paradas para este sentido.</li>';
      };
      if (bm) {
        addRouteLayers(bm);
        bm.m.on('click', 'bs-route-stops', (e) => { const c = e.features?.[0]?.properties?.codigo; if (c) location.hash = `parada-${c}`; });
        ctl = lineController(bm, new MarkerSet(bm), { onStatus: (t) => { const n = $('#l-live', el); if (n) n.textContent = t; }, onBuses: drawTimeline });
      }
      const draw = () => {
        const stops = ruta[sentido] || [];
        const ini = sentido === 2 ? l.hora_inicio_vuelta : l.hora_inicio_ida;
        const fin = sentido === 2 ? l.hora_fin_vuelta : l.hora_fin_ida;
        $('#l-horario', el).textContent = ini && fin ? `Primer bus ${ini} · último ${fin} · ${stops.length} paradas` : `${stops.length} paradas`;
        drawTimeline();
        el.querySelectorAll('[data-s]').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.s) === sentido));
        if (ctl) bm.ready.then(() => { if (!dead) ctl.show(l, sentido); });
      };
      el.querySelectorAll('[data-s]').forEach((b) => { b.onclick = () => { sentido = Number(b.dataset.s); draw(); }; });
      active.refresh = () => ctl?.live();
      draw();
    } catch (e) {
      if (dead) return;
      el.innerHTML = backHead() + errorHTML(e, 'retry-l');
      $('.back-btn', el).onclick = goBack;
      $('#retry-l', el).onclick = init;
    }
  }
  init();
  return { cleanup: () => { dead = true; ctl?.stop(); bm?.remove(); } };
};

/* ---------- Detalle de parada ---------- */
views.parada = (el, codigo) => {
  let stop = null, bm = null, markers = null, info = null, dead = false, first = true;
  el.innerHTML = backHead(`<div class="grow"><h2>Parada ${esc(codigo)}</h2></div>`) + skeletons(2);
  $('.back-btn', el).onclick = goBack;
  function headHTML() {
    const fb = favButton(info, () => paintTools());
    return { fb, html: backHead(`<div class="grow"><h2>${esc(info.nombre)}</h2><p><span class="stop-num" style="display:inline-grid;height:22px;min-width:0;font-size:15px;vertical-align:-3px">${esc(codigo)}</span> ${esc(info.direccion_completa || '')}</p></div>${fb.html}`) };
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
      <article class="card" id="p-board"><div class="board-empty">Cargando tiempos…</div></article>
      <div><div class="map-box" id="p-map"></div>
        <div class="map-legend"><span><i class="lg-stop"></i>Esta parada</span><span><i class="lg-bus"></i>Autobús que viene</span><span><i class="lg-path"></i>Camino que le queda</span></div>
        <p class="small muted" id="p-map-note" style="margin:6px 2px 0"></p></div>
      <div><h3 class="section-title" style="margin-bottom:8px">Líneas que paran aquí</h3><div class="chips-wrap" id="p-lineas"><span class="muted small">Cargando…</span></div></div>
    </div>`;
    $('.back-btn', el).onclick = goBack;
    h.fb.bind(el);
    paintTools();
    active.rerender = paintTools;
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
      $('#p-lineas', el).innerHTML = nums.length ? nums.map((n) => badge(n, lineaFor(n)?.color, { href: `#linea-${encodeURIComponent(n)}` })).join('') : '<span class="muted small">Sin datos de líneas.</span>';
    }).catch(() => { if (!dead) $('#p-lineas', el).innerHTML = '<span class="muted small">No se han podido cargar.</span>'; });
    await load();
    stop = autoRefresh(() => load(true));
  }
  async function load(quiet = false) {
    if (dead || !info) return;
    spin(true);
    try {
      const d = await api(`/paradas/${encodeURIComponent(codigo)}/tiempos`);
      if (dead) return;
      await getLineas().catch(() => null);
      const status = d.upstream_status || 'ok';
      $('#p-board', el).innerHTML = `${boardHTML(d.tiempos, status)}
        <div class="meta-row" style="padding-top:10px;border-top:1px solid var(--line)">${status === 'ok' ? freshnessPill(d) : '<span class="pill stale">TUSSAM no responde</span>'}<span>Actualizado ${fmtClock()} · ${refreshNote()}</span></div>`;
      if (bm) {
        const buses = await estimateBuses(codigo, d.tiempos);
        if (dead) return;
        await bm.ready;
        drawApproaching(bm, markers, buses);
        if (first && buses.length) { first = false; bm.fit([[info.latitud, info.longitud], ...buses.slice(0, 4).map((b) => b.pos)], { padding: 50 }); }
        $('#p-map-note', el).textContent = buses.length
          ? 'Cada autobús aparece donde está ahora, calculado con la distancia que da TUSSAM. Toca uno para ver cuánto le falta.'
          : 'Cuando haya autobuses en camino, verás aquí por dónde vienen.';
      }
    } catch (e) {
      if (dead) return;
      if (!quiet) $('#p-board', el).innerHTML = `<div class="board-empty">${esc(e.message)}</div>`; else toast(e.message);
    } finally { spin(false); }
  }
  init();
  return { cleanup: () => { dead = true; stop?.(); bm?.remove(); }, refresh: () => load() };
};

/* ---------- Cerca ---------- */
views.cerca = (el) => {
  let pos = null, stop = null, loading = false;
  const intro = () => {
    el.innerHTML = emptyHTML(ICON.pin, 'Paradas cerca de ti', 'Usa tu ubicación para ver las paradas más cercanas y cuánto le falta a cada autobús. Es opcional: también puedes buscar la parada arriba.', '<button class="btn" type="button" id="btn-geo">Usar mi ubicación</button>');
    $('#btn-geo', el).onclick = locate;
  };
  async function locate() {
    el.innerHTML = skeletons(3);
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
      el.innerHTML = `<div class="stack"><h2 class="section-title">Cerca de ti</h2>
        ${d.paradas.map((p) => stopCardHTML(p, { tiempos: p.tiempos || [], status: p.tiempos_status, distancia: p.distancia })).join('')}
        <p class="updated">Actualizado a las ${fmtClock()} · ${refreshNote()}</p></div>`;
    } catch (e) {
      if (!quiet) { el.innerHTML = errorHTML(e, 'retry-cerca'); $('#retry-cerca', el).onclick = () => load(); } else toast(e.message);
    } finally { loading = false; spin(false); }
  }
  if (store.get('geoOk', false)) locate(); else intro();
  return { cleanup: () => stop?.(), refresh: () => (pos ? load() : locate()) };
};

/* ================================================================== */
/* Tarjeta TUSSAM                                                      */
/* El NFC solo lee el número de serie (no toca saldo ni claves). Con   */
/* él se calcula el número impreso y se consulta la web oficial de     */
/* recargas de TUSSAM, de donde la app lee el saldo y el tipo.         */
/* ================================================================== */
const TIPOS = [
  { id: 'sin-transbordo', nombre: 'Bonobús sin transbordo', re: /sin\s*transbordo/i, info: 'Tarjeta monedero: cada viaje descuenta su precio del saldo. Si cambias de autobús, pagas otro viaje.' },
  { id: 'con-transbordo', nombre: 'Bonobús con transbordo', re: /con\s*transbordo|transbordo/i, info: 'Tarjeta monedero que permite cambiar de autobús sin pagar otro viaje durante un tiempo limitado después de validar.' },
  { id: '30-dias', nombre: 'Tarjeta 30 días', re: /30\s*d[ií]as|mensual/i, info: 'Viajes ilimitados durante 30 días seguidos desde la primera validación. No descuenta saldo por viaje.' },
  { id: 'joven', nombre: 'Tarjeta Joven', re: /joven/i, info: 'Abono con precio reducido para jóvenes, con requisitos de edad. Consulta en TUSSAM las condiciones actuales.' },
  { id: 'estudiante', nombre: 'Tarjeta Estudiante', re: /estudiant|universitari/i, info: 'Tarifa reducida para estudiantes que cumplen los requisitos de TUSSAM.' },
  { id: 'tercera-edad', nombre: 'Tarjeta Tercera Edad', re: /tercera\s*edad|mayor|pensionista|jubilad/i, info: 'Tarjeta para personas mayores o pensionistas que cumplen los requisitos.' },
  { id: 'solidaria', nombre: 'Tarjeta Solidaria', re: /solidari|social/i, info: 'Tarjeta con descuento para personas en situación económica difícil, con requisitos.' },
  { id: 'familia', nombre: 'Familia numerosa', re: /familia\s*numerosa/i, info: 'Descuento para miembros de familias numerosas.' },
  { id: 'discapacidad', nombre: 'Tarjeta Discapacidad', re: /discapacidad|pmr|movilidad reducida/i, info: 'Tarjeta para personas con discapacidad que cumplen los requisitos.' },
  { id: 'otra', nombre: 'Otro tipo', re: /$^/, info: 'Tipo de tarjeta no reconocido automáticamente.' },
];
const tipoPorId = (id) => TIPOS.find((t) => t.id === id) || null;
const tarjeta = {
  disponible: () => !!window.Capacitor?.isPluginAvailable?.('TarjetaNfc'),
  call: (m) => window.Capacitor.nativePromise('TarjetaNfc', m, {}),
  numeroDesdeUid(hex) {
    const h = String(hex || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (h.length < 8) throw new Error('UID demasiado corto');
    const rev = h.slice(6, 8) + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);
    return this.numeroVisible(String(parseInt(rev, 16)));
  },
  numeroVisible(input) {   // cálculo tomado de SeviBus (código abierto)
    const p = input.padStart(10, '0');
    const n = Number(p);
    const bin = n.toString(2).padStart(32, '0');
    const b = [0, 8, 16, 24].map((i) => parseInt(bin.slice(i, i + 8), 2));
    const bits = (((b[1] ^ b[0]) ^ b[2]) ^ b[3]).toString(2).padStart(8, '0');
    const shift = n % 7;
    const res = new Array(8);
    for (let i = 1; i <= 8; i++) { let ni = i - shift; if (ni < 0) ni += 8; else if (ni === 0) ni = 8; res[ni - 1] = bits[i - 1]; }
    const sh = res.join('');
    let a = parseInt(sh.slice(0, 4), 2); if (a > 9) a -= 7;
    let c = parseInt(sh.slice(4, 8), 2); if (c > 9) c -= 7;
    return p.slice(0, 5) + `${a}${c}` + p.slice(5, 10);
  },
  fmt: (num) => String(num).replace(/(\d{4})(?=\d)/g, '$1 '),
  url: (num) => `https://recargas.tussam.es/TPW/Common/index.do?client_id=APPTUSSAM&id_tarjeta=${encodeURIComponent(num)}`,
  list: () => store.get('cards', []),
  get(num) { return this.list().find((c) => c.num === num) || null; },
  save(card) { const l = this.list().filter((c) => c.num !== card.num); l.unshift(card); store.set('cards', l.slice(0, 10)); },
  update(num, patch) { store.set('cards', this.list().map((c) => (c.num === num ? { ...c, ...patch } : c))); },
  remove(num) { store.set('cards', this.list().filter((c) => c.num !== num)); },

  /* Lee la página oficial y saca lo que pueda: saldo, tipo, viajes, validez... */
  async consultar(num) {
    const res = await fetch(this.url(num), { headers: { Accept: 'text/html,application/xhtml+xml' } });
    const html = await res.text();
    return this.interpretar(html);
  },
  interpretar(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html'); // no ejecuta nada
    doc.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const pares = [];
    doc.querySelectorAll('tr').forEach((tr) => { const c = [...tr.children].map((x) => clean(x.textContent)).filter(Boolean); if (c.length >= 2) pares.push([c[0], c.slice(1).join(' ')]); });
    doc.querySelectorAll('dt').forEach((dt) => { const dd = dt.nextElementSibling; if (dd?.tagName === 'DD') pares.push([clean(dt.textContent), clean(dd.textContent)]); });
    doc.querySelectorAll('label,strong,b,th,.label,.titulo').forEach((lb) => {
      const t = clean(lb.textContent); const nx = clean(lb.nextElementSibling?.textContent || lb.nextSibling?.textContent);
      if (t && nx && t.length < 40 && nx.length < 80) pares.push([t.replace(/:$/, ''), nx]);
    });
    doc.querySelectorAll('input[readonly],input[disabled],input[type=text]').forEach((inp) => {
      const id = inp.id && doc.querySelector(`label[for="${CSS.escape(inp.id)}"]`);
      if (inp.value && id) pares.push([clean(id.textContent).replace(/:$/, ''), clean(inp.value)]);
    });
    const text = clean(doc.body?.textContent || '');
    const lines = (doc.body?.innerText || text).split(/\n+/).map(clean).filter(Boolean);
    const find = (re) => pares.find(([k]) => re.test(k))?.[1];
    const euros = (s) => { const m = String(s || '').match(/(-?\d{1,4}(?:[.,]\d{1,2})?)\s*(?:€|eur)/i) || String(s || '').match(/(-?\d{1,4}[.,]\d{2})/); return m ? Number(m[1].replace(',', '.')) : null; };
    let saldo = euros(find(/saldo/i));
    if (saldo == null) { const m = text.match(/saldo[^0-9-]{0,40}(-?\d{1,4}(?:[.,]\d{1,2})?)\s*(?:€|eur)/i); if (m) saldo = Number(m[1].replace(',', '.')); }
    const tipoTxt = find(/tipo|t[ií]tulo|perfil|producto|tarifa|tarjeta/i) || '';
    const tipo = TIPOS.find((t) => t.re.test(tipoTxt)) || TIPOS.find((t) => t.re.test(text)) || null;
    const viajes = (() => { const v = find(/viajes?/i); const m = String(v || '').match(/\d+/) || text.match(/(\d+)\s*viajes?/i); return m ? Number(m[1] ?? m[0]) : null; })();
    const fecha = (s) => String(s || '').match(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/)?.[0] || null;
    const validez = fecha(find(/v[aá]lid|caduc|vigen|hasta|fin/i)) || (text.match(/(?:v[aá]lid[ao]?|caduca|hasta)[^0-9]{0,20}(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i)?.[1] ?? null);
    const estado = find(/estado|situaci/i) || null;
    const ultima = find(/[uú]ltim|recarga/i) || null;
    const error = /no existe|no encontrad|incorrect|no v[aá]lid|error/i.test(text) && saldo == null ? (lines.find((l) => /no existe|no encontrad|incorrect|no v[aá]lid|error/i.test(l)) || 'TUSSAM no reconoce esta tarjeta.') : null;
    return { saldo, tipo: tipo?.id || null, tipoTexto: tipoTxt || null, viajes, validez, estado, ultima, error, ok: saldo != null || !!tipo,
      extra: pares.filter(([k, v]) => k && v && k.length < 40).slice(0, 12), texto: text.slice(0, 1500) };
  },
};
views.tarjeta = (el) => {
  let shown = null;   // { num, res, loading, err }
  const cardColor = (c) => safeColor(c?.color, '') || null;
  function tcardHTML(num, c, res) {
    const color = cardColor(c);
    const tipo = tipoPorId(c?.tipo || res?.tipo);
    const saldo = res?.saldo ?? c?.ultimo?.saldo;
    return `<div class="tcard" ${color ? `style="background:linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 55%, #000))"` : ''}>
      <div class="tc-top"><span>${esc(c?.name || 'TARJETA TUSSAM')}</span>${ICON.nfc}</div>
      <div>${saldo != null ? `<div class="tc-saldo">${fmtEuro(saldo)}</div>` : ''}${tipo ? `<div class="tc-tipo">${esc(tipo.nombre)}</div>` : ''}</div>
      <div><div class="tc-num" style="font-size:clamp(18px,6vw,24px)">${esc(tarjeta.fmt(num))}</div></div></div>`;
  }
  function resultHTML(num) {
    const c = tarjeta.get(num);
    const r = shown.res;
    const tipo = tipoPorId(c?.tipo || r?.tipo);
    const precio = Number(c?.precio) || 0;
    const saldo = r?.saldo;
    const filas = [];
    if (saldo != null) filas.push(['Saldo', fmtEuro(saldo)]);
    if (tipo) filas.push(['Tipo', tipo.nombre]);
    if (precio && saldo != null) filas.push(['Viajes que te quedan', `unos ${Math.max(0, Math.floor(saldo / precio + 1e-9))} (a ${fmtEuro(precio)} el viaje)`]);
    if (r?.viajes != null) filas.push(['Viajes', String(r.viajes)]);
    if (r?.validez) filas.push(['Válida hasta', r.validez]);
    if (r?.estado) filas.push(['Estado', r.estado]);
    if (r?.ultima) filas.push(['Última operación', r.ultima]);
    for (const [k, v] of r?.extra || []) if (!filas.some(([a, b]) => norm(a) === norm(k) || norm(b) === norm(v)) && !/saldo|tipo|tarjeta/i.test(k)) filas.push([k, v]);
    const bajo = c?.aviso && saldo != null && saldo < Number(c.aviso);
    return `${tcardHTML(num, c, r)}
      ${shown.loading ? '<div class="board-empty" style="border:0;text-align:center">Consultando el saldo en TUSSAM…</div>' : ''}
      ${bajo ? `<div class="pill stale" style="justify-self:start">Saldo bajo: menos de ${fmtEuro(Number(c.aviso))}</div>` : ''}
      ${r?.ok ? `<div class="kv">${filas.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
        <p class="small muted" style="margin:0">Datos de la web oficial de TUSSAM · ${fmtClock()}</p>` : ''}
      ${tipo ? `<div class="info-list"><div><b>¿Qué es «${esc(tipo.nombre)}»?</b><p>${esc(tipo.info)}</p></div></div>` : ''}
      ${!shown.loading && r && !r.ok ? `<div class="set-group"><h3>No he podido leer el saldo</h3><p>${esc(r.error || 'TUSSAM ha respondido, pero en un formato que la app no entiende todavía.')}</p>
        <button class="btn" type="button" id="t-web">Ver el saldo en la web de TUSSAM</button>
        <details><summary class="small">Ver lo que ha contestado TUSSAM</summary><div class="raw">${esc(r.texto || '(vacío)')}</div><p class="small muted">Si me mandas una captura de esto, puedo ajustar la app para que lo lea.</p></details></div>` : ''}
      ${shown.err ? `<div class="set-group"><h3>No se ha podido consultar</h3><p>${esc(shown.err)}</p><button class="btn" type="button" id="t-web">Ver en la web de TUSSAM</button></div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn ghost" style="flex:1" type="button" id="t-again">Actualizar</button>
        <button class="btn ghost" style="flex:1" type="button" id="t-edit">${c ? 'Personalizar' : 'Guardar tarjeta'}</button>
      </div>`;
  }
  async function consultar(num) {
    shown = { num, res: null, loading: true, err: null }; render();
    try {
      const res = await tarjeta.consultar(num);
      shown = { num, res, loading: false, err: null };
      if (res.ok && tarjeta.get(num)) tarjeta.update(num, { ultimo: { saldo: res.saldo, tipo: res.tipo, fecha: Date.now() }, ...(tarjeta.get(num).tipo ? {} : { tipo: res.tipo }) });
    } catch {
      shown = { num, res: null, loading: false, err: 'No hay conexión con la web de TUSSAM. Comprueba tu conexión a internet.' };
    }
    render();
  }
  function editCard(num) {
    const c = tarjeta.get(num) || { num, name: '', color: '', tipo: shown?.res?.tipo || '', precio: '', aviso: '' };
    let color = c.color || '';
    openModal(`<h2>${tarjeta.get(num) ? 'Personalizar tarjeta' : 'Guardar tarjeta'}</h2><p class="help">${esc(tarjeta.fmt(num))}</p>
      <div class="field"><label for="c-name">Nombre</label><input id="c-name" maxlength="24" placeholder="Por ejemplo: Mía, Mamá, Trabajo" value="${esc(c.name || '')}"></div>
      <div class="field"><label>Color</label>${swatchesHTML(color, 'data-cc')}</div>
      <div class="field"><label for="c-tipo">Tipo de tarjeta</label><select id="c-tipo"><option value="">Detectar automáticamente</option>${TIPOS.map((t) => `<option value="${t.id}" ${c.tipo === t.id ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></div>
      <div class="field"><label for="c-precio">Precio de un viaje (opcional)</label><input id="c-precio" inputmode="decimal" placeholder="Por ejemplo: 0,76" value="${c.precio ? String(c.precio).replace('.', ',') : ''}"><p class="help">Con esto la app calcula cuántos viajes te quedan. Míralo en tu último tique o en tussam.es.</p></div>
      <div class="field"><label for="c-aviso">Avisarme si el saldo baja de (€, opcional)</label><input id="c-aviso" inputmode="decimal" placeholder="Por ejemplo: 3" value="${c.aviso ? String(c.aviso).replace('.', ',') : ''}"></div>
      <div class="actions">${tarjeta.get(num) ? '<button class="btn danger" type="button" id="c-del">Borrar</button>' : ''}<button class="btn" type="button" id="c-ok">Guardar</button></div>`,
    (m, close) => {
      m.querySelectorAll('[data-cc]').forEach((b) => { b.onclick = () => {
        color = color === b.dataset.cc ? '' : b.dataset.cc;
        m.querySelectorAll('[data-cc]').forEach((x) => { const on = x.dataset.cc === color; x.setAttribute('aria-pressed', on); x.innerHTML = on ? ICON.check : ''; });
      }; });
      const num2 = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : ''; };
      $('#c-del', m)?.addEventListener('click', () => { tarjeta.remove(num); close(); toast('Tarjeta borrada'); render(); });
      $('#c-ok', m).onclick = () => {
        const prev = tarjeta.get(num) || {};
        tarjeta.save({ ...prev, num, name: $('#c-name', m).value.trim().slice(0, 24), color, tipo: $('#c-tipo', m).value, precio: num2($('#c-precio', m).value), aviso: num2($('#c-aviso', m).value),
          ultimo: prev.ultimo || (shown?.res?.ok ? { saldo: shown.res.saldo, tipo: shown.res.tipo, fecha: Date.now() } : undefined) });
        close(); toast('Tarjeta guardada'); render();
      };
    });
  }
  function render() {
    const cards = tarjeta.list();
    const nfcOk = tarjeta.disponible();
    el.innerHTML = `<div class="stack">
      ${shown ? `<div style="display:flex;align-items:center;justify-content:space-between"><h2 class="section-title">Tu tarjeta</h2><button class="back-btn" type="button" id="t-x" aria-label="Cerrar">${ICON.close}</button></div>${resultHTML(shown.num)}` : ''}
      ${nfcOk ? `<button class="btn block" type="button" id="t-scan" style="height:54px">${ICON.nfc}Escanear tarjeta</button>
        <p class="small muted" style="margin:0">Activa el NFC del móvil y apoya la tarjeta en la parte de atrás.</p>` : ''}
      ${cards.length ? `<h2 class="section-title">Mis tarjetas</h2><div class="list">${cards.map((c) => {
        const col = cardColor(c); const t = tipoPorId(c.tipo || c.ultimo?.tipo);
        return `<button class="row" type="button" data-open="${esc(c.num)}" style="width:100%;border:0;background:none;text-align:left;font:inherit;color:inherit;cursor:pointer">
          <span class="stop-num" style="${col ? `background:${col};color:${textOn(col)}` : ''}">${ICON.nfc.replace('<svg', '<svg width="20" height="20"')}</span>
          <div class="row-main"><b>${esc(c.name || 'Tarjeta')}${t ? ` · ${esc(t.nombre)}` : ''}</b><span style="font-variant-numeric:tabular-nums">${esc(tarjeta.fmt(c.num))}${c.ultimo?.saldo != null ? ` · ${fmtEuro(c.ultimo.saldo)} (${new Date(c.ultimo.fecha).toLocaleDateString('es-ES')})` : ''}</span></div>${ICON.chev}</button>`;
      }).join('')}</div>` : ''}
      <div class="set-group">
        <h3>Escribir el número a mano</h3>
        <p>Está en la parte de atrás de la tarjeta y tiene 12 dígitos.</p>
        <form id="t-form" class="field" novalidate>
          <label for="t-num">Número de tarjeta</label>
          <input id="t-num" inputmode="numeric" autocomplete="off" maxlength="15" placeholder="0000 0000 0000">
          <button class="btn" type="submit">Consultar saldo</button>
        </form>
      </div>
      <h2 class="section-title">Tipos de tarjeta</h2>
      <div class="info-list">${TIPOS.filter((t) => t.id !== 'otra').map((t) => `<div><b>${esc(t.nombre)}</b><p>${esc(t.info)}</p></div>`).join('')}</div>
      <p class="small muted" style="margin:0">Las condiciones y precios los fija TUSSAM y pueden cambiar. Consulta tussam.es para los datos oficiales.</p>
    </div>`;
    $('#t-scan', el)?.addEventListener('click', scan);
    $('#t-x', el)?.addEventListener('click', () => { shown = null; render(); });
    $('#t-again', el)?.addEventListener('click', () => consultar(shown.num));
    $('#t-edit', el)?.addEventListener('click', () => editCard(shown.num));
    el.querySelectorAll('#t-web').forEach((b) => { b.onclick = () => openWeb(tarjeta.url(shown.num)); });
    el.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => consultar(b.dataset.open); });
    $('#t-form', el).onsubmit = (e) => {
      e.preventDefault();
      const num = $('#t-num', el).value.replace(/\D/g, '');
      if (num.length !== 12) { toast('El número de la tarjeta tiene 12 dígitos. Revísalo en la parte de atrás.'); return; }
      consultar(num);
    };
  }
  async function scan() {
    try {
      const st = await tarjeta.call('estado');
      if (!st.disponible) { toast('Este móvil no tiene NFC. Escribe el número a mano.'); return; }
      if (!st.activado) { toast('Activa el NFC en los ajustes del móvil y vuelve a intentarlo.'); return; }
    } catch { /* seguimos */ }
    const ov = document.createElement('div');
    ov.className = 'scan-overlay';
    ov.innerHTML = `<div class="scan-box" role="dialog" aria-label="Escaneando tarjeta"><span class="pulse">${ICON.nfc}</span><h3>Acerca la tarjeta</h3><p>Apoya la tarjeta TUSSAM en la parte de atrás del móvil y no la muevas.</p><button class="btn ghost block" type="button">Cancelar</button></div>`;
    document.body.appendChild(ov);
    let cancelled = false;
    $('button', ov).onclick = () => { cancelled = true; tarjeta.call('cancelar').catch(() => null); ov.remove(); };
    try {
      const r = await tarjeta.call('leer');
      if (cancelled) return;
      navigator.vibrate?.(60);
      ov.remove();
      consultar(tarjeta.numeroDesdeUid(r.uid));
    } catch (e) {
      if (!cancelled) toast(e?.message && !/cancel/i.test(e.message) ? e.message : 'No se ha podido leer la tarjeta. Prueba otra vez.');
    } finally { ov.remove(); }
  }
  render();
  return { cleanup: () => { document.querySelector('.scan-overlay')?.remove(); if (tarjeta.disponible()) tarjeta.call('cancelar').catch(() => null); }, refresh: () => shown && consultar(shown.num) };
};

/* ---------- Ajustes ---------- */
views.ajustes = (el) => {
  const segBtns = (name, opts, cur) => `<div class="seg" role="group">${opts.map(([v, t]) => `<button type="button" data-set="${name}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${t}</button>`).join('')}</div>`;
  function render() {
    el.innerHTML = `<div class="stack">
      ${backHead('<div class="grow"><h2>Ajustes</h2></div>')}
      <div class="set-group"><h3>Tema</h3>${segBtns('theme', [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']], settings.theme)}
        <p>Automático sigue el modo claro u oscuro de tu móvil. El tema oscuro gasta menos batería en pantallas OLED.</p></div>
      <div class="set-group"><h3>Color de la app</h3>
        <div class="swatches">${Object.entries(PALETTES).map(([k, p]) => `<button class="swatch" type="button" data-color="${k}" aria-pressed="${settings.color === k}" aria-label="${p.label}" style="background:${p[resolvedTheme][0]};color:${p[resolvedTheme][2]}">${settings.color === k ? ICON.check : ''}</button>`).join('')}</div></div>
      <div class="set-group"><h3>Mapa</h3>${segBtns('mapStyle', [['oscuro', 'Oscuro'], ['claro', 'Claro'], ['tema', 'Como el tema']], settings.mapStyle)}
        <p>Mapa con calles, nombres y comercios de OpenStreetMap. No necesita clave.</p></div>
      <div class="set-group"><h3>Actualizar los tiempos</h3>${segBtns('refresh', [[30, 'Cada 30 s'], [60, 'Cada minuto'], [0, 'Al pulsar ⟳']], settings.refresh)}
        <p>Cuanto menos a menudo, menos batería y datos. Con la app en segundo plano nunca se actualiza.</p></div>
      <div class="set-group"><div class="switch-row"><div><h3>Autobuses en directo en las líneas</h3><p>Muestra dónde va cada autobús de la línea. Hace más consultas a TUSSAM y gasta algo más de batería.</p></div><input class="switch" type="checkbox" id="s-live" ${settings.liveLines ? 'checked' : ''} aria-label="Autobuses en directo en las líneas"></div></div>
      <div class="set-group"><h3>Privacidad y seguridad</h3>
        <p>BusSev solo se conecta con TUSSAM (tiempos y saldo) y con OpenFreeMap (mapa). No tiene anuncios ni seguimiento. Tus favoritas y tarjetas se guardan solo en este móvil.</p>
        <p>Permisos: internet, ubicación (opcional, solo para «Cerca» y centrar el mapa) y NFC (solo mientras escaneas).</p></div>
      <div class="set-group"><h3>Datos</h3><p>Paradas y líneas: copia de ${window.BusSevBackend?.generado ? esc(new Date(String(window.BusSevBackend.generado).replace(' ', 'T')).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })) : '—'}. Recorridos por calle: ${Object.keys(window.BUSSEV_RECORRIDOS || {}).length ? 'sí' : 'en línea recta'}. Mapas: © OpenStreetMap, OpenFreeMap, OpenMapTiles.</p>
        <p>BusSev es una app personal, sin relación con TUSSAM.</p></div>
    </div>`;
    $('.back-btn', el).onclick = goBack;
    el.querySelectorAll('[data-set]').forEach((b) => { b.onclick = () => {
      const k = b.dataset.set; settings[k] = k === 'refresh' ? Number(b.dataset.v) : b.dataset.v; saveSettings();
      if (k === 'theme' || k === 'mapStyle') applyTheme();
      render();
    }; });
    el.querySelectorAll('[data-color]').forEach((b) => { b.onclick = () => { settings.color = b.dataset.color; saveSettings(); applyTheme(); render(); }; });
    $('#s-live', el).onchange = (e) => { settings.liveLines = e.target.checked; saveSettings(); };
  }
  render();
  return {};
};

/* ---------- Búsqueda ---------- */
const searchEl = $('#q');
const searchView = $('#view-buscar');
let searchSeq = 0;
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
    else { const words = nq.split(/\s+/); stops = paradas.filter((p) => { const h = norm(`${p.nombre} ${p.direccion_completa || ''} ${p.calle || ''}`); return words.every((w) => h.includes(w)); }); }
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
  if (name !== 'mapa') el.scrollTop = 0;
  document.querySelectorAll('.tabbar a').forEach((a) => { if (a.dataset.tab === lastTab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  active = { name, cleanup: null, refresh: null, rerender: null };
  const r = views[name](el, arg) || {};
  active.cleanup = r.cleanup; active.refresh = active.refresh || r.refresh;
}
function route() {
  routeCount++;
  document.querySelector('.modal-bg')?.remove();
  if (searchEl.value) { searchEl.value = ''; $('#q-clear').hidden = true; }
  const h = decodeURIComponent(location.hash.slice(1));
  let m;
  if ((m = h.match(/^parada-(\d{1,7})$/))) return show('parada', m[1]);
  if ((m = h.match(/^linea-([A-Za-z0-9]{1,8})$/))) return show('linea', m[1]);
  if (h === 'ajustes') return show('ajustes');
  if (TABS.includes(h)) return show(h);
  history.replaceState(null, '', '#favoritas');
  return show('favoritas');
}
$('#btn-refresh').onclick = () => { if (active.refresh) active.refresh(); else toast('Esta pantalla ya está al día'); };
document.querySelectorAll('.tabbar a').forEach((a) => {
  a.addEventListener('click', (e) => { if (location.hash === `#${a.dataset.tab}`) { e.preventDefault(); clearSearch(); route(); } });
});
window.addEventListener('hashchange', route);
window.addEventListener('online', () => toast('Vuelves a tener conexión'));
window.addEventListener('offline', () => toast('Sin conexión: los tiempos no se actualizarán'));

applyTheme();
route();

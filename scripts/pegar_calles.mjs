// Ajusta ("pega") el trazado oficial de una línea a las calles reales de OpenStreetMap, para que se dibuje
// justo encima de la calzada del mapa (y dé la vuelta a las rotondas en vez de cruzarlas por el medio).
// No usa ningún servidor externo al compilar: las calles están guardadas en la rama «calles-osm» del
// repositorio (las descarga el workflow "Calles OSM"). Datos © colaboradores de OpenStreetMap (ODbL).
//
// Cómo funciona (map-matching): se recorre el trazado oficial cada pocos metros; para cada punto se buscan
// las calles cercanas que van en su misma dirección (respetando los sentidos únicos, salvo donde el bus puede
// ir a contramano) y se elige la cadena de calles CONECTADAS que mejor sigue al trazado. Donde no hay calle
// que encaje (un tramo que no está en OpenStreetMap), se deja el trazado oficial tal cual: nunca queda peor.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';

const LAT0 = 37.39, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110540;
const CELDA = 40;

/* Lee las calles: de un archivo (CALLES_OSM=ruta, para pruebas) o de la rama «calles-osm» del repositorio. */
export function leerCalles(raiz) {
  let buf;
  if (process.env.CALLES_OSM) buf = fs.readFileSync(process.env.CALLES_OSM);
  else {
    execSync('git fetch --quiet --depth=1 origin calles-osm', { cwd: raiz, stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 });
    buf = execSync('git show FETCH_HEAD:calles.json.gz', { cwd: raiz, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  const j = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  if (!Array.isArray(j.ways) || j.ways.length < 1000) throw new Error('archivo de calles vacío o raro');
  return j;
}

/* Monta la red: nudos (cruces y puntos de las calles) y tramos con su sentido permitido para un autobús. */
export function redDeCalles(datos) {
  const idDe = new Map(), X = [], Y = [];
  const nodo = (id, lat, lon) => {
    let i = idDe.get(id);
    if (i === undefined) { i = X.length; idDe.set(id, i); X.push(lon * KX); Y.push(lat * KY); }
    return i;
  };
  const eu = [], ev = [], el = [], ep = [];   // tramo dirigido: nudo origen, nudo destino, largo (m), penalización
  const adj = [];
  const celdas = new Map();
  const tramo = (u, v, pen) => {
    const l = Math.hypot(X[v] - X[u], Y[v] - Y[u]);
    if (!(l > 0.05)) return;
    const e = eu.length; eu.push(u); ev.push(v); el.push(l); ep.push(pen);
    (adj[u] ||= []).push(e);
    const x0 = Math.floor(Math.min(X[u], X[v]) / CELDA), x1 = Math.floor(Math.max(X[u], X[v]) / CELDA);
    const y0 = Math.floor(Math.min(Y[u], Y[v]) / CELDA), y1 = Math.floor(Math.max(Y[u], Y[v]) / CELDA);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = cx * 100003 + cy; let c = celdas.get(k); if (!c) celdas.set(k, c = []); c.push(e);
    }
  };
  const si = (v) => v === 'yes' || v === 'designated';
  for (const w of datos.ways) {
    const t = w.t || {};
    if (t.area === 'yes' || !Array.isArray(w.g) || w.g.length < 4) continue;
    const busOK = si(t.bus) || si(t.psv) || t.access === 'bus' || t.highway === 'busway' || t.service === 'psv';
    if (t.highway === 'service' && ['parking_aisle', 'driveway', 'drive-through', 'emergency_access'].includes(t.service)) continue;
    if (!busOK && (['private', 'no', 'customers', 'permit'].includes(t.access) || ['no', 'private'].includes(t.motor_vehicle) || ['no', 'private'].includes(t.vehicle))) continue;
    // Calles menores: valen, pero a igualdad se prefiere la calle principal de al lado
    const pen = busOK ? 0 : t.highway === 'pedestrian' ? 2.5 : t.highway === 'service' ? 1.5 : t.highway === 'living_street' ? 0.5 : 0;
    const rot = t.junction === 'roundabout' || t.junction === 'circular';
    const contramano = t['oneway:bus'] === 'no' || t['oneway:psv'] === 'no' || /opposite/.test(t.busway || '');
    let ida = true, vuelta = true;
    if (t.oneway === '-1') ida = false;
    else if (t.oneway === 'yes' || (rot && t.oneway !== 'no') || t.highway === 'motorway') vuelta = false;
    if (contramano) ida = vuelta = true;
    const ids = []; let la = 0, lo = 0;
    for (let i = 0; i + 1 < w.g.length; i += 2) {
      la += w.g[i]; lo += w.g[i + 1];
      const id = Array.isArray(w.n) && w.n.length * 2 === w.g.length ? w.n[i / 2] : `${la},${lo}`;
      ids.push(nodo(id, la / 1e7, lo / 1e7));
    }
    for (let i = 0; i + 1 < ids.length; i++) {
      if (ida) tramo(ids[i], ids[i + 1], pen);
      if (vuelta) tramo(ids[i + 1], ids[i], pen);
    }
  }
  return { X, Y, eu, ev, el, ep, adj, celdas, tramos: eu.length };
}

const dAng = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d; };

/* Camino más corto por la red desde el nudo «desde» (que ya lleva «d0» metros), hasta «tope» metros. */
function dijkstra(red, desde, d0, tope) {
  const dist = new Map([[desde, d0]]), prev = new Map();
  const heap = [[d0, desde]];
  const sube = (i) => { while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const baja = (i) => { for (;;) { let m = i; const a = 2 * i + 1, b = a + 1; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } };
  while (heap.length) {
    const [d, u] = heap[0]; const ult = heap.pop(); if (heap.length) { heap[0] = ult; baja(0); }
    if (d > (dist.get(u) ?? Infinity)) continue;
    for (const e of red.adj[u] || []) {
      const v = red.ev[e], nd = d + red.el[e];
      if (nd > tope || nd >= (dist.get(v) ?? Infinity)) continue;
      dist.set(v, nd); prev.set(v, u); heap.push([nd, v]); sube(heap.length - 1);
    }
  }
  return { dist, prev };
}

/* Pega un trazado [[lat,lon]…] a la red. Devuelve { pts, pegado (0-1: parte del recorrido que va por calle
   de OSM), huecos } o null si no se pudo pegar nada. */
export function pegarACalles(red, trazado, op = {}) {
  const PASO = op.paso ?? 12, RADIO = op.radio ?? 24, K = op.k ?? 6, SIGMA = 7, ANG = 55 * Math.PI / 180;
  const BETA = 8, SALTO = op.salto ?? 22;
  if (!Array.isArray(trazado) || trazado.length < 2) return null;
  const T = trazado.map((p) => [p[1] * KX, p[0] * KY]);
  const cum = [0]; for (let i = 1; i < T.length; i++) cum.push(cum[i - 1] + Math.hypot(T[i][0] - T[i - 1][0], T[i][1] - T[i - 1][1]));
  const total = cum[cum.length - 1];
  if (!(total > 30)) return null;
  // Punto del trazado a «s» metros del inicio
  let cur = 0;
  const en = (s) => {
    s = Math.max(0, Math.min(total, s));
    while (cur + 2 < T.length && cum[cur + 1] < s) cur++;
    while (cur > 0 && cum[cur] > s) cur--;
    const l = cum[cur + 1] - cum[cur], f = l > 0 ? (s - cum[cur]) / l : 0;
    return [T[cur][0] + (T[cur + 1][0] - T[cur][0]) * f, T[cur][1] + (T[cur + 1][1] - T[cur][1]) * f];
  };
  // 1) Muestras del trazado con su rumbo, y calles candidatas para cada una
  const capas = [];
  const n = Math.max(2, Math.round(total / PASO) + 1);
  for (let k = 0; k < n; k++) {
    const s = total * k / (n - 1);
    const p = en(s), a = en(s - 9), b = en(s + 9);
    const rumbo = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const cx = Math.floor(p[0] / CELDA), cy = Math.floor(p[1] / CELDA);
    const mejores = new Map();
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iy = cy - 1; iy <= cy + 1; iy++) {
      for (const e of red.celdas.get(ix * 100003 + iy) || []) {
        if (mejores.has(e)) continue;
        const u = red.eu[e], v = red.ev[e];
        const dx = red.X[v] - red.X[u], dy = red.Y[v] - red.Y[u], L2 = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((p[0] - red.X[u]) * dx + (p[1] - red.Y[u]) * dy) / L2));
        const d = Math.hypot(p[0] - red.X[u] - t * dx, p[1] - red.Y[u] - t * dy);
        if (d > RADIO) continue;
        const da = dAng(Math.atan2(dy, dx), rumbo);
        if (da > ANG) continue;
        mejores.set(e, { e, t, coste: (d / SIGMA) ** 2 + (da / (35 * Math.PI / 180)) ** 2 + red.ep[e] });
      }
    }
    const cands = [...mejores.values()].sort((x, y) => x.coste - y.coste).slice(0, K);
    if (cands.length) capas.push({ s, cands });
  }
  if (capas.length < 2) return null;
  // 2) Viterbi: la cadena de candidatos conectados por la red que mejor sigue al trazado
  for (const c of capas[0].cands) { c.total = c.coste; c.ant = -1; c.salto = false; }
  for (let j = 1; j < capas.length; j++) {
    const A = capas[j - 1], B = capas[j], ds = B.s - A.s;
    const tope = ds * 2.5 + 70;
    let mejorAnt = 0; for (let i = 1; i < A.cands.length; i++) if (A.cands[i].total < A.cands[mejorAnt].total) mejorAnt = i;
    for (const b of B.cands) { b.total = A.cands[mejorAnt].total + SALTO + b.coste; b.ant = mejorAnt; b.salto = true; }
    A.cands.forEach((a, i) => {
      if (a.total >= A.cands[mejorAnt].total + SALTO) return;   // nunca ganaría al «salto»
      let dj = null;
      for (const b of B.cands) {
        let net;
        if (b.e === a.e && b.t >= a.t - 1e-9) net = (b.t - a.t) * red.el[a.e];
        else {
          dj ||= dijkstra(red, red.ev[a.e], (1 - a.t) * red.el[a.e], tope);
          const d = dj.dist.get(red.eu[b.e]);
          if (d === undefined) continue;
          net = d + b.t * red.el[b.e];
        }
        if (net > tope) continue;
        const tot = a.total + Math.abs(net - ds) / BETA + b.coste;
        if (tot < b.total) { b.total = tot; b.ant = i; b.salto = false; }
      }
    });
  }
  // 3) Se reconstruye el camino hacia atrás
  const elegido = new Array(capas.length);
  let c = 0; const U = capas[capas.length - 1].cands;
  for (let i = 1; i < U.length; i++) if (U[i].total < U[c].total) c = i;
  for (let j = capas.length - 1; j >= 0; j--) { elegido[j] = capas[j].cands[c]; c = elegido[j].ant; }
  const xy = (cand) => { const u = red.eu[cand.e], v = red.ev[cand.e]; return [red.X[u] + (red.X[v] - red.X[u]) * cand.t, red.Y[u] + (red.Y[v] - red.Y[u]) * cand.t]; };
  const out = [];
  const mete = (p) => { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 0.3) out.push(p); };
  const oficial = (s0, s1) => {   // puntos del trazado oficial entre s0 y s1 (para los huecos)
    for (let i = 0; i < T.length; i++) if (cum[i] > s0 + 1 && cum[i] < s1 - 1) mete(T[i]);
  };
  let huecos = 0, mHueco = 0;
  // Un extremo corto sin calle (el dato oficial suele empezar/acabar unos metros fuera de la calzada) se
  // recorta; uno largo (un tramo que no está en OSM) se conserva tal cual.
  const CORTO = op.corto ?? 60;
  if (capas[0].s > CORTO) { oficial(-1, capas[0].s); mHueco += capas[0].s; }
  mete(xy(elegido[0]));
  for (let j = 1; j < capas.length; j++) {
    const a = elegido[j - 1], b = elegido[j];
    if (b.salto) {
      // Hueco: si es corto se une en recta (meter ahí los puntos oficiales, que van fuera de la calle, hacía
      // un pico); si es largo se sigue el trazado oficial.
      const largo = capas[j].s - capas[j - 1].s;
      huecos++;
      if (largo > CORTO * 1.5) { mHueco += largo; oficial(capas[j - 1].s, capas[j].s); }
      mete(xy(b)); continue;
    }
    if (!(b.e === a.e && b.t >= a.t - 1e-9)) {
      const dj = dijkstra(red, red.ev[a.e], (1 - a.t) * red.el[a.e], (capas[j].s - capas[j - 1].s) * 2.5 + 70);
      const cadena = []; let v = red.eu[b.e];
      for (let guard = 0; v !== undefined && guard < 5000; guard++) { cadena.push(v); if (v === red.ev[a.e]) break; v = dj.prev.get(v); }
      for (let i = cadena.length - 1; i >= 0; i--) mete([red.X[cadena[i]], red.Y[cadena[i]]]);
    }
    mete(xy(b));
  }
  const fin = capas[capas.length - 1].s;
  if (fin < total - CORTO) { oficial(fin, total + 1); mete(T[T.length - 1]); mHueco += total - fin; }
  // Se quitan los «ida y vuelta» por el mismo tramo (un punto al que se va y del que se vuelve por donde se vino)
  for (let i = 1; i + 1 < out.length;) {
    if (Math.hypot(out[i - 1][0] - out[i + 1][0], out[i - 1][1] - out[i + 1][1]) < 0.5) { out.splice(i, 2); i = Math.max(1, i - 1); } else i++;
  }
  // Se quitan los puntos intermedios que no aportan forma (los que caen en plena recta): menos datos en la app
  const fino = [out[0]]; let desde = 0;
  for (let i = 1; i + 1 < out.length; i++) {
    const a = out[desde], b = out[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    let sobra = Math.hypot(dx, dy) <= 150;
    for (let k = desde + 1; sobra && k <= i; k++) {   // todos los saltados deben seguir sobre la recta
      const t = L2 ? Math.max(0, Math.min(1, ((out[k][0] - a[0]) * dx + (out[k][1] - a[1]) * dy) / L2)) : 0;
      if (Math.hypot(out[k][0] - a[0] - t * dx, out[k][1] - a[1] - t * dy) > 0.6) sobra = false;
    }
    if (!sobra) { fino.push(out[i]); desde = i; }
  }
  fino.push(out[out.length - 1]);
  out.length = 0; out.push(...fino);
  if (out.length < 2) return null;
  return { pts: out.map(([x, y]) => [y / KY, x / KX]), pegado: Math.max(0, 1 - mHueco / total), huecos };
}

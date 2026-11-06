// Calcula el recorrido de cada línea siguiendo las calles (no en línea recta entre paradas).
// Se ejecuta en GitHub al compilar el APK y guarda el resultado en www/recorridos.js.
// Usa el servidor público de OSRM (datos de OpenStreetMap). Si falla, la app usa líneas rectas.
// Antes coloca cada parada en su sitio exacto según OpenStreetMap (paradas_osm.mjs).
import fs from 'node:fs';
import vm from 'node:vm';

const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const ROOT = new URL('..', import.meta.url).pathname;
const MAX_WAYPOINTS = 80;
const PAUSA_MS = Number(process.env.OSRM_PAUSA_MS ?? 1100); // el servidor público pide como mucho 1 consulta por segundo

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(`${ROOT}www/data.js`, 'utf8'), ctx);
const D = ctx.window.BUSSEV_DATA;
const paradas = new Map(D.paradas.map((p) => [p.codigo, p]));

/* 1) Posición real de cada parada según OpenStreetMap (las de TUSSAM a veces caen 50-100 m fuera de la calle) */
let osm = new Map();
if (!process.env.BUSSEV_SOLO_FUNCIONES) {
  try {
    const { paradasOSM } = await import('./paradas_osm.mjs');   // si falta el archivo, se sigue sin él
    const r = await paradasOSM(D.paradas);
    osm = r.ajustes;
    console.log(`OpenStreetMap: ${r.nodos} paradas de bus en la zona; colocadas ${r.porNumero} por número y ${r.porNombre} por nombre (de ${D.paradas.length}).`);
  } catch (e) { console.log(`OpenStreetMap no disponible (${e.message}): se usan las coordenadas de TUSSAM.`); }
  for (const [c, pos] of osm) { const p = paradas.get(c); if (p) { p.latitud = pos[0]; p.longitud = pos[1]; } }
}

const grupos = new Map();
for (const [cod, lin, sentido, orden] of D.recorridos) {
  const p = paradas.get(cod);
  if (!p) continue;
  const k = `${lin}|${sentido}`;
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k).push({ orden, codigo: cod, lat: p.latitud, lon: p.longitud });
}

const hav = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const x = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* Puntos de cada tramo (pares de paradas seguidas) a partir de los «legs» de OSRM */
const puntosDe = (legs) => legs.map((leg) => {
  const pts = [];
  for (const st of leg.steps) for (const [lon, lat] of st.geometry.coordinates) {
    const q = [lat, lon];
    const last = pts[pts.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
  }
  return { pts, distancia: leg.distance };
});

/* 1) «Ajuste al trazado» (map matching): OSRM mira, para cada parada, todas las calles a menos de
   35 m y elige la combinación que forma el recorrido más lógico. Así no se pega una parada a la
   calzada del otro sentido de una avenida (lo que provocaba vueltas a la manzana que el bus no da). */
let avisoAjuste = 0, sinRadios = false;   // si el servidor rechaza los márgenes una vez, ya no se mandan
async function porAjuste(stops) {
  const coords = stops.map((s) => `${s.lon.toFixed(6)},${s.lat.toFixed(6)}`).join(';');
  let ultimo;
  // 1º con margen de 25 m por parada; si el servidor no lo admite (400), sin indicar margen (usa el suyo)
  for (const extra of sinRadios ? [''] : [`&radiuses=${stops.map(() => 25).join(';')}`, '']) {
    const url = `${OSRM}/match/v1/driving/${coords}?overview=false&steps=true&geometries=geojson&gaps=ignore&tidy=false${extra}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'BusSev (app personal)' }, signal: AbortSignal.timeout(12000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      ultimo = new Error(`OSRM match ${res.status}${j.code ? ` ${j.code}` : ''}${j.message ? `: ${j.message}` : ''}`);
      if (avisoAjuste++ < 3) process.stdout.write(`   (detalle: ${ultimo.message})\n`);
      if (res.status === 400 && extra) { sinRadios = true; await esperar(PAUSA_MS); continue; }
      throw ultimo;
    }
    // Solo vale si ha encajado TODAS las paradas en un único recorrido continuo
    if (j.code !== 'Ok' || j.matchings?.length !== 1 || !j.tracepoints?.every(Boolean)) throw new Error(j.code !== 'Ok' ? `OSRM match ${j.code}` : 'no encajan todas las paradas');
    const legs = j.matchings[0].legs;
    if (legs.length !== stops.length - 1) throw new Error('OSRM match: tramos incompletos');
    return puntosDe(legs);
  }
  throw ultimo;
}
/* 2) Si el ajuste no sale, ruta normal parada a parada (con «acera» obliga a llegar por la derecha: solo como
   alternativa, porque si la parada está mal colocada provoca vueltas a la manzana) */
async function porRuta(stops, acera = false) {
  const coords = stops.map((s) => `${s.lon.toFixed(6)},${s.lat.toFixed(6)}`).join(';');
  const lados = acera ? `&approaches=${stops.map(() => 'curb').join(';')}` : '';
  const url = `${OSRM}/route/v1/driving/${coords}?overview=false&steps=true&geometries=geojson&continue_straight=true${lados}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BusSev (app personal)' }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const j = await res.json();
  if (j.code !== 'Ok' || !j.routes?.[0]) throw new Error(`OSRM ${j.code}`);
  return puntosDe(j.routes[0].legs);
}
async function tramos(stops) {
  try { return await porAjuste(stops); } catch (e) {
    process.stdout.write(`   (ajuste no disponible: ${e.message}; se usa la ruta)\n`);
    await esperar(PAUSA_MS);
    return porRuta(stops);
  }
}

/* ¿Este tramo da un rodeo que el autobús no da? (vuelta a la manzana, cambio de calzada…)
   Entre dos paradas seguidas el bus va casi recto: si el camino calculado es mucho más largo
   que la distancia en línea recta, se usa la recta. */
export const esRodeo = (distancia, recta) => distancia > Math.max(recta * 1.8, recta + 250);
/* Cuánto se aparta el camino de la línea recta entre las dos paradas (en metros).
   Una vuelta a la manzana se va 100-200 m hacia un lado aunque el camino no sea muy largo. */
function desvio(pts, a, b) {
  const r = Math.PI / 180, kx = 111320 * Math.cos(a[0] * r), ky = 110540;
  const P = (q) => [(q[1] - a[1]) * kx, (q[0] - a[0]) * ky];
  const [bx, by] = P(b), L2 = bx * bx + by * by;
  let max = 0;
  for (const q of pts) {
    const [x, y] = P(q);
    const t = L2 ? Math.max(0, Math.min(1, (x * bx + y * by) / L2)) : 0;
    max = Math.max(max, Math.hypot(x - t * bx, y - t * by));
  }
  return max;
}
export const tramoRaro = (leg, a, b) => {
  const recta = hav(a, b);
  return !leg.pts.length || esRodeo(leg.distancia, recta) || desvio(leg.pts, a, b) > Math.max(150, recta * 0.6);
};
let rehechos = 0, rarosQuedan = 0;
const MAX_REHECHOS = Number(process.env.OSRM_MAX_REHECHOS ?? 150);
// GitHub corta este paso a los 10 min: se deja margen para guardar siempre lo calculado
const INICIO = Date.now();
const quedaTiempo = (min) => Date.now() - INICIO < min * 60_000;

const salida = {};
const ajustes = new Map();   // parada -> { dist, pos } (posición en la calle)
let ok = 0, rectos = 0;
if (!process.env.BUSSEV_SOLO_FUNCIONES) for (const [k, lista] of grupos) {
  const stops = lista.sort((a, b) => a.orden - b.orden);
  if (stops.length < 2) continue;
  if (!quedaTiempo(7)) { process.stdout.write(`… sin tiempo: ${k} queda en línea recta\n`); continue; }
  try {
    const legs = [];
    for (let i = 0; i < stops.length - 1; i += MAX_WAYPOINTS - 1) {
      const trozo = stops.slice(i, i + MAX_WAYPOINTS);
      legs.push(...await tramos(trozo));
      await esperar(PAUSA_MS);
    }
    // Si el coche da un rodeo que el autobús no da (carriles bus, calles cortadas), ese tramo va en recta.
    // Tramo raro (rodeo o vuelta a la manzana): se recalcula solo ese tramo llegando por el lado de la acera;
    // si sigue raro, ese tramo va en línea recta entre las dos paradas.
    /* Un tramo raro (rodeo o vuelta a la manzana) se recalcula de otras dos formas (llegando por el lado de la
       acera y sin restricciones) y se queda el MEJOR camino POR CALLE de los tres. Nunca en línea recta por encima
       de las casas: solo si OSRM no da ningún camino para ese tramo. */
    const nota = (leg, a, b) => (leg?.pts?.length ? leg.distancia / Math.max(30, hav(a, b)) + desvio(leg.pts, a, b) / 100 : Infinity);
    const recto = [];
    for (let i = 0; i < legs.length; i++) {
      const a = [stops[i].lat, stops[i].lon], b = [stops[i + 1].lat, stops[i + 1].lon];
      if (!tramoRaro(legs[i], a, b)) { recto.push(false); continue; }
      const opciones = [legs[i]];
      for (const acera of [false, true]) {
        if (rehechos >= MAX_REHECHOS || !quedaTiempo(5.5)) break;
        rehechos++;
        try {
          await esperar(PAUSA_MS);
          const [nuevo] = await porRuta([stops[i], stops[i + 1]], acera);
          if (nuevo?.pts?.length) opciones.push(nuevo);
          if (nuevo && !tramoRaro(nuevo, a, b)) break;          // ya hay uno bueno
        } catch { /* se prueba la siguiente forma */ }
      }
      const mejor = opciones.filter((o) => o?.pts?.length).sort((x, y) => nota(x, a, b) - nota(y, a, b))[0];
      if (mejor) { legs[i] = mejor; recto.push(false); if (tramoRaro(mejor, a, b)) rarosQuedan++; }
      else { recto.push(true); rectos++; }
    }
    /* Las coordenadas de las paradas que publica TUSSAM a veces caen 20-30 m fuera de la calle (dentro de una
       manzana). Se usa el punto de la calle por donde pasa el autobús que OSRM ha encajado para esa parada,
       si está cerca (menos de 60 m); si no, la coordenada original. */
    const enCalle = (i) => {
      const raw = [stops[i].lat, stops[i].lon];
      const cand = [];
      if (i > 0 && !recto[i - 1]) cand.push(legs[i - 1].pts[legs[i - 1].pts.length - 1]);
      if (i < legs.length && !recto[i]) cand.push(legs[i].pts[0]);
      const q = cand.find((c) => c && hav(raw, c) <= 60);
      const qLinea = cand.find((c) => c && hav(raw, c) <= 150);
      // La línea pasa siempre por la calzada (aunque la parada esté algo lejos);
      // el punto de la parada se dibuja donde diga OpenStreetMap (en la acera)
      if (osm.has(stops[i].codigo)) return qLinea || raw;
      if (!q) return qLinea || raw;
      const dist = hav(raw, q);
      const prev = ajustes.get(stops[i].codigo);
      if (dist > 3 && (!prev || dist < prev.dist)) ajustes.set(stops[i].codigo, { dist, pos: q });
      return q;
    };
    const pts = [enCalle(0)];
    const idx = [0];
    legs.forEach((leg, i) => {
      const b = enCalle(i + 1);
      const tramo = recto[i] ? [b] : [...leg.pts.slice(1, -1), b];
      for (const q of tramo) pts.push([Math.round(q[0] * 1e5), Math.round(q[1] * 1e5)].map((v) => v / 1e5));
      idx.push(pts.length - 1);
    });
    // Compresión: diferencias enteras (1e-5 grados ≈ 1 m)
    const d = [];
    let pl = 0, pn = 0;
    for (const [lat, lon] of pts) {
      const L = Math.round(lat * 1e5), N = Math.round(lon * 1e5);
      d.push(L - pl, N - pn); pl = L; pn = N;
    }
    salida[k] = { d, s: idx };
    ok++;
    process.stdout.write(`✓ ${k} (${stops.length} paradas)\n`);
  } catch (e) {
    process.stdout.write(`✗ ${k}: ${e.message}\n`);
    await esperar(PAUSA_MS);
  }
}

if (!process.env.BUSSEV_SOLO_FUNCIONES) fs.writeFileSync(`${ROOT}www/recorridos.js`,
  `/* Recorridos por calle calculados con OSRM (© OpenStreetMap). ${new Date().toISOString().slice(0, 10)} */\nwindow.BUSSEV_RECORRIDOS=${JSON.stringify(salida)};\n` +
  `/* Paradas colocadas sobre la calle por la que pasa el autobús (las de TUSSAM a veces caen dentro de una manzana) */\nwindow.BUSSEV_PARADAS_AJUSTADAS=${JSON.stringify(Object.fromEntries([...[...ajustes].map(([c, a]) => [c, a.pos.map((v) => Math.round(v * 1e6) / 1e6)]), ...osm]))};\n`);
if (!process.env.BUSSEV_SOLO_FUNCIONES) console.log(`Recorridos: ${ok}/${grupos.size} líneas-sentido, ${rehechos} recálculos de tramos raros (${rarosQuedan} siguen algo raros, pero por calle), ${rectos} en recta (sin camino); paradas: ${osm.size} con OpenStreetMap y ${ajustes.size} pegadas a la calle.`);

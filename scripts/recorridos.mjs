// Calcula el recorrido de cada línea siguiendo las calles (no en línea recta entre paradas).
// Se ejecuta en GitHub al compilar el APK y guarda el resultado en www/recorridos.js.
// Usa el servidor público de OSRM (datos de OpenStreetMap). Si falla, la app usa líneas rectas.
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

const grupos = new Map();
for (const [cod, lin, sentido, orden] of D.recorridos) {
  const p = paradas.get(cod);
  if (!p) continue;
  const k = `${lin}|${sentido}`;
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k).push({ orden, lat: p.latitud, lon: p.longitud });
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
async function porAjuste(stops) {
  const coords = stops.map((s) => `${s.lon.toFixed(6)},${s.lat.toFixed(6)}`).join(';');
  const radios = stops.map(() => 35).join(';');
  const url = `${OSRM}/match/v1/driving/${coords}?overview=false&steps=true&geometries=geojson&gaps=ignore&tidy=false&radiuses=${radios}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BusSev (app personal)' }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`OSRM match ${res.status}`);
  const j = await res.json();
  // Solo vale si ha encajado TODAS las paradas en un único recorrido continuo
  if (j.code !== 'Ok' || j.matchings?.length !== 1 || !j.tracepoints?.every(Boolean)) throw new Error(j.code !== 'Ok' ? `OSRM match ${j.code}` : 'no encajan todas las paradas');
  const legs = j.matchings[0].legs;
  if (legs.length !== stops.length - 1) throw new Error('OSRM match: tramos incompletos');
  return puntosDe(legs);
}
/* 2) Si el ajuste no sale, ruta normal parada a parada, llegando por el lado de la acera (derecha) */
async function porRuta(stops) {
  const coords = stops.map((s) => `${s.lon.toFixed(6)},${s.lat.toFixed(6)}`).join(';');
  const lados = stops.map(() => 'curb').join(';');
  const url = `${OSRM}/route/v1/driving/${coords}?overview=false&steps=true&geometries=geojson&continue_straight=true&approaches=${lados}`;
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
export const esRodeo = (distancia, recta) => distancia > Math.max(recta * 2, recta + 350);

const salida = {};
let ok = 0, rectos = 0;
if (!process.env.BUSSEV_SOLO_FUNCIONES) for (const [k, lista] of grupos) {
  const stops = lista.sort((a, b) => a.orden - b.orden);
  if (stops.length < 2) continue;
  try {
    const legs = [];
    for (let i = 0; i < stops.length - 1; i += MAX_WAYPOINTS - 1) {
      const trozo = stops.slice(i, i + MAX_WAYPOINTS);
      legs.push(...await tramos(trozo));
      await esperar(PAUSA_MS);
    }
    const pts = [[stops[0].lat, stops[0].lon]];
    const idx = [0];
    legs.forEach((leg, i) => {
      const a = [stops[i].lat, stops[i].lon], b = [stops[i + 1].lat, stops[i + 1].lon];
      const recta = hav(a, b);
      // Si el coche da un rodeo que el autobús no da (carriles bus, calles cortadas), usamos la recta.
      const usarRecta = !leg.pts.length || esRodeo(leg.distancia, recta);
      if (usarRecta) rectos++;
      const tramo = usarRecta ? [b] : [...leg.pts.slice(1, -1), b];
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
  `/* Recorridos por calle calculados con OSRM (© OpenStreetMap). ${new Date().toISOString().slice(0, 10)} */\nwindow.BUSSEV_RECORRIDOS=${JSON.stringify(salida)};\n`);
if (!process.env.BUSSEV_SOLO_FUNCIONES) console.log(`Recorridos: ${ok}/${grupos.size} líneas-sentido, ${rectos} tramos en recta.`);

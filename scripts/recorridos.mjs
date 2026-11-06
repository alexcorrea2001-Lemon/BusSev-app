// Calcula el recorrido de cada línea siguiendo las calles (no en línea recta entre paradas).
// Se ejecuta en GitHub al compilar el APK y guarda el resultado en www/recorridos.js.
// Usa el servidor público de OSRM (datos de OpenStreetMap). Si falla, la app usa líneas rectas.
import fs from 'node:fs';
import vm from 'node:vm';

const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const ROOT = new URL('..', import.meta.url).pathname;
const MAX_WAYPOINTS = 80;
const PAUSA_MS = 1100; // el servidor público pide como mucho 1 consulta por segundo

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

async function tramos(stops) {
  // Devuelve, para cada par de paradas seguidas, la lista de puntos [lat, lon] por calle.
  const coords = stops.map((s) => `${s.lon.toFixed(6)},${s.lat.toFixed(6)}`).join(';');
  const url = `${OSRM}/route/v1/driving/${coords}?overview=false&steps=true&geometries=geojson&continue_straight=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BusSev (app personal)' }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const j = await res.json();
  if (j.code !== 'Ok' || !j.routes?.[0]) throw new Error(`OSRM ${j.code}`);
  return j.routes[0].legs.map((leg) => {
    const pts = [];
    for (const st of leg.steps) for (const [lon, lat] of st.geometry.coordinates) {
      const q = [lat, lon];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
    }
    return { pts, distancia: leg.distance };
  });
}

const salida = {};
let ok = 0, rectos = 0;
for (const [k, lista] of grupos) {
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
      const usarRecta = !leg.pts.length || leg.distancia > Math.max(recta * 2.5, recta + 700);
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

fs.writeFileSync(`${ROOT}www/recorridos.js`,
  `/* Recorridos por calle calculados con OSRM (© OpenStreetMap). ${new Date().toISOString().slice(0, 10)} */\nwindow.BUSSEV_RECORRIDOS=${JSON.stringify(salida)};\n`);
console.log(`Recorridos: ${ok}/${grupos.size} líneas-sentido, ${rectos} tramos en recta.`);

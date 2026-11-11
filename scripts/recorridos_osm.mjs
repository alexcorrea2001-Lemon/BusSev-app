// Recorrido REAL de cada línea desde las relaciones route=bus de OpenStreetMap.
// TUSSAM no publica la geometría en su GTFS (no trae shapes.txt), así que la comunidad de OSM es
// la única fuente del trazado real por calle. Se consulta con la API pública Overpass.
// Datos © colaboradores de OpenStreetMap (ODbL).

const OVERPASS = (process.env.OVERPASS_URL || [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
].join(',')).split(',');
const BBOX = '37.28,-6.10,37.47,-5.86';   // Sevilla y alrededores (igual que paradas_osm)

const hav = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const x = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

async function overpass(q) {
  let ultimo;
  for (const url of OVERPASS) {
    try {
      // El cliente esperaba antes 90 s, menos que el tiempo que Overpass se da a sí mismo (180 s): cortaba
      // la consulta pesada antes de tiempo. Ahora se espera algo más que eso.
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': 'BusSev (app personal, no comercial)' }, signal: AbortSignal.timeout(Number(process.env.OSM_TIMEOUT_MS ?? 200_000)) });
      if (!r.ok) throw new Error(`Overpass ${r.status}`);
      const j = await r.json();
      if (!Array.isArray(j.elements)) throw new Error('respuesta rara');
      return j.elements;
    } catch (e) {
      ultimo = new Error(`${new URL(url).hostname}: ${e.message}`);
      console.log(`  OpenStreetMap (recorridos): ${ultimo.message}; se prueba otro servidor`);
      await new Promise((r) => setTimeout(r, Number(process.env.OSM_PAUSA ?? 5000)));
    }
  }
  throw ultimo;
}

/* Une los tramos (ways) de una relación en una sola polilínea continua, volteando los que haga falta. */
export function unir(ways) {
  const segs = ways.filter((w) => Array.isArray(w) && w.length >= 2);
  if (!segs.length) return [];
  let linea = segs[0].slice();
  for (let i = 1; i < segs.length; i++) {
    const w = segs[i];
    const A = linea[0], B = linea[linea.length - 1], P = w[0], Q = w[w.length - 1];
    const dBP = hav(B, P), dBQ = hav(B, Q), dAP = hav(A, P), dAQ = hav(A, Q);
    const min = Math.min(dBP, dBQ, dAP, dAQ);
    if (min === dBP) linea.push(...w.slice(1));
    else if (min === dBQ) linea.push(...w.slice(0, -1).reverse());
    else if (min === dAP) linea = w.slice(0, -1).reverse().concat(linea);
    else linea = w.slice(0, -1).concat(linea);
  }
  // quita puntos repetidos seguidos
  const out = [];
  for (const p of linea) { const l = out[out.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p); }
  return out;
}

/* Descarga las relaciones de autobús de OSM y devuelve  Map: ref(normalizada) -> [ { pts, nombre, from, to, tussam } ].
   Primero pide SOLO las de TUSSAM (operator/network): es mucho más ligero y no agota el tiempo. Si saca pocas,
   recurre a todas las de bus de la zona (como antes). */
export async function recorridosOSM() {
  // 1º las de TUSSAM (consulta ligera y fiable); 2º el resto de rutas de bus (completa, más pesada) para
  // rellenar las que en OSM no están etiquetadas como TUSSAM pero tienen el número correcto. Si la segunda
  // falla (servidor lento), nos quedamos al menos con las de TUSSAM.
  const qTussam = `[out:json][timeout:180];(rel["type"="route"]["route"="bus"]["operator"~"tussam",i](${BBOX});rel["type"="route"]["route"="bus"]["network"~"tussam",i](${BBOX}););out geom;`;
  const qTodas = `[out:json][timeout:180];rel["type"="route"]["route"="bus"](${BBOX});out geom;`;
  const out = new Map();
  const procesar = (els) => {
    for (const rel of els) {
      if (rel.type !== 'relation' || !rel.members) continue;
      const t = rel.tags || {};
      const ref = String(t.ref || '').trim();
      if (!ref) continue;
      const tussam = /tussam/i.test(`${t.operator || ''} ${t.network || ''}`);
      const ways = rel.members.filter((m) => m.type === 'way' && Array.isArray(m.geometry)).map((m) => m.geometry.map((g) => [g.lat, g.lon]));
      const pts = unir(ways);
      if (pts.length < 2) continue;
      const key = ref.replace(/^0+/, '');
      if (!out.has(key)) out.set(key, []);
      out.get(key).push({ pts, nombre: t.name || '', from: t.from || '', to: t.to || '', tussam });
    }
  };
  try { procesar(await overpass(qTussam)); console.log(`  OpenStreetMap: ${out.size} líneas con etiqueta TUSSAM.`); }
  catch (e) { console.log(`  OpenStreetMap (solo TUSSAM) no fue posible (${e.message}).`); }
  try { procesar(await overpass(qTodas)); }
  catch (e) { console.log(`  OpenStreetMap (todas las rutas de bus) no fue posible (${e.message}): se usa solo lo de TUSSAM.`); }
  return out;
}

/* Encaja una polilínea con una lista de paradas (en orden): para cada parada, el punto más cercano
   avanzando hacia delante. Devuelve { idx, coste(mediana), media, max } de las distancias parada↔trazado (m).
   Se usa la MEDIANA como coste: así un par de paradas sueltas (una variante que se salta un bucle, una
   parada mal colocada) no tiran abajo un trazado que por lo demás es el real. */
export function encajar(pts, stops) {
  const idx = [], dists = []; let desde = 0;
  for (const s of stops) {
    let best = desde, bd = Infinity;
    for (let j = desde; j < pts.length; j++) { const dd = hav(s, pts[j]); if (dd < bd) { bd = dd; best = j; } }
    idx.push(best); dists.push(bd); desde = best;
  }
  const orden = dists.slice().sort((a, b) => a - b);
  const mediana = orden.length ? orden[Math.floor(orden.length / 2)] : 0;
  const media = dists.reduce((a, b) => a + b, 0) / Math.max(1, dists.length);
  return { idx, coste: mediana, media, max: dists.length ? Math.max(...dists) : 0 };
}

/* Elige, entre los candidatos de una línea, el que mejor encaja con estas paradas y en su sentido.
   Devuelve { pts, idx, coste } o null si ninguno encaja bien. Umbral generoso: el trazado de OSM es el
   REAL, y es mejor usarlo aunque las paradas no caigan clavadas que dibujar un rodeo de coche con OSRM. */
export function mejorEncaje(candidatos, stops, maxCoste = Number(process.env.OSM_MAX_COSTE ?? 110)) {
  let mejor = null;
  for (const c of candidatos) {
    for (const pts of [c.pts, c.pts.slice().reverse()]) {   // se prueba el trazado y su inverso (sentido)
      const e = encajar(pts, stops);
      const peso = e.coste + (c.tussam ? 0 : 8);            // a igualdad, se prefiere la ruta marcada TUSSAM
      if (!mejor || peso < mejor.peso) mejor = { pts, idx: e.idx, coste: e.coste, max: e.max, peso, tussam: c.tussam };
    }
  }
  if (!mejor) return null;
  // Se acepta si la mayoría de paradas están cerca (mediana) y no hay un disparate (relación de otra línea).
  return (mejor.coste <= maxCoste && mejor.max <= 500) ? mejor : null;
}

// Coloca las paradas de TUSSAM donde están de verdad, usando OpenStreetMap.
// Las coordenadas que publica TUSSAM a veces caen 50-100 m fuera de la calle. En OpenStreetMap
// voluntarios han situado cada parada en su sitio exacto (muchas con su número de TUSSAM en «ref»).
// Se emparejan: 1) por número de parada, 2) si no, por nombre y cercanía. Si no hay pareja segura, no se toca.
// Datos © colaboradores de OpenStreetMap (ODbL), consultados con la API pública Overpass.

const OVERPASS = (process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter').split(',');
// Zona de TUSSAM (Sevilla y alrededores)
const BBOX = '37.28,-6.10,37.47,-5.86';

const hav = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const x = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'avda', 'av', 'avenida', 'calle', 'c', 'pza', 'plaza', 'glorieta', 'ronda', 'parada', 'tussam']);
const palabras = (t) => new Set(String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !VACIAS.has(w)));
function parecido(a, b) {
  const A = palabras(a), B = palabras(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}
const numeros = (tags) => ['ref', 'ref:tussam', 'ref:TUSSAM', 'local_ref', 'ref:bus', 'ref_name']
  .map((k) => String(tags?.[k] || '')).join(';').split(/[;,/ ]+/).map((x) => x.replace(/^0+/, '')).filter((x) => /^\d{1,5}$/.test(x));

async function descargar() {
  const q = `[out:json][timeout:90];(node["highway"="bus_stop"](${BBOX});node["public_transport"="platform"]["bus"="yes"](${BBOX});node["public_transport"="stop_position"]["bus"="yes"](${BBOX}););out body;`;
  let ultimo;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': 'BusSev (app personal, no comercial)' }, signal: AbortSignal.timeout(100_000) });
      if (!r.ok) throw new Error(`Overpass ${r.status}`);
      const j = await r.json();
      if (!Array.isArray(j.elements)) throw new Error('Overpass: respuesta rara');
      return j.elements.filter((e) => e.type === 'node' && e.lat && e.lon);
    } catch (e) { ultimo = e; }
  }
  throw ultimo;
}

/* Devuelve { ajustes: Map(codigo -> [lat, lon]), porNumero, porNombre, nodos } */
export async function paradasOSM(paradas, nodos) {
  nodos ??= await descargar();
  // Se prefieren los andenes / señales de parada (donde espera la gente) a los puntos sobre la calzada
  const peso = (n) => (n.tags?.highway === 'bus_stop' || n.tags?.public_transport === 'platform' ? 0 : 1);
  const porRef = new Map();
  for (const n of nodos) for (const r of numeros(n.tags)) { if (!porRef.has(r)) porRef.set(r, []); porRef.get(r).push(n); }
  const ajustes = new Map();
  const usados = new Set();
  let porNumero = 0, porNombre = 0;
  for (const p of paradas) {
    const yo = [p.latitud, p.longitud];
    // 1) mismo número de parada y a menos de 400 m
    const cand = (porRef.get(String(p.codigo).replace(/^0+/, '')) || [])
      .map((n) => ({ n, d: hav(yo, [n.lat, n.lon]) })).filter((x) => x.d < 400)
      .sort((a, b) => peso(a.n) - peso(b.n) || a.d - b.d);
    if (cand.length) { ajustes.set(p.codigo, [cand[0].n.lat, cand[0].n.lon]); usados.add(cand[0].n.id); porNumero++; continue; }
    // 2) nombre parecido y a menos de 150 m (y sin número que diga otra cosa)
    const mio = String(p.codigo).replace(/^0+/, '');
    const porNom = nodos.map((n) => ({ n, d: hav(yo, [n.lat, n.lon]), s: parecido(p.nombre, n.tags?.name) }))
      .filter((x) => x.d < 150 && x.s >= 0.6 && !usados.has(x.n.id) && !numeros(x.n.tags).some((r) => r !== mio))
      .sort((a, b) => b.s - a.s || peso(a.n) - peso(b.n) || a.d - b.d);
    if (porNom.length) { ajustes.set(p.codigo, [porNom[0].n.lat, porNom[0].n.lon]); usados.add(porNom[0].n.id); porNombre++; }
  }
  for (const [k, v] of ajustes) ajustes.set(k, v.map((x) => Math.round(x * 1e6) / 1e6));
  return { ajustes, porNumero, porNombre, nodos: nodos.length };
}

// Trazado OFICIAL de cada línea de TUSSAM, publicado como datos abiertos por el Ayuntamiento de
// Sevilla (IDE Sevilla / cda-idesevilla, capa "TUSSAM_Lineas"). Es la geometría REAL por calle de
// (casi) todas las líneas, ida y vuelta: la fuente más fiable y completa del recorrido. Por eso se usa
// ANTES que OpenStreetMap y que OSRM. El archivo geojson/lineas.json lo mantiene al día
// scripts/actualizar_datos.sh en cada compilación (si no se puede bajar, va el que lleva el repositorio).
// Datos © Ayuntamiento de Sevilla (datos abiertos, IDE Sevilla).
import fs from 'node:fs';
import { unir } from './recorridos_osm.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

// Número de línea como lo usa el resto del cálculo: sin ceros a la izquierda ("01" -> "1", "38A" -> "38A").
export const normLinea = (r) => String(r == null ? '' : r).trim().replace(/^0+(?=.)/, '');

/* Lee el GeoJSON oficial y agrupa los trazados por número de línea. Devuelve
     Map: ref -> [ { pts:[[lat,lon]...], nombre, dest, tussam:true } ]
   con una o varias variantes por línea (ida, vuelta y a veces refuerzos). mejorEncaje() se encarga de
   elegir, para cada línea-sentido de la app, la variante y el sentido que mejor encajan con las paradas.
   Las coordenadas de GeoJSON vienen en orden [lon,lat]; se pasan al orden [lat,lon] que usa la app. */
export function recorridosTussam(archivo = `${ROOT}geojson/lineas.json`) {
  let j;
  try { j = JSON.parse(fs.readFileSync(archivo, 'utf8')); }
  catch (e) { console.log(`  Trazado oficial de TUSSAM no disponible (${e.message}).`); return new Map(); }
  const feats = Array.isArray(j?.features) ? j.features : [];
  const out = new Map();
  for (const f of feats) {
    const g = f && f.geometry;
    if (!g) continue;
    let pts = [];
    if (g.type === 'LineString') {
      pts = (g.coordinates || []).map(([lon, lat]) => [lat, lon]);
    } else if (g.type === 'MultiLineString') {
      // Varios tramos: se cosen en una sola polilínea continua (igual que las relaciones de OSM).
      pts = unir((g.coordinates || []).map((seg) => seg.map(([lon, lat]) => [lat, lon])));
    } else {
      continue;
    }
    // Quita puntos no válidos y repetidos seguidos.
    const limpio = [];
    for (const p of pts) {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      const l = limpio[limpio.length - 1];
      if (!l || l[0] !== p[0] || l[1] !== p[1]) limpio.push(p);
    }
    if (limpio.length < 2) continue;
    const pr = f.properties || {};
    const ref = normLinea(pr.LabelLinea);
    if (!ref) continue;
    if (!out.has(ref)) out.set(ref, []);
    out.get(ref).push({ pts: limpio, nombre: pr.NombreLinea || '', dest: pr.DestinoRuta || '', tussam: true });
  }
  return out;
}

const hav = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const x = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

/* Coloca cada parada (en orden) sobre el punto más cercano del trazado avanzando siempre hacia delante.
   Devuelve los índices, las distancias parada↔trazado y su mediana (coste robusto: una parada suelta no
   penaliza un trazado que por lo demás es el real). */
function snap(pts, stops) {
  const idx = [], dists = []; let desde = 0;
  for (const s of stops) {
    let best = desde, bd = Infinity;
    for (let j = desde; j < pts.length; j++) { const dd = hav(s, pts[j]); if (dd < bd) { bd = dd; best = j; } }
    idx.push(best); dists.push(bd); desde = best;
  }
  const o = dists.slice().sort((a, b) => a - b);
  return { idx, dists, mediana: o.length ? o[o.length >> 1] : 0, max: dists.length ? Math.max(...dists) : 0 };
}

/* Elige, entre las variantes oficiales de una línea (y su sentido inverso), la que mejor encaja con estas
   paradas, por la MEDIANA de las distancias. A diferencia de OSM, aquí los candidatos ya vienen filtrados
   por el número EXACTO de línea, así que no hay riesgo de coger la relación de otra línea: no se descarta
   por un máximo alto. Localiza la PRIMERA y la ÚLTIMA parada que el trazado oficial cubre bien; las paradas
   que queden fuera por un extremo (porque el trazado oficial no llega a ese extremo, o va por otra calle) se
   rellenan luego siguiendo las calles (en recorridos.mjs, con OSRM). Devuelve
     { body, bodyIdx, firstCovered, lastCovered, coste }
   o null si ni la mejor variante se parece (línea mal emparejada). */
export function encajarOficial(cand, stops, maxMediana = Number(process.env.OFICIAL_MAX_MEDIANA ?? 150)) {
  let best = null;
  for (const c of cand) {
    for (const pts of [c.pts, c.pts.slice().reverse()]) {
      const e = snap(pts, stops);
      if (!best || e.mediana < best.mediana) best = { pts, idx: e.idx, dists: e.dists, mediana: e.mediana };
    }
  }
  if (!best || best.mediana > maxMediana) return null;
  return { body: best.pts, bodyIdx: best.idx, dists: best.dists, coste: best.mediana };
}

// Índice (punto más cercano, avanzando hacia delante) de cada parada sobre una polilínea ya montada.
export function indices(pts, stops) {
  return snap(pts, stops.map((s) => (Array.isArray(s) ? s : [s.lat, s.lon]))).idx;
}

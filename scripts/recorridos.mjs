// Calcula el recorrido de cada línea siguiendo las calles (no en línea recta entre paradas).
// Se ejecuta en GitHub al compilar el APK y guarda el resultado en www/recorridos.js.
// Usa el servidor público de OSRM (datos de OpenStreetMap). Si falla, la app usa líneas rectas.
// Antes coloca cada parada en su sitio exacto según OpenStreetMap (paradas_osm.mjs).
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { recorridosOSM, mejorEncaje } from './recorridos_osm.mjs';
import { recorridosTussam, encajarOficial, indices } from './recorridos_tussam.mjs';
import { leerCalles, redDeCalles, pegarACalles } from './pegar_calles.mjs';

const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const ROOT = new URL('..', import.meta.url).pathname;
const MAX_WAYPOINTS = 80;
let MAX_AJUSTE = 10;          // el servidor público de OSRM solo encaja trazados de pocas paradas de una vez
const VERSION_CALCULO = 11;   // 11: trazado OFICIAL ajustado a las calles de OSM con la red guardada en la rama «calles-osm»
                              //     (10: oficial + OSRM /match; 9: oficial; 8: OSM solo-TUSSAM; 7: mediana; 6: shapes/OSM/OSRM)
const PAUSA_MS = Number(process.env.OSRM_PAUSA_MS ?? 1100); // el servidor público pide como mucho 1 consulta por segundo

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(`${ROOT}www/data.js`, 'utf8'), ctx);
const D = ctx.window.BUSSEV_DATA;
const paradas = new Map(D.paradas.map((p) => [p.codigo, p]));

/* Geometría REAL del recorrido que publica TUSSAM (shapes.txt del GTFS), si gtfs_a_datos.py la dejó
   en scripts/_shapes.json. Es la ruta exacta del autobús; si falta una línea, se calcula con OSRM. */
let shapesGtfs = {};
try { shapesGtfs = JSON.parse(fs.readFileSync(`${ROOT}scripts/_shapes.json`, 'utf8')) || {}; } catch { /* no hay: se usa OSRM */ }
if (Object.keys(shapesGtfs).length) console.log(`Geometría real del GTFS para ${Object.keys(shapesGtfs).length} líneas-sentido: se usa en vez de OSRM.`);

/* Trazado OFICIAL de TUSSAM (datos abiertos del Ayuntamiento de Sevilla, capa "TUSSAM_Lineas"): geometría
   real por calle de (casi) todas las líneas, ida y vuelta. Es la fuente MÁS fiable y completa; se usa antes
   que OpenStreetMap y que OSRM. El archivo geojson/lineas.json lo mantiene al día scripts/actualizar_datos.sh. */
let recOficial = new Map();
try { recOficial = recorridosTussam(); if (recOficial.size) console.log(`Trazado oficial de TUSSAM (datos abiertos): ${recOficial.size} líneas con geometría real por calle.`); }
catch (e) { console.log(`Trazado oficial de TUSSAM no disponible (${e.message}): se usará OpenStreetMap/OSRM.`); }
// Firma del trazado oficial (nº de puntos por línea): si cambia, se vuelve a calcular aunque las paradas sigan igual.
const firmaOficial = [...recOficial.entries()].map(([r, a]) => [r, a.reduce((n, c) => n + c.pts.length, 0)]).sort();

/* Calles reales de OpenStreetMap (rama «calles-osm» del repositorio; las descarga el workflow "Calles OSM").
   Con ellas se ajusta el trazado oficial a la calzada del mapa, sin depender de ningún servidor al compilar.
   Si no están, las líneas se quedan con el trazado oficial tal cual. */
let redCalles = null, fechaCalles = '';
if (!process.env.BUSSEV_SOLO_FUNCIONES && !process.env.SIN_PEGAR_OSM) {
  try {
    const datos = leerCalles(ROOT);
    redCalles = redDeCalles(datos); fechaCalles = String(datos.fecha || '');
    console.log(`Calles de OpenStreetMap (${fechaCalles.slice(0, 10)}): ${datos.ways.length} calles; el trazado se ajusta a la calzada.`);
  } catch (e) { console.log(`Calles de OpenStreetMap no disponibles (${String(e.message).split('\n')[0]}): el trazado se queda como lo publica TUSSAM. Lanza el workflow "Calles OSM" para descargarlas.`); }
}

/* 0) Si ya se calcularon (y salieron completos) para estos mismos datos, no se repite: compila más rápido
      y no se carga a los servidores públicos de mapas. */
const FIRMA = crypto.createHash('sha1').update(JSON.stringify([VERSION_CALCULO, D.recorridos, D.paradas.map((p) => [p.codigo, p.latitud, p.longitud]), firmaOficial, fechaCalles])).digest('hex').slice(0, 16);
if (!process.env.BUSSEV_SOLO_FUNCIONES && !process.env.FORZAR_RECORRIDOS) {
  try {
    const previo = fs.readFileSync(`${ROOT}www/recorridos.js`, 'utf8');
    if (previo.includes(`BUSSEV_RECORRIDOS_FIRMA="${FIRMA}"`) && previo.includes('BUSSEV_RECORRIDOS_COMPLETO=true')) {
      console.log('Los recorridos ya están calculados para estos datos: no hace falta repetirlos.');
      process.exit(0);
    }
  } catch { /* no hay previos */ }
}

/* 1) Posición real de cada parada según OpenStreetMap (las de TUSSAM a veces caen 50-100 m fuera de la calle) */
let osm = new Map(), osmReutilizado = false;
if (!process.env.BUSSEV_SOLO_FUNCIONES) {
  try {
    const { paradasOSM } = await import('./paradas_osm.mjs');   // si falta el archivo, se sigue sin él
    const r = await paradasOSM(D.paradas);
    osm = r.ajustes;
    console.log(`OpenStreetMap: ${r.nodos} paradas de bus en la zona; colocadas ${r.porNumero} por número y ${r.porNombre} por nombre (de ${D.paradas.length}).`);
  } catch (e) {
    // OpenStreetMap no contesta: se reutilizan las posiciones que se consiguieron la última vez (van guardadas en recorridos.js)
    try {
      const c2 = { window: {} };
      vm.runInNewContext(fs.readFileSync(`${ROOT}www/recorridos.js`, 'utf8'), c2);
      const prev = c2.window.BUSSEV_PARADAS_OSM || {};
      for (const [cod, pos] of Object.entries(prev)) {
        const p = paradas.get(cod);
        if (p && Array.isArray(pos) && Math.abs(pos[0] - p.latitud) < 0.005 && Math.abs(pos[1] - p.longitud) < 0.005) osm.set(cod, pos);
      }
    } catch { /* no había */ }
    console.log(osm.size
      ? `OpenStreetMap no disponible (${e.message}): se reutilizan ${osm.size} paradas colocadas la vez anterior.`
      : `OpenStreetMap no disponible (${e.message}): se usan las coordenadas de TUSSAM.`);
    osmReutilizado = osm.size > 0;
  }
  for (const [c, pos] of osm) { const p = paradas.get(c); if (p) { p.latitud = pos[0]; p.longitud = pos[1]; } }
}

/* Trazado real de OpenStreetMap (relaciones route=bus de TUSSAM). TUSSAM no da geometría en su GTFS,
   así que OSM es la fuente del recorrido real; las líneas que no estén en OSM se calculan con OSRM. */
let osmRec = new Map();
if (!process.env.BUSSEV_SOLO_FUNCIONES && !process.env.SIN_OSM_RECORRIDOS) {
  try { osmRec = await recorridosOSM(); console.log(`OpenStreetMap: recorridos de ${osmRec.size} refs de línea (relaciones route=bus).`); }
  catch (e) { console.log(`OpenStreetMap (recorridos) no disponible (${e.message}): se usará OSRM.`); }
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
      if (res.status === 400 && extra && !/TooBig|NoMatch/.test(ultimo.message)) { sinRadios = true; await esperar(PAUSA_MS); continue; }
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
/* Encaja una línea entera: en trozos de pocas paradas (lo que admite el servidor público), solapados una parada.
   Si un trozo no se puede encajar, ese trozo va por ruta normal. En modo rápido (poco tiempo), todo por ruta. */
async function tramos(stops, rapido = false) {
  const legs = [];
  if (rapido) {
    for (let i = 0; i < stops.length - 1; i += MAX_WAYPOINTS - 1) { legs.push(...await porRuta(stops.slice(i, i + MAX_WAYPOINTS))); await esperar(PAUSA_MS); }
    return legs;
  }
  for (let i = 0; i < stops.length - 1;) {
    const trozo = stops.slice(i, i + MAX_AJUSTE);
    try { legs.push(...await porAjuste(trozo)); }
    catch (e) {
      if (/TooBig/.test(e.message) && MAX_AJUSTE > 4) { MAX_AJUSTE = Math.max(4, Math.floor(MAX_AJUSTE * 0.7)); await esperar(PAUSA_MS); continue; }   // trozos más pequeños
      if (avisoAjuste++ < 6) process.stdout.write(`   (ajuste no disponible en un trozo: ${e.message}; ese trozo va por ruta)\n`);
      await esperar(PAUSA_MS);
      legs.push(...await porRuta(trozo));
    }
    await esperar(PAUSA_MS);
    i += trozo.length - 1;
  }
  return legs;
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

/* Ruta POR CALLE que pasa por una lista corta de paradas (el extremo de una línea que el trazado oficial
   no cubre). Reutiliza OSRM como el resto; si un tramo daría un rodeo que el autobús no da, ese tramo va en
   recta; si OSRM no está disponible o no queda tiempo, toda la cabeza/cola va en recta (como antes). Nunca
   dibuja un rodeo: en el peor caso, línea recta entre esas pocas paradas. */
async function bordeCalle(stops, rapido) {
  const recta = stops.map((s) => [s.lat, s.lon]);
  if (stops.length < 2 || !quedaTiempo(LIMITE_TOTAL)) return recta;
  let legs;
  try { legs = await tramos(stops, rapido); await esperar(PAUSA_MS); }
  catch { return recta; }
  if (!legs || legs.length !== stops.length - 1) return recta;
  const pts = [[stops[0].lat, stops[0].lon]];
  for (let i = 0; i < legs.length; i++) {
    const a = [stops[i].lat, stops[i].lon], b = [stops[i + 1].lat, stops[i + 1].lon];
    const tramo = (!legs[i] || tramoRaro(legs[i], a, b)) ? [b] : [...legs[i].pts.slice(1, -1), b];
    for (const q of tramo) pts.push(q);
  }
  return pts.length >= 2 ? pts : recta;
}

/* Monta la línea de una línea-sentido a partir del trazado oficial: recorre las paradas en orden y, entre
   cada dos seguidas, usa el trozo del trazado OFICIAL (si ambas están sobre él) o, si alguna cae lejos
   (un extremo que el dato no cubre, o una parada a mitad de recorrido por la que el trazado va por otra
   calle), la ruta POR CALLE que pasa por ellas (OSRM, recta de respaldo). Así ninguna parada queda suelta
   y nada se dibuja recto por encima de las casas. Si todas las paradas están sobre el trazado oficial,
   devuelve el trazado tal cual (caso de casi todas las líneas). Devuelve { pts, idx }. */
/* Red de seguridad: el trazado pegado solo se acepta si no se aparta mucho del oficial (map-matching correcto)
   ni se alarga de forma rara (evita que OSRM se vaya por calles que no son). Si no, se queda el oficial. */
export function pegadoAceptable(oficial, pegado, maxMediana = Number(process.env.PEGAR_MAX_MEDIANA ?? 35)) {
  if (!pegado || pegado.length < 2) return false;
  const largo = (a) => { let s = 0; for (let i = 1; i < a.length; i++) s += hav(a[i - 1], a[i]); return s; };
  const lo = largo(oficial), lp = largo(pegado);
  if (lo < 1 || lp > lo * 1.3 || lp < lo * 0.7) return false;
  const distSeg = (p, poly) => {
    let mn = Infinity;
    for (let i = 0; i + 1 < poly.length; i++) {
      const a = poly[i], b = poly[i + 1], r = Math.PI / 180, kx = 111320 * Math.cos(a[0] * r), ky = 110540;
      const bx = (b[1] - a[1]) * kx, by = (b[0] - a[0]) * ky, px = (p[1] - a[1]) * kx, py = (p[0] - a[0]) * ky;
      const L2 = bx * bx + by * by, t = L2 ? Math.max(0, Math.min(1, (px * bx + py * by) / L2)) : 0;
      mn = Math.min(mn, Math.hypot(px - t * bx, py - t * by));
    }
    return mn;
  };
  const ds = oficial.map((p) => distSeg(p, pegado)).sort((a, b) => a - b);
  return (ds[ds.length >> 1] || 0) <= maxMediana;
}

async function montarOficial(m, stopsLL, rapido) {
  // Solo se reroutea por calle una parada que caiga CLARAMENTE fuera del trazado oficial (un extremo que el
  // dato no cubre, o una parada de en medio por la que el trazado va por otra calle). Una imprecisión pequeña
  // (la parada un poco a un lado de la calzada) se deja sobre el trazado oficial: no merece recalcular nada.
  const U = Number(process.env.OFICIAL_REROUTE_M ?? 130);
  const { body, bodyIdx, dists } = m;
  const n = stopsLL.length, L = body.length;
  const lejos = dists.map((d) => d > U);
  if (!lejos.some(Boolean)) return { pts: body, idx: bodyIdx };   // todo sobre el trazado oficial: tal cual

  const punto = (k) => (lejos[k] ? stopsLL[k] : body[bodyIdx[k]]);   // dónde se coloca cada parada
  const pts = [];
  const mete = (arr, salta) => {
    for (let t = salta ? 1 : 0; t < arr.length; t++) {
      const q = arr[t], l = pts[pts.length - 1];
      if (!Array.isArray(q) || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue;
      if (!l || l[0] !== q[0] || l[1] !== q[1]) pts.push(q);
    }
  };
  // Cabecera del trazado antes de la 1ª parada (si esa parada está sobre el trazado), para no perderla.
  if (!lejos[0] && bodyIdx[0] > 0) mete(body.slice(0, bodyIdx[0] + 1), false);
  else mete([punto(0)], false);

  let k = 0;
  while (k < n - 1) {
    if (lejos[k] || lejos[k + 1]) {
      // tramo con parada lejos: se agrupa toda la racha y se calcula por calle de una vez
      let j = k; while (j < n - 1 && (lejos[j] || lejos[j + 1])) j++;
      const racha = [];
      for (let t = k; t <= j; t++) { const p = punto(t); racha.push({ lat: p[0], lon: p[1] }); }
      mete(await bordeCalle(racha, rapido), true);
      k = j;
    } else {
      // racha de paradas sobre el trazado oficial: se usan sus trozos tal cual
      let j = k; while (j < n - 1 && !(lejos[j] || lejos[j + 1])) j++;
      for (let t = k; t < j; t++) mete(body.slice(bodyIdx[t], bodyIdx[t + 1] + 1), true);
      k = j;
    }
  }
  // Cola del trazado tras la última parada (si esa parada está sobre el trazado).
  if (!lejos[n - 1] && bodyIdx[n - 1] < L - 1) mete(body.slice(bodyIdx[n - 1] + 1), false);

  const linea = pts.length >= 2 ? pts : body;
  return { pts: linea, idx: indices(linea, stopsLL), rerutadas: lejos.filter(Boolean).length };
}
let rehechos = 0, rarosQuedan = 0;
const MAX_REHECHOS = Number(process.env.OSRM_MAX_REHECHOS ?? 150);
// GitHub corta este paso a los 10 min: se deja margen para guardar siempre lo calculado
const INICIO = Date.now();
const quedaTiempo = (min) => Date.now() - INICIO < min * 60_000;
const LIMITE_REHACER = Number(process.env.LIMITE_REHACER_MIN ?? 5);     // recalcular tramos raros
const LIMITE_COMPLETO = Number(process.env.LIMITE_COMPLETO_MIN ?? 6.5); // encaje fino; después, modo rápido
const LIMITE_TOTAL = Number(process.env.LIMITE_TOTAL_MIN ?? 8.5);       // después, se guarda lo que haya
let rapidas = 0, sinCalcular = 0, fallidas = 0;

const salida = {};
const ajustes = new Map();   // parada -> { dist, pos } (posición en la calle)
let ok = 0, rectos = 0, shapesUsados = 0, osmUsados = 0, oficialUsados = 0, pegadosOSM = 0;
if (!process.env.BUSSEV_SOLO_FUNCIONES) for (const [k, lista] of grupos) {
  const stops = lista.sort((a, b) => a.orden - b.orden);
  if (stops.length < 2) continue;
  // Geometría REAL del GTFS: si la hay, se usa tal cual (es el recorrido oficial del bus) y no se llama a OSRM.
  const shp = shapesGtfs[k];
  if (Array.isArray(shp) && shp.length >= 2) {
    const pts = shp.map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]);
    // Índice en la geometría de cada parada: el punto más cercano, avanzando siempre hacia delante
    const idx = []; let desde = 0;
    for (const s of stops) {
      let best = desde, bd = Infinity;
      for (let j = desde; j < pts.length; j++) { const dd = hav([s.lat, s.lon], pts[j]); if (dd < bd) { bd = dd; best = j; } }
      idx.push(best); desde = best;
    }
    const d = []; let pl = 0, pn = 0;
    for (const [lat, lon] of pts) { const L = Math.round(lat * 1e5), N = Math.round(lon * 1e5); d.push(L - pl, N - pn); pl = L; pn = N; }
    salida[k] = { d, s: idx };
    ok++; shapesUsados++; process.stdout.write(`✓ ${k} (geometría real del GTFS, ${stops.length} paradas)\n`);
    continue;
  }
  const refOsm = String(k.split('|')[0]).replace(/^0+/, '');
  // 1.5) Trazado OFICIAL de TUSSAM (datos abiertos del Ayuntamiento de Sevilla): geometría real por calle.
  //      Es la fuente más fiable y completa: se prefiere a OpenStreetMap y a OSRM. encajarOficial elige, entre
  //      las variantes de la línea, la que encaja con las paradas y en su sentido, y prolonga el trazado en
  //      recta hasta las paradas del extremo que no cubra (para que la línea dibujada llegue a todas).
  const candOf = recOficial.get(refOsm);
  if (candOf && candOf.length) {
    const m = encajarOficial(candOf, stops.map((s) => [s.lat, s.lon]));
    if (m) {
      // El cuerpo es el trazado oficial; las paradas que caigan lejos de él (un extremo que el dato no cubre
      // o una parada a mitad de recorrido por la que el trazado va por otra calle) se enlazan siguiendo las
      // calles (OSRM, recta de respaldo). Así ninguna parada queda suelta.
      const rapido = !quedaTiempo(LIMITE_COMPLETO);
      const r = await montarOficial(m, stops.map((s) => [s.lat, s.lon]), rapido);
      // Se ajusta el trazado a las calles reales de OpenStreetMap: queda encima de la calzada del mapa y da la
      // vuelta a las rotondas. Red de seguridad: si el resultado se aparta del oficial o cambia mucho de largo,
      // se queda el oficial (nunca peor).
      let lineaPts = r.pts, pegada = false;
      if (redCalles) {
        let aj = null;
        try { aj = pegarACalles(redCalles, r.pts); } catch { /* se queda el oficial */ }
        if (aj && aj.pegado >= 0.5 && pegadoAceptable(r.pts, aj.pts)) { lineaPts = aj.pts; pegada = true; }
      }
      const idx = pegada ? indices(lineaPts, stops.map((s) => [s.lat, s.lon])) : r.idx;
      const pts = lineaPts.map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]);
      const d = []; let pl = 0, pn = 0;
      for (const [lat, lon] of pts) { const L = Math.round(lat * 1e5), N = Math.round(lon * 1e5); d.push(L - pl, N - pn); pl = L; pn = N; }
      salida[k] = { d, s: idx };
      ok++; oficialUsados++; if (pegada) pegadosOSM++;
      process.stdout.write(`✓ ${k} (trazado oficial de TUSSAM, ${stops.length} paradas, ±${Math.round(m.coste)} m${pegada ? ', ajustado a la calle' : ''}${r.rerutadas ? `, ${r.rerutadas} por calle` : ''})\n`);
      continue;
    }
  }
  // 2) Trazado real de OpenStreetMap (relación route=bus de la línea), si encaja bien con las paradas
  const candOsm = osmRec.get(refOsm);
  if (candOsm && candOsm.length) {
    const m = mejorEncaje(candOsm, stops.map((s) => [s.lat, s.lon]));
    if (m) {
      const pts = m.pts.map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]);
      const d = []; let pl = 0, pn = 0;
      for (const [lat, lon] of pts) { const L = Math.round(lat * 1e5), N = Math.round(lon * 1e5); d.push(L - pl, N - pn); pl = L; pn = N; }
      salida[k] = { d, s: m.idx };
      ok++; osmUsados++; process.stdout.write(`✓ ${k} (OpenStreetMap, ${stops.length} paradas, ±${Math.round(m.coste)} m)\n`);
      continue;
    }
  }
  // Con poco tiempo, el resto de líneas se calcula en modo rápido (una consulta por línea): siempre por calle
  const rapido = !quedaTiempo(LIMITE_COMPLETO);
  if (rapido) rapidas++;
  if (!quedaTiempo(LIMITE_TOTAL)) { process.stdout.write(`… sin tiempo: ${k} queda sin calcular\n`); sinCalcular++; continue; }
  try {
    const legs = await tramos(stops, rapido);
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
        if (rapido || rehechos >= MAX_REHECHOS || !quedaTiempo(LIMITE_REHACER)) break;
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
    process.stdout.write(`✗ ${k}: ${e.message}\n`); fallidas++;
    await esperar(PAUSA_MS);
  }
}

if (!process.env.BUSSEV_SOLO_FUNCIONES) fs.writeFileSync(`${ROOT}www/recorridos.js`,
  `/* Recorridos: trazado OFICIAL de TUSSAM (© Ayuntamiento de Sevilla, datos abiertos) donde está publicado; si no, trazado real de OpenStreetMap (© colaboradores de OSM, ODbL); el resto por calle con OSRM. ${new Date().toISOString().slice(0, 10)} */\nwindow.BUSSEV_RECORRIDOS=${JSON.stringify(salida)};\n` +
  `/* Paradas colocadas sobre la calle por la que pasa el autobús (las de TUSSAM a veces caen dentro de una manzana) */\nwindow.BUSSEV_PARADAS_AJUSTADAS=${JSON.stringify(Object.fromEntries([...[...ajustes].map(([c, a]) => [c, a.pos.map((v) => Math.round(v * 1e6) / 1e6)]), ...osm]))};\n` +
  `/* Posición de las paradas según OpenStreetMap (© colaboradores de OpenStreetMap, ODbL); se reutiliza si un día no contesta */\nwindow.BUSSEV_PARADAS_OSM=${JSON.stringify(Object.fromEntries(osm))};\n` +
  `window.BUSSEV_RECORRIDOS_FIRMA="${FIRMA}";window.BUSSEV_RECORRIDOS_COMPLETO=${!rapidas && !sinCalcular && !fallidas && osm.size > 0 && !osmReutilizado};\n`);
if (!process.env.BUSSEV_SOLO_FUNCIONES) console.log(`Recorridos: ${ok}/${grupos.size} líneas-sentido (${oficialUsados} del trazado oficial de TUSSAM, ${pegadosOSM} ajustadas a la calle (OSM), ${shapesUsados} del GTFS, ${osmUsados} de OpenStreetMap, el resto por OSRM), ${rehechos} recálculos de tramos raros (${rarosQuedan} siguen algo raros, pero por calle), ${rectos} en recta (sin camino); paradas: ${osm.size} con OpenStreetMap y ${ajustes.size} pegadas a la calle; ${rapidas} líneas en modo rápido, ${sinCalcular} sin calcular.`);

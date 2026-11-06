/* BusSev sin servidor: responde a las mismas rutas que la API TUSSAM, pero desde el móvil.
   - Paradas, líneas y recorridos: los datos incluidos en la app (data.js).
   - Tiempos de llegada: se piden directamente a TUSSAM. En la app Android, Capacitor
     hace la petición de forma nativa, así que no le afecta el bloqueo CORS del navegador. */
'use strict';
(() => {
  const D = window.BUSSEV_DATA;
  const ORIGEN = 'https://reddelineas.tussam.es';
  const CACHE_MS = 30_000;          // tiempos recientes que reutilizamos sin volver a preguntar
  const STALE_MS = 10 * 60_000;     // si TUSSAM falla, enseñamos lo último bueno hasta 10 min
  const MAX_SIMULTANEAS = 4;

  const paradaByCode = new Map(D.paradas.map((p) => [p.codigo, p]));
  const lineaByNum = new Map(D.lineas.map((l) => [l.numero, l]));
  const recorrido = new Map();      // linea -> [{...parada, sentido, orden}]
  const sentidosEn = new Map();     // `${parada}|${linea}` -> [sentidos]
  const lineasEn = new Map();       // parada -> Set(lineas)
  for (const [cod, lin, sentido, orden] of D.recorridos) {
    const p = paradaByCode.get(cod);
    if (!p) continue;
    if (!recorrido.has(lin)) recorrido.set(lin, []);
    recorrido.get(lin).push({ ...p, sentido, orden });
    const k = `${cod}|${lin}`;
    if (!sentidosEn.has(k)) sentidosEn.set(k, []);
    if (!sentidosEn.get(k).includes(sentido)) sentidosEn.get(k).push(sentido);
    if (!lineasEn.has(cod)) lineasEn.set(cod, new Set());
    lineasEn.get(cod).add(lin);
  }
  const ordenLineas = new Map(D.lineas.map((l, i) => [l.numero, i]));

  /* Cuando caducan los datos oficiales incluidos en la app (o falta una línea),
     se piden las paradas de la línea a TUSSAM en directo y se guardan 7 días. */
  const caducados = () => !!D.caduca && Date.now() > Date.parse(D.caduca + 'T23:59:59');
  const fhTussam = () => { const d = new Date(); const z = (n) => String(n).padStart(2, '0'); return `${z(d.getDate())}-${z(d.getMonth() + 1)}-${d.getFullYear()}T${z(d.getHours())}%3A${z(d.getMinutes())}%3A${z(d.getSeconds())}`; };
  const leerCache = (k) => { try { const v = JSON.parse(localStorage.getItem('bussev.live.' + k) || 'null'); return v && Date.now() - v.at < 7 * 86400_000 ? v.data : null; } catch { return null; } };
  const guardarCache = (k, data) => { try { localStorage.setItem('bussev.live.' + k, JSON.stringify({ at: Date.now(), data })); } catch { /* sin espacio */ } };
  let lineasLiveP = null;
  async function lineasLive() {
    const c = leerCache('lineas'); if (c) return c;
    lineasLiveP ??= fetch(`${ORIGEN}/API/infotus-ui/lineas/${fhTussam()}`, { headers: { Accept: 'application/json' } }).then((r) => r.json()).then((j) => {
      const l = (j?.result?.lineasDisponibles || []).map((x) => ({ id: x.linea, numero: String(x.labelLinea || '') })).filter((x) => x.id && /^[A-Za-z0-9]{1,8}$/.test(x.numero));
      if (l.length) guardarCache('lineas', l);
      return l;
    }).finally(() => { lineasLiveP = null; });
    return lineasLiveP;
  }
  async function recorridoLive(numero) {
    const c = leerCache('rec.' + numero); if (c) return c;
    const info = (await lineasLive()).find((x) => x.numero === numero);
    if (!info) return null;
    const out = [];
    for (const sentido of [1, 2]) {
      const j = await fetch(`${ORIGEN}/API/infotus-ui/nodosLinea/${encodeURIComponent(info.id)}/${sentido}/${fhTussam()}`, { headers: { Accept: 'application/json' } }).then((r) => r.json()).catch(() => null);
      (Array.isArray(j?.result) ? j.result : []).forEach((n, orden) => {
        const codigo = String(n?.codigo ?? '');
        const lat = (n?.posicion?.latitudE6 || 0) / 1e6, lon = (n?.posicion?.longitudE6 || 0) / 1e6;
        if (!/^\d{1,7}$/.test(codigo) || !lat || !lon) return;
        const base = paradaByCode.get(codigo) || {};
        out.push({ ...base, codigo, nombre: base.nombre || String(n?.descripcion?.texto || `Parada ${codigo}`).slice(0, 120), latitud: lat, longitud: lon, sentido, orden });
      });
    }
    if (out.length) guardarCache('rec.' + numero, out);
    return out.length ? out : null;
  }
  async function recorridoDe(numero) {
    const local = recorrido.get(numero);
    if (local && !caducados()) return local;
    const live = await recorridoLive(numero).catch(() => null);
    if (live) {
      for (const p of live) if (!paradaByCode.has(p.codigo)) paradaByCode.set(p.codigo, p);
      return live;
    }
    return local || null;
  }

  class HttpError extends Error { constructor(status, msg) { super(msg || `HTTP ${status}`); this.status = status; } }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, r = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* ---------- tiempos desde TUSSAM ---------- */
  const cache = new Map();      // parada -> {at, data}
  const enVuelo = new Map();    // parada -> Promise
  let pausaHasta = 0;           // si TUSSAM nos pide esperar (429)
  let activas = 0; const cola = [];
  const turno = () => new Promise((res) => { if (activas < MAX_SIMULTANEAS) { activas++; res(); } else cola.push(res); });
  const liberar = () => { const n = cola.shift(); if (n) n(); else activas--; };

  function normalizar(json, codigo) {
    let r = json && json.result;
    if (Array.isArray(r)) r = r.find((x) => x && typeof x === 'object') || {};
    if (!r || typeof r !== 'object') r = {};
    const tiempos = [];
    for (const l of r.lineasCoincidentes || []) {
      const label = String(l.labelLinea || '');
      const s = sentidosEn.get(`${codigo}|${label}`) || [];
      for (const e of l.estimaciones || []) {
        if (e.segundos == null) continue;
        tiempos.push({
          linea: label,
          color: l.color || lineaByNum.get(label)?.color || '#000000',
          tiempo_minutos: Math.floor(e.segundos / 60),
          destino: e.destino?.texto || '',
          distancia_metros: e.distancia ?? null,
          vehiculo: e.vehiculo ?? null,
          sentido: s.length === 1 ? s[0] : null,
        });
      }
    }
    tiempos.sort((a, b) => a.tiempo_minutos - b.tiempo_minutos);
    const p = paradaByCode.get(codigo) || {};
    const pos = r.posicion || {};
    return {
      parada: codigo,
      nombre: r.descripcion?.texto || p.nombre || '',
      latitud: pos.latitudE6 ? pos.latitudE6 / 1e6 : (p.latitud ?? null),
      longitud: pos.longitudE6 ? pos.longitudE6 / 1e6 : (p.longitud ?? null),
      tiempos: tiempos.slice(0, 40),   // sin recortar de más: en paradas con muchas líneas se perdían autobuses
    };
  }

  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  /* Respaldo: tu propio servidor (el mismo del saldo), que guarda los últimos tiempos de TUSSAM */
  async function pedirAlServidor(codigo) {
    const base = (typeof settings !== 'undefined' && settings.saldoURL) ? String(settings.saldoURL).replace(/\/+$/, '') : '';
    if (!base) throw new HttpError(502, 'Sin servidor propio');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(`${base}/tiempos/${encodeURIComponent(codigo)}`, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
      if (!r.ok) throw new HttpError(502, `Tu servidor respondió ${r.status}`);
      const j = await r.json();
      if (!j?.ok || !j.tussam) throw new HttpError(502, j?.error || 'Tu servidor no tiene datos');
      const d = normalizar(j.tussam, codigo);
      return j.antiguo ? { ...d, stale: true, cached_at: new Date(j.at).toISOString() } : d;
    } finally { clearTimeout(t); }
  }
  /* Pide a TUSSAM; si falla la red o TUSSAM da un error pasajero, lo intenta otra vez
     (no si TUSSAM pide esperar), y si sigue fallando prueba con tu servidor. */
  async function pedirATussam(codigo) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new HttpError(503, 'Sin conexión a internet');
    let ultimo;
    for (const pausa of [0, 800, 2000]) {
      if (pausa) await espera(pausa);
      try { return await pedirUnaVez(codigo); } catch (e) {
        ultimo = e;
        if (e.status === 429 || e.status === 404) break;
      }
    }
    try { return await pedirAlServidor(codigo); } catch { /* sin respaldo */ }
    throw ultimo;
  }
  async function pedirUnaVez(codigo) {
    if (Date.now() < pausaHasta) throw new HttpError(429);
    await turno();
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      let res;
      try {
        res = await fetch(`${ORIGEN}/API/infotus-ui/tiempos/${encodeURIComponent(codigo)}`, {
          headers: { Accept: 'application/json', Referer: `${ORIGEN}/` }, signal: ctrl.signal,
        });
      } finally { clearTimeout(t); }
      if (res.status === 429) {
        const ra = parseInt(res.headers.get('Retry-After') || '15', 10);
        pausaHasta = Date.now() + Math.min(Math.max(ra, 5), 120) * 1000;
        throw new HttpError(429);
      }
      if (!res.ok) throw new HttpError(502, `TUSSAM respondió ${res.status}`);
      const txt = await res.text();
      let json; try { json = JSON.parse(txt); } catch { throw new HttpError(502, 'Respuesta de TUSSAM no válida'); }
      return normalizar(json, codigo);
    } finally { liberar(); }
  }

  async function tiempos(codigo) {
    const c = cache.get(codigo);
    if (c && Date.now() - c.at < CACHE_MS) return c.data;
    if (enVuelo.has(codigo)) return enVuelo.get(codigo);
    const p = pedirATussam(codigo).then((data) => {
      cache.set(codigo, { at: Date.now(), data });
      return data;
    }).catch((e) => {
      if (c && Date.now() - c.at < STALE_MS) return { ...c.data, stale: true, cached_at: new Date(c.at).toISOString() };
      throw e;
    }).finally(() => enVuelo.delete(codigo));
    enVuelo.set(codigo, p);
    return p;
  }

  /* ---------- rutas ---------- */
  async function get(path) {
    const u = new URL(path, 'https://bussev.local');
    const seg = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const q = u.searchParams;

    if (seg[0] === 'paradas' && seg.length === 1) return D.paradas;
    if (seg[0] === 'lineas' && seg.length === 1) return D.lineas;
    if (seg[0] === 'lineas' && seg[2] === 'paradas') {
      const r = await recorridoDe(seg[1]);
      if (!r) throw new HttpError(404);
      return r;
    }
    if (seg[0] === 'paradas' && seg.length >= 2) {
      const codigo = seg[1];
      const p = paradaByCode.get(codigo);
      if (!p) throw new HttpError(404);
      if (seg.length === 2) return p;
      if (seg[2] === 'lineas') return [...(lineasEn.get(codigo) || [])].sort((a, b) => (ordenLineas.get(a) ?? 999) - (ordenLineas.get(b) ?? 999));
      if (seg[2] === 'tiempos') {
        try { return await tiempos(codigo); } catch (e) {
          if (e.status === 429) throw e;
          return { parada: codigo, nombre: p.nombre, latitud: p.latitud, longitud: p.longitud, tiempos: [], upstream_status: 'unavailable' };
        }
      }
    }
    if (seg[0] === 'cercanas') {
      const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
      const radio = Math.min(Math.max(Number(q.get('radio')) || 300, 50), 2000);
      const max = Math.min(Math.max(Number(q.get('max_paradas')) || 3, 1), 10);
      const cerca = D.paradas
        .map((p) => ({ ...p, distancia: Math.round(haversine(lat, lon, p.latitud, p.longitud)) }))
        .filter((p) => p.distancia <= radio)
        .sort((a, b) => a.distancia - b.distancia)
        .slice(0, max);
      const res = await Promise.all(cerca.map((p) => tiempos(p.codigo).then(
        (t) => ({ ...p, tiempos_status: 'ok', tiempos: t.tiempos.slice(0, 5), ...(t.stale ? { stale: true, cached_at: t.cached_at } : {}) }),
        () => ({ ...p, tiempos_status: 'unavailable', tiempos: [] }),
      )));
      return { ubicacion: { lat, lon }, paradas: res };
    }
    throw new HttpError(404);
  }

  window.BusSevBackend = { get, HttpError, generado: D.generado, caduca: D.caduca, caducados };
})();

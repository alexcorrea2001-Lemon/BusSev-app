/* BusSev sin servidor: responde a las mismas rutas que la API TUSSAM, pero desde el móvil.
   Basado en la API TUSSAM de 686f6c61 (https://github.com/686f6c61/API-TUSSAM): rutas y forma de leer
   los tiempos de reddelineas.tussam.es. Licencia PolyForm Noncommercial 1.0.0
   (https://polyformproject.org/licenses/noncommercial/1.0.0). Copyright (c) 2026 686f6c61.
   - Paradas, líneas y recorridos: los datos incluidos en la app (data.js).
   - Tiempos de llegada: se piden directamente a TUSSAM. En la app Android, Capacitor
     hace la petición de forma nativa, así que no le afecta el bloqueo CORS del navegador. */
'use strict';
(() => {
  const D = window.BUSSEV_DATA;
  // Paradas en su sitio exacto (OpenStreetMap) o pegadas a la calle del autobús (se calcula al compilar, en recorridos.js)
  const AJ = window.BUSSEV_PARADAS_AJUSTADAS || {};
  for (const p of D.paradas) {
    const a = AJ[p.codigo];
    if (Array.isArray(a) && Math.abs(a[0] - p.latitud) < 0.005 && Math.abs(a[1] - p.longitud) < 0.005) { p.latitud = a[0]; p.longitud = a[1]; }
  }
  const ORIGEN = 'https://reddelineas.tussam.es';
  const CACHE_MS = 30_000;          // tiempos recientes que reutilizamos sin volver a preguntar
  const STALE_MS = 10 * 60_000;     // si TUSSAM falla, enseñamos lo último bueno hasta 10 min
  const MAX_SIMULTANEAS = 2;

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
  const fhTussam = () => { const d = new Date(); const z = (n) => String(n).padStart(2, '0'); return `${z(d.getDate())}-${z(d.getMonth() + 1)}-${d.getFullYear()}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`; };
  const leerCache = (k) => { try { const v = JSON.parse(localStorage.getItem('bussev.live.' + k) || 'null'); return v && Date.now() - v.at < 7 * 86400_000 ? v.data : null; } catch { return null; } };
  const guardarCache = (k, data) => { try { localStorage.setItem('bussev.live.' + k, JSON.stringify({ at: Date.now(), data })); } catch { /* sin espacio */ } };
  let lineasLiveP = null;
  async function lineasLive() {
    const c = leerCache('lineas'); if (c) return c;
    lineasLiveP ??= fetchApi(`/INFOTUS/api/v2/lineas?fechaConcreta=${encodeURIComponent(fhTussam())}`).then((r) => { if (!r.ok) throw new HttpError(502, `TUSSAM respondió ${r.status}`); return r.json(); }).then((j) => {
      const l = ((j?.result ?? j)?.lineasDisponibles || []).map((x) => ({ id: x.linea, numero: String(x.labelLinea || '') })).filter((x) => x.id && /^[A-Za-z0-9]{1,8}$/.test(x.numero));
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
      const j = await fetchApi(`/INFOTUS/api/v2/nodosLinea/${encodeURIComponent(info.id)}?sentido=${sentido}&fecha=${encodeURIComponent(fhTussam())}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      (Array.isArray(j) ? j : Array.isArray(j?.result) ? j.result : []).forEach((n, orden) => {
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
  /* TUSSAM corta (429) si le llegan muchas consultas seguidas desde el mismo móvil.
     Por eso todas las consultas pasan por una sola fila:
     - como mucho 2 a la vez y separadas un poco entre sí;
     - un «cupo» que se va rellenando: las de segundo plano (buscar autobuses de una línea)
       solo salen si queda cupo de sobra, para que lo que estás mirando vaya siempre primero;
     - si TUSSAM pide esperar, la fila se para ese tiempo y luego sigue sola (no da error),
       y durante un rato va más despacio. */
  const cache = new Map();      // parada -> {at, data}
  const enVuelo = new Map();    // parada -> Promise
  let pausaHasta = 0;           // TUSSAM nos ha pedido esperar (429) hasta aquí
  let despacioHasta = 0;        // tras un 429, va a medio ritmo un rato
  const CUPO_MAX = 12, RELLENO_MS = 2500, ESPACIO_MS = 300, CUPO_FONDO = 5;
  let cupo = CUPO_MAX, rellenado = Date.now(), ultimaSalida = 0;
  let activas = 0, temporizador = 0;
  const filas = { alta: [], baja: [] };
  function rellenar() {
    const ahora = Date.now(), paso = ahora < despacioHasta ? RELLENO_MS * 2 : RELLENO_MS;
    const n = Math.floor((ahora - rellenado) / paso);
    if (n > 0) { cupo = Math.min(CUPO_MAX, cupo + n); rellenado += n * paso; }
    if (cupo >= CUPO_MAX) rellenado = ahora;
  }
  function despachar() {
    clearTimeout(temporizador); temporizador = 0;
    while (activas < MAX_SIMULTANEAS && (filas.alta.length || filas.baja.length)) {
      rellenar();
      const ahora = Date.now();
      let falta = Math.max(pausaHasta - ahora, ultimaSalida + ESPACIO_MS - ahora, 0);
      const fila = filas.alta.length ? filas.alta : filas.baja;
      const minimo = fila === filas.alta ? 1 : CUPO_FONDO;
      if (cupo < minimo) falta = Math.max(falta, (minimo - cupo) * RELLENO_MS / 2);
      if (falta > 0) { temporizador = setTimeout(despachar, Math.min(falta, 30000)); return; }
      cupo--; activas++; ultimaSalida = ahora;
      fila.shift().res();
    }
  }
  /* Espera turno. Las de segundo plano se rinden si tardan demasiado (no se acumulan). */
  const turno = (prioridad) => new Promise((res, rej) => {
    const fila = prioridad === 'baja' ? filas.baja : filas.alta;
    const item = { res, rej };
    fila.push(item);
    const max = prioridad === 'baja' ? 20000 : 25000;
    item.t = setTimeout(() => { const i = fila.indexOf(item); if (i >= 0) { fila.splice(i, 1); rej(new HttpError(enPausa() ? 429 : 408, 'ocupado')); } }, max);
    const r0 = item.res; item.res = () => { clearTimeout(item.t); r0(); };
    despachar();
  });
  const liberar = () => { activas = Math.max(0, activas - 1); despachar(); };
  /* Al salir del mapa o de la línea: las búsquedas de autobuses que esperaban turno ya no se hacen */
  function cancelarFondo() {
    for (const item of filas.baja.splice(0)) { clearTimeout(item.t); item.rej?.(new HttpError(499, 'cancelado')); }
  }
  const enPausa = () => Date.now() < pausaHasta;

  function normalizar(json, codigo, via = 'api') {
    // La API nueva (api.tussam.es) devuelve el objeto directo; la antigua lo envolvía en "result".
    let r = json && (json.result ?? json);
    if (Array.isArray(r)) r = r.find((x) => x && typeof x === 'object') || {};
    if (!r || typeof r !== 'object') r = {};
    const tiempos = [];
    for (const l of r.lineasCoincidentes || []) {
      const label = String(l.labelLinea || '');
      const s = sentidosEn.get(`${codigo}|${label}`) || [];
      for (const e of l.estimaciones || []) {
        if (e.segundos == null) continue;
        // -1800 = "más de 30 min" en la API de TUSSAM; otros negativos = sin dato
        if (e.segundos < 0 && e.segundos !== -1800) continue;
        const seg = e.segundos === -1800 ? 31 * 60 : e.segundos;
        tiempos.push({
          linea: label,
          color: l.color || lineaByNum.get(label)?.color || '#000000',
          tiempo_minutos: Math.floor(seg / 60),
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
      via,   // de dónde salieron estos tiempos: 'api' (api.tussam.es) o 'servidor' (tu servidor)
      nombre: r.descripcion?.texto || p.nombre || '',
      latitud: pos.latitudE6 ? pos.latitudE6 / 1e6 : (p.latitud ?? null),
      longitud: pos.longitudE6 ? pos.longitudE6 / 1e6 : (p.longitud ?? null),
      tiempos: tiempos.slice(0, 40),   // sin recortar de más: en paradas con muchas líneas se perdían autobuses
    };
  }

  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  /* ---------- Tu servidor (como SeviBus) ----------
     SeviBus no pregunta a TUSSAM desde el móvil: se lo pide a su servidor, que guarda las respuestas.
     Con datos móviles muchísima gente sale a internet con la MISMA dirección de la operadora,
     así que TUSSAM corta aunque tú hagas pocas consultas. Si tienes tu servidor puesto en Ajustes,
     BusSev hace lo mismo: le pide los tiempos a él (varias paradas en UNA sola consulta)
     y solo si falla pregunta a TUSSAM directamente. */
  /* Tu servidor (Ajustes → Tus datos → Tu servidor). Ojo: TUSSAM protege su web de tiempos con Cloudflare y
     a los servidores de internet (Deno, Google…) les pide una comprobación de navegador («Just a moment», 403),
     así que normalmente NO puede dar los tiempos. Por eso viene desactivado: solo se usa si lo activas. */
  const baseServidor = () => String((typeof settings !== 'undefined' && settings.saldoURL) || '').replace(/\/+$/, '');
  let servidorV2 = null;          // null: no se sabe · true: admite varias paradas · false: servidor antiguo
  let servidorMalHasta = 0, fallosServidor = 0;
  const usarServidor = () => !!baseServidor() && settings.tiemposServidor === true && Date.now() >= servidorMalHasta;
  const servidorFallo = () => { if (++fallosServidor >= 2) { servidorMalHasta = Date.now() + 2 * 60_000; fallosServidor = 0; } };
  const servidorBien = () => { fallosServidor = 0; };
  function desdeServidor(j, codigo) {
    if (!j?.ok || !j.tussam) {
      // TUSSAM bloquea a tu servidor: no se vuelve a probar en media hora (así no se pierde tiempo)
      if (/403|cloudflare|just a moment/i.test(String(j?.error || ''))) servidorMalHasta = Date.now() + 30 * 60_000;
      throw new HttpError(502, j?.error || 'Tu servidor no tiene datos');
    }
    const d = normalizar(j.tussam, codigo, 'servidor');
    return j.antiguo ? { ...d, stale: true, cached_at: new Date(j.at).toISOString() } : d;
  }
  async function pedirJSON(url, ms = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
      if (r.status === 404 || r.status === 400) throw new HttpError(r.status);
      if (!r.ok) throw new HttpError(502, `Tu servidor respondió ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  // Las paradas que se piden casi a la vez (las favoritas, la búsqueda de una línea…) van juntas
  let lote = new Map(), loteT = 0;
  function pedirAlServidor(codigo) {
    return new Promise((res, rej) => {
      if (!lote.has(codigo)) lote.set(codigo, []);
      lote.get(codigo).push({ res, rej });
      clearTimeout(loteT);
      if (lote.size >= 24) enviarLote(); else loteT = setTimeout(enviarLote, 40);
    });
  }
  async function enviarLote() {
    clearTimeout(loteT);
    const mio = lote; lote = new Map();
    if (!mio.size) return;
    const base = baseServidor();
    const codigos = [...mio.keys()];
    const cerrar = (c, err, val) => { for (const x of mio.get(c) || []) err ? x.rej(err) : x.res(val); };
    if (servidorV2 !== false && codigos.length > 1) {
      try {
        const j = await pedirJSON(`${base}/tiempos?p=${codigos.map(encodeURIComponent).join(',')}`, 8000 + codigos.length * 400);
        if (!j?.paradas) throw new HttpError(404);
        servidorV2 = true; servidorBien();
        for (const c of codigos) { try { cerrar(c, null, desdeServidor(j.paradas[c], c)); } catch (e) { cerrar(c, e); } }
        return;
      } catch (e) {
        if (e.status === 404 || e.status === 400) servidorV2 = false;     // servidor antiguo: de una en una
        else { servidorFallo(); for (const c of codigos) cerrar(c, e instanceof HttpError ? e : new HttpError(502, 'Tu servidor no responde')); return; }
      }
    }
    await Promise.all(codigos.map(async (c) => {
      try { const d = desdeServidor(await pedirJSON(`${base}/tiempos/${encodeURIComponent(c)}`), c); servidorBien(); cerrar(c, null, d); }
      catch (e) { if (e.status !== 404) servidorFallo(); cerrar(c, e instanceof HttpError ? e : new HttpError(502, 'Tu servidor no responde')); }
    }));
  }
  /* Primero tu servidor (si lo tienes); si falla, TUSSAM directo, en la fila.
     Si TUSSAM da un error pasajero, se intenta una vez más. */
  async function pedirATussam(codigo, prioridad) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new HttpError(503, 'Sin conexión a internet');
    if (usarServidor()) {
      try {
        // Si tu servidor solo tiene datos de hace un rato (TUSSAM tampoco le contesta), se enseñan ya
        // marcados como «no actualizados», sin hacerte esperar; el siguiente refresco lo vuelve a intentar.
        return await pedirAlServidor(codigo);
      } catch { /* tu servidor no responde: se pregunta a TUSSAM directamente */ }
    }
    let ultimo;
    for (let intento = 0; intento < 2; intento++) {
      try { return await pedirUnaVez(codigo, prioridad); } catch (e) {
        ultimo = e;
        if (e.status === 404 || e.status === 408 || prioridad === 'baja') break;
        if (e.status !== 429) await espera(1200);
      }
    }
    throw ultimo;
  }
  /* ---------- API oficial de la app móvil de TUSSAM (OAuth) ---------- */
  const API_TUSSAM = 'https://api.tussam.es';
  const URL_TOKEN = 'https://auth.tussam.es/auth/realms/TUSSAM-SSO/protocol/openid-connect/token';
  // Las credenciales van fuera del repositorio, en www/secrets.js (ignorado por git).
  // Ese fichero sí se incluye en el APK. Ver www/secrets.example.js para su forma.
  const CRED = (typeof window !== 'undefined' && window.BUSSEV_TUSSAM) || {};
  const OAUTH_CLIENT_ID = CRED.clientId || '';
  const OAUTH_CLIENT_SECRET = CRED.clientSecret || '';
  const OAUTH_USER = CRED.user || '';
  const OAUTH_PASS = CRED.pass || '';
  let accessToken = null, refreshToken = null, tokenP = null;

  function pedirToken(signal) {
    if (!OAUTH_CLIENT_SECRET) return Promise.reject(new HttpError(500, 'Faltan las credenciales de TUSSAM (crea www/secrets.js)'));
    tokenP ??= (async () => {
      const conRefresh = !!refreshToken;
      const params = conRefresh
        ? { grant_type: 'refresh_token', client_id: OAUTH_CLIENT_ID, client_secret: OAUTH_CLIENT_SECRET, refresh_token: refreshToken }
        : { grant_type: 'password', client_id: OAUTH_CLIENT_ID, client_secret: OAUTH_CLIENT_SECRET, username: OAUTH_USER, password: OAUTH_PASS };
      const r = await fetch(URL_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(params).toString(),
        signal,
      });
      if (!r.ok) {
        accessToken = null; refreshToken = null;
        if (conRefresh) return pedirToken(signal);   // el refresh caducó: login completo
        throw new HttpError(502, `Auth TUSSAM ${r.status}`);
      }
      const j = await r.json();
      accessToken = j.access_token || null;
      refreshToken = j.refresh_token || null;
      if (!accessToken) throw new HttpError(502, 'TUSSAM no devolvió token');
    })().finally(() => { tokenP = null; });
    return tokenP;
  }

  async function fetchApi(ruta, signal) {
    if (!accessToken) await pedirToken(signal);
    const llamar = () => fetch(`${API_TUSSAM}${ruta}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }, signal,
    });
    let res = await llamar();
    if (res.status === 401) { await pedirToken(signal); res = await llamar(); }
    return res;
  }

  /* Estado de una tarjeta (saldo, título, caducidad) directo de la API de TUSSAM */
  async function estadoTarjeta(numero) {
    const num = String(Number(String(numero).replace(/\D/g, '')));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetchApi(`/INFOTUS/api/v2/estadoTarjeta/${encodeURIComponent(num)}`, ctrl.signal);
      if (!r.ok) {
        let msg = '';
        try { msg = String((await r.json())?.mensaje || ''); } catch { /* sin cuerpo */ }
        throw new HttpError(r.status, msg || `TUSSAM respondió ${r.status}`);
      }
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async function pedirUnaVez(codigo, prioridad) {
    // TUSSAM ha pedido esperar un buen rato: no te dejamos mirando «Cargando…»; se avisa ya
    // (la pantalla enseña lo último que había y lo vuelve a intentar sola cuando toque)
    if (pausaHasta - Date.now() > 4000) throw new HttpError(429);
    await turno(prioridad);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      let res;
      try {
        res = await fetchApi(`/INFOTUS/api/v2/tiempos/${encodeURIComponent(codigo)}`, ctrl.signal);
      } finally { clearTimeout(t); }
      if (res.status === 429) {
        let ra = parseInt(res.headers.get('Retry-After') || '', 10);
        if (!(ra > 0)) ra = 5;
        pausaHasta = Math.max(pausaHasta, Date.now() + Math.min(Math.max(ra, 3), 60) * 1000);
        despacioHasta = Date.now() + 5 * 60_000;
        cupo = Math.min(cupo, 2);
        throw new HttpError(429);
      }
      if (!res.ok) throw new HttpError(502, `TUSSAM respondió ${res.status}`);
      const txt = await res.text();
      let json; try { json = JSON.parse(txt); } catch { throw new HttpError(502, 'Respuesta de TUSSAM no válida'); }
      return normalizar(json, codigo);
    } finally { liberar(); }
  }

  /* Últimos tiempos buenos guardados en el móvil (10 min): si al abrir la app TUSSAM corta,
     se enseñan al momento (marcados como «no actualizados») en vez de «Cargando…» */
  function guardarUltimo(codigo, data) {
    try {
      const m = JSON.parse(localStorage.getItem('bussev.ultimos') || '{}');
      m[codigo] = { at: Date.now(), data };
      const ks = Object.keys(m).sort((a, b) => m[b].at - m[a].at);
      for (const k of ks.slice(30)) delete m[k];
      localStorage.setItem('bussev.ultimos', JSON.stringify(m));
    } catch { /* sin espacio */ }
  }
  function leerUltimo(codigo) { try { return JSON.parse(localStorage.getItem('bussev.ultimos') || '{}')[codigo] || null; } catch { return null; } }

  /* prioridad: 'alta' (lo que estás mirando) o 'baja' (buscar autobuses por la línea) */
  async function tiempos(codigo, prioridad = 'alta', maxEdad = CACHE_MS) {
    const c = cache.get(codigo);
    if (c && Date.now() - c.at < maxEdad) return c.data;
    if (enVuelo.has(codigo)) return enVuelo.get(codigo);
    const p = pedirATussam(codigo, prioridad).then((data) => {
      cache.set(codigo, { at: Date.now(), data });
      if (cache.size > 400) cache.delete(cache.keys().next().value);
      guardarUltimo(codigo, data);
      return data;
    }).catch((e) => {
      const v = c || leerUltimo(codigo);
      if (v && Date.now() - v.at < STALE_MS) return { ...v.data, stale: true, cached_at: new Date(v.at).toISOString() };
      throw e;
    }).finally(() => enVuelo.delete(codigo));
    enVuelo.set(codigo, p);
    return p;
  }

  /* ---------- rutas ---------- */
  async function get(path, opciones = {}) {
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
        try { return await tiempos(codigo, opciones.prioridad === 'baja' ? 'baja' : 'alta', opciones.maxEdad || CACHE_MS); } catch (e) {
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

  // Últimos tiempos buenos guardados en el móvil (para enseñarlos al instante al abrir la app)
  const ultimo = (codigo) => { const v = leerUltimo(codigo); return v ? { ...v.data, stale: true, cached_at: new Date(v.at).toISOString() } : null; };
  // Pide el token OAuth por adelantado al arrancar, para que la primera consulta no espere a autenticarse
  const precalentar = () => { try { pedirToken().catch(() => {}); } catch { /* da igual */ } };
  window.BusSevBackend = { get, estadoTarjeta, ultimo, precalentar, HttpError, cancelarFondo, get pausa() { return Math.max(0, pausaHasta - Date.now()); }, get viaServidor() { return usarServidor(); }, generado: D.generado, caduca: D.caduca, caducados };
})();

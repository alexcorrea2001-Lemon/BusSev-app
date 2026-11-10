/* BusSev — pestaña Tarjeta.
   - El NFC solo lee el número de serie de la tarjeta (no toca saldo ni claves).
   - El saldo se pide a la web oficial de recargas de TUSSAM desde un navegador interno
     (plugin TussamWeb), igual que al pulsar «Seleccionar» en esa web. */
'use strict';

/* Tipos de tarjeta: diseño propio de BusSev para reconocerlas de un vistazo */
const TIPOS = [
  { id: 'con-transbordo', nombre: 'Saldo con transbordo', re: /\bCT\b|con\s*transbordo/i, colores: ['#c3134f', '#7a0a32'] },
  { id: 'sin-transbordo', nombre: 'Saldo sin transbordo', re: /\bST\b|sin\s*transbordo|bono\S*\s*saldo(?!.*\bCT\b)/i, colores: ['#e5484d', '#8f1d22'] },
  { id: '30-dias', nombre: '30 días', re: /30\s*d[ií]as|abono\s*30|mensual(?!.*estudiante)/i, colores: ['#f08a24', '#d1342f'], foto: true },
  { id: 'anual', nombre: 'Anual', re: /anual/i, colores: ['#f2a65a', '#2bb3a3'], foto: true },
  { id: 'turistica-48h', nombre: 'Turística 48 horas', re: /48\s*h|tur[ií]stic\w*\s*1|1\s*d[ií]a/i, colores: ['#7fae3a', '#3d6a1d'] },
  { id: 'turistica-4d', nombre: 'Turística 4 días', re: /4\s*d[ií]as|tur[ií]stic\w*\s*3|3\s*d[ií]as/i, colores: ['#f08f84', '#a5463e'] },
  { id: 'estudiante-mensual', nombre: 'Estudiante mensual', re: /estudiante\s*mensual/i, colores: ['#6a43d8', '#30187e'], foto: true },
  { id: 'estudiante', nombre: 'Estudiante', re: /estudiant|universitari/i, colores: ['#8a52e8', '#3e1d8f'], foto: true },
  { id: 'joven', nombre: 'Joven', re: /joven/i, colores: ['#0f9f7a', '#055443'], foto: true },
  { id: 'pensionista', nombre: 'Pensionista', re: /pensionista|tercera\s*edad|jubilad|mayor/i, colores: ['#e0a100', '#8a5a00'], foto: true },
  { id: 'solidaria', nombre: 'Solidaria', re: /solidari/i, colores: ['#0b9bb0', '#045764'], foto: true },
];
const tipoPorId = (id) => TIPOS.find((t) => t.id === id) || null;
/* El tipo que dice TUSSAM (por el título) manda; el elegido a mano solo vale si TUSSAM no lo dice */
const tipoDeTarjeta = (c, res) => res?.tipo || c?.ultimo?.tipo || c?.tipo || null;
const tipoDetectado = (c, res) => res?.tipo || c?.ultimo?.tipo || null;
const tipoDeTitulo = (t) => (t ? TIPOS.find((x) => x.re.test(t)) || null : null);
const TIPO_GENERICO = { colores: ['#3a3f4b', '#16181d'] };
/* Solo los bonobús de saldo (con/sin transbordo) llevan saldo monedero.
   Si no sabemos el tipo pero hay saldo real (>0), también lo tratamos como de saldo. */
const TIPOS_SALDO = new Set(['con-transbordo', 'sin-transbordo']);
const llevaSaldo = (tipoId, saldo) => TIPOS_SALDO.has(tipoId) || (!tipoId && saldo != null && saldo > 0);
/* Fechas centinela que TUSSAM usa para «no caduca» / «sin fin» */
const fechaCentinela = (x) => !!x && /(^|\D)31[/-]12[/-]20(63|99)\b/.test(String(x));

const tarjeta = {
  nfc: () => !!window.Capacitor?.isPluginAvailable?.('TarjetaNfc'),
  call: (m, o = {}) => window.Capacitor.nativePromise('TarjetaNfc', m, o),
  numeroDesdeUid(hex) {
    const h = String(hex || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (h.length < 8) throw new Error('Esta tarjeta no es compatible.');
    const rev = h.slice(6, 8) + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);
    return this.numeroVisible(String(parseInt(rev, 16)));
  },
  numeroVisible(input) {   // cálculo tomado de SeviBus (código abierto)
    const p = input.padStart(10, '0');
    const n = Number(p);
    const bin = n.toString(2).padStart(32, '0');
    const b = [0, 8, 16, 24].map((i) => parseInt(bin.slice(i, i + 8), 2));
    const bits = (((b[1] ^ b[0]) ^ b[2]) ^ b[3]).toString(2).padStart(8, '0');
    const shift = n % 7;
    const res = new Array(8);
    for (let i = 1; i <= 8; i++) { let ni = i - shift; if (ni < 0) ni += 8; else if (ni === 0) ni = 8; res[ni - 1] = bits[i - 1]; }
    const sh = res.join('');
    let a = parseInt(sh.slice(0, 4), 2); if (a > 9) a -= 7;
    let c = parseInt(sh.slice(4, 8), 2); if (c > 9) c -= 7;
    return p.slice(0, 5) + `${a}${c}` + p.slice(5, 10);
  },
  fmt: (num) => String(num).replace(/(\d{4})(?=\d)/g, '$1 '),
  url: (num) => `https://recargas.tussam.es/TPW/index.html?client_id=APPTUSSAM&id_tarjeta=${encodeURIComponent(num)}`,
  list: () => store.get('cards', []),
  get(num) { return this.list().find((c) => c.num === num) || null; },
  save(card) { const l = this.list().filter((c) => c.num !== card.num); l.unshift(card); store.set('cards', l.slice(0, 10)); },
  update(num, patch) { store.set('cards', this.list().map((c) => (c.num === num ? { ...c, ...patch } : c))); },
  remove(num) { store.set('cards', this.list().filter((c) => c.num !== num)); this.setFoto(num, ''); this.setFoto(num, '', 'retrato'); },
  foto(num, cual = 'fondo') {
    try { const f = localStorage.getItem(`bussev.${cual === 'fondo' ? 'foto' : 'retrato'}.${num}`) || ''; return /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(f) ? f : ''; } catch { return ''; }
  },
  setFoto(num, data, cual = 'fondo') {
    try { const k = `bussev.${cual === 'fondo' ? 'foto' : 'retrato'}.${num}`; if (data) localStorage.setItem(k, data); else localStorage.removeItem(k); return true; } catch { return false; }
  },

  /* Consulta a TUSSAM. visible=true abre la página para pasar la comprobación de Cloudflare. */
  async consultar(num, { visible = false } = {}) {
    let html, diag = {};
    // 00) API de TUSSAM (la que usa su app móvil): sin web, sin Cloudflare, con saldo, título y caducidad.
    //     «visible» pide la comprobación de Cloudflare de la web, así que en ese caso se salta.
    if (!visible && window.BusSevBackend?.estadoTarjeta) {
      try {
        const res = this.desdeApi(await window.BusSevBackend.estadoTarjeta(num), num);
        res.diag = { via: 'API de TUSSAM', numero: num };
        return res;
      } catch (e) {
        // El número no existe: no tiene sentido probar las demás vías
        if (e?.status === 400 || e?.status === 404) {
          return { ok: false, saldo: null, titulo: null, tipo: null, caducidad: null, sinCaducidad: false, caducaEl: null, extra: [], sinSaldoWeb: false, numeroOk: false, error: 'TUSSAM no reconoce esta tarjeta. Comprueba el número.', fecha: Date.now(), diag: { via: 'API de TUSSAM', numero: num, api: e.message } };
        }
        diag.api = e?.message || 'no se pudo consultar la API de TUSSAM';
      }
    }
    // 0) Tu propio servidor del saldo, si lo has configurado (es lo más fiable: lo lee desde un servidor, no desde el móvil).
    if (settings.saldoURL && !visible) {
      try {
        const base = settings.saldoURL.replace(/\/+$/, '');
        const r = await fetch(`${base}/saldo/${encodeURIComponent(num)}`, { headers: { Accept: 'application/json' } });
        const j = await r.json().catch(() => ({}));
        if (j.html) { const res = this.interpretar(j.html, num); if (res.ok) { res.diag = { via: 'tu servidor', numero: num }; return res; } }
        diag.servidor = j.error || (j.cloudflare ? 'Cloudflare bloqueó a tu servidor' : 'tu servidor no devolvió el saldo');
      } catch (e) { diag.servidor = 'no se pudo conectar con tu servidor'; }
    }
    if (window.Capacitor?.isPluginAvailable?.('TussamWeb')) {
      // 1) Rápida: sin abrir ninguna web (menos batería y datos). Si TUSSAM no la acepta, 2) navegador interno.
      if (!visible) {
        const d = await window.Capacitor.nativePromise('TussamWeb', 'directo', { numero: num }).catch((e) => ({ error: String(e?.message || e) }));
        const rd = d?.html ? this.interpretar(d.html, num) : null;
        if (rd?.ok) { rd.diag = { via: 'directa', numero: num }; return rd; }
        diag.directa = d?.error ? d.error : `respuestas ${d?.paso1 ?? '-'}/${d?.paso2 ?? '-'}/${d?.codigo ?? '-'}${d?.cloudflare ? ' · Cloudflare' : ''}`;
      }
      try {
        const r = await window.Capacitor.nativePromise('TussamWeb', 'consultar', { numero: num, visible });
        html = r.html;
        diag = { api: diag.api, servidor: diag.servidor, directa: diag.directa, motivo: r.motivo || '', via: r.via || '', boton: !!r.boton, estado: r.estado || '', texto: String(r.diag || '').slice(0, 700), url: String(r.url || '').slice(0, 200), red: String(r.red || '').slice(0, 200) };
      } catch (e) {
        const code = e?.code || (/CLOUDFLARE/.test(String(e?.message)) ? 'CLOUDFLARE' : '');
        throw Object.assign(new Error(e?.message || 'No se ha podido consultar.'), { code });
      }
    } else {
      // Fuera de la app instalada (pruebas en el navegador)
      const r = await fetch(`https://recargas.tussam.es/TPW/Common/cardStatus.do?swNumber=${encodeURIComponent(num)}`, { method: 'POST' });
      html = new TextDecoder('iso-8859-1').decode(await r.arrayBuffer());
    }
    const res = this.interpretar(html, num);
    res.diag = { ...diag, numero: num, html: String(html || '').replace(/\s+/g, ' ').slice(0, 400) };
    return res;
  },
  /* Convierte la respuesta de la API de TUSSAM (estadoTarjeta) al mismo formato que «interpretar» */
  desdeApi(j, num) {
    const titulo = j?.nombreTitulo ? String(j.nombreTitulo).trim() : null;
    const saldo = j?.saldoMonedero != null ? Math.round(Number(j.saldoMonedero)) / 1000 : null;   // viene en milésimas de euro
    const cadRaw = [j?.caducidad, j?.finValidez].find((x) => x && String(x).trim()) || null;
    const sinCad = fechaCentinela(cadRaw) || (!!cadRaw && /sin\s*caducidad/i.test(String(cadRaw)));   // TussApp trata 31/12/2063 como «no caduca»
    const cadTxt = sinCad ? null : cadRaw;
    const f = cadTxt ? String(cadTxt).match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/) : null;
    const caducaEl = f ? new Date(Number(f[3].length === 2 ? '20' + f[3] : f[3]), Number(f[2]) - 1, Number(f[1])).getTime() : null;
    const extra = [];
    if (j?.saldoViajes != null) extra.push(['Viajes en la tarjeta', String(j.saldoViajes)]);
    if (j?.ultimaOperacion) extra.push(['Última operación', String(j.ultimaOperacion)]);
    // Validez: solo si viene y no es una fecha centinela («hasta» solo si no coincide ya con la caducidad)
    if (j?.inicioValidez && !fechaCentinela(j.inicioValidez)) extra.push(['Válida desde', String(j.inicioValidez)]);
    if (j?.finValidez && !fechaCentinela(j.finValidez) && String(j.finValidez) !== String(cadRaw)) extra.push(['Válida hasta', String(j.finValidez)]);
    if (j?.inicioAmpliacion || j?.finAmpliacion) extra.push(['Ampliación', [j.inicioAmpliacion, j.finAmpliacion].filter(Boolean).join(' – ')]);
    const ok = j?.numeroSerie != null || saldo != null || !!titulo;
    return {
      ok, saldo, titulo, tipo: tipoDeTitulo(titulo)?.id || null,
      caducidad: sinCad ? null : cadTxt, sinCaducidad: sinCad, caducaEl, extra,
      sinSaldoWeb: ok && saldo == null && !titulo, numeroOk: true,
      error: ok ? null : 'TUSSAM no reconoce esta tarjeta. Comprueba el número.',
      fecha: Date.now(),
    };
  },
  /* Lee el bloque «cardStatus»: <label><b>Saldo monedero:</b></label><span class="cardStatusValue">… */
  interpretar(html, num) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html'); // no ejecuta nada
    const caja = doc.querySelector('#cardStatus') || doc.body;
    const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const datos = [];
    caja?.querySelectorAll('b').forEach((b) => {
      const k = clean(b.textContent).replace(/:$/, '');
      const lab = b.closest('label') || b;
      let v = lab.nextElementSibling;
      while (v && v.tagName === 'BR') v = v.nextElementSibling;
      const val = clean(v?.classList?.contains('cardStatusValue') || v?.tagName === 'SPAN' ? v.textContent : '');
      if (k && val && k.length < 40 && val.length < 120) datos.push([k, val]);
    });
    const find = (re) => datos.find(([k]) => re.test(norm(k)))?.[1] || null;
    const saldoTxt = find(/saldo/);
    const m = saldoTxt?.match(/-?\d+(?:[.,]\d{1,2})?/);
    const saldo = m ? Number(m[0].replace(',', '.')) : null;
    const titulo = find(/titulo|tipo/);
    const cad = find(/caducidad|validez|vigencia/);
    const numero = find(/num|n\W{0,3}m\W*tarjeta|numero/);
    const extra = datos.filter(([k]) => !/saldo|titulo|tipo|caducidad|validez|vigencia|num/.test(norm(k)));
    const reconocida = !!numero && numero.replace(/\D/g, '') === num;
    const ok = saldo != null || !!titulo || reconocida;
    const sinSaldoWeb = ok && saldo == null && !titulo;   // p. ej. Tarjeta Solidaria: «no recargable vía web»
    const sinCad = cad && /sin\s*caducidad/i.test(cad);
    const fecha = cad?.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    const caducaEl = fecha ? new Date(Number(fecha[3].length === 2 ? '20' + fecha[3] : fecha[3]), Number(fecha[2]) - 1, Number(fecha[1])).getTime() : null;
    return {
      ok, saldo, titulo, tipo: tipoDeTitulo(titulo)?.id || null, caducidad: cad, sinCaducidad: !!sinCad, caducaEl, extra, sinSaldoWeb,
      numeroOk: !numero || numero.replace(/\D/g, '') === num,
      error: ok ? null : 'TUSSAM no reconoce esta tarjeta. Comprueba el número.',
      fecha: Date.now(),
    };
  },
};

/* ---------- Diseño de la tarjeta ---------- */
function cardBackground(c, tipoId) {
  const foto = c?.num ? tarjeta.foto(c.num) : '';
  if (foto) return `background-image:linear-gradient(180deg, rgb(0 0 0 / .05), rgb(0 0 0 / .55)), url('${foto}');background-size:cover;background-position:center`;
  const col = c?.color ? safeColor(c.color) : null;
  const [a, b] = col ? [col, `color-mix(in srgb, ${col} 45%, #000)`] : (tipoPorId(tipoId)?.colores || TIPO_GENERICO.colores);
  return `background:radial-gradient(120% 90% at 100% 0%, rgb(255 255 255 / .2), transparent 55%), linear-gradient(135deg, ${a}, ${b})`;
}
const ondas = '<svg class="tc-waves" viewBox="0 0 400 250" preserveAspectRatio="none" aria-hidden="true"><path d="M0 190 C 90 150, 170 230, 260 185 S 360 140, 400 165 V250 H0Z" fill="rgb(255 255 255 / .12)"/><path d="M0 215 C 110 185, 200 250, 300 210 S 380 190, 400 200 V250 H0Z" fill="rgb(255 255 255 / .12)"/><circle cx="350" cy="40" r="90" fill="none" stroke="rgb(255 255 255 / .10)" stroke-width="18"/></svg>';
function tcardHTML(num, c, res, { mini = false } = {}) {
  const tipoId = tipoDeTarjeta(c, res);
  const tipo = tipoPorId(tipoId);
  const saldo = res?.saldo ?? c?.ultimo?.saldo;
  const sinSaldo = (res || c?.ultimo)?.sinSaldoWeb;
  const titulo = tipo?.nombre || res?.titulo || c?.ultimo?.titulo || 'Tarjeta TUSSAM';
  // Solo se enseña el saldo (o «— €») en tarjetas de saldo; en abonos/pases no, para que no salga «— €»
  const mostrarSaldo = llevaSaldo(tipoId, saldo);
  const saldoHTML = mostrarSaldo && saldo != null ? `<div class="tc-saldo">${fmtEuro(saldo)}</div>`
    : sinSaldo ? '<div class="tc-saldo tc-dim tc-sinsaldo">Sin saldo en la web</div>'
    : mostrarSaldo ? '<div class="tc-saldo tc-dim">— €</div>'
    : '';
  return `<div class="tcard${mini ? ' mini' : ''}" style="${cardBackground(c || { num }, tipoId)}">
    ${tarjeta.foto(num) ? '' : ondas}
    <div class="tc-top"><span class="tc-brand">${esc(c?.name || titulo)}</span>${ICON.nfc}</div>
    <div class="tc-mid">${saldoHTML}
      <div class="tc-tipo">${esc(c?.name ? titulo : (res?.titulo || c?.ultimo?.titulo || titulo))}</div></div>
    <div class="tc-num">${esc(tarjeta.fmt(num))}</div></div>`;
}
function leerFoto(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type) || file.size > 25 * 1024 * 1024) { reject(new Error('Elige una imagen de menos de 25 MB.')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 900 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se ha podido abrir la imagen.')); };
    img.src = url;
  });
}
const haceCuanto = (t) => {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'ahora mismo';
  if (m < 60) return `hace ${m} min`;
  if (m < 1440) return `hace ${Math.round(m / 60)} h`;
  return `el ${new Date(t).toLocaleDateString('es-ES')}`;
};
/* De dónde salió el saldo, en texto corto para enseñarlo en la tarjeta */
const viaLegible = (v) => {
  if (v === 'API de TUSSAM') return 'vía API de TUSSAM';
  if (v === 'tu servidor') return 'vía tu servidor';
  if (v === 'directa' || v === 'DIRECTO') return 'vía web de TUSSAM';
  if (v === 'manual') return 'apuntado a mano';
  if (v) return 'vía web de TUSSAM';
  return '';
};

/* Guarda el resultado de una consulta en la tarjeta y lanza los avisos */
function aplicarConsulta(num, res) {
  const c = tarjeta.get(num);
  if (!c || !res?.ok) return;
  tarjeta.update(num, {
    ultimo: { saldo: res.saldo, tipo: res.tipo, titulo: res.titulo, caducidad: res.caducidad, caducaEl: res.caducaEl, sinCaducidad: res.sinCaducidad, sinSaldoWeb: !!res.sinSaldoWeb, fecha: res.fecha, via: res.manual ? 'manual' : (res.diag?.via || null) },
    // si TUSSAM dice el tipo, se quita el que se hubiera elegido a mano
    ...(res.tipo ? { tipo: '' } : {}),
  });
  window.avisosTarjeta?.comprobar(num);
}

/* ---------- Vista ---------- */
views.tarjeta = (el) => {
  let detalle = null;   // { num, res, loading, err, code }
  let lectorActivo = false, dead = false;
  const alCambiarNfc = (e) => {
    if (dead || detalle) return;
    const on = !!e?.activado;
    const box = $('#nfc-estado', el);
    if (on) { vibrar(20); armarLector(); } else if (box) { lectorActivo = false; box.innerHTML = nfcEstadoHTML('off'); bindNfc(); }
  };
  window.addEventListener('bussevNfc', alCambiarNfc);
  const alTarifas = () => { if (!dead && detalle) pintar(); };
  window.addEventListener('bussev-tarifas', alTarifas);
  window.tarifas?.cargar().catch(() => null);
  function bindNfc() { $('#nfc-ajustes', el)?.addEventListener('click', () => tarjeta.call('ajustesNfc').catch(() => toast('Abre los ajustes del móvil y enciende el NFC.'))); }

  /* Lector NFC activo mientras la pestaña esté abierta */
  async function armarLector() {
    if (dead || !tarjeta.nfc() || lectorActivo) return;
    let st = { disponible: true, activado: true };
    try { st = await tarjeta.call('estado'); } catch { /* seguimos */ }
    const box = $('#nfc-estado', el);
    if (!st.disponible) { if (box) box.innerHTML = nfcEstadoHTML('no'); return; }
    if (!st.activado) { if (box) { box.innerHTML = nfcEstadoHTML('off'); bindNfc(); } return; }
    if (box) box.innerHTML = nfcEstadoHTML('on');
    lectorActivo = true;
    try {
      const r = await tarjeta.call('leer');
      lectorActivo = false;
      if (dead) return;
      vibrar(60);
      abrir(tarjeta.numeroDesdeUid(r.uid), { consultar: true });
    } catch (e) {
      lectorActivo = false;
      if (dead || e?.code === 'CANCELADO' || /Cancelado/.test(e?.message)) return;
      if (e?.code === 'NFC_OFF') { const b = $('#nfc-estado', el); if (b) { b.innerHTML = nfcEstadoHTML('off'); bindNfc(); } return; }
      toast(e?.message || 'No se ha podido leer la tarjeta. Prueba otra vez.');
    }
    setTimeout(armarLector, 600);
  }
  function nfcEstadoHTML(st) {
    if (st === 'on') return `<div class="nfc-on"><span class="pulse">${ICON.nfc}</span><div><b>Acerca tu tarjeta</b><small>Apóyala en la parte de atrás del móvil para ver su saldo.</small></div></div>`;
    if (st === 'off') return `<div class="nfc-off">${ICON.nfc}<div><b>El NFC está apagado</b><small>Enciéndelo y BusSev lo notará sola: no tienes que hacer nada más.</small></div><button class="btn sm" type="button" id="nfc-ajustes">Activar NFC</button></div>`;
    return `<div class="nfc-off">${ICON.nfc}<div><b>Este móvil no tiene NFC</b><small>Añade tu tarjeta escribiendo su número.</small></div></div>`;
  }

  async function consultar(num, { visible = false } = {}) {
    detalle = { ...(detalle?.num === num ? detalle : {}), num, loading: true, err: null, code: null };
    pintar();
    try {
      const res = await tarjeta.consultar(num, { visible });
      if (dead) return;
      detalle = { num, res, loading: false };
      if (res.ok) { aplicarConsulta(num, res); store.set('cfPendiente', false); }
    } catch (e) {
      if (dead) return;
      if (e.code === 'CANCELADO') { detalle = { ...detalle, loading: false }; pintar(); return; }
      if (e.code === 'CLOUDFLARE') store.set('cfPendiente', true);
      detalle = { ...detalle, loading: false, code: e.code, err: e.code === 'CLOUDFLARE' ? 'TUSSAM pide una comprobación de seguridad antes de enseñar el saldo.' : (e.message || 'No se ha podido consultar.') };
    }
    pintar();
  }
  /* Como la app oficial: abre la web de recargas en el navegador. (Ya no se pregunta el saldo al volver.) */
  function abrirOficial(num) {
    openWeb(tarjeta.url(num));
  }
  function abrir(num, { consultar: c = false } = {}) {
    detalle = { num, res: null, loading: false };
    pintar();
    el.scrollTop = 0;
    if (c || !tarjeta.get(num)?.ultimo) consultar(num);
  }

  function detalleHTML() {
    const { num, res, loading, err, code } = detalle;
    const c = tarjeta.get(num);
    const u = res?.ok ? res : c?.ultimo;
    const filas = [];
    const tipoId = tipoDeTarjeta(c, u);
    if (u) {
      // El saldo solo tiene sentido en bonobús de saldo; en abonos/pases no se muestra
      if (llevaSaldo(tipoId, u.saldo)) filas.push(['Saldo', u.saldo != null ? fmtEuro(u.saldo) : '—']);
      else if (u.sinSaldoWeb) filas.push(['Saldo', 'TUSSAM no lo muestra']);
      filas.push(['Tipo', tipoPorId(tipoId)?.nombre || u.titulo || '—']);
      if (u.titulo && tipoPorId(tipoId)) filas.push(['Título en TUSSAM', u.titulo]);
      filas.push(['Caducidad', u.sinCaducidad ? 'No caduca' : (u.caducidad || '—')]);
    }
    filas.push(['Número', tarjeta.fmt(num)]);
    for (const [k, v] of res?.extra || []) filas.push([k, v]);
    // Viajes que quedan: solo en los bonobús de saldo (con y sin transbordo), con el precio actual de TUSSAM
    const infoViaje = window.tarifas?.viaje(tipoId) || null;
    const precio = infoViaje?.precio || 0;
    const viajes = precio && u?.saldo != null ? Math.max(0, Math.floor(u.saldo / precio + 1e-9)) : null;
    const bajo = c?.avisoSaldo?.on && u?.saldo != null && u.saldo < Number(c.avisoSaldo.importe || 0);
    return `<div class="detail-head" style="margin-bottom:4px"><button class="back-btn" type="button" id="t-back" aria-label="Volver">${ICON.back}</button><div class="grow"><h2>${esc(c?.name || 'Tu tarjeta')}</h2><p>${u?.fecha ? `Actualizada ${haceCuanto(u.fecha)}${viaLegible(res?.diag?.via || u?.via) ? ` · ${viaLegible(res?.diag?.via || u?.via)}` : ''}` : 'Sin consultar todavía'}</p></div>
      ${c ? `<button class="btn-mas" type="button" id="t-menu" aria-label="Más opciones">${ICON.mas}</button>` : ''}</div>
      ${tcardHTML(num, c, res?.ok ? res : null)}
      ${loading ? cargandoHTML('Consultando tu tarjeta en TUSSAM…', 'Puede tardar unos segundos.') : ''}
      ${bajo ? `<div class="alert warn">Te queda poco saldo: menos de ${fmtEuro(Number(c.avisoSaldo.importe))}.</div>` : ''}
      ${u?.sinSaldoWeb ? '<div class="alert info">TUSSAM no muestra el saldo de esta tarjeta porque no se recarga por internet (por ejemplo, la Tarjeta Solidaria). Sí puedes ver aquí su caducidad.</div>' : ''}
      ${err ? `<div class="set-group"><h3>${code === 'CLOUDFLARE' ? 'Hace falta una comprobación' : 'No se ha podido consultar'}</h3><p>${esc(err)}</p>
        ${code === 'CLOUDFLARE' ? '<button class="btn" type="button" id="t-cf">Hacer la comprobación</button>' : '<button class="btn" type="button" id="t-again2">Reintentar</button>'}
        <button class="btn ghost" type="button" data-web>Abrir la web de TUSSAM</button></div>` : ''}
      ${res && !res.ok && !err ? `<div class="set-group"><h3>No he podido leer el saldo</h3>
        <p>${res.diag?.motivo === 'TIEMPO' ? 'La web de TUSSAM no ha llegado a enseñar los datos de la tarjeta.' : esc(res.error)}</p>
        <p>Comprueba que el número de arriba es el mismo que pone detrás de tu tarjeta.</p>
        <div class="btn-row"><button class="btn" type="button" id="t-again2">Reintentar</button><button class="btn ghost" type="button" id="t-ver">Ver la consulta en pantalla</button></div>
        <details open><summary class="small">Detalles para enviar a quien te ayuda con la app</summary><div class="raw">${esc([
          `Número: ${res.diag?.numero || num}`,
          `Motivo: ${res.diag?.motivo || 'respuesta sin datos'} · Estado: ${res.diag?.estado || '-'} · Vía: ${res.diag?.via || '-'} · Botón «Seleccionar»: ${res.diag?.boton ? 'sí' : 'no encontrado'}`,
          `Dirección: ${res.diag?.url || '-'} · Red: ${res.diag?.red || 'sin errores'}`,
          `API de TUSSAM: ${res.diag?.api || 'sin respuesta'}`,
          `Tu servidor del saldo: ${settings.saldoURL ? (res.diag?.servidor || 'sin respuesta') : 'no configurado'}`,
          `Consulta rápida: ${res.diag?.directa || '-'}`,
          `Página: ${res.diag?.texto || '(vacía)'}`,
          `Respuesta: ${res.diag?.html || '(vacía)'}`,
        ].join('\n'))}</div></details></div>` : ''}
      <div class="kv">${filas.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
        ${precio ? `<div><span>Cada viaje cuesta</span><b>${fmtEuro(precio)}${infoViaje.conDescuento ? ` <small class="muted">(con descuento; sin él ${fmtEuro(infoViaje.normal)})</small>` : ''}</b></div>` : ''}
        ${viajes != null ? `<div><span>Viajes que te quedan</span><b>${viajes} ${viajes === 1 ? 'viaje' : 'viajes'}</b></div>` : ''}</div>
      <p class="small muted" style="margin:0">TUSSAM tarda hasta 24 h en descontar viajes y sumar recargas.</p>
      <button class="btn block" type="button" id="t-oficial">🌐 Ver el saldo en la web de TUSSAM</button>
      <p class="small muted" style="margin:-6px 0 0">Se abre la web de recargas de TUSSAM con tu tarjeta, por si quieres recargar o ver el saldo oficial.</p>
      <div class="btn-row">
        <button class="btn ghost" type="button" id="t-again" ${loading ? 'disabled' : ''}>Actualizar</button>
        ${c ? '<button class="btn ghost" type="button" id="t-edit">Personalizar</button>' : '<button class="btn" type="button" id="t-save">Guardar tarjeta</button>'}
      </div>
      ${c ? avisosHTML(c, u) : '<p class="small muted" style="margin:0">Guárdala para verla siempre aquí y activar avisos de saldo bajo y de caducidad.</p>'}`;
  }
  function avisosHTML(c, u) {
    const s = c.avisoSaldo || { on: false, importe: 3 };
    const k = c.avisoCaducidad || { on: false, dias: [15, 3] };
    const sinCad = u?.sinCaducidad;
    const tipoId = tipoDeTarjeta(c, u);
    const conSaldo = llevaSaldo(tipoId, u?.saldo) && !u?.sinSaldoWeb;   // solo bonobús de saldo
    // Saldo bajo: solo si la tarjeta lleva saldo
    const grupoSaldo = conSaldo ? `
      <div class="set-group">
        <div class="switch-row"><div><h3>Saldo bajo</h3><p>Te aviso cuando el saldo baje de la cantidad que elijas.</p></div><input class="switch" type="checkbox" id="av-s" ${s.on ? 'checked' : ''} aria-label="Aviso de saldo bajo"></div>
        <div class="field" ${s.on ? '' : 'hidden'} id="av-s-box"><label for="av-s-imp">Avisarme si baja de</label>
          <div class="chips-wrap">${[2, 3, 5, 10].map((v) => `<button class="chip" type="button" data-imp="${v}" aria-pressed="${Number(s.importe) === v}">${v} €</button>`).join('')}
          <input id="av-s-imp" class="mini-input" inputmode="decimal" aria-label="Otra cantidad" placeholder="Otra" value="${[2, 3, 5, 10].includes(Number(s.importe)) ? '' : String(s.importe || '').replace('.', ',')}"></div></div>
      </div>` : '';
    // Caducidad: solo si la tarjeta caduca de verdad (hay una fecha). Sin fecha (o «no caduca») no se muestra el aviso.
    const grupoCad = (sinCad || !u?.caducaEl) ? '' : `
      <div class="set-group">
        <div class="switch-row"><div><h3>Caducidad</h3><p>${u?.caducaEl ? `Caduca el ${new Date(u.caducaEl).toLocaleDateString('es-ES')}. Te aviso con antelación.` : 'Te aviso unos días antes de que caduque (cuando TUSSAM dé la fecha).'}</p></div>
          <input class="switch" type="checkbox" id="av-c" ${k.on ? 'checked' : ''} aria-label="Recordatorio de caducidad"></div>
        <div class="field" ${k.on ? '' : 'hidden'} id="av-c-box"><label>Avisarme antes</label>
          <div class="chips-wrap">${[30, 15, 7, 3, 1].map((d) => `<button class="chip" type="button" data-dia="${d}" aria-pressed="${(k.dias || []).includes(d)}">${d === 1 ? '1 día' : d + ' días'}</button>`).join('')}</div></div>
      </div>`;
    if (!grupoSaldo && !grupoCad) return '';
    return `<h2 class="section-title">Avisos</h2>${grupoSaldo}${grupoCad}`;
  }
  function inicioHTML() {
    const cards = tarjeta.list();
    const cf = store.get('cfPendiente', false);
    return `<div class="page-head"><h1>Tarjeta</h1><p>Saldo y caducidad de tus tarjetas TUSSAM.</p></div>
      ${tarjeta.nfc() ? '<div id="nfc-estado" class="nfc-box"></div>' : ''}
      ${cf ? '<div class="alert warn">TUSSAM pidió una comprobación la última vez. Abre una tarjeta y pulsa «Hacer la comprobación».</div>' : ''}
      ${cards.length ? `<div class="row-between"><h2 class="section-title">Mis tarjetas</h2><span class="small muted">${cards.length > 1 ? 'Desliza para ver más' : ''}</span></div>
        <div class="carrusel">${cards.map((c) => `<button class="card-btn" type="button" data-open="${esc(c.num)}" aria-label="${esc(c.name || 'Tarjeta')} ${esc(tarjeta.fmt(c.num))}">
          ${tcardHTML(c.num, c, null, { mini: true })}
          <span class="card-btn-sub">${c.ultimo?.fecha ? `${c.avisoSaldo?.on && c.ultimo.saldo != null && c.ultimo.saldo < Number(c.avisoSaldo.importe) ? '⚠ Saldo bajo · ' : ''}Actualizada ${haceCuanto(c.ultimo.fecha)}` : 'Toca para consultar'}</span></button>`).join('')}</div>`
      : `<div class="empty" style="padding:16px">${ICON.nfc}<h2>Añade tu tarjeta</h2><p>${tarjeta.nfc() ? 'Acércala al móvil o escribe su número.' : 'Escribe el número que tiene detrás.'}</p></div>`}
      <button class="btn ghost block" type="button" id="t-add">+ Añadir tarjeta por su número</button>
      <a class="btn ghost block" href="#tarifas">💶 Tarifas y títulos de viaje</a>`;
  }
  function pintar() {
    if (dead) return;
    el.innerHTML = `<div class="stack view-anim">${detalle ? detalleHTML() : inicioHTML()}</div>`;
    if (!detalle) {
      if (tarjeta.nfc()) { if (lectorActivo) $('#nfc-estado', el).innerHTML = nfcEstadoHTML('on'); else armarLector(); }
      bindNfc();
      el.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => abrir(b.dataset.open); });
      $('#t-add', el).onclick = anadirManual;
      return;
    }
    const num = detalle.num;
    $('#t-back', el).onclick = cerrarDetalle;
    $('#t-again', el).onclick = () => consultar(num);
    $('#t-again2', el)?.addEventListener('click', () => consultar(num));
    $('#t-cf', el)?.addEventListener('click', () => consultar(num, { visible: true }));
    $('#t-ver', el)?.addEventListener('click', () => consultar(num, { visible: true }));
    el.querySelectorAll('[data-web]').forEach((b) => { b.onclick = () => abrirOficial(num); });
    $('#t-oficial', el).onclick = () => abrirOficial(num);
    $('#t-save', el)?.addEventListener('click', () => editCard(num, true));
    $('#t-edit', el)?.addEventListener('click', () => editCard(num));
    $('#t-menu', el)?.addEventListener('click', () => menuTarjeta(num));
    // avisos
    const c = tarjeta.get(num);
    if (!c) return;
    const guardarAv = (patch) => { tarjeta.update(num, patch); window.avisosTarjeta?.comprobar(num); };
    const avS = $('#av-s', el);
    if (avS) avS.onchange = async (e) => {
      if (e.target.checked && !(await window.avisos?.permisoOk?.())) { e.target.checked = false; return; }
      guardarAv({ avisoSaldo: { ...(c.avisoSaldo || { importe: 3 }), on: e.target.checked } }); pintar();
    };
    el.querySelectorAll('[data-imp]').forEach((b) => { b.onclick = () => { guardarAv({ avisoSaldo: { on: true, importe: Number(b.dataset.imp) } }); pintar(); }; });
    $('#av-s-imp', el)?.addEventListener('change', (e) => { const v = Number(String(e.target.value).replace(',', '.')); if (v > 0 && v < 500) { guardarAv({ avisoSaldo: { on: true, importe: Math.round(v * 100) / 100 } }); pintar(); } });
    const avC = $('#av-c', el);
    if (avC) avC.onchange = async (e) => {
      if (e.target.checked && !(await window.avisos?.permisoOk?.())) { e.target.checked = false; return; }
      guardarAv({ avisoCaducidad: { ...(c.avisoCaducidad || { dias: [15, 3] }), on: e.target.checked } }); pintar();
    };
    el.querySelectorAll('[data-dia]').forEach((b) => { b.onclick = () => {
      const d = Number(b.dataset.dia); const set = new Set(c.avisoCaducidad?.dias || [15, 3]);
      if (set.has(d)) set.delete(d); else set.add(d);
      guardarAv({ avisoCaducidad: { on: true, dias: [...set].sort((x, y) => y - x) } }); pintar();
    }; });
  }
  function cerrarDetalle() { detalle = null; pintar(); }
  function anadirManual() {
    openModal(`<h2>Añadir tarjeta</h2><p class="help">Escribe el número que tiene la tarjeta en la parte de atrás (12 dígitos).</p>
      <form id="am-form" class="field" novalidate><label for="am-num">Número de tarjeta</label>
      <input id="am-num" inputmode="numeric" autocomplete="off" maxlength="15" placeholder="0000 0000 0000">
      <button class="btn" type="submit">Consultar saldo</button></form>`, (m, close) => {
      const inp = $('#am-num', m);
      inp.addEventListener('input', () => { inp.value = tarjeta.fmt(inp.value.replace(/\D/g, '').slice(0, 12)); });
      setTimeout(() => inp.focus(), 50);
      $('#am-form', m).onsubmit = (e) => {
        e.preventDefault();
        const num = inp.value.replace(/\D/g, '');
        if (num.length !== 12) { toast('El número tiene 12 dígitos. Revísalo en la parte de atrás.'); return; }
        close(); abrir(num, { consultar: true });
      };
    });
  }
  function menuTarjeta(num) {
    openModal(`<h2>${esc(tarjeta.get(num)?.name || 'Tarjeta')}</h2>
      <div class="stack"><button class="btn ghost block" type="button" id="mt-edit">Personalizar</button>
      <button class="btn ghost block" type="button" id="mt-web">Abrir la web de TUSSAM</button>
      <button class="btn danger block" type="button" id="mt-del">Borrar tarjeta</button></div>`, (m, close) => {
      $('#mt-edit', m).onclick = () => { close(); editCard(num); };
      $('#mt-web', m).onclick = () => { close(); openWeb(tarjeta.url(num)); };
      $('#mt-del', m).onclick = () => { close(); window.avisosTarjeta?.cancelarTodo(num); tarjeta.remove(num); toast('Tarjeta borrada'); detalle = null; pintar(); };
    });
  }
  function editCard(num, nueva = false) {
    const prev = tarjeta.get(num);
    const c = prev || { num, name: '', color: '', tipo: '' };
    let color = c.color || '';
    const detect = tipoDetectado(c, detalle?.res?.ok ? detalle.res : null);   // si TUSSAM dice el tipo, no se puede cambiar
    const originalFondo = tarjeta.foto(num);
    const preview = (m) => {
      $('#c-prev', m).innerHTML = tcardHTML(num, { ...c, name: $('#c-name', m).value, color, tipo: detect ? '' : (c.tipo || '') }, detalle?.res?.ok ? detalle.res : null, { mini: true });
    };
    openModal(`<h2>${nueva ? 'Guardar tarjeta' : 'Personalizar tarjeta'}</h2>
      <div id="c-prev"></div>
      <div class="field"><label for="c-name">Nombre</label><input id="c-name" maxlength="24" placeholder="Por ejemplo: Mía, Mamá, Trabajo" value="${esc(c.name || '')}"></div>
      <div class="field"><label>Color</label>${swatchesHTML(color, 'data-cc')}<p class="help">Si no eliges ninguno, se usa el diseño de su tipo.</p></div>
      <div class="field"><label>Foto de fondo</label>
        <div class="btn-row"><label class="btn ghost" for="c-foto" style="cursor:pointer">Elegir foto de fondo</label><button class="btn ghost" type="button" id="c-sinfoto">Quitar</button></div>
        <input id="c-foto" type="file" accept="image/*" hidden></div>
      <p class="help">Las fotos se guardan solo en este móvil.</p>
      <div class="actions"><button class="btn ghost" type="button" id="c-cancel">Cancelar</button><button class="btn" type="button" id="c-ok">Guardar</button></div>`,
    (m, close) => {
      preview(m);
      $('#c-name', m).oninput = () => preview(m);
      m.querySelectorAll('[data-cc]').forEach((b) => { b.onclick = () => {
        color = color === b.dataset.cc ? '' : b.dataset.cc;
        m.querySelectorAll('[data-cc]').forEach((x) => { const on = x.dataset.cc === color; x.setAttribute('aria-pressed', on); x.innerHTML = on ? ICON.check : ''; });
        preview(m);
      }; });
      const fotoInput = (sel, cual) => { $(sel, m).onchange = async (e) => { try { tarjeta.setFoto(num, await leerFoto(e.target.files?.[0]), cual); preview(m); } catch (err) { toast(err.message); } }; };
      fotoInput('#c-foto', 'fondo');
      $('#c-sinfoto', m).onclick = () => { tarjeta.setFoto(num, ''); preview(m); };
      const deshacer = () => { tarjeta.setFoto(num, originalFondo); };
      $('#c-cancel', m).onclick = () => { deshacer(); close(); };
      m.closest('.modal-bg').addEventListener('click', (e) => { if (e.target === e.currentTarget) deshacer(); });
      $('#c-ok', m).onclick = () => {
        const base = tarjeta.get(num) || {};
        const r = detalle?.res?.ok ? detalle.res : null;
        const { precio: _sinPrecio, ...resto } = base;   // el precio ya no se escribe a mano: sale de las tarifas de TUSSAM
        tarjeta.save({ ...resto, num, name: $('#c-name', m).value.trim().slice(0, 24), color, tipo: detect ? '' : (c.tipo || ''),
          ultimo: base.ultimo || (r ? { saldo: r.saldo, tipo: r.tipo, titulo: r.titulo, caducidad: r.caducidad, caducaEl: r.caducaEl, sinCaducidad: r.sinCaducidad, sinSaldoWeb: r.sinSaldoWeb, fecha: r.fecha } : undefined) });
        close(); toast(nueva ? 'Tarjeta guardada' : 'Cambios guardados'); pintar();
      };
    });
  }

  const onNfc = (e) => { if (e?.uid) { try { abrir(tarjeta.numeroDesdeUid(e.uid), { consultar: true }); } catch (err) { toast(err.message); } } };
  window.addEventListener('bussevTarjeta', onNfc);
  const onResume = () => { if (!detalle) armarLector(); };
  resumeHandlers.add(onResume);
  const inicioNum = window.__tarjetaPendiente; window.__tarjetaPendiente = null;
  if (inicioNum) abrir(inicioNum, { consultar: true }); else pintar();
  return {
    back: () => { if (detalle) { cerrarDetalle(); return true; } return false; },
    cleanup: () => {
      dead = true; lectorActivo = false;
      window.removeEventListener('bussevTarjeta', onNfc);
      window.removeEventListener('bussevNfc', alCambiarNfc);
      window.removeEventListener('bussev-tarifas', alTarifas);
      resumeHandlers.delete(onResume);
      document.querySelector('.scan-overlay')?.remove();
      if (tarjeta.nfc()) tarjeta.call('cancelar').catch(() => null);
    },
    refresh: () => (detalle ? consultar(detalle.num) : pintar()),
  };
};

/* BusSev — Tarifas y títulos de viaje de TUSSAM.
   Lee la página pública https://www.tussam.es/es/titulos-de-viajes (solo texto, con DOMParser,
   que no ejecuta nada) y guarda los precios 24 h. Si TUSSAM cambia un precio, la app lo coge
   la próxima vez que lo consulte. Con esos precios calcula los viajes que te quedan
   en los bonobús de saldo (con y sin transbordo). */
'use strict';

window.tarifas = (() => {
  const WEB = 'https://www.tussam.es';
  const URL_TARIFAS = `${WEB}/es/titulos-de-viajes`;
  const VALE = 24 * 3600_000;
  const RE_PRECIO = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:€|euros?\b)|€\s*(\d{1,3}(?:[.,]\d{1,2})?)/i;
  let pidiendo = null;

  const limpio = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const numero = (t) => Number(String(t).replace(',', '.'));
  const datos = () => store.get('tarifas2', null);      // { at, nota, lista: [{ grupo, nombre, precio, descuento, gratis, url }] }
  const bonito = (t) => { const x = limpio(t).toLocaleLowerCase('es'); return x.charAt(0).toLocaleUpperCase('es') + x.slice(1); };
  const leerPrecio = (t) => { const m = limpio(t).match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*€/); return m ? numero(m[1]) : null; };

  async function descargar(url) {
    const r = await Promise.race([
      fetch(url, { headers: { Accept: 'text/html' }, credentials: 'omit', cache: 'no-store' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('La web de TUSSAM está tardando demasiado.')), 15000)),
    ]);
    if (!r.ok) throw new Error(`La web de TUSSAM ha respondido con un error (${r.status}).`);
    const t = await r.text();
    if (t.length > 2_000_000) throw new Error('Respuesta demasiado grande');
    return new DOMParser().parseFromString(t, 'text/html');
  }

  /* Página de TUSSAM: filas «.contenido-titulos-de-viaje» con 3 columnas
     (nombre · precio normal, a veces tachado · precio con descuento o «-»), agrupadas bajo un <h4>. */
  function leerTussam(doc) {
    const lista = [];
    let grupo = '';
    for (const n of doc.querySelectorAll('h4, .contenido-titulos-de-viaje')) {
      if (n.tagName === 'H4') { grupo = bonito(n.textContent); continue; }
      const cols = n.querySelectorAll('.lista-tarjetas');
      if (cols.length < 2) continue;
      const nombre = bonito(cols[0].textContent);
      const tNormal = limpio(cols[1].textContent);
      const gratis = /gratu/i.test(tNormal);
      const precio = gratis ? 0 : leerPrecio(tNormal);
      const descuento = cols[2] ? leerPrecio(cols[2].textContent) : null;
      if (!nombre || (precio == null && !gratis)) continue;
      let url = null;
      try { const u = new URL(n.querySelector('a[href]')?.getAttribute('href') || '', WEB); if (u.origin === WEB) url = u.href; } catch { /* sin enlace */ }
      lista.push({ grupo, nombre, precio, descuento: descuento != null && descuento !== precio ? descuento : null, gratis, url });
    }
    const nota = [...doc.querySelectorAll('.cabecera-list h6')].map((h) => limpio(h.textContent)).find((t) => /ley|descuento|real decreto/i.test(t)) || '';
    return { lista, nota };
  }

  /* Por si TUSSAM cambia el diseño: recorre la página y saca «nombre → precio» venga como venga */
  function leer(doc) {
    const raiz = doc.querySelector('main, article, #main-content, .region-content, #content') || doc.body;
    raiz.querySelectorAll('script, style, nav, header, footer, form, noscript').forEach((n) => n.remove());
    const lista = [];
    const vistos = new Set();
    let grupo = '';
    const meter = (nombre, texto) => {
      const m = texto.match(RE_PRECIO);
      if (!m) return;
      const precio = numero(m[1] || m[2]);
      if (!(precio > 0 && precio < 500)) return;
      nombre = limpio(nombre).replace(/[:\-–·]+$/, '').trim();
      if (!nombre || nombre.length > 140) nombre = grupo || 'Título';
      const k = `${grupo}|${nombre}|${precio}`;
      if (vistos.has(k)) return;
      vistos.add(k);
      lista.push({ grupo, nombre, precio, texto: limpio(texto).slice(0, 200) });
    };
    const bloques = raiz.querySelectorAll('h1, h2, h3, h4, h5, tr, li, p, dd, dt, .field, .views-row, div');
    for (const b of bloques) {
      if (/^H[1-5]$/.test(b.tagName)) { const t = limpio(b.textContent); if (t && !RE_PRECIO.test(t)) grupo = t.slice(0, 120); else if (t) meter(t.replace(RE_PRECIO, ''), t); continue; }
      if (b.tagName === 'DIV' && b.querySelector('div, p, li, tr, table, h1, h2, h3, h4, h5')) continue;   // solo los div «hoja»
      if (b.closest('tr') && b.tagName !== 'TR') continue;
      const t = limpio(b.textContent);
      if (!t || t.length > 400 || !RE_PRECIO.test(t)) continue;
      if (b.tagName === 'TR') {
        const celdas = [...b.children].map((c) => limpio(c.textContent));
        const i = celdas.findIndex((c) => RE_PRECIO.test(c));
        meter(celdas.filter((c, j) => j !== i && c).join(' · ') || grupo, celdas[i]);
        continue;
      }
      const antes = t.split(RE_PRECIO)[0];
      meter(antes || grupo, t);
    }
    return lista;
  }

  async function cargar({ forzar = false } = {}) {
    const d = datos();
    if (!forzar && d && Date.now() - d.at < VALE) return d;
    if (pidiendo) return pidiendo;
    pidiendo = (async () => {
      const doc = await descargar(URL_TARIFAS);
      let { lista, nota } = leerTussam(doc);
      if (!lista.length) lista = leer(doc).map((e) => ({ ...e, descuento: null, gratis: false, url: null }));
      if (!lista.length) throw new Error('No se han encontrado precios en la web de TUSSAM. Puede que haya cambiado.');
      const n = { at: Date.now(), nota, lista };
      store.set('tarifas2', n);
      window.dispatchEvent(new Event('bussev-tarifas'));
      return n;
    })().finally(() => { pidiendo = null; });
    return pidiendo;
  }

  /* Precio de un viaje para los bonobús de saldo (los únicos que descuentan saldo al picar) */
  function viaje(tipoId) {
    if (tipoId !== 'con-transbordo' && tipoId !== 'sin-transbordo') return null;
    const con = tipoId === 'con-transbordo';
    const lista = datos()?.lista || [];
    const es = (e) => { const t = norm(`${e.nombre} ${e.texto || ''}`); return /multiviaje|bono|saldo/.test(t) && (con ? /con transbordo/.test(t) : /sin transbordo/.test(t)) && !/aeropuerto|feria/.test(norm(e.grupo || '')); };
    const e = lista.find(es);
    if (!e) return null;
    return { precio: e.descuento ?? e.precio, normal: e.precio, conDescuento: e.descuento != null, nombre: e.nombre };
  }
  /* Precio de un viaje para los multiviaje/bonobús de saldo (los únicos que descuentan saldo al picar) */
  const precioViaje = (tipoId) => viaje(tipoId)?.precio || 0;

  // Al abrir la app, como mucho una vez al día
  setTimeout(() => cargar().catch(() => null), 6000);

  return { cargar, leer, leerTussam, precioViaje, viaje, get datos() { return datos(); }, URL: URL_TARIFAS };
})();

/* ---------- Pantalla «Tarifas y títulos de viaje» ---------- */
views.tarifas = (el) => {
  const T = window.tarifas;
  let cargando = false, error = '', dead = false;
  function paint() {
    const d = T.datos;
    const grupos = new Map();
    for (const e of d?.lista || []) { const g = e.grupo || 'Títulos'; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(e); }
    el.innerHTML = `<div class="stack view-anim">
      ${backHead('<div class="grow"><h2>Tarifas y títulos</h2><p>Precios actuales de TUSSAM.</p></div>')}
      ${error ? `<div class="av-error">${esc(error)}${d ? ' Se muestran los últimos precios descargados.' : ''}</div>` : ''}
      ${d?.lista.some((e) => e.descuento != null) ? `<div class="tf-nota">🏷️ Ahora hay <b>precios con descuento</b>${d.nota ? ` (${esc(d.nota)})` : ''}. Se muestra el precio normal tachado y, al lado, lo que pagas.</div>` : ''}
      ${d ? [...grupos].map(([g, l]) => `<section class="card tf-grupo"><h3>${esc(g)}</h3>${l.map((e) => `<${e.url ? `button type="button" data-tf="${esc(e.url)}"` : 'div'} class="tf-fila"><span>${esc(e.nombre === g ? 'Precio' : e.nombre)}</span><span class="tf-precio">${e.gratis ? '<b class="tf-gratis">Gratis</b>' : e.descuento != null ? `<s>${fmtEuro(e.precio)}</s><b>${fmtEuro(e.descuento)}</b>` : `<b>${fmtEuro(e.precio)}</b>`}${e.url ? ICON.chev : ''}</span></${e.url ? 'button' : 'div'}>`).join('')}</section>`).join('') : cargando ? cargandoHTML('Consultando las tarifas de TUSSAM…') : ''}
      <p class="updated">${cargando ? 'Consultando la web de TUSSAM…' : d ? `Precios revisados el ${new Date(d.at).toLocaleDateString('es-ES')} · pulsa ⟳ para revisar ahora` : ''}</p>
      <button class="btn ghost block" type="button" id="tf-web">Ver en la web de TUSSAM</button>
      <p class="small muted" style="text-align:center;margin:0">Fuente: tussam.es. BusSev los revisa una vez al día y calcula con ellos los viajes que te quedan en los bonobús de saldo.</p>
    </div>`;
    $('.back-btn', el).onclick = goBack;
    $('#tf-web', el).onclick = () => openWeb(T.URL);
    el.querySelectorAll('[data-tf]').forEach((b) => { b.onclick = () => openWeb(b.dataset.tf); });
  }
  async function load(forzar) {
    if (cargando) return;
    cargando = true; error = ''; spin(true); paint();
    try { await T.cargar({ forzar }); } catch (e) { error = e.message || 'No se ha podido consultar la web de TUSSAM.'; }
    finally { cargando = false; spin(false); if (!dead) paint(); }
  }
  load(false);
  return { refresh: () => load(true), cleanup: () => { dead = true; } };
};

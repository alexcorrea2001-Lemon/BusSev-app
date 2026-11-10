/* BusSev — avisos y horarios especiales de TUSSAM.
   Lee la lista pública de www.tussam.es/es/avisos-generales (solo texto: el HTML se analiza
   con DOMParser, que no ejecuta nada ni carga imágenes, y la app pinta su propio HTML escapado). */
'use strict';

const TUSSAM_WEB = 'https://www.tussam.es';
const AVISOS_URL = `${TUSSAM_WEB}/es/avisos-generales/avisos-y-horarios-especiales`;
const AVISOS_CADA = 60 * 60_000;          // como mucho una consulta por hora al abrir la app
const DETALLE_VALE = 6 * 3600_000;        // el detalle de un aviso se guarda 6 h
const MAX_HTML = 2_000_000;

window.avisosTussam = (() => {
  const st = {
    get datos() { return store.get('tussam.avisos', null); },      // { at, lista:[{id,titulo,seccion,lineas}] }
    set datos(v) { store.set('tussam.avisos', v); },
    get vistos() { return new Set(store.get('tussam.vistos', [])); },
    set vistos(s) { store.set('tussam.vistos', [...s].slice(-200)); },
  };
  let pidiendo = null;

  /* ---------- Descarga ---------- */
  async function descargar(url) {
    if (!url.startsWith(TUSSAM_WEB + '/')) throw new Error('Dirección no permitida');
    const r = await Promise.race([
      fetch(url, { headers: { Accept: 'text/html' }, credentials: 'omit', cache: 'no-store' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('La web de TUSSAM está tardando demasiado.')), 15000)),
    ]);
    if (!r.ok) throw new Error(`La web de TUSSAM ha respondido con un error (${r.status}).`);
    const txt = await r.text();
    if (txt.length > MAX_HTML) throw new Error('Respuesta demasiado grande');
    return new DOMParser().parseFromString(txt, 'text/html');
  }
  const et = (n) => String(n).replace(/^0+(?=\d)/, '');             // «02» → «2»
  const limpio = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const idDe = (href) => {
    try {
      const u = new URL(href, TUSSAM_WEB);
      if (u.origin !== TUSSAM_WEB) return null;
      const m = u.pathname.match(/^\/es\/avisos-generales\/([a-z0-9-]{1,150})$/);
      return m && m[1] !== 'avisos-y-horarios-especiales' ? m[1] : null;
    } catch { return null; }
  };

  /* ---------- Líneas a las que afecta (sacadas del título) ---------- */
  function lineasDe(titulo) {
    const T = titulo.toLocaleUpperCase('es');
    const out = new Set();
    const pre = T.match(/^L[ÍI]NEAS?\s+([A-Z0-9 ,]+?(?:\s+Y\s+[A-Z0-9]+)?)\s*[.:-]/);
    const trozos = pre ? [pre[1]] : [];
    for (const m of T.matchAll(/L[ÍI]NEAS?\s+((?:[A-Z]{0,2}\d{1,3}[A-Z]?)(?:\s*(?:,|\bY\b)\s*[A-Z]{0,2}\d{1,3}[A-Z]?)*)/g)) trozos.push(m[1]);
    for (const t of trozos) for (const x of t.split(/\s*,\s*|\s+Y\s+/)) {
      const v = x.trim();
      if (/^[A-Z]{0,2}\d{1,3}[A-Z]?$/.test(v)) out.add(lineaFor(v)?.numero || v);
    }
    if (/AEROPUERTO/.test(T)) out.add(lineaFor('EA')?.numero || 'EA');
    if (/NOCTURN/.test(T)) for (const l of cache.lineaByNum.values()) if (/^A\d$/.test(l.numero)) out.add(l.numero);
    return [...out];
  }
  /* Título legible: sin «LÍNEAS 2.» delante (ya salen los colores) y sin mayúsculas gritonas */
  const PROPIOS = /\b(real betis|betis|sevilla|cartuja|sánchez pizjuán|pizjuán|miraflores|heliópolis|triana|macarena|nervión|alameda|trajano|reina mercedes|polígono sur|sierra de la grana|alcalde parias merry|parias merry|santa justa|san bernardo|plaza de armas|prado de san sebastián)\b/g;
  function titulo(t, quitarLineas = true) {
    let s = limpio(t);
    if (quitarLineas) { const q = s.replace(/^L[ÍI]NEAS?\s+(?=[^.]*\d)[A-Z0-9 ,]+?\s*\.\s*/i, ''); if (q.length > 3) s = q; }
    if (s === s.toLocaleUpperCase('es')) {
      s = s.toLocaleLowerCase('es');
      s = s.charAt(0).toLocaleUpperCase('es') + s.slice(1);
      s = s.replace(PROPIOS, (w) => w.replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase('es')).replace(/ (De|La|Del|Los|Las|El)(?= )/g, (m) => m.toLowerCase()));
      s = s.replace(/\b(cc\.ss\.|[ace]\d{1,2})(?![\p{L}\d])/giu, (w) => w.toUpperCase());
    }
    return s.replace(/\.$/, '');
  }

  /* ---------- Lista ---------- */
  function leerLista(doc) {
    const lista = [];
    const vistos = new Set();
    const grupos = doc.querySelectorAll('nav.menu--avisos-generales li.menu-item, nav[id*="avisos"] li.menu-item, li.memu-depth-1, li.menu-depth-1');
    const add = (a, seccion) => {
      const id = idDe(a.getAttribute('href') || '');
      const t = limpio(a.textContent);
      if (!id || !t || vistos.has(id) || t.length > 300) return;
      vistos.add(id);
      lista.push({ id, titulo: t, seccion, lineas: lineasDe(t) });
    };
    for (const g of grupos) {
      const nombre = limpio(g.querySelector('.enlace-menu, label, span')?.textContent).toLocaleUpperCase('es');
      const seccion = /HORARIO/.test(nombre) ? 'horarios' : 'avisos';
      g.querySelectorAll('ul.menu-2 a[href]').forEach((a) => add(a, seccion));
    }
    if (!lista.length) doc.querySelectorAll('ul.menu-2 a[href]').forEach((a) => add(a, /^HORARIO/i.test(limpio(a.textContent)) ? 'horarios' : 'avisos'));
    return lista;
  }

  /* ---------- Mis líneas: las de mis paradas favoritas ---------- */
  async function misLineas() {
    const s = new Set();
    await getLineas().catch(() => null);
    for (const f of favs.list()) {
      let ls = f.lineas?.length ? f.lineas : null;
      if (!ls) ls = await api(`/paradas/${encodeURIComponent(f.codigo)}/lineas`).catch(() => []);
      for (const n of ls || []) s.add(lineaFor(n)?.numero || String(n));
    }
    return s;
  }
  const meAfecta = (a, mias) => a.lineas.some((n) => mias.has(n));

  /* ---------- Revisar (al abrir, al volver o a mano) ---------- */
  async function revisar({ forzar = false } = {}) {
    const d = st.datos;
    if (!forzar && d && Date.now() - d.at < AVISOS_CADA) return d;
    if (pidiendo) return pidiendo;
    pidiendo = (async () => {
      await getLineas().catch(() => null);
      const doc = await descargar(AVISOS_URL);
      const lista = leerLista(doc);
      if (!lista.length) throw new Error('No se han encontrado avisos en la web de TUSSAM. Puede que haya cambiado.');
      const antes = d ? new Set(d.lista.map((a) => a.id)) : null;
      st.datos = { at: Date.now(), lista };
      if (!antes) st.vistos = new Set(lista.map((a) => a.id));        // la primera vez nada es «nuevo»
      else await notificarNuevos(lista.filter((a) => !antes.has(a.id)));
      window.dispatchEvent(new Event('bussev-avisos'));
      return st.datos;
    })().finally(() => { pidiendo = null; });
    return pidiendo;
  }

  async function notificarNuevos(nuevos) {
    const modo = settings.avisosTussam || 'mias';
    if (!nuevos.length || modo === 'no' || !plugin('LocalNotifications')) return;
    const mias = await misLineas();
    const lista = modo === 'todas' ? nuevos : nuevos.filter((a) => meAfecta(a, mias));
    if (!lista.length) return;
    const perm = await native('LocalNotifications', 'checkPermissions').catch(() => ({}));
    if (perm.display !== 'granted') return;
    const pref = (a) => (a.lineas.length ? `${a.lineas.length > 1 ? 'Líneas' : 'Línea'} ${a.lineas.map(et).join(', ')}: ` : '');
    const n = lista.length === 1
      ? { title: `Aviso de TUSSAM${a1(lista[0])}`, body: titulo(lista[0].titulo) }
      : { title: `${lista.length} avisos nuevos de TUSSAM`, body: lista.slice(0, 4).map((a) => pref(a) + titulo(a.titulo)).join(' · ') };
    function a1(a) { return a.lineas.length ? ` · ${a.lineas.length > 1 ? 'líneas' : 'línea'} ${a.lineas.map(et).join(', ')}` : ''; }
    await native('LocalNotifications', 'schedule', { notifications: [{
      id: idAviso('tussam-avisos' + Date.now()), ...n,
      largeBody: n.body, extra: { abrir: 'avisos' },
      schedule: { at: new Date(Date.now() + 1500).toISOString(), allowWhileIdle: true }, smallIcon: 'ic_stat_bus', iconColor: '#D41C2B',
    }] }).catch(() => null);
  }

  /* ---------- Detalle de un aviso ---------- */
  function leerDetalle(doc) {
    const art = doc.querySelector('article.node--type-aviso-a-los-clientes, article.node, main article') || doc.querySelector('#main-content')?.parentElement;
    if (!art) throw new Error('No se ha podido leer el aviso.');
    const campos = [];
    const adjuntos = [];
    const enlaceOk = (h) => { try { const u = new URL(h, TUSSAM_WEB); return u.origin === TUSSAM_WEB && u.protocol === 'https:' ? u.href : null; } catch { return null; } };
    const esPdf = (href, texto) => /\.pdf(\?|$)/i.test(href || '') || (/pdf/i.test(texto || '') && !/\.(png|jpe?g|gif|webp)(\?|$)/i.test(href || ''));
    const agregarAdjuntos = (nodo) => {
      for (const a of nodo.querySelectorAll('a[href]')) {
        const raw = a.getAttribute('href');
        if (!(/ver imagen|imagen|plano|pdf|descargar/i.test(a.textContent) || /\.(png|jpe?g|gif|webp|pdf)(\?|$)/i.test(raw))) continue;
        const href = enlaceOk(raw);
        if (!href || adjuntos.some((x) => x.href === href)) continue;
        const pdf = esPdf(href, a.textContent);
        adjuntos.push({ href, pdf, texto: pdf ? 'Abrir PDF' : 'Ver imagen o plano' });
      }
    };
    const bloques = (nodo) => {
      const out = [];
      const ps = nodo.querySelectorAll('p, li, h2, h3, h4, tr');
      if (!ps.length) { const t = limpio(nodo.textContent); if (t) out.push({ t }); return out; }
      for (const p of ps) {
        if (p.closest('tr') && p.tagName !== 'TR') continue;
        if (p.tagName === 'TR') { const celdas = [...p.children].map((c) => limpio(c.textContent)); if (celdas.some(Boolean)) out.push({ fila: celdas, cab: !!p.querySelector('th') }); continue; }
        if (p.tagName === 'P' && p.closest('li')) continue;
        const t = limpio(p.textContent);
        if (t) out.push({ t, b: !!p.querySelector('b, strong') && limpio(p.querySelector('b, strong').textContent).length > t.length * 0.6, li: p.tagName === 'LI', h: /^H/.test(p.tagName) });
      }
      return out;
    };
    const filas = art.querySelectorAll('.views-field');
    for (const f of filas) {
      const lab = limpio(f.querySelector('.views-label')?.textContent).replace(/:$/, '');
      const cont = f.querySelector('.field-content');
      if (!cont) continue;
      if (!lab) { agregarAdjuntos(cont); continue; }                         // bloque sin etiqueta: imágenes/PDF del aviso
      agregarAdjuntos(cont);                                                 // también puede haber adjuntos dentro de un campo con etiqueta
      const b = bloques(cont);
      if (b.length) campos.push({ lab, b });
    }
    if (!campos.length) {
      const cuerpo = art.querySelector('.node__content, .field--name-body, .panel-body') || art;
      const b = bloques(cuerpo).slice(0, 300);
      if (b.length) campos.push({ lab: '', b });
      agregarAdjuntos(cuerpo);
    }
    const h1 = limpio(art.querySelector('h1')?.textContent || doc.querySelector('h1')?.textContent);
    return { h1, campos, adjuntos, imagen: adjuntos[0]?.href || null };
  }
  async function detalle(id, forzar = false) {
    const k = 'tussam.det.' + id;
    const g = store.get(k, null);
    if (!forzar && g && Date.now() - g.at < DETALLE_VALE) return g.d;
    try {
      const d = leerDetalle(await descargar(`${TUSSAM_WEB}/es/avisos-generales/${id}`));
      store.set(k, { at: Date.now(), d });
      return d;
    } catch (e) { if (g) return g.d; throw e; }
  }
  function detalleHTML(d) {
    const bloque = (b) => {
      const filas = b.filter((x) => x.fila);
      const resto = b.filter((x) => !x.fila).map((x) => x.h ? `<h4>${esc(x.t)}</h4>` : x.li ? `<p class="av-li">• ${esc(x.t)}</p>` : `<p${x.b ? ' class="av-b"' : ''}>${esc(x.t)}</p>`).join('');
      const tabla = filas.length ? `<div class="av-tabla"><table>${filas.map((f) => `<tr>${f.fila.map((c) => (f.cab ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</table></div>` : '';
      return resto + tabla;
    };
    return d.campos.map((c) => `<div class="av-campo">${c.lab ? `<h3>${esc(c.lab)}</h3>` : ''}${bloque(c.b)}</div>`).join('') || '<p class="help">Este aviso no tiene más texto.</p>';
  }
  function abrir(id) {
    const a = st.datos?.lista.find((x) => x.id === id);
    const v = st.vistos; v.add(id); st.vistos = v;
    const cab = a ? `${a.lineas.length ? `<div class="chips-wrap" style="margin-bottom:8px">${a.lineas.map((n) => badge(et(n), lineaFor(n)?.color, { sm: true, href: `#linea-${encodeURIComponent(n)}` })).join('')}</div>` : ''}<h2>${esc(titulo(a.titulo))}</h2>` : '<h2>Aviso de TUSSAM</h2>';
    openModal(`${cab}<p class="help" style="margin-top:-4px">${a?.seccion === 'horarios' ? 'Horario especial' : 'Aviso'} de TUSSAM</p>
      <div id="av-det" class="av-det">${cargandoHTML('Abriendo el aviso…')}</div>
      <div class="actions"><button class="btn ghost" type="button" id="av-web">Ver en la web</button><button class="btn" type="button" id="av-ok">Cerrar</button></div>`, (m, close) => {
      $('#av-ok', m).onclick = close;
      $('#av-web', m).onclick = () => openWeb(`${TUSSAM_WEB}/es/avisos-generales/${id}`);
      m.querySelectorAll('a[href^="#linea-"]').forEach((x) => x.addEventListener('click', close));
      detalle(id).then((d) => {
        const box = $('#av-det', m);
        if (!box) return;
        const adj = d.adjuntos && d.adjuntos.length ? d.adjuntos : (d.imagen ? [{ href: d.imagen, pdf: /\.pdf(\?|$)/i.test(d.imagen), texto: 'Ver imagen o plano' }] : []);
        box.innerHTML = detalleHTML(d) + adj.map((a, i) => `<button class="btn ghost block" type="button" data-av="${i}">${a.pdf ? '📄' : '🗺️'} ${a.texto}</button>`).join('');
        adj.forEach((a, i) => { const b = $(`[data-av="${i}"]`, m); if (b) b.onclick = () => openWeb(a.href); });
      }).catch((e) => {
        const box = $('#av-det', m);
        if (box) box.innerHTML = `<p class="help">${esc(e.message || 'No se ha podido abrir el aviso.')} Puedes verlo en la web de TUSSAM.</p>`;
      });
      window.dispatchEvent(new Event('bussev-avisos'));
    });
  }

  /* ---------- Piezas para otras pantallas ---------- */
  function filaHTML(a, nuevo) {
    const chips = a.lineas.length ? a.lineas.slice(0, 6).map((n) => badge(et(n), lineaFor(n)?.color, { sm: true })).join('') : `<span class="av-ico">${a.seccion === 'horarios' ? '🕒' : '⚠️'}</span>`;
    return `<button class="av-row" type="button" data-aviso="${esc(a.id)}"><span class="av-lineas">${chips}</span><span class="av-txt">${esc(titulo(a.titulo))}${nuevo ? ' <i class="av-nuevo">Nuevo</i>' : ''}</span>${ICON.chev}</button>`;
  }
  /* Banner en una línea o parada: avisos que afectan a esas líneas */
  function bannerHTML(lineas) {
    const d = st.datos;
    if (!d) return '';
    const set = new Set(lineas.map((n) => lineaFor(n)?.numero || String(n)));
    const ls = d.lista.filter((a) => a.lineas.some((n) => set.has(n)));
    if (!ls.length) return '';
    return `<div class="av-banner"><h3>⚠️ ${ls.length === 1 ? 'Aviso de TUSSAM' : `${ls.length} avisos de TUSSAM`}</h3>${ls.map((a) => filaHTML(a, false)).join('')}</div>`;
  }
  /* Tarjeta en Favoritas */
  async function favoritasHTML() {
    const d = st.datos;
    if (!d) return '';
    const mias = await misLineas();
    const vistos = st.vistos;
    const enMias = d.lista.filter((a) => meAfecta(a, mias)).length;
    const nuevos = d.lista.filter((a) => !vistos.has(a.id)).length;
    const det = [enMias ? `${enMias} en tus líneas` : 'ninguno en tus líneas', nuevos ? `${nuevos} nuevo${nuevos > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
    return `<a class="av-boton${enMias ? ' hay' : ''}" href="#avisos"><span class="av-ico">${enMias ? '⚠️' : '✅'}</span><span class="av-txt"><b>Ver avisos de TUSSAM (${d.lista.length})</b><small>${det}</small></span>${nuevos ? '<i class="av-punto"></i>' : ''}${ICON.chev}</a>`;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-aviso]');
    if (!b) return;
    e.preventDefault();
    abrir(b.dataset.aviso);
  });

  return { revisar, abrir, bannerHTML, favoritasHTML, filaHTML, misLineas, meAfecta, titulo, lineasDe, leerLista, leerDetalle, get datos() { return st.datos; }, get vistos() { return st.vistos; }, marcarVistos(ids) { const v = st.vistos; ids.forEach((i) => v.add(i)); st.vistos = v; } };
})();

/* ---------- Pantalla «Avisos de TUSSAM» ---------- */
views.avisos = (el) => {
  const A = window.avisosTussam;
  let filtro = store.get('tussam.filtro', 'mias'), cargando = false, error = '', dead = false;
  async function paint() {
    const d = A.datos;
    const mias = await A.misLineas();
    if (dead) return;
    const vistos = A.vistos;
    const pasa = (a) => filtro === 'todas' || A.meAfecta(a, mias);
    const sec = (k, nombre, vacio) => {
      const ls = (d?.lista || []).filter((a) => a.seccion === k);
      const vis = ls.filter(pasa);
      return `<h2 class="section-title">${nombre}</h2>${vis.length ? `<div class="av-list">${vis.map((a) => A.filaHTML(a, !vistos.has(a.id))).join('')}</div>` : `<p class="help">${ls.length ? vacio : 'No hay ninguno ahora mismo.'}</p>`}`;
    };
    el.innerHTML = `<div class="stack view-anim">
      ${backHead('<div class="grow"><h2>Avisos de TUSSAM</h2><p>Desvíos, obras y horarios especiales.</p></div>')}
      <div class="seg" role="group" aria-label="Qué avisos ver"><button type="button" data-f="mias" aria-pressed="${filtro === 'mias'}">De mis líneas</button><button type="button" data-f="todas" aria-pressed="${filtro === 'todas'}">Todos</button></div>
      ${!favs.list().length && filtro === 'mias' ? '<p class="help">«Mis líneas» son las que paran en tus paradas favoritas. Aún no tienes ninguna: mira «Todos».</p>' : ''}
      ${error ? `<div class="av-error">${esc(error)}${d ? ' Se muestran los últimos avisos descargados.' : ''}</div>` : ''}
      ${d ? sec('avisos', 'Avisos', 'Ninguno afecta a tus líneas.') + sec('horarios', 'Horarios especiales', 'Ninguno es de tus líneas.') : cargando ? cargandoHTML('Consultando los avisos de TUSSAM…', 'La primera vez tarda unos segundos; después salen al momento.') : ''}
      <p class="updated">${cargando ? 'Consultando la web de TUSSAM…' : d ? `Revisado a las ${new Date(d.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · pulsa ⟳ para revisar ahora` : ''}</p>
      <p class="small muted" style="text-align:center;margin:0">Fuente: tussam.es. La app los revisa al abrirla (como mucho una vez por hora).</p>
    </div>`;
    $('.back-btn', el).onclick = goBack;
    el.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { filtro = b.dataset.f; store.set('tussam.filtro', filtro); paint(); }; });
  }
  async function load(forzar = true) {
    if (cargando) return;
    cargando = true; error = ''; spin(true); paint();
    try { await A.revisar({ forzar }); } catch (e) { error = e.message || 'No se ha podido consultar la web de TUSSAM.'; }
    finally { cargando = false; spin(false); if (!dead) paint(); }
  }
  const onAv = () => { if (!dead && !cargando) paint(); };
  window.addEventListener('bussev-avisos', onAv);
  if (A.datos) paint();
  load(!A.datos ? true : false);
  return {
    refresh: () => load(true),
    cleanup: () => { dead = true; window.removeEventListener('bussev-avisos', onAv); if (A.datos) A.marcarVistos(A.datos.lista.map((a) => a.id)); },
  };
};

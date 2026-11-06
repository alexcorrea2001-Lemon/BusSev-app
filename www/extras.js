/* BusSev — aviso de llegada, lectura en voz alta, cómo llegar y copia de seguridad. */
'use strict';

const plugin = (name) => !!window.Capacitor?.isPluginAvailable?.(name);
const native = (name, method, opts = {}) => window.Capacitor.nativePromise(name, method, opts);

/* ================================================================== */
/* Aviso de llegada (notificación local, sin servidores)               */
/* Se programa con el tiempo que da TUSSAM y se corrige cada vez que   */
/* la app vuelve a consultar esa parada.                               */
/* ================================================================== */
const avisos = {
  list() { const now = Date.now(); return store.get('avisos', []).filter((a) => a.at > now - 60_000); },
  save(l) { store.set('avisos', l); },
  find(codigo, linea, destino) { return this.list().find((a) => a.codigo === codigo && a.linea === linea && a.destino === destino) || null; },
  async permiso() {
    if (!plugin('LocalNotifications')) throw new Error('Los avisos solo funcionan en la app instalada.');
    let p = await native('LocalNotifications', 'checkPermissions').catch(() => ({}));
    if (p.display !== 'granted') p = await native('LocalNotifications', 'requestPermissions').catch(() => ({}));
    if (p.display !== 'granted') throw new Error('Activa las notificaciones de BusSev en los ajustes del móvil para recibir avisos.');
  },
  async programar(a) {
    const at = Math.max(Date.now() + 5000, Date.now() + (a.minutos - a.antes) * 60_000);
    const id = a.id || (Math.floor(Math.random() * 2_000_000_000) + 1);
    await native('LocalNotifications', 'cancel', { notifications: [{ id }] }).catch(() => null);
    await native('LocalNotifications', 'schedule', { notifications: [{
      id, title: `Línea ${a.linea}: llega en ${a.antes} min`, body: `${a.parada} · hacia ${a.destino}`,
      schedule: { at: new Date(at).toISOString(), allowWhileIdle: true }, smallIcon: 'ic_stat_bus', iconColor: '#D41C2B',
    }] });
    const l = this.list().filter((x) => x.id !== id);
    l.push({ id, codigo: a.codigo, parada: a.parada, linea: a.linea, destino: a.destino, antes: a.antes, at });
    this.save(l);
    return at;
  },
  async cancelar(id) {
    if (plugin('LocalNotifications')) await native('LocalNotifications', 'cancel', { notifications: [{ id }] }).catch(() => null);
    this.save(this.list().filter((x) => x.id !== id));
  },
  /* Corrige la hora del aviso con los tiempos nuevos de la parada */
  actualizar(codigo, tiempos) {
    const mios = this.list().filter((a) => a.codigo === codigo);
    for (const a of mios) {
      const t = (tiempos || []).filter((x) => x.linea === a.linea && x.destino === a.destino).sort((x, y) => x.tiempo_minutos - y.tiempo_minutos)[0];
      if (!t) continue;
      const nuevo = Date.now() + (t.tiempo_minutos - a.antes) * 60_000;
      if (Math.abs(nuevo - a.at) > 45_000 && nuevo > Date.now()) this.programar({ ...a, minutos: t.tiempo_minutos }).catch(() => null);
    }
  },
};
window.avisos = avisos; // lo usa app.js para marcar los avisos activos
function avisoModal({ codigo, parada, linea, destino, minutos, color }) {
  const ya = avisos.find(codigo, linea, destino);
  const opciones = [2, 5, 10, 15].filter((n) => n < minutos);
  openModal(`<h2>Aviso de llegada</h2>
    <div class="row-flat">${badge(linea, color)}<div><b>${esc(destino)}</b><p class="help">${esc(parada)} · ahora a ${minutos <= 0 ? 'punto de llegar' : minutos + ' min'}</p></div></div>
    ${ya ? `<div class="alert">Tienes un aviso para cuando falten ${ya.antes} min (sobre las ${new Date(ya.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}).</div>` : ''}
    ${opciones.length ? `<p class="help">Te mandaré una notificación cuando a este autobús le falten:</p>
      <div class="btn-row">${opciones.map((n) => `<button class="btn ghost" type="button" data-antes="${n}">${n} min</button>`).join('')}</div>
      <p class="help">El aviso se calcula con el tiempo de ahora y se corrige cada vez que abres la app. Si el autobús se retrasa mucho con la app cerrada, puede llegar un poco antes o después.</p>`
    : '<p class="help">Este autobús está a punto de llegar; no hace falta aviso.</p>'}
    <div class="actions">${ya ? '<button class="btn danger" type="button" id="av-del">Quitar aviso</button>' : ''}<button class="btn ghost" type="button" id="av-x">Cerrar</button></div>`,
  (m, close) => {
    $('#av-x', m).onclick = close;
    $('#av-del', m)?.addEventListener('click', async () => { await avisos.cancelar(ya.id); close(); toast('Aviso quitado'); active.rerender?.(); });
    m.querySelectorAll('[data-antes]').forEach((b) => { b.onclick = async () => {
      try {
        await avisos.permiso();
        if (ya) await avisos.cancelar(ya.id);
        const at = await avisos.programar({ codigo, parada, linea, destino, minutos, antes: Number(b.dataset.antes) });
        close();
        toast(`Te aviso sobre las ${new Date(at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`);
        active.rerender?.();
      } catch (e) { toast(e.message); }
    }; });
  });
}
document.addEventListener('click', (e) => {
  const r = e.target.closest('[data-av]');
  if (!r) return;
  e.preventDefault();
  const [codigo, linea, destino, minutos, color] = JSON.parse(r.dataset.av);
  const p = cache.paradaByCode.get(codigo);
  avisoModal({ codigo, parada: favs.get(codigo)?.alias || p?.nombre || `Parada ${codigo}`, linea, destino, minutos: Number(minutos), color });
});

/* ================================================================== */
/* Leer en voz alta                                                    */
/* ================================================================== */
function textoParaVoz(nombre, tiempos) {
  const g = groupArrivals(tiempos);
  if (!g.length) return `${nombre}. Ahora mismo no hay autobuses previstos.`;
  return `${nombre}. ` + g.slice(0, 6).map((x) => {
    const m = x.buses[0].tiempo_minutos;
    const n = x.buses[1]?.tiempo_minutos;
    return `Línea ${String(x.linea).replace(/^0/, '')}, hacia ${x.destino}: ${m <= 0 ? 'llegando' : m === 1 ? 'un minuto' : m + ' minutos'}${n != null ? `; el siguiente, en ${n} minutos` : ''}.`;
  }).join(' ');
}
async function hablar(texto) {
  try {
    if (plugin('TextToSpeech')) {
      await native('TextToSpeech', 'stop').catch(() => null);
      await native('TextToSpeech', 'speak', { text: texto, lang: 'es-ES', rate: 1.0, pitch: 1.0, volume: 1.0, category: 'ambient' });
    } else if (window.speechSynthesis) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texto); u.lang = 'es-ES'; speechSynthesis.speak(u);
    } else toast('Este móvil no permite leer en voz alta.');
  } catch { toast('No se ha podido leer en voz alta. Revisa que el móvil tenga instalada la voz en español.'); }
}

/* ================================================================== */
/* Cómo llegar: autobús directo o con un transbordo                    */
/* ================================================================== */
const planner = (() => {
  let idx = null;
  function build() {
    const D = window.BUSSEV_DATA;
    const pos = new Map(D.paradas.map((p) => [p.codigo, [p.latitud, p.longitud]]));
    const seqs = new Map();       // "linea|sentido" -> [codigos]
    for (const [cod, lin, s, orden] of D.recorridos) {
      const k = `${lin}|${s}`;
      if (!seqs.has(k)) seqs.set(k, []);
      seqs.get(k).push([orden, cod]);
    }
    const porParada = new Map();  // codigo -> [{k, i}]
    for (const [k, l] of seqs) {
      l.sort((a, b) => a[0] - b[0]);
      const cods = l.map((x) => x[1]);
      seqs.set(k, cods);
      cods.forEach((c, i) => { if (!porParada.has(c)) porParada.set(c, []); porParada.get(c).push({ k, i }); });
    }
    // paradas cercanas entre sí (para cambiar de autobús andando un poco)
    const cerca = new Map();
    const arr = D.paradas;
    for (let a = 0; a < arr.length; a++) {
      const pa = [arr[a].latitud, arr[a].longitud];
      for (let b = a; b < arr.length; b++) {
        if (Math.abs(arr[b].latitud - pa[0]) > 0.003) continue;
        const d = haversine(pa, [arr[b].latitud, arr[b].longitud]);
        if (d <= 220) {
          (cerca.get(arr[a].codigo) || cerca.set(arr[a].codigo, []).get(arr[a].codigo)).push([arr[b].codigo, d]);
          if (a !== b) (cerca.get(arr[b].codigo) || cerca.set(arr[b].codigo, []).get(arr[b].codigo)).push([arr[a].codigo, d]);
        }
      }
    }
    idx = { pos, seqs, porParada, cerca };
    return idx;
  }
  const ANDAR = 75;      // metros por minuto
  const PARADA = 1.6;    // minutos por parada, aproximado
  const CAMBIO = 6;      // penalización por transbordo (esperar al otro autobús)
  function paradasCerca(pt, radio = 450, max = 8) {
    const { pos } = idx || build();
    return [...pos].map(([c, p]) => [c, haversine(pt, p)]).filter(([, d]) => d <= radio).sort((a, b) => a[1] - b[1]).slice(0, max);
  }
  function buscar(origen, destino) {
    const I = idx || build();
    const O = paradasCerca(origen), Dd = new Map(paradasCerca(destino));
    const res = [];
    for (const [o, wo] of O) {
      for (const { k, i } of I.porParada.get(o) || []) {
        const seq = I.seqs.get(k);
        for (let j = i + 1; j < seq.length; j++) {
          if (Dd.has(seq[j])) res.push({ tramos: [{ k, desde: o, hasta: seq[j], n: j - i }], min: wo / ANDAR + (j - i) * PARADA + Dd.get(seq[j]) / ANDAR, andar: [wo, Dd.get(seq[j])] });
        }
        // con un transbordo
        for (let j = i + 1; j < seq.length; j++) {
          for (const [t, wt] of I.cerca.get(seq[j]) || []) {
            for (const { k: k2, i: i2 } of I.porParada.get(t) || []) {
              if (k2.split('|')[0] === k.split('|')[0]) continue;
              const s2 = I.seqs.get(k2);
              for (let j2 = i2 + 1; j2 < s2.length; j2++) {
                if (!Dd.has(s2[j2])) continue;
                const min = wo / ANDAR + (j - i) * PARADA + wt / ANDAR + CAMBIO + (j2 - i2) * PARADA + Dd.get(s2[j2]) / ANDAR;
                res.push({ tramos: [{ k, desde: o, hasta: seq[j], n: j - i }, { k: k2, desde: t, hasta: s2[j2], n: j2 - i2 }], min, andar: [wo, Dd.get(s2[j2])], cambio: wt });
                break;
              }
            }
          }
        }
      }
    }
    // la mejor opción de cada combinación de líneas
    const best = new Map();
    for (const r of res) {
      const key = r.tramos.map((t) => t.k.split('|')[0]).join('>');
      if (!best.has(key) || best.get(key).min > r.min) best.set(key, r);
    }
    const out = [...best.values()].sort((a, b) => a.min - b.min);
    const directos = out.filter((r) => r.tramos.length === 1);
    const mejorDirecto = directos[0]?.min ?? Infinity;
    // los transbordos solo si ahorran tiempo de verdad o no hay directo
    return [...directos.slice(0, 4), ...out.filter((r) => r.tramos.length === 2 && r.min < mejorDirecto - 5).slice(0, directos.length ? 2 : 5)].sort((a, b) => a.min - b.min);
  }
  return { buscar, paradasCerca };
})();

views.ruta = (el) => {
  const st = { origen: null, destino: null };   // { tipo:'yo'|'parada', nombre, pos, codigo }
  const nombreParada = (p) => favs.get(p.codigo)?.alias ? `${favs.get(p.codigo).alias} (${p.nombre})` : p.nombre;
  function campo(id, label, val, ph) {
    return `<div class="field plan-field"><label for="${id}">${label}</label>
      <div class="plan-input"><input id="${id}" autocomplete="off" placeholder="${ph}" value="${esc(val?.nombre || '')}">${id === 'pl-o' ? `<button class="btn ghost" type="button" id="pl-yo" title="Usar mi ubicación">${ICON.pin}</button>` : ''}</div>
      <div class="sugs" id="${id}-s" hidden></div></div>`;
  }
  function render() {
    el.innerHTML = `<div class="stack">
      ${backHead('<div class="grow"><h2>Cómo llegar</h2><p>En autobús, directo o con un transbordo.</p></div>')}
      <div class="set-group">${campo('pl-o', 'Desde', st.origen, 'Mi ubicación, parada o calle')}
        <button class="swap" type="button" id="pl-swap" aria-label="Intercambiar origen y destino">⇅</button>
        ${campo('pl-d', 'Hasta', st.destino, 'Parada, calle o número de parada')}
        <button class="btn" type="button" id="pl-go">Buscar autobuses</button></div>
      <div id="pl-res"></div></div>`;
    $('.back-btn', el).onclick = goBack;
    $('#pl-go', el).onclick = buscar;
    $('#pl-swap', el).onclick = () => { [st.origen, st.destino] = [st.destino, st.origen]; render(); };
    $('#pl-yo', el).onclick = async () => {
      try { const pos = await getPosition(); st.origen = { tipo: 'yo', nombre: 'Mi ubicación', pos }; $('#pl-o', el).value = 'Mi ubicación'; } catch (e) { toast(geoErrorText(e)); }
    };
    for (const [id, key] of [['pl-o', 'origen'], ['pl-d', 'destino']]) {
      const inp = $('#' + id, el), box = $(`#${id}-s`, el);
      inp.oninput = () => {
        const q = norm(inp.value); st[key] = null;
        if (q.length < 2) { box.hidden = true; return; }
        const words = q.split(/\s+/);
        const list = (window.BUSSEV_DATA.paradas).filter((p) => /^\d+$/.test(q) ? p.codigo.startsWith(q) : words.every((w) => norm(`${p.nombre} ${p.direccion_completa || ''} ${favs.get(p.codigo)?.alias || ''}`).includes(w))).slice(0, 8);
        box.innerHTML = list.map((p) => `<button type="button" data-c="${esc(p.codigo)}"><span class="stop-num">${esc(p.codigo)}</span><span><b>${esc(nombreParada(p))}</b><small>${esc(p.direccion_completa || '')}</small></span></button>`).join('') || '<p class="help" style="padding:8px">No hay paradas con ese nombre.</p>';
        box.hidden = false;
        box.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => {
          const p = cache.paradaByCode.get(b.dataset.c) || window.BUSSEV_DATA.paradas.find((x) => x.codigo === b.dataset.c);
          st[key] = { tipo: 'parada', nombre: nombreParada(p), pos: [p.latitud, p.longitud], codigo: p.codigo };
          inp.value = st[key].nombre; box.hidden = true;
        }; });
      };
    }
  }
  async function buscar() {
    const res = $('#pl-res', el);
    if (!st.origen) { try { const pos = await getPosition(); st.origen = { tipo: 'yo', nombre: 'Mi ubicación', pos }; $('#pl-o', el).value = 'Mi ubicación'; } catch { toast('Elige desde dónde sales.'); return; } }
    if (!st.destino) { toast('Elige adónde vas (una parada de la lista).'); return; }
    if (haversine(st.origen.pos, st.destino.pos) < 300) { res.innerHTML = '<div class="alert">Está muy cerca: mejor ir andando.</div>'; return; }
    await getLineas().catch(() => null);
    const ops = planner.buscar(st.origen.pos, st.destino.pos);
    if (!ops.length) { res.innerHTML = emptyHTML(ICON.route, 'No he encontrado autobuses', 'No hay una línea directa ni con un solo transbordo entre esos dos puntos. Prueba con una parada cercana.'); return; }
    const pName = (c) => esc(cache.paradaByCode.get(c)?.nombre || `Parada ${c}`);
    res.innerHTML = `<h2 class="section-title">Opciones</h2><div class="stack">${ops.map((o, n) => {
      const ls = o.tramos.map((t) => lineaFor(t.k.split('|')[0]) || { numero: t.k.split('|')[0], color: '#555' });
      return `<article class="card plan">
        <div class="plan-top">${ls.map((l) => badge(l.numero, l.color)).join('<span class="plan-arrow">›</span>')}<span class="plan-min">${Math.round(o.min)} min</span></div>
        <ol class="plan-steps">
          <li><span class="muted">Anda ${fmtDist(o.andar[0])}</span> hasta <b>${pName(o.tramos[0].desde)}</b> <span class="muted">(${esc(o.tramos[0].desde)})</span> · <span class="next" data-next="${n}-0">próximo…</span></li>
          <li>Sube a la <b>línea ${esc(ls[0].numero)}</b> y baja en <b>${pName(o.tramos[0].hasta)}</b> <span class="muted">(${o.tramos[0].n} paradas)</span></li>
          ${o.tramos[1] ? `<li>${o.cambio > 10 ? `Anda ${fmtDist(o.cambio)} hasta <b>${pName(o.tramos[1].desde)}</b> y` : 'Allí'} coge la <b>línea ${esc(ls[1].numero)}</b> · <span class="next" data-next="${n}-1">próximo…</span>; baja en <b>${pName(o.tramos[1].hasta)}</b> <span class="muted">(${o.tramos[1].n} paradas)</span></li>` : ''}
          <li><span class="muted">Anda ${fmtDist(o.andar[1])}</span> hasta tu destino</li>
        </ol>
        <div class="btn-row" style="padding:0 14px 12px"><button class="btn ghost" type="button" data-ver="${esc(ls[0].numero)}">Ver la línea ${esc(ls[0].numero)} en el mapa</button></div></article>`;
    }).join('')}</div><p class="small muted" style="margin:8px 2px 0">Tiempos aproximados: no incluyen la espera salvo en los transbordos.</p>`;
    res.querySelectorAll('[data-ver]').forEach((b) => { b.onclick = () => chooseMapLine(b.dataset.ver); });
    // próximo autobús en cada parada de subida
    ops.forEach((o, n) => o.tramos.forEach((t, ti) => {
      const num = t.k.split('|')[0];
      api(`/paradas/${encodeURIComponent(t.desde)}/tiempos`).then((d) => {
        const b = (d.tiempos || []).filter((x) => lineaFor(x.linea)?.numero === num).sort((a, c) => a.tiempo_minutos - c.tiempo_minutos)[0];
        const span = res.querySelector(`[data-next="${n}-${ti}"]`);
        if (span) span.textContent = b ? (b.tiempo_minutos <= 0 ? 'llegando' : `próximo en ${b.tiempo_minutos} min`) : 'sin autobuses ahora';
      }).catch(() => { const span = res.querySelector(`[data-next="${n}-${ti}"]`); if (span) span.textContent = ''; });
    }));
  }
  render();
  return {};
};

/* ================================================================== */
/* Copia de seguridad                                                  */
/* ================================================================== */
const copia = {
  crear() {
    const fotos = {};
    for (const c of tarjeta.list()) { const f = tarjeta.foto(c.num); if (f) fotos[c.num] = f; }
    return { app: 'BusSev', version: 1, fecha: new Date().toISOString(), favs: favs.list(), cards: tarjeta.list(), settings, fotos };
  },
  async exportar() {
    const json = JSON.stringify(this.crear());
    const name = `BusSev-copia-${new Date().toISOString().slice(0, 10)}.json`;
    if (plugin('Filesystem') && plugin('Share')) {
      const w = await native('Filesystem', 'writeFile', { path: name, data: json, directory: 'CACHE', encoding: 'utf8' });
      await native('Share', 'share', { title: 'Copia de BusSev', text: 'Copia de seguridad de BusSev', url: w.uri, dialogTitle: 'Guardar la copia en…' });
      return;
    }
    try { await navigator.clipboard.writeText(json); toast('Copia copiada al portapapeles'); } catch { toast('No se ha podido exportar en este dispositivo.'); }
  },
  /* Valida todo lo que llega: una copia manipulada no puede meter nada raro */
  validar(o) {
    if (!o || o.app !== 'BusSev' || typeof o !== 'object') throw new Error('Este archivo no es una copia de BusSev.');
    const hex = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '');
    const txt = (s, n) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, '').slice(0, n) : '');
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1000 ? Math.round(v * 100) / 100 : '');
    const fv = (Array.isArray(o.favs) ? o.favs : []).filter((f) => /^\d{1,7}$/.test(f?.codigo)).slice(0, 60).map((f) => ({
      codigo: f.codigo, nombre: txt(f.nombre, 100), alias: txt(f.alias, 30), color: hex(f.color),
      lineas: Array.isArray(f.lineas) ? f.lineas.filter((l) => /^[A-Za-z0-9]{1,8}$/.test(l)).slice(0, 20) : null,
    }));
    const cards = (Array.isArray(o.cards) ? o.cards : []).filter((c) => /^\d{12}$/.test(c?.num)).slice(0, 10).map((c) => ({
      num: c.num, name: txt(c.name, 24), color: hex(c.color), tipo: tipoPorId(c.tipo) ? c.tipo : '', precio: num(c.precio), aviso: num(c.aviso),
    }));
    const s = {};
    const S = o.settings || {};
    if (['auto', 'light', 'dark'].includes(S.theme)) s.theme = S.theme;
    if (PALETTES[S.color]) s.color = S.color;
    if ([0, 30, 60].includes(S.refresh)) s.refresh = S.refresh;
    if (typeof S.liveLines === 'boolean') s.liveLines = S.liveLines;
    if (['oscuro', 'claro', 'tema'].includes(S.mapStyle)) s.mapStyle = S.mapStyle;
    const fotos = {};
    for (const [k, v] of Object.entries(o.fotos || {})) if (/^\d{12}$/.test(k) && typeof v === 'string' && v.length < 900_000 && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v)) fotos[k] = v;
    return { favs: fv, cards, settings: s, fotos };
  },
  importar(file) {
    return new Promise((resolve, reject) => {
      if (!file || file.size > 8 * 1024 * 1024) { reject(new Error('El archivo es demasiado grande.')); return; }
      const r = new FileReader();
      r.onload = () => { try { resolve(this.validar(JSON.parse(String(r.result)))); } catch (e) { reject(e instanceof SyntaxError ? new Error('El archivo está dañado o no es una copia de BusSev.') : e); } };
      r.onerror = () => reject(new Error('No se ha podido leer el archivo.'));
      r.readAsText(file);
    });
  },
  aplicar(d) {
    store.set('favs', d.favs);
    store.set('cards', d.cards);
    for (const [k, v] of Object.entries(d.fotos)) tarjeta.setFoto(k, v);
    Object.assign(settings, d.settings); saveSettings(); applyTheme();
  },
};

/* ================================================================== */
/* Avisos de las tarjetas: saldo bajo y caducidad                      */
/* ================================================================== */
const idAviso = (txt) => { let h = 7; for (const ch of String(txt)) h = (h * 31 + ch.charCodeAt(0)) | 0; return (Math.abs(h) % 1_900_000_000) + 1000; };
avisos.permisoOk = async () => { try { await avisos.permiso(); return true; } catch (e) { toast(e.message); return false; } };
const DIAS_CAD = [30, 15, 7, 3, 1];
window.avisosTarjeta = {
  async comprobar(num) {
    const c = tarjeta.get(num);
    if (!c || !plugin('LocalNotifications')) return;
    const u = c.ultimo || {};
    const nombre = c.name || `tarjeta ${tarjeta.fmt(num)}`;
    // Saldo bajo: una notificación por cada saldo nuevo que quede por debajo
    if (c.avisoSaldo?.on && u.saldo != null && u.saldo < Number(c.avisoSaldo.importe)) {
      const marca = `${u.saldo}|${c.avisoSaldo.importe}`;
      if (c.notifSaldo !== marca) {
        await native('LocalNotifications', 'schedule', { notifications: [{ id: idAviso(num + 'saldo'), title: 'Saldo bajo', body: `A tu ${nombre} le quedan ${fmtEuro(u.saldo)}. Recárgala pronto.`, schedule: { at: new Date(Date.now() + 1500).toISOString(), allowWhileIdle: true }, smallIcon: 'ic_stat_bus', iconColor: '#D41C2B' }] }).catch(() => null);
        tarjeta.update(num, { notifSaldo: marca });
      }
    }
    // Caducidad: notificaciones programadas a las 10:00 de cada día elegido
    const ids = DIAS_CAD.map((d) => ({ id: idAviso(`${num}cad${d}`) }));
    await native('LocalNotifications', 'cancel', { notifications: ids }).catch(() => null);
    if (c.avisoCaducidad?.on && u.caducaEl && !u.sinCaducidad) {
      const lista = [];
      for (const d of c.avisoCaducidad.dias || []) {
        const f = new Date(u.caducaEl); f.setDate(f.getDate() - d); f.setHours(10, 0, 0, 0);
        if (f.getTime() > Date.now() + 60_000) lista.push({ id: idAviso(`${num}cad${d}`), title: 'Tu tarjeta caduca pronto', body: `Tu ${nombre} caduca ${d === 1 ? 'mañana' : `en ${d} días`} (${new Date(u.caducaEl).toLocaleDateString('es-ES')}).`, schedule: { at: f.toISOString(), allowWhileIdle: true }, smallIcon: 'ic_stat_bus', iconColor: '#D41C2B' });
      }
      if (lista.length) await native('LocalNotifications', 'schedule', { notifications: lista }).catch(() => null);
    }
  },
  async cancelarTodo(num) {
    if (!plugin('LocalNotifications')) return;
    await native('LocalNotifications', 'cancel', { notifications: [{ id: idAviso(num + 'saldo') }, ...DIAS_CAD.map((d) => ({ id: idAviso(`${num}cad${d}`) }))] }).catch(() => null);
  },
};

/* ================================================================== */
/* Revisar al abrir la app: saldo y caducidad de las tarjetas guardadas */
/* (como mucho con la frecuencia elegida, de una en una, sin molestar)  */
/* ================================================================== */
let revisando = false;
async function revisarAlAbrir() {
  if (revisando || !settings.revisarCada || !plugin('TussamWeb')) return;
  const cards = tarjeta.list();
  if (!cards.length) return;
  if (Date.now() - store.get('ultimaRevision', 0) < settings.revisarCada * 3600_000) return;
  revisando = true;
  store.set('ultimaRevision', Date.now());
  try {
    for (const c of cards) {
      if (!appVisible) break;
      try {
        const res = await tarjeta.consultar(c.num);
        if (res.ok) aplicarConsulta(c.num, res);
      } catch (e) {
        if (e.code === 'CLOUDFLARE') { store.set('cfPendiente', true); break; }
      }
    }
  } finally {
    revisando = false;
    if (active.name === 'tarjeta') active.refresh?.();
  }
}

/* ================================================================== */
/* Tarjeta acercada con la app cerrada o en otra pantalla              */
/* ================================================================== */
function abrirTarjetaPorNfc(uid) {
  try {
    window.__tarjetaPendiente = tarjeta.numeroDesdeUid(uid);
    vibrar(60);
    if (active.name === 'tarjeta') { route(); } else location.hash = 'tarjeta';
  } catch (e) { toast(e.message); }
}
window.addEventListener('bussevTarjeta', (e) => { if (e?.uid && active.name !== 'tarjeta') abrirTarjetaPorNfc(e.uid); });

/* ================================================================== */
/* Arranque                                                            */
/* ================================================================== */
applyTheme();
route();
// Lo que no corre prisa se hace después de enseñar la app
setTimeout(async () => {
  if (plugin('TarjetaNfc')) {
    const r = await native('TarjetaNfc', 'pendiente').catch(() => null);
    if (r?.uid) abrirTarjetaPorNfc(r.uid);
  }
  for (const c of tarjeta.list()) window.avisosTarjeta.comprobar(c.num);
  revisarAlAbrir();
  window.avisosTussam.revisar().catch(() => null);
}, 2500);
resumeHandlers.add(() => setTimeout(revisarAlAbrir, 1500));
resumeHandlers.add(() => setTimeout(() => window.avisosTussam.revisar().catch(() => null), 4000));
// Cambia de temática sola si cambia el día con la app abierta
setInterval(() => { if (appVisible && document.documentElement.dataset.tematica !== tematicaActiva()) applyTheme(); }, 10 * 60_000);

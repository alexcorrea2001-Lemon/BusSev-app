// Compara los datos de TUSSAM que llevaba la app con los nuevos y apunta QUÉ ha cambiado (líneas, paradas,
// recorridos y horarios) en www/novedades.json. La app lo enseña al actualizar («Novedades») y GitHub lo pone
// en la descripción de la versión publicada.
//
//   node scripts/novedades.mjs <data.js de antes> <data.js nuevo> <www/novedades.json>
//       -> si hay cambios, escribe el archivo; si no, lo deja como estaba.
//   node scripts/novedades.mjs --publicar <www/novedades.json>
//       -> escribe en $GITHUB_ENV el texto (NOVEDADES_MD) y los datos (NOVEDADES_B64) para la publicación.
//
// Nunca hace fallar la compilación: ante cualquier problema, avisa y sale con 0.
import fs from 'node:fs';
import vm from 'node:vm';

const leer = (f) => { const c = { window: {} }; vm.runInNewContext(fs.readFileSync(f, 'utf8'), c); return c.window.BUSSEV_DATA; };
const orden = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true });
const metros = (a, b) => Math.hypot((a.latitud - b.latitud) * 110540, (a.longitud - b.longitud) * 111320 * Math.cos(37.39 * Math.PI / 180));
const junta = (xs, max = 8) => (xs.length > max ? [...xs.slice(0, max), `y ${xs.length - max} más`] : xs);

export function comparar(viejo, nuevo) {
  const grupos = [];
  const mete = (t, i) => { if (i.length) grupos.push({ t, i }); };
  const Lv = new Map(viejo.lineas.map((l) => [String(l.numero), l])), Ln = new Map(nuevo.lineas.map((l) => [String(l.numero), l]));
  const Pv = new Map(viejo.paradas.map((p) => [String(p.codigo), p])), Pn = new Map(nuevo.paradas.map((p) => [String(p.codigo), p]));
  const nombreP = (c) => { const p = Pn.get(String(c)) || Pv.get(String(c)); return p ? `${p.nombre} (${c})` : `parada ${c}`; };

  // Líneas
  mete('Líneas nuevas', [...Ln.keys()].filter((n) => !Lv.has(n)).sort(orden).map((n) => `${n} · ${Ln.get(n).nombre}`));
  mete('Líneas que desaparecen', [...Lv.keys()].filter((n) => !Ln.has(n)).sort(orden).map((n) => `${n} · ${Lv.get(n).nombre}`));
  mete('Líneas que cambian de nombre', [...Ln.keys()].filter((n) => Lv.has(n) && Lv.get(n).nombre !== Ln.get(n).nombre).sort(orden).map((n) => `${n}: ahora «${Ln.get(n).nombre}»`));

  // Recorridos: paradas por las que pasa cada línea en cada sentido
  const rec = (d) => { const m = new Map(); for (const [c, l, s, o] of d.recorridos) { const k = `${l}|${s}`; if (!m.has(k)) m.set(k, []); m.get(k).push([o, String(c)]); } for (const v of m.values()) v.sort((a, b) => a[0] - b[0]); return m; };
  const Rv = rec(viejo), Rn = rec(nuevo);
  const cambios = [];
  for (const n of [...Ln.keys()].filter((x) => Lv.has(x)).sort(orden)) {
    const de = (R) => [1, 2].map((s) => (R.get(`${n}|${s}`) || []).map((x) => x[1]));
    const [a1, a2] = de(Rv), [b1, b2] = de(Rn);
    if (a1.join() === b1.join() && a2.join() === b2.join()) continue;
    const antes = new Set([...a1, ...a2]), ahora = new Set([...b1, ...b2]);
    const mas = [...ahora].filter((c) => !antes.has(c)), menos = [...antes].filter((c) => !ahora.has(c));
    const partes = [];
    if (mas.length) partes.push(`ahora para en ${junta(mas.map(nombreP), 3).join(', ')}`);
    if (menos.length) partes.push(`deja de parar en ${junta(menos.map(nombreP), 3).join(', ')}`);
    if (!partes.length) partes.push('cambia el orden de las paradas');
    cambios.push(`${n}: ${partes.join('; ')}`);
  }
  mete('Líneas que cambian de recorrido', junta(cambios, 12));

  // Paradas
  const nuevasP = [...Pn.keys()].filter((c) => !Pv.has(c)).sort(orden), quitadasP = [...Pv.keys()].filter((c) => !Pn.has(c)).sort(orden);
  mete('Paradas nuevas', junta(nuevasP.map(nombreP)));
  mete('Paradas que se quitan', junta(quitadasP.map(nombreP)));
  const comunes = [...Pn.keys()].filter((c) => Pv.has(c)).sort(orden);
  mete('Paradas que cambian de nombre', junta(comunes.filter((c) => Pv.get(c).nombre !== Pn.get(c).nombre).map((c) => `${c}: «${Pv.get(c).nombre}» pasa a ser «${Pn.get(c).nombre}»`)));
  mete('Paradas que cambian de sitio', junta(comunes.filter((c) => metros(Pv.get(c), Pn.get(c)) > 40).map((c) => `${nombreP(c)}, unos ${Math.round(metros(Pv.get(c), Pn.get(c)) / 10) * 10} m`)));

  // Horarios (primer y último autobús)
  const hor = (l) => [l.hora_inicio_ida, l.hora_fin_ida, l.hora_inicio_vuelta, l.hora_fin_vuelta].map((x) => x || '').join('|');
  mete('Líneas que cambian de horario', junta([...Ln.keys()].filter((n) => Lv.has(n) && hor(Lv.get(n)) !== hor(Ln.get(n))).sort(orden).map((n) => {
    const l = Ln.get(n); return `${n}: primer bus ${l.hora_inicio_ida || '—'}, último ${l.hora_fin_ida || '—'}`;
  }), 12));

  return { id: String(nuevo.generado || ''), desde: String(viejo.generado || ''), fecha: new Date().toISOString().slice(0, 10), grupos };
}

export const aTexto = (nov) => (nov.grupos || []).map((g) => `**${g.t}**\n${g.i.map((x) => `- ${x}`).join('\n')}`).join('\n\n');

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  try {
    if (process.argv[2] === '--publicar') {
      let md = '', b64 = '';
      try {
        const nov = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
        if (nov.grupos?.length) { md = `### Cambios en los datos de TUSSAM (${nov.fecha})\n\n${aTexto(nov)}`; b64 = Buffer.from(JSON.stringify(nov), 'utf8').toString('base64'); }
      } catch { /* aún no hay novedades apuntadas */ }
      const salida = `NOVEDADES_MD<<FIN_NOVEDADES_BUSSEV\n${md}\nFIN_NOVEDADES_BUSSEV\nNOVEDADES_B64=${b64}\n`;
      if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, salida); else process.stdout.write(salida);
      console.log(md ? 'Novedades de datos añadidas a la publicación.' : 'Sin novedades de datos que publicar.');
    } else {
      const [, , fViejo, fNuevo, fSalida] = process.argv;
      const nov = comparar(leer(fViejo), leer(fNuevo));
      if (nov.grupos.length) {
        fs.writeFileSync(fSalida, JSON.stringify(nov, null, 1) + '\n');
        console.log(`Novedades de datos apuntadas en ${fSalida}:`); console.log(aTexto(nov).replace(/\*\*/g, ''));
      } else console.log('Los datos nuevos no cambian ni líneas, ni paradas, ni recorridos, ni horarios.');
    }
  } catch (e) { console.log(`No se han podido calcular las novedades (${e.message}). No pasa nada.`); }
}

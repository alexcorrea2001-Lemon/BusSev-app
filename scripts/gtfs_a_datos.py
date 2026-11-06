"""Convierte el GTFS oficial de TUSSAM en www/data.js (paradas, líneas y recorridos).
Uso: python3 scripts/gtfs_a_datos.py <carpeta_gtfs_descomprimido> <data.js actual> <data.js nuevo>
Conserva direcciones y colores de la copia anterior cuando existen."""
import csv, collections, json, sys
G, OLD, OUT = sys.argv[1:4]
rd = lambda f: list(csv.DictReader(open(f'{G}/{f}', encoding='utf-8-sig')))
txt = open(OLD, encoding='utf8').read()
old = json.loads(txt[txt.index('{'):txt.rindex('}') + 1])
oldP = {p['codigo']: p for p in old['paradas']}
oldL = {l['numero']: l for l in old['lineas']}
oldR = collections.defaultdict(list)
for c, l, s, o in old['recorridos']: oldR[(l, s)].append(c)

feed = rd('feed_info.txt')[0]
routes = {r['route_id']: r for r in rd('routes.txt')}
stops = {r['stop_id']: r for r in rd('stops.txt')}
trips = {r['trip_id']: r for r in rd('trips.txt')}
seq = collections.defaultdict(list)
for r in rd('stop_times.txt'):
    seq[r['trip_id']].append((int(r['stop_sequence']), r['stop_id'], r['departure_time']))

pat = collections.defaultdict(collections.Counter)
horas = collections.defaultdict(list)
for t, l in seq.items():
    tr = trips.get(t)
    if not tr: continue
    lin = routes[tr['route_id']]['route_short_name'].strip()
    l.sort()
    pat[(lin, tr['direction_id'])][tuple(x[1] for x in l)] += 1
    horas[(lin, tr['direction_id'])].append(l[0][2])

def hhmm(t):
    h, m, *_ = (int(x) for x in t.split(':'))
    return f'{h % 24:02d}:{m:02d}'
def mins(t):
    h, m, *_ = (int(x) for x in t.split(':')); return h * 60 + m

COLOR_DEF = {'A': '#2b2f7a', 'C': '#008431', 'T': '#c60018'}
lineas, recorridos, usadas = [], [], set()
for rid, r in routes.items():
    lin = r['route_short_name'].strip()
    dirs = sorted(d for (l, d) in pat if l == lin)
    if not dirs: continue
    # Sentidos: que coincidan con la copia anterior (mismo 1 y 2) cuando la línea ya existía
    main = {d: list(pat[(lin, d)].most_common(1)[0][0]) for d in dirs}
    m = {}
    if (lin, 1) in oldR and len(dirs) == 2:
        sim = lambda a, b: len(set(a) & set(b)) / max(1, len(set(a) | set(b)))
        a = sim(main[dirs[0]], oldR[(lin, 1)]) + sim(main[dirs[1]], oldR.get((lin, 2), []))
        b = sim(main[dirs[1]], oldR[(lin, 1)]) + sim(main[dirs[0]], oldR.get((lin, 2), []))
        m = {dirs[0]: 1, dirs[1]: 2} if a >= b else {dirs[0]: 2, dirs[1]: 1}
    else:
        m = {d: i + 1 for i, d in enumerate(dirs)}
    for d in dirs:
        for o, c in enumerate(main[d]):
            recorridos.append([c, lin, m[d], o]); usadas.add(c)
    prev = oldL.get(lin, {})
    hs = {m[d]: sorted(horas[(lin, d)], key=mins) for d in dirs}
    color = prev.get('color') or (('#' + r['route_color']) if r.get('route_color') else COLOR_DEF.get(lin[0], '#000d6f'))
    lineas.append({
        'numero': lin, 'nombre': ' '.join(r['route_long_name'].split()), 'color': color,
        'hora_inicio_ida': hhmm(hs[1][0]) if hs.get(1) else None, 'hora_fin_ida': hhmm(hs[1][-1]) if hs.get(1) else None,
        'hora_inicio_vuelta': hhmm(hs[2][0]) if hs.get(2) else None, 'hora_fin_vuelta': hhmm(hs[2][-1]) if hs.get(2) else None,
        'nocturna': lin.startswith('A'),
    })
orden = lambda n: (0 if n[0].isdigit() else 1, n.zfill(3))
lineas.sort(key=lambda l: orden(l['numero']))
recorridos.sort(key=lambda x: (orden(x[1]), x[2], x[3]))
paradas = []
for c in sorted(usadas, key=lambda x: int(x) if x.isdigit() else 10**9):
    s = stops[c]; o = oldP.get(c, {})
    p = {'codigo': c, 'nombre': ' '.join(s['stop_name'].split()), 'latitud': round(float(s['stop_lat']), 6), 'longitud': round(float(s['stop_lon']), 6)}
    for k in ('calle', 'numero', 'codigo_postal', 'municipio', 'direccion_completa'):
        if o.get(k): p[k] = o[k]
    paradas.append(p)
fi, ff = feed['feed_start_date'], feed['feed_end_date']
data = {'generado': f'{fi[:4]}-{fi[4:6]}-{fi[6:]}', 'caduca': f'{ff[:4]}-{ff[4:6]}-{ff[6:]}', 'fuente': 'GTFS oficial de TUSSAM (Punto de Acceso Nacional)',
        'paradas': paradas, 'lineas': lineas, 'recorridos': recorridos}
open(OUT, 'w', encoding='utf8').write(f"/* Paradas, líneas y recorridos de TUSSAM. Fuente: GTFS oficial, válido del {data['generado']} al {data['caduca']}. */\nwindow.BUSSEV_DATA=" + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(len(paradas), 'paradas,', len(lineas), 'líneas,', len(recorridos), 'relaciones; nuevas paradas:', len([p for p in paradas if p['codigo'] not in oldP]))

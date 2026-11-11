#!/usr/bin/env bash
# Descarga el GTFS oficial de TUSSAM y regenera www/data.js (paradas, líneas y recorridos).
# Fuentes, por orden:
#   1) Punto de Acceso Nacional del Ministerio de Transportes (donde publica TUSSAM)
#   2) Mobility Database (copia del anterior)
# Si no se puede descargar, o el archivo es raro o más antiguo que el que ya hay, NO toca nada.
# Nunca hace fallar la compilación (siempre sale con 0).
set -u
cd "$(dirname "$0")/.."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FUENTES=(
  "https://nap.transportes.gob.es/api/Fichero/download/1567"
  "https://files.mobilitydatabase.org/mdb-2770/latest.zip"
)

# --- Trazado OFICIAL de las líneas (datos abiertos del Ayuntamiento de Sevilla, capa "TUSSAM_Lineas") ---
# Es la geometría real por calle de (casi) todas las líneas. Se intenta refrescar geojson/lineas.json desde el
# portal de datos abiertos; si no se puede (sin conexión, el portal ha cambiado, datos raros...), se queda el
# archivo que ya lleva el repositorio y la app funciona igual. Así, si TUSSAM cambia el trazado de una línea,
# la siguiente compilación lo coge automáticamente. Se puede forzar otro origen con el secreto TUSSAM_LINEAS_ITEM.
ITEM_LINEAS="${TUSSAM_LINEAS_ITEM:-c5e6ecf63aa944c8a09eb1e65e72d8f4}"   # item "TUSSAM_Lineas" en ArcGIS Online (IDE Sevilla)
LGJ="$TMP/lineas.json"
echo "Buscando el trazado oficial de las líneas (datos abiertos de Sevilla)…"
if SRV="$(curl -fsSL --max-time 60 "https://www.arcgis.com/sharing/rest/content/items/${ITEM_LINEAS}?f=json" 2>/dev/null \
          | python3 -c 'import sys,json;print((json.load(sys.stdin).get("url") or "").rstrip("/"))' 2>/dev/null)" \
   && [ -n "$SRV" ]; then
  case "$SRV" in
    */FeatureServer|*/MapServer) Q="$SRV/0/query" ;;
    */[0-9])                     Q="$SRV/query"   ;;
    *)                           Q="$SRV/0/query" ;;
  esac
  if curl -fsSL --max-time 180 --retry 2 -G "$Q" \
        --data-urlencode "where=1=1" --data-urlencode "outFields=*" \
        --data-urlencode "outSR=4326" --data-urlencode "f=geojson" -o "$LGJ" 2>/dev/null \
     && python3 -c '
import sys,json
d=json.load(open(sys.argv[1]))
f=d.get("features") or []
assert d.get("type")=="FeatureCollection" and len(f)>=100, "pocas lineas"
assert any(str((x.get("geometry") or {}).get("type","")).endswith("LineString") for x in f), "sin geometria"
' "$LGJ" 2>/dev/null; then
    mkdir -p geojson
    cp "$LGJ" geojson/lineas.json
    echo "  Trazado oficial de las líneas actualizado (geojson/lineas.json)."
  else
    echo "  No se ha podido descargar el trazado oficial: se usa el que lleva el repositorio."
  fi
else
  echo "  No se ha localizado el servicio del trazado oficial: se usa el que lleva el repositorio."
fi

ok=0
for url in "${FUENTES[@]}"; do
  cab=()
  # Si el Ministerio pidiera clave, se puede guardar como secreto NAP_API_KEY en GitHub
  if [[ "$url" == *nap.transportes.gob.es* && -n "${NAP_API_KEY:-}" ]]; then cab=(-H "ApiKey: ${NAP_API_KEY}"); fi
  echo "Probando $url"
  if curl -fsSL --max-time 180 --retry 2 "${cab[@]}" -o "$TMP/gtfs.zip" "$url" \
     && [ "$(head -c 2 "$TMP/gtfs.zip")" = "PK" ] \
     && unzip -l "$TMP/gtfs.zip" | grep -q "stop_times.txt" \
     && unzip -l "$TMP/gtfs.zip" | grep -q "feed_info.txt"; then
    ok=1; echo "Descargado de $url"; break
  fi
  echo "  no se ha podido usar esta fuente"
done
[ "$ok" = 1 ] || { echo "Sin datos nuevos: se mantienen los que lleva la app."; exit 0; }

mkdir -p "$TMP/g"
unzip -q -o "$TMP/gtfs.zip" -d "$TMP/g" || { echo "El archivo no se ha podido descomprimir."; exit 0; }
# Algunos GTFS vienen dentro de una carpeta
G="$TMP/g"; [ -f "$G/stops.txt" ] || G="$(dirname "$(find "$TMP/g" -name stops.txt | head -1)")"
python3 scripts/gtfs_a_datos.py "$G" www/data.js "$TMP/data.js" || { echo "No se ha podido convertir el GTFS."; exit 0; }

# Comprobaciones antes de sustituir: que se pueda leer, que tenga paradas y que no sea más antiguo
node -e '
const fs = require("fs"), vm = require("vm");
const leer = (f) => { const c = { window: {} }; vm.runInNewContext(fs.readFileSync(f, "utf8"), c); return c.window.BUSSEV_DATA; };
const nuevo = leer(process.argv[1]), viejo = leer(process.argv[2]);
if (!nuevo || nuevo.paradas.length < 500 || nuevo.lineas.length < 30) { console.log("Datos nuevos incompletos: no se usan."); process.exit(1); }
if (nuevo.generado < viejo.generado) { console.log(`El archivo descargado (${nuevo.generado}) es más antiguo que el actual (${viejo.generado}): no se usa.`); process.exit(1); }
console.log(`Datos: válidos del ${nuevo.generado} al ${nuevo.caduca} · ${nuevo.paradas.length} paradas · ${nuevo.lineas.length} líneas (antes hasta ${viejo.caduca})`);
' "$TMP/data.js" www/data.js || exit 0

cp "$TMP/data.js" www/data.js
# Geometría real del recorrido (shapes.txt): la deja lista para recorridos.mjs (archivo solo de build, no se sube)
if [ -f "$TMP/data.js.shapes.json" ]; then
  cp "$TMP/data.js.shapes.json" scripts/_shapes.json
  echo "Geometría real del GTFS guardada en scripts/_shapes.json para recorridos.mjs."
fi
echo "www/data.js actualizado."
exit 0

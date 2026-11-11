# BusSev 🚌

**BusSev** es una app para Android para moverte en los autobuses de **TUSSAM** (Sevilla).
Te dice cuánto le falta a tu autobús, dónde va cada uno en el mapa (siguiendo las calles de verdad),
cuánto saldo tiene tu tarjeta y los avisos de desvíos y obras. Es gratis, no tiene anuncios y no te pide registrarte.

> BusSev es un proyecto personal e independiente. **No es la app oficial de TUSSAM** ni tiene relación con TUSSAM.
> Los datos los saca de las webs y los datos abiertos públicos de TUSSAM y del Ayuntamiento de Sevilla,
> igual que harías tú con el navegador.

<!-- 📸 CAPTURAS: ponlas en la carpeta docs/capturas/ del repositorio. Donde veas una línea
     ![texto](docs/capturas/algo.png), sube tu imagen con ese mismo nombre y aparecerá sola.
     Puedes cambiar los nombres o quitar las que no quieras. -->


---

## ¿Qué puedo hacer con BusSev?

### ⭐ Favoritas
Guarda las paradas que más usas y ve de un vistazo cuánto le falta a cada autobús.
- Ponle un nombre a cada parada («Casa», «Trabajo», «Facultad») y un color.
- Elige qué líneas quieres ver en cada parada, para no ver autobuses que nunca coges.
- Ordénalas como quieras: al subir o bajar una, ves al momento en qué puesto queda.
- Arriba te avisa de lo que importa hoy: **buses nocturnos**, **servicios especiales** (Feria, Semana Santa),
  **festivos**, **saldo bajo** o **tarjeta a punto de caducar**, y si estás **sin conexión**.

<p align="center"><img src="docs/capturas/favoritas.png" alt="Pantalla de Favoritas" width="280"></p>

### 🗺️ Mapa
- Todas las paradas de Sevilla en el mapa.
- Toca una línea y verás su **recorrido real por las calles** y **los autobuses que van por ella ahora mismo**.
- Los autobuses se mueven solos por el mapa y miran hacia donde van.
- En la parada puedes poner el mapa en **pantalla completa**.

> El recorrido de cada línea es el **trazado oficial** que publica el Ayuntamiento de Sevilla en datos abiertos,
> así que el autobús va por su calle de verdad, no en línea recta entre paradas. Si TUSSAM cambia una línea,
> BusSev lo coge solo en la siguiente compilación (ver la parte técnica).

> TUSSAM no publica el GPS de sus autobuses: BusSev calcula dónde está cada uno a partir de la distancia
> que da TUSSAM. Es una posición **aproximada**, pero muy cercana a la real.

<p align="center"><img src="docs/capturas/mapa-linea.png" alt="El recorrido de una línea en el mapa" width="280"></p>

### 🚏 Parada
- Minutos que le faltan a cada línea, con el siguiente autobús.
- Toca una línea para que **te avise cuando esté llegando** (notificación en el móvil).
- Elige qué líneas ver tocando sus botones (03, 06, 34…).
- Las líneas que paran allí y los avisos de TUSSAM que les afectan.
- Si TUSSAM lo publica, verás si la parada es **accesible** para silla de ruedas (♿).

<p align="center"><img src="docs/capturas/parada.png" alt="Ficha de una parada" width="280"></p>

### 🔎 Buscador
En la barra de arriba, en cualquier pantalla, busca **por número de poste**, **por nombre de la parada o la calle**
o **por línea**. Los resultados salen al momento mientras escribes.

### 🛣️ Líneas
- Todas las líneas, con filtro de nocturnas.
- Lista de paradas de cada línea con el **tiempo de llegada** de los autobuses al lado de cada parada
  y las demás líneas que paran en ella.
- Si una línea tiene un **desvío** por obras o un evento, te lo avisa con enlace al aviso.

### 📍 Cerca
Las paradas que tienes cerca y cuánto le falta a cada autobús. Si tienes la ubicación apagada, te avisa al momento.
También tiene **Cómo llegar**: te dice qué autobús coger (directo o con un transbordo).

### 💳 Tarjeta
- **Acerca tu tarjeta TUSSAM al móvil** (NFC) y BusSev la reconoce.
- Ve su **saldo**, tipo, caducidad y **cuántos viajes te quedan** (con el precio actual de TUSSAM).
- Guarda varias tarjetas y personalízalas (nombre, color, foto de fondo).
- **Avisos**: te avisa si te queda poco saldo o si la tarjeta va a caducar.
- **Tarifas y títulos de viaje** actualizados desde la web de TUSSAM.

<p align="center"><img src="docs/capturas/tarjeta.png" alt="Tarjeta TUSSAM leída por NFC" width="280"></p>

### ⚠️ Avisos de TUSSAM
Desvíos, obras y horarios especiales (con sus **PDF e imágenes**). BusSev los revisa al abrirse y te manda una
notificación si hay uno nuevo en las líneas de tus paradas favoritas.

### 📲 Widget de inicio
Pon una parada en la **pantalla de inicio** del móvil y ve los próximos autobuses sin abrir la app.
Elige qué líneas ver y, al tocarlo, se abre directo en esa parada.

### ✈️ Sin conexión
Si te quedas sin datos, BusSev te sigue enseñando los **últimos tiempos que tenía** (avisándote de que no están al día)
y la información de paradas y líneas, que va guardada dentro de la app.

### 🎨 A tu gusto
- Tema claro u oscuro, **colores** (incluidos pasteles) y **colores de fondo**.
- **Temáticas** que cambian solas: Navidad, Semana Santa, Feria y Halloween, con adornos, y si quieres,
  **pasos, coches de caballos o carrozas** en el mapa en vez de autobuses.
- **Accesibilidad**: **modo sencillo** (deja solo lo esencial y botones grandes), letra grande, alto contraste,
  menos animaciones y lectura en voz alta.

---

## Cómo instalarla

BusSev no está en Google Play: se instala con un archivo **APK** (el instalador de apps de Android).

1. **Descarga el APK.** Desde el móvil, entra en la página de *Releases* del proyecto
   (te pasarán el enlace) y toca **BusSev.apk**.
2. **Ábrelo.** Cuando termine la descarga, toca el archivo (en la notificación o en *Descargas*).
3. **Permite la instalación.** La primera vez, Android te dirá que no se pueden instalar apps de esa fuente.
   Toca **Ajustes**, activa **Permitir de esta fuente** y vuelve atrás.
4. Toca **Instalar**. Si sale un aviso de *Play Protect* diciendo que la app no es conocida,
   toca **Más detalles → Instalar de todas formas**. Sale porque la app no viene de Google Play, no porque tenga nada malo.
5. ¡Listo! Ya tienes BusSev en tu pantalla de inicio.

**Para actualizarla**, ve a *Ajustes → Actualizaciones → Buscar actualización*, o descarga el APK nuevo,
e instálalo **encima**: no pierdes tus favoritas ni tus tarjetas. BusSev también te avisa sola cuando hay una versión nueva.

### Permisos que te puede pedir
| Permiso | Para qué | ¿Obligatorio? |
|---|---|---|
| **Ubicación** | Ver las paradas que tienes cerca | No: solo en la pestaña *Cerca* |
| **NFC** | Leer tu tarjeta TUSSAM al acercarla | No: también puedes escribir el número |
| **Notificaciones** | Avisos de llegada, de saldo bajo y de TUSSAM | No |

Para leer la tarjeta, el **NFC del móvil tiene que estar encendido**. Si está apagado, BusSev te lleva al ajuste con un botón.

---

## Preguntas frecuentes

**¿Es segura?**
Sí. BusSev solo se conecta con las webs de TUSSAM y con el mapa (OpenStreetMap). No tiene anuncios ni rastreadores,
no guarda tus datos en ningún servidor y todo se queda en tu móvil. No pide tu cuenta de TUSSAM.

**¿Gasta mucha batería o datos?**
No. Solo consulta a TUSSAM mientras miras la pantalla, guarda las respuestas unos segundos para no repetir
consultas y se para cuando la app está en segundo plano.

**¿Por qué a veces no salen los tiempos?**
Los tiempos vienen de TUSSAM. Si su servicio falla, BusSev reintenta sola, te enseña los últimos datos que tenía
(avisándote de que no están al día) y se actualiza sola cuando vuelve la conexión.

**¿Por qué no sale el saldo de mi tarjeta Solidaria?**
TUSSAM no muestra en su web el saldo de las tarjetas que no se recargan por internet. BusSev te enseña lo que
sí da: el número y la caducidad.

**¿Puedo ver mis viajes (cuándo he picado)?**
No. TUSSAM no publica ese historial en su web pública.

**¿Puedo hacer una copia de mis favoritas y tarjetas?**
Sí: *Ajustes → Tus datos → Copia de seguridad*. Te sirve para pasarlas a otro móvil.

---

### El recorrido de las líneas en el mapa
El trazado que se dibuja en el mapa se calcula al compilar (`scripts/recorridos.mjs`) y se guarda en `www/recorridos.js`.
Para cada línea se usa, por orden:
1. **Trazado oficial de TUSSAM** (datos abiertos del Ayuntamiento de Sevilla, capa «TUSSAM_Lineas»), en `geojson/lineas.json`.
   Es la geometría real por calle de (casi) todas las líneas: la fuente más fiable y completa (`scripts/recorridos_tussam.mjs`).
2. **OpenStreetMap** (relaciones `route=bus`) para lo que no esté en el dato oficial (`scripts/recorridos_osm.mjs`, vía Overpass).
3. **OSRM** (rutas por calle de OpenStreetMap) como último recurso.

Si alguna parada de un extremo o de en medio cae lejos del trazado oficial (porque el dato va por una calle paralela),
ese tramo concreto se enlaza siguiendo las calles con OSRM, con línea recta solo como último respaldo. Así ninguna
parada queda suelta y nada se dibuja por encima de las casas.

**Se actualiza solo:** `scripts/actualizar_datos.sh` descarga en cada compilación el trazado oficial más reciente del
portal de datos abiertos. Si TUSSAM cambia el recorrido de una línea, la siguiente compilación lo coge solo; si el portal
no responde, se usa el `geojson/lineas.json` que lleva el repositorio. Para forzar otro origen hay un secreto opcional
`TUSSAM_LINEAS_ITEM` (el identificador del item en ArcGIS Online).

### Paradas y recorridos: se actualizan solos
Los horarios oficiales de TUSSAM (GTFS) se descargan **solos** cada vez que GitHub compila la app
(`scripts/actualizar_datos.sh`), de dos fuentes por orden:
1. El **Punto de Acceso Nacional** del Ministerio de Transportes (donde los publica TUSSAM).
2. **Mobility Database**, que es una copia del anterior.

Solo se usan si el archivo está completo y es igual o más reciente que el que ya hay; si no, se queda el anterior
y la compilación sigue. Los datos nuevos (y el trazado oficial) también se guardan en el repositorio.

Además, **el día 1 de cada mes** GitHub mira si TUSSAM ha publicado horarios o recorridos nuevos y, solo si los hay,
compila una versión nueva por su cuenta.

### Servidor propio (opcional)
En `servidor-saldo/` hay un servidor pequeño (Deno Deploy gratis, o Google Cloud Run) que lee el **saldo** de la tarjeta.
Se activa en *Ajustes → Tus datos → Tu servidor*.

También sabe pedir los tiempos de llegada, pero **normalmente TUSSAM no le deja**: su web de tiempos está protegida con
Cloudflare y a los servidores de internet les pide una comprobación de navegador («Just a moment», error 403).
Por eso esa opción viene desactivada y los tiempos se piden desde el móvil. El servidor tiene un diagnóstico en
`/diag/249` que dice qué contesta TUSSAM.

### Número de versión
El nombre de la versión (v1.1.2, v1.1.3…) está en el archivo **`VERSION`** del repositorio: cámbialo cuando quieras
estrenar versión. Cada compilación lleva además un número interno que siempre sube (el contador de GitHub + 100), que es
el que deja instalar la nueva encima. Si vuelves a compilar la misma versión, su publicación en *Releases* se sustituye.

### Botón «Buscar actualización»
Al compilar, GitHub apunta el número de versión en `www/version.js`. La app pregunta a GitHub cuál es la última
versión publicada. Si el repositorio es **privado**, GitHub no deja mirarlo sin entrar: la app abre la página de versiones
para que entres con tu cuenta.

### Créditos
- La forma de pedir y leer los tiempos de llegada (y las rutas internas `/paradas/…/tiempos`, `/cercanas`…) está basada en
  la **[API TUSSAM](https://github.com/686f6c61/API-TUSSAM)** de 686f6c61, publicada con licencia
  [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) (Copyright (c) 2026 686f6c61).
  Por eso BusSev también es **solo para uso no comercial**. BusSev no usa su servidor: pregunta a TUSSAM desde el móvil.
- Horarios, paradas y accesibilidad de las paradas: GTFS oficial de TUSSAM (Punto de Acceso Nacional).
- **Recorrido de las líneas por calle: trazado oficial de TUSSAM en datos abiertos del Ayuntamiento de Sevilla**
  (IDE Sevilla / cda-idesevilla), capa «TUSSAM_Lineas».
- Posición exacta de las paradas y recorridos de respaldo: © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright)
  (ODbL), consultados al compilar con Overpass y OSRM (`scripts/paradas_osm.mjs`, `scripts/recorridos_osm.mjs` y `scripts/recorridos.mjs`).
- Mapa: OpenFreeMap / OpenStreetMap.

### Aviso legal
Uso **personal y no comercial**. Proyecto independiente, sin relación con TUSSAM. Los servicios de TUSSAM no son
públicos ni están documentados: si cambian, alguna función puede dejar de ir hasta que se ajuste la app.

# Jalón USC

Sistema de carpooling universitario de la Universidad Santiago de Cali. Proyecto de Ingeniería de Software I.

## Clonar y ejecutar la versión de presentación

Requiere Git y Node.js 24.7 o posterior. Desde PowerShell:

```powershell
git clone --branch dev --single-branch https://github.com/rhrh78665-stack/jalon-usc.git
Set-Location -LiteralPath jalon-usc
powershell -NoProfile -ExecutionPolicy Bypass -File .\ejecutar.ps1
```

El comando instala las dependencias fijadas en el repositorio, compila e inicia la demostración en http://127.0.0.1:3001. Conserva la terminal abierta. Las cuentas son conductor.demo@usc.edu.co, pasajero.demo@usc.edu.co y movilidad.demo@usc.edu.co; la contraseña es JalonDemo-2026!.

Incluye el diseño y las fotografías locales, los roles separados, el historial, las reservas y 64 ofertas para mañana y otras 64 para pasado mañana según la fecha de Cali al arrancar. El recorrido reservado conserva sus paradas; el precio por persona parte de $11.000 COP, utiliza $1.200 COP por kilómetro y tiene un máximo de $25.000 COP por reserva, aplicado también al cierre. El total de una carrera con varios pasajeros puede superar ese valor porque suma varios asientos.

La demostración utiliza una base temporal nueva al arrancar. Los cambios realizados durante esa sesión se pierden al detenerla; no modifica la base persistente de server/index.js. Para un servicio con datos persistentes se usa npm run build y npm start, con su configuración de correo y acceso. Ese modo no carga automáticamente las cuentas y ofertas de demostración.

## Estructura

| Carpeta o archivo | Contenido |
| --- | --- |
| `src/` | Pantallas y estilos de la aplicación web. |
| `server/` | API Express, reglas de negocio y acceso a PostgreSQL embebido. |
| `test/` | Pruebas automatizadas vinculadas a los requisitos. |
| `docs/diseno/` | Wireframes, mockups y referencia al prototipo. |
| `docs/sprints/` | Evidencias de los sprints y burndown. |
| `package.json` y `package-lock.json` | Configuración y versiones de dependencias para Node.js 24. |

Abrir la carpeta `Jalon-USC` en el IDE. Desde esa carpeta se pueden instalar las dependencias con `npm.cmd ci` en PowerShell.

El primer requisito es **RF-001 · Registrar cuenta**. Los puntos de entrada que se crean con esa historia son `index.html` en la raíz, `src/main.jsx` para la interfaz y `server/index.js` para iniciar la API. La prueba del requisito va en `test/register.test.js`. Los comandos `npm.cmd run build` y `npm.cmd start` se usan después de crear esos puntos de entrada.

Registrar cada requisito en su rama y comprobar su caso de prueba antes del commit. El asunto del commit es el identificador del requisito, como `RF-001`. Para correcciones generales se usa `FIX`.

## Viajes: RF-011 a RF-017

El módulo permite definir un itinerario con horas por parada, buscar viajes con cupos en todo el recorrido, filtrar por una ventana de 40 minutos, consultar el aporte estimado y máximo, editar viajes propios sin reservas activas, publicar una serie de fechas y cancelar un viaje junto con sus reservas activas.

Para ejecutarlo con Node.js 24:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Las pruebas se ejecutan con `npm.cmd test -- --test-concurrency=1`. Los casos de este bloque están en `test/itinerarios.test.js` y `test/viajes-avanzados.test.js`; `test/viajes.test.js` conserva la comprobación de publicación de RF-010.

Las fechas del formulario corresponden a Cali (`America/Bogota`). Al iniciar, la base de datos incorpora las columnas de itinerario, costos y cancelación, además de la tabla de reservas. Los viajes anteriores se conservan, pero necesitan completar horarios y costos mediante edición antes de aparecer en la búsqueda.

El catálogo de `shared/paradas.js` contiene distancias ficticias, peajes de prueba y un precio inicial de combustible de demostración. Estos valores deben validarse antes de utilizar el cálculo para viajes reales. Los avisos de cancelación llegan a los participantes con una sesión conectada; no se envían correos. La tabla de reservas permite comprobar cupos y cancelaciones, pero los flujos de solicitar y aceptar reservas (RF-018 y RF-019) quedan fuera de este bloque.


### Ofertas y paradas de la demostración

La demostración prepara 64 conductores ficticios con nombre, vehículo, placa y fotografía de referencia propios. Publica 64 ofertas de diez paradas para mañana y 64 para pasado mañana, según la fecha de Cali al arrancar, además de conservar los casos de reserva, cierre e historial. Los tres accesos principales mantienen sus credenciales.

En **Mis viajes → Publicar recorrido**, el conductor elige hacia o desde el campus, indica sus horarios y puede añadir puntos con nombre desde el mapa. Esos puntos se guardan en el itinerario, aparecen en los filtros de búsqueda y permiten reservar un tramo concreto. Las paradas personalizadas se limitan al área de Cali y la USC debe estar en un extremo del recorrido. Las distancias de los tramos sin entrada en el catálogo se estiman a partir de sus coordenadas; el trazado vial consultado al abrir el mapa es orientativo.

La cartelera permite alternar tarjetas y mapa, ordenar las ofertas y consultar el recorrido antes de solicitar un asiento. El historial mantiene los nombres de las paradas guardadas y los valores de las reservas. Los mapas usan OpenStreetMap y el servicio de rutas configurado en `JALON_ROUTING_URL`; si este último no responde, las paradas permanecen marcadas sin presentar una línea aproximada como una ruta vial calculada.

Las 64 fotografías públicas se distribuyen optimizadas en `public/vehiculos/`. Sus fuentes, autores y licencias se incluyen en `shared/photo-credits.js` y en **Quiénes somos → Créditos fotográficos**. Las identidades, placas y ofertas de esta demostración son sintéticas; las fotografías no representan vehículos de los integrantes del proyecto.


### Recorridos y búsqueda

El conductor puede publicar entre 2 y 10 paradas dentro de Cali, sin un extremo obligatorio. Marca sus puntos en el mapa, los ordena, calcula el recorrido y revisa las horas antes de publicar. La vista previa se conserva 15 minutos y está ligada a la sesión y a los puntos elegidos: el navegador no puede aportar sus propias distancias ni precios. El mapa vial de la demostración utiliza 16 trazados obtenidos de OSRM / OpenStreetMap, guardados en server/fixtures/demo-road-maps.json. Las nuevas rutas se consultan al proveedor; si no responde se identifica expresamente la estimación.

El pasajero consulta un catálogo de recorridos ya publicados, con disponibilidad para la fecha elegida. Puede filtrar por un recorrido existente o consultar las paradas que efectivamente forman parte de las ofertas. No hay campos para proponer un origen, un destino o una ruta nueva. Al reservar, la subida y la bajada deben ser paradas de ese mismo recorrido, en su orden original; la reserva no modifica la ruta del conductor. Las tarjetas se paginan de 24 en 24 y el mapa incluye las ofertas cargadas de la fecha. Se consultan las páginas adicionales del servidor cuando hay más de 100 resultados.

Las nuevas tarifas aplican el mínimo una sola vez a la reserva y el componente por distancia al trayecto seleccionado. Las reservas y liquidaciones anteriores conservan su modelo y su tarifa. Agregar paradas no multiplica el mínimo. Movilidad mantiene el control de la configuración.

La navegación principal organiza Inicio, Rutas, Reservas, Historial, Comunidad, Soporte y Cuenta, con sus respectivos submenús. Los conductores tienen además Conducir y Movilidad dispone de un menú propio para su administración. El historial sigue siendo privado. La plataforma continúa siendo exclusivamente una página web. La interfaz utiliza una sola familia tipográfica local, Manrope, con su licencia OFL. Los controles ovalados y los paneles de vidrio comparten el mismo tratamiento visual claro.

Para iniciar la demostración conserva abierta la terminal donde se ejecuta el servidor. Si el servidor se detiene, la página informa la desconexión y permite reintentar; las escrituras no se repiten automáticamente.


### Acceso y lectura de los recorridos

El acceso se abre en un diálogo sobre el contenido difuminado. Conserva registro, ingreso, recuperación, verificación y cierre de sesión. La cuenta y el cierre de sesión se encuentran dentro de Cuenta; el encabezado muestra la marca gráfica sin repetir el nombre en cada sección.

Las tarjetas comparten un único componente para mostrar el nombre completo del conductor, la foto del vehículo, el modelo, el color y la placa. Los nombres no llevan iniciales superpuestas. El historial mantiene sus datos y filtros. Los incidentes autorizados incluyen el itinerario publicado para mostrar los nombres de paradas creadas por los conductores.

El mapa puede depender de la conexión para cargar las calles. Los recorridos guardados y la lista de paradas siguen identificando el trayecto del conductor.


### Separación de roles

Pasajero consulta las rutas publicadas, reserva entre sus paradas y revisa únicamente sus reservas y su historial como pasajero.

Conductor accede a un inicio propio, publica y administra sus ofertas, responde las solicitudes recibidas para sus recorridos, gestiona sus vehículos y consulta el historial de las carreras que ofreció. No tiene catálogo de ofertas ajenas ni funciones para reservar asientos como pasajero. Su navegación y el pie de página están adaptados a estas funciones.

Movilidad conserva vinculaciones, habilitación de conductores, tarifas e incidentes. Los espacios compartidos de cuenta, comunidad y soporte mantienen sus permisos propios.

La separación se comprueba en el servidor. La autorización de búsquedas y nuevas reservas pertenece a Pasajero; las ofertas propias y su gestión pertenecen a Conductor. Las solicitudes y los historiales se filtran según el rol y la propiedad de cada registro. Los datos anteriores permanecen almacenados. El vencimiento de una licencia conserva el rol de conductor y su historial, pero impide publicar o modificar ofertas hasta que Movilidad actualice la habilitación.

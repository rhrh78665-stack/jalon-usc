# Jalón USC

Sistema de carpooling universitario de la Universidad Santiago de Cali. Proyecto de Ingeniería de Software I.

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

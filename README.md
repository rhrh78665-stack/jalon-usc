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

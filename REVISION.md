# Revisión de UITESTER

Revisión del código local, las dependencias y los flujos de emulación. Se corrigieron los hallazgos indicados abajo. Las pruebas usaron páginas temporales. La comprobación de dependencias con `npm audit --json` devolvió cero vulnerabilidades conocidas.

## Hallazgos corregidos

### 1. Seguridad · Prioridad media · Aislamiento de Chromium

El lanzamiento omitía `chromiumSandbox`, cuyo valor predeterminado en Playwright es `false`. Esto reducía el aislamiento del navegador que ejecuta los sitios probados. Se agregó `chromiumSandbox = true` en `server.mjs:64`, tanto para el motor estándar como para GPU. La prueba completa pasó en esta PC con el aislamiento activo. La revisión no demostró una explotación del navegador.

La configuración predeterminada está documentada en la [API oficial de Playwright](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-chromium-sandbox).

### 2. Funcionamiento · Prioridad media · Avisos al vencer una sesión

En `assets/pane.mjs:362` y `assets/pane.mjs:366`, los caminos de error llamaban a `notice`, que no existía en ese módulo. Se sustituyó por `callbacks.notice`. Se agregó una prueba que simula una respuesta 410 y comprueba que aparece el aviso y se recupera la vista de prueba sin errores JavaScript.

### 3. Rendimiento · Prioridad media · Acumulación de acciones

La cola de acciones no tenía límite. Una vista lenta podía acumular clics y escritura en memoria, prolongando la espera de las acciones siguientes. `server.mjs:507` ahora admite hasta 64 acciones pendientes por sesión y rechaza el exceso con un mensaje. Se verificó una ráfaga de 80 acciones mientras una navegación respondía lentamente y la sesión siguió utilizable después.

El cierre también marca la sesión antes de esperar la cola (`server.mjs:726`). La limpieza por inactividad espera a que terminen las acciones pendientes (`server.mjs:784`). Esto reduce las carreras entre el cierre y nuevas acciones.

### 4. Instalación · Prioridad media · Motor Chromium ausente

`Iniciar.cmd:8` solo comprobaba WebKit. Una PC nueva podía abrir los perfiles Apple y fallar al usar Android o PC. El lanzador ahora comprueba e instala Chromium y WebKit. Se revisó el comando de instalación. No se descargaron de nuevo todos los navegadores en una PC limpia.

### 5. Validación · Prioridad baja · JSON y caracteres UTF-8

El cuerpo de la petición se convertía a texto por fragmentos. Un carácter UTF-8 dividido entre fragmentos podía dañarse. `server.mjs:649` reúne los bytes antes de decodificarlos, aplica un límite de 64 KiB y rechaza valores JSON que no sean objetos. Las pruebas verificaron el rechazo de `null`, arrays y booleanos.

## Costes y límites vigentes

- **Captura nítida con DPR alto.** `server.mjs:172` produce capturas adicionales en píxeles físicos y limita su frecuencia a un máximo aproximado de 10 por segundo. Puede consumir CPU y memoria incluso con GPU activa. El límite de pantalla de `assets/devices.mjs:63` permite hasta 16,7 millones de píxeles físicos por vista. Tres vistas animadas a densidad alta siguen pudiendo ralentizar una PC. No se realizó una prueba prolongada de carga máxima.
- **Acciones sincronizadas.** Una acción sobre un formulario puede ejecutarse en varias vistas. Es el comportamiento de comparación descrito en la interfaz y el README.
- **Alcance local.** El servidor escucha en bucle local, valida Host y Origin y sirve una lista explícita de archivos. Las pruebas confirmaron el rechazo de un origen externo y de la descarga de `server.mjs`. El acceso a aplicaciones de localhost y de la red privada forma parte del propósito de la herramienta.
- **Límites de la revisión.** Cero avisos de npm no garantiza ausencia de vulnerabilidades. No se realizó una auditoría de los motores de navegador, de las aplicaciones que se abren dentro de ellos ni de las configuraciones externas de Apache.

## Verificación realizada

- `npm test` pasó las tres pruebas existentes de direcciones.
- `node tests/browser.mjs` pasó los flujos de perfiles, comparación, entrada, scroll, giro, resolución, DPR, captura nítida, GPU y recuperación de sesión vencida con un motor temporal.
- Una prueba de API temporal comprobó origen externo, archivos restringidos, JSON inválido, límite de cola y cierre de sesión.
- El README incluye instalación rápida en Windows y comandos de instalación desde terminal.

Los procesos de UITESTER que ya estaban abiertos mantienen el código del servidor cargado al iniciar. Las correcciones de servidor se aplican al reiniciar el motor. Esta revisión no cerró las sesiones activas del usuario.

No se modificó ninguna base de datos.

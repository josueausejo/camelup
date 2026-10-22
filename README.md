# Camel Up Online 🐪

Versión web de **Camel Up 2.0** para 2–4 jugadores online, con tablero 3D en vista isométrica.

## Cómo jugar

```bash
npm install
npm start
```

Abre `http://localhost:3210`. La consola también muestra la dirección para tu red local (por ejemplo `http://192.168.1.47:3210`): compártela con los demás jugadores que estén en tu misma wifi. Si no pueden conectar, permite Node.js en el Firewall de Windows.

1. Un jugador pulsa **Crear sala** y comparte el código de 4 letras (o el enlace de invitación).
2. Los demás pulsan **Unirse** con ese código.
3. El anfitrión (👑) empieza cuando haya entre 2 y 4 jugadores.

Si recargas la pestaña vuelves automáticamente a tu partida. Una sala vacía se conserva 10 minutos.

El botón ✨ de la barra superior cambia entre calidad gráfica alta (bloom, sombras de 2048 px y todas las partículas) y baja (para equipos o móviles lentos). La elección se recuerda.

## Publicarlo en Render

El proyecto incluye [`render.yaml`](render.yaml): un único servicio web que compila el cliente y arranca el servidor (que sirve la web y Socket.io).

1. Sube el repositorio a GitHub.
2. En [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**, conecta tu cuenta de GitHub y elige el repositorio.
3. Render lee `render.yaml`, compila (`npm ci --include=dev && npm run build`) y arranca (`npm run serve`). Tu juego queda en `https://camelup-XXXX.onrender.com`.
4. Cada `git push` a la rama principal vuelve a desplegar automáticamente.

Ten en cuenta que en el plan gratuito el servicio se duerme tras 15 minutos sin visitas (la primera carga tarda ~50 s) y que las salas viven en memoria, así que se pierden al reiniciarse el servicio.

## Desarrollo

```bash
npm run dev    # servidor (puerto 3210) + Vite con recarga en caliente (http://localhost:5173)
npm test       # tests del motor de reglas
npm run typecheck
```

Cada pestaña del navegador cuenta como un jugador distinto, así que puedes probar una partida abriendo varias pestañas.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `shared/game.ts` | Motor de reglas puro: preparación, acciones, movimiento y pilas, público, camellos locos, puntuación de etapa y final. |
| `shared/game.test.ts` | Tests con los ejemplos del reglamento y 500 partidas aleatorias. |
| `server/index.ts` | Express + Socket.io: salas, autoridad de reglas y vista filtrada por jugador (las cartas de apuesta final son secretas). |
| `client/src/scene/` | Escena Three.js: tablero, camellos de madera, pirámide, dados, palmeras y texturas generadas por código. |
| `client/src/main.ts` | Lobby, interfaz de juego y animaciones. |

## Decisiones sobre las reglas

- Fichas de apuesta de etapa **5-3-2-2** por color (edición 2.0).
- No se incluyen las reglas de 6 o más jugadores (sociedades).
- La carrera termina en cuanto una unidad cruza la meta, también si es un camello loco hacia atrás (sus pasajeros cuentan como los últimos).
- Las fichas de público vuelven a sus dueños al final de cada etapa.
- El dinero es visible para todos.

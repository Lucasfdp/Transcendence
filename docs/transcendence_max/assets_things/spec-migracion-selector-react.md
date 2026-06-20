# Especificación de Migración: Selector de Juegos (Phaser → React)

**Tipo:** Refactor / migración de capa de UI
**Para:** Agente de código (Claude Code / similar)
**Prioridad:** Alta — bloquea limpieza de arquitectura de assets compartidos

---

## 1. Objetivo

Migrar toda la pantalla de **selección de modo de juego** ("Dojo selector": anillo de botones de minijuegos + preview de personaje + perfil de jugador + botón "START NEXT SHOT") desde Phaser hacia React puro.

Phaser debe quedar reservado **exclusivamente** para las escenas de gameplay real (la partida jugable en sí). Cualquier pantalla que sea solo navegación/selección/formulario debe vivir en React.

---

## 2. Contexto previo necesario

Antes de tocar código, el agente debe:

1. Localizar el repositorio del proyecto y mapear la estructura actual de carpetas (`src/`, `public/assets/`, configuración de Phaser, configuración de React/Vite/Next, etc.)
2. Identificar **todas** las escenas de Phaser existentes (`Phaser.Scene` o equivalente) y clasificarlas en dos grupos:
   - **Grupo A — Navegación/UI no jugable:** selector de modo, menú principal, perfil de jugador, pantallas de resultado/score si son solo texto/botones, pantallas de carga si tienen interacción de botones.
   - **Grupo B — Gameplay real:** cualquier escena con física, colisiones, animación de sprites controlada por input del jugador en tiempo real, loop de juego.
3. Confirmar con el output de ese mapeo cuál escena corresponde exactamente al selector mostrado en la imagen de referencia (anillo de botones: KAME KNOCK, RIVER RUSH, ONI DODGE, BAMBOO BASH, TEMPLE CURLING, SHELL SHOCKERS, TURTLE TUSSLE + panel de perfil + botón START NEXT SHOT).

**No proceder a la migración hasta completar este mapeo y reportarlo.**

---

## 3. Alcance de la migración

### 3.1 Qué SÍ migra a React

- Toda la lógica de renderizado de los botones del anillo (posición, textos, eventos de click)
- El panel "Player Profile" (avatar, username, botón "View Details")
- El botón principal "START NEXT SHOT"
- El preview estático del personaje (tortuga compuesta por capas: caparazón + bandana/peinado + tatuajes) — ver sección 5
- Cualquier transición/animación de entrada del menú (puede resolverse con CSS o Framer Motion, no requiere canvas)
- Cualquier estado de "modo seleccionado" antes de confirmar partida

### 3.2 Qué NO migra (permanece en Phaser)

- El gameplay de cada minijuego individual (Kame Knock, River Rush, etc.)
- Físicas, colisiones, partículas, animaciones de sprite en tiempo real
- HUD **dentro** de la partida (vidas, puntaje en vivo, timers de gameplay activo)

### 3.3 Regla de decisión para casos ambiguos

Si el agente encuentra una escena de Phaser que no esté claramente en Grupo A o B, debe aplicar este criterio:

> ¿Esta pantalla usa el game loop de Phaser (update/render por frame) para algo más que mostrar elementos estáticos? Si la respuesta es no → migra a React.

No migrar sin confirmar; si hay ambigüedad, reportar el caso puntual antes de modificar.

---

## 4. Arquitectura objetivo

```
src/
├── pages/                          (React Router o Next pages)
│   ├── GameSelector.jsx            ← NUEVO: reemplaza la escena Phaser del selector
│   └── GamePlay.jsx                ← contenedor que monta Phaser SOLO al jugar
├── components/
│   ├── selector/
│   │   ├── DojoRing.jsx            ← layout del anillo de botones
│   │   ├── MenuButton.jsx          ← ya existente, reutilizar (ver doc previo de assets)
│   │   ├── PlayerProfilePanel.jsx
│   │   └── CharacterPreview.jsx    ← composición de capas de la tortuga en React
│   └── shared/
│       └── assetConfig.js          ← ya existente, reutilizar
├── game/
│   ├── scenes/                     ← LIMPIAR: remover escena del selector si existe aquí
│   │   └── GameplayScene.js        (y demás escenas de Grupo B, sin tocar su lógica interna)
│   └── phaserConfig.js
└── state/
    └── playerStore.js              ← estado compartido (personaje, modo elegido) — ver sección 6
```

### Flujo de navegación resultante

```
React Router/Next routing:
"/"               → Landing (React)
"/selector"        → GameSelector.jsx (React) — NUEVA pantalla migrada
"/play/:mode"       → GamePlay.jsx (monta Phaser.Game SOLO en este punto)
```

Phaser **no debe inicializarse** (`new Phaser.Game(...)`) hasta que el usuario entra a `/play/:mode`. Debe destruirse (`game.destroy(true)`) al salir de esa ruta.

---

## 5. Preview del personaje (tortuga) en React

El preview de la tortuga personalizada en el centro del selector **no requiere Phaser**. Debe resolverse como composición de capas estáticas en React:

```jsx
function CharacterPreview({ shell, headwear, tattoo }) {
  return (
    <div className="character-preview">
      <img src="/assets/character/turtle-base.png" className="layer layer--base" />
      <img src={`/assets/character/tattoos/${tattoo}.png`} className="layer layer--tattoo" />
      <img src={`/assets/character/shells/${shell}.png`} className="layer layer--shell" />
      <img src={`/assets/character/headwear/${headwear}.png`} className="layer layer--headwear" />
    </div>
  );
}
```

```css
.character-preview { position: relative; width: 300px; height: 300px; }
.layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
```

**Requisito crítico:** estas mismas rutas de asset (`/assets/character/shells/...`, etc.) deben ser las que luego use Phaser para construir el sprite animado dentro del gameplay. El agente debe verificar que no existan rutas duplicadas o assets equivalentes generados por separado para Phaser — si las encuentra, debe unificarlas a una sola fuente, según la regla del documento de assets compartidos previo (`guia-assets-react-phaser.md`).

---

## 6. Estado compartido entre React y Phaser

El selector vive en React; el gameplay vive en Phaser. El agente debe identificar o crear un mecanismo de paso de estado al cruzar esa frontera:

- Si el proyecto ya usa Zustand/Redux/Context → usar el mismo store, leído por `GamePlay.jsx` al construir `phaserConfig`
- Si no existe store global → crear uno mínimo en `state/playerStore.js` con: `selectedMode`, `playerCharacter` (shell/headwear/tattoo elegidos)
- El paso de datos a Phaser ocurre **una sola vez**, al instanciar `new Phaser.Game(config)`, pasando estos valores como parte de la config de la escena inicial. Phaser no debe leer el store de React continuamente (evitar acoplamiento fuerte entre el store de React y el ciclo de vida de Phaser).

```js
// GamePlay.jsx
const { selectedMode, playerCharacter } = usePlayerStore();

useEffect(() => {
  const game = new Phaser.Game({
    ...phaserConfig,
    scene: new GameplayScene({ mode: selectedMode, character: playerCharacter }),
  });
  return () => game.destroy(true);
}, []);
```

---

## 7. Pasos de ejecución para el agente

1. **Auditoría** — mapear escenas Phaser existentes (Grupo A vs B), confirmar cuál es el selector, reportar hallazgos antes de continuar.
2. **Extracción de assets** — identificar qué imágenes/atlas usa actualmente la escena del selector en Phaser (botones, iconos, sprite de tortuga) y verificar si ya están en `/public/assets/` o están embebidas en un atlas exclusivo de Phaser. Extraerlas/copiarlas a rutas planas reutilizables por React si es necesario.
3. **Construcción de componentes React** — crear `GameSelector.jsx` y subcomponentes (`DojoRing`, `MenuButton`, `PlayerProfilePanel`, `CharacterPreview`) según sección 4 y 5, reutilizando `MenuButton` y `assetConfig.js` ya existentes (no crear botones nuevos desde cero).
4. **Routing** — conectar `/selector` a la nueva página React; asegurar que el botón "START NEXT SHOT" navegue a `/play/:mode` pasando el estado correspondiente.
5. **Desmontaje de Phaser del selector** — eliminar la escena Phaser del selector del bundle de inicialización del juego. Confirmar que `Phaser.Game` no se instancia en ninguna ruta fuera de `/play/:mode`.
6. **Limpieza de assets duplicados** — si existían sprites del selector solo en el atlas de Phaser sin equivalente plano para React, decidir cuál es la fuente única según la guía de assets compartidos, y eliminar la copia redundante.
7. **Verificación** — confirmar que:
   - El selector carga y funciona sin que `Phaser.Game` se haya instanciado en ningún momento
   - Al hacer click en un botón de modo y luego "START NEXT SHOT", se monta Phaser correctamente con el modo y personaje correctos
   - Al volver del gameplay al selector (botón "back" o similar), Phaser se destruye correctamente (`game.destroy(true)`) sin dejar el canvas montado ni listeners huérfanos
8. **Reporte final** — listar archivos creados, modificados y eliminados, y cualquier asset que haya quedado duplicado o sin resolver para revisión humana.

---

## 8. Criterios de aceptación

- [ ] No existe instancia de `Phaser.Game` activa en ninguna ruta de selección/menú/perfil
- [ ] El selector es completamente navegable por teclado (focus/tab nativo del DOM)
- [ ] Los botones del anillo reutilizan el componente `MenuButton` con `border-image` 9-slice, no imágenes individuales por botón
- [ ] El preview de personaje en el selector usa las mismas rutas de asset que usará el sprite del personaje dentro del gameplay (sin duplicación)
- [ ] El tiempo de carga inicial del selector mejora medible (sin overhead de WebGL context de Phaser)
- [ ] `game.destroy(true)` se invoca correctamente al desmontar `GamePlay.jsx`
- [ ] Ninguna escena de Grupo B (gameplay real) fue modificada en su lógica interna

---

## 9. Documentos relacionados

Este documento asume conocimiento previo de:
- `guia-assets-react-phaser.md` — estructura de assets compartidos, 9-slice en CSS vs Phaser, config compartida

El agente debe respetar esas convenciones de assets al ejecutar esta migración, no introducir un patrón nuevo.

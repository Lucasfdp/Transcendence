# Plan de Reparación del Sistema de Replay

## Análisis de Problemas

### Problema 1 (CRÍTICO): No se guardan posiciones de jugadores/pelotas

Los snapshots del estado (`room.state`) NO contienen posiciones de las bolas/proyectiles para **3 de 4 juegos**:

| Juego | Datos en snapshot | ¿Bola del jugador? |
|-------|-------------------|--------------------|
| **Kame Knock** | Solo `targets[]` con `{nx, ny}` | ❌ No |
| **Bamboo Bash** | Solo `bamboos[]` con `{nx, ny}` | ❌ No |
| **Bell Clash** | Solo `zones[]` con `{start, end}` (ángulos) | ❌ No |
| **Temple Curling** | `objects[]` con `{x, y}` pero solo posiciones **finales** (settled) | ⚠️ Parcial |

La física de la pelota corre 100% del lado del cliente. El servidor solo recibe `release` con `(vx, vy)` y lo reenvía a los otros clientes. Sin datos de posición, el visor no puede mostrar el movimiento de personajes.

### Problema 2: Visor SVG demasiado básico

El componente `ReplayStage` (`HomePage.tsx:329-533`) usa SVG primitivo:
- **Escenarios**: rectángulos/círculos sin los detalles del juego real
- **Personajes**: solo círculos de colores, sin sprites PNG de tortugas, sin sombras
- **Sin fondos**: el juego real usa fondos procedurales con estrellas, parrillas, faroles
- **Sin trails**: en curling real hay `stone.trail` (líneas de colores), en replay no

### Problema 3: Marcadores de lanzamiento hardcodeados

`getActiveReplayEventMarkers()` (`HomePage.tsx:233-327`) usa:
- Posiciones iniciales fijas (`50, 88` curling, `28/72` bamboo, etc.)
- Fórmulas de drag que no coinciden con la física real
- No usa posiciones reales del snapshot

### Problema 4: Sin interpolación entre frames

El playback salta entre snapshots. En curling, las piedras pasan de `(0, 0.5)` (placeholder) a la posición final directamente.

### Problema 5: Captura de frames irregular

`captureFrame()` solo se llama en `emitState()`, que solo ocurre cuando cambia el estado. No hay captura periódica.

---

## Plan de Implementación

### Fase 1: Backend — Capturar posiciones de bolas

#### 1.1 Agregar `BallSnapshotData` a types

**Archivo:** `backend/src/modules/matchmaking/matchmaking.types.ts`

Agregar tipo compartido:
```typescript
export interface BallSnapshotData {
  side: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}
```

Agregar campo `balls: BallSnapshotData[]` a:
- `KameKnockSnapshot`
- `BambooBashSnapshot`
- `BellClashSnapshot`

En `CurlingSnapshot` (`objects[]`): asegurar que las posiciones se capturen durante el deslizamiento (no solo al settled).

#### 1.2 Motores: trackear posiciones de bola

**Archivos:**
- `backend/src/modules/matchmaking/engines/kame-knock.engine.ts`
- `backend/src/modules/matchmaking/engines/bamboo-bash.engine.ts`
- `backend/src/modules/matchmaking/engines/bell-clash.engine.ts`
- `backend/src/modules/matchmaking/engines/shell-curl.engine.ts`

En cada motor:
- Al recibir `release`: inicializar `balls[]` en `state` con posición inicial según `side`
- Al recibir `settled`: actualizar posición final
- Actualizar `balls[]` en cada `handleInput` que modifique el estado
- Para curling: trackear posición durante el slide con datos del cliente o simulación server-side

#### 1.3 Hacer que `emitState()` se llame periódicamente

**Archivo:** `backend/src/modules/matchmaking/matchmaking.gateway.ts`

Agregar un interval timer durante el juego activo que llame `emitState()` cada ~100ms (además de las llamadas por cambio de estado), para capturar posiciones intermedias.

O alternativamente:

**Archivo:** `backend/src/modules/matchmaking/engines/*.engine.ts`

En el bucle de juego server-side (si existe), emitir estado periódicamente.

---

### Fase 2: Frontend — Reemplazar SVG con Phaser

#### 2.1 Crear escena ReplayScene

**Archivo nuevo:** `frontend/src/games/shared/ReplayScene.ts`

Escena Phaser que extiende `ResponsiveScene` y reutiliza funciones existentes:
- `drawSumoRing()` (de `shared/arenas/`)
- `drawIceSheet()` (de `shared/arenas/curl-sheet.ts`)
- `drawBackground()` (de `shared/drawBackground.ts`)
- `drawBell()` (de `BellClashScene.ts`)
- `drawIngamePlayerTexture()` / `drawShellBall()` / `drawStone()` (de `shared/mechanics/player-renderer.ts`)

La escena recibe `ReplayDetail` y un `ReplayController` que itera frames.

#### 2.2 Crear ReplayController

**Archivo nuevo:** `frontend/src/games/shared/ReplayController.ts`

Controlador que:
- Mantiene índice de frame actual
- Interpola entre frames (lerp)
- Maneja play/pause/seek
- Dispara eventos cuando cambia de frame

#### 2.3 Integrar en el hub modal

**Archivo:** `frontend/src/pages/HomePage.tsx`

Reemplazar:
```tsx
<ReplayStage replay={...} frame={...} bounds={...} playbackTime={...} />
```

Con:
```tsx
<div ref={replayContainerRef} className="hub-modal__replay-phaser" />
```

Usar `useEffect` para montar/desmontar la instancia Phaser.

#### 2.4 Estilos para el contenedor Phaser

**Archivo:** `frontend/src/styles/global.css` (o archivo de estilos del hub)

Agregar estilos para `.hub-modal__replay-phaser` con dimensiones fijas y aspecto consistente.

---

### Fase 3: Simular trayectorias con física real

#### 3.1 Extraer stepBall() a shared utility

**Archivo nuevo:** `frontend/src/shared/mechanics/physics.ts`

Extraer de `KameKnockScene.ts`, `BambooBashScene.ts`, `BellClashScene.ts`:
```typescript
export function stepBall(ball: BallState, deltaMs: number, arena: ArenaGeometry): void
```

Incluir:
- Integración lineal (`x += vx * dt`)
- Fricción (`v *= 0.985^(dt/16.67)`)
- Rebote en elipse con dampening (`0.8`)
- Umbral de parada (`MIN_SPEED_SRC * scale`)

#### 3.2 Extraer stepStone() para curling

**Archivo nuevo:** `frontend/src/shared/mechanics/physics.ts` (mismo archivo)

```typescript
export function stepStone(stone: StoneState, deltaMs: number, sheet: SheetGeometry): void
```

Incluir:
- Curl drift (velocidad perpendicular según `curlBias`)
- Integración lineal
- Rebote en paredes con dampening (`0.55`)
- Fricción (`v *= 0.99^(dt/16.67)`)
- Umbral de parada

#### 3.3 Reprojectar trayectorias en ReplayScene

En `ReplayScene.ts`:
- Por cada `game:throw`/`game:kame-throw`/etc, obtener `(vx, vy, side, timestamp)`
- Ejecutar `stepBall()` desde el timestamp del evento hasta el tiempo actual del playback
- Renderizar bola en posición calculada
- Renderizar trail (círculos encadenados con alpha decreciente)
- Al llegar al frame con `settled`: corregir posición si hay discrepancia

---

### Fase 4: Escenarios correctos por juego

#### 4.1 Temple Curling

Renderizar con `drawIceSheet()`:
- Pista rectangular con marco de madera
- Textura de guijarros (líneas finas paralelas cada `5*scale` px)
- 4 círculos de la casa (Rojo → Blanco → Azul → Blanco)
- Línea central, paredes laterales, hack de salida
- Bambú decorativo y faroles japoneses (laterales)
- Sombras de viñeta en bordes superior/inferior

#### 4.2 Kame Knock

Renderizar con `drawSumoRing()`:
- Elipse interior con relleno arena `#e8d5a3`
- Borde de tawara (terracota `#8b3a0f`)
- Línea de salida
- Fondo oscuro con parrilla (`THEME.background`) y líneas de grid
- Objetivos: sprites PNG (`daruma.png`, `box.png`, `tambor.png`) con sombra y pulso

#### 4.3 Bamboo Bash

Misma arena que Kame Knock (sumo ring):
- Fondo más oscuro (`#0a1208`)
- Bambús: sprites PNG (`bamboo1.png`, `bamboo2.png`, `bamboo3.png`) según `stage`

#### 4.4 Bell Clash

Misma arena que Kame Knock + campana:
- `drawBell()` con cuerpo marrón, anillos dorados, sombras
- Zonas de puntuación: arcos semi-transparentes (rojo 0.5x, amarillo 1.5x, verde 2x)
- Indicadores de jugador sobre las bolas

---

### Fase 5: Interpolación de frames

#### 5.1 Interpolar posiciones entre snapshots

En `ReplayController.ts`:
```typescript
function getInterpolatedPosition(
  prevFrame: ReplayFrame,
  nextFrame: ReplayFrame,
  progress: number,
  objectId: string
): { x: number; y: number }
```

Usar `lerp()` para suavizar movimiento entre snapshots consecutivos.

#### 5.2 Sincronizar simulación con timeline

Mantener dos timelines en paralelo:
- **Timeline de frames**: snapshots capturados del servidor
- **Timeline de simulación**: física corrida desde eventos de lanzamiento

El tiempo de playback determina qué mostrar de cada timeline, con cross-fade entre datos de snapshot y datos simulados.

---

### Fase 6: Optimizar captura

#### 6.1 Captura periódica en backend

En el gateway, cuando un match está `active`:
```typescript
const captureInterval = setInterval(() => {
  this.emitState(room.matchId);
}, 100); // ~10 fps de captura
```

Limpiar el interval cuando el match termina.

#### 6.2 Deduplicación inteligente

En `captureFrame()`, además de verificar `seq`, verificar si las posiciones de `balls[]` cambiaron significativamente antes de guardar (para no llenar la BD con frames redundantes).

---

## Archivos a modificar/crear

### Backend

| Archivo | Cambio |
|---------|--------|
| `backend/src/modules/matchmaking/matchmaking.types.ts` | + `BallSnapshotData`, + `balls` en snapshot types |
| `backend/src/modules/matchmaking/engines/kame-knock.engine.ts` | Trackear `balls[]` en state |
| `backend/src/modules/matchmaking/engines/bamboo-bash.engine.ts` | Trackear `balls[]` en state |
| `backend/src/modules/matchmaking/engines/bell-clash.engine.ts` | Trackear `balls[]` en state |
| `backend/src/modules/matchmaking/engines/shell-curl.engine.ts` | Trackear posiciones intermedias |
| `backend/src/modules/matchmaking/matchmaking.gateway.ts` | Captura periódica (interval 100ms) |

### Frontend

| Archivo | Cambio |
|---------|--------|
| **NUEVO** `frontend/src/games/shared/ReplayScene.ts` | Escena Phaser para replays |
| **NUEVO** `frontend/src/games/shared/ReplayController.ts` | Controlador de playback |
| **NUEVO** `frontend/src/shared/mechanics/physics.ts` | `stepBall()`, `stepStone()` extraídos |
| `frontend/src/pages/HomePage.tsx` | Reemplazar `ReplayStage` SVG con Phaser |
| `frontend/src/styles/global.css` | Estilos para contenedor Phaser |
| `frontend/src/features/hub/api.ts` | Tipos `ReplayFrame` si cambian |

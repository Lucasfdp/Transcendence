# Plan de Implementacion: Power Pickups en Kame Knock, Bell Clash y Shell Curl

## Resumen

Anadir power pickups con soporte online a los tres juegos que ya tienen la infraestructura frontend local pero carecen de backend online:
- **Bamboo Bash** ya funciona completo (referencia).
- **Kame Knock** — frontend local OK, falta backend + online wiring.
- **Bell Clash** — frontend local OK, falta backend + online wiring.
- **Shell Curl** — frontend local OK, falta backend + online wiring.

---

## Fase 1: Helper compartido backend

**Archivo:** `backend/src/modules/matchmaking/power-pickup.helper.ts`

Extraer logica comun de Bamboo Bash a un helper puro (sin dependencias de clase):

| Funcion | Proposito |
|---|---|
| `initPowerPickups(playerCount, powerupsEnabled, spawnCount)` | Estado inicial con N pickups esparcidos |
| `tickPowerPickups(pickups, nextId, accMs, deltaMs, intervalMs)` | Acumular tiempo y spawnear cada `intervalMs` ms |
| `tryConsumePowerPickup(pickups, side, pickupId, usedPowersBySide, lastPowerBySide, lastPowerPickupIdBySide)` | Validar y consumir un pickup; devuelve `string \| null` |
| `resetPowerPickups(playerCount)` | Resetear todo el estado de pickups por ronda |
| `randomPowerPickupType()` | Tipo aleatorio del pool |
| `randomPowerPickupSpot(existing, blockers?)` | Posicion normalizada 2D con separacion |

---

## Fase 2: Tipos compartidos

**Archivo:** `backend/src/modules/matchmaking/matchmaking.types.ts`

1. Extraer `PowerPickupEntry` a interface compartida (ya existe inline en `BambooBashSnapshot`).
2. Anadir a **`KameKnockSnapshot`**, **`BellClashSnapshot`** y **`CurlingSnapshot`**:
   - `usedPowersBySide: string[][]`
   - `lastPowerBySide: string[]`
   - `lastPowerPickupIdBySide: Array<number | null>`
   - `powerPickups: PowerPickupEntry[]`
   - `nextPowerPickupId: number`
   - `powerPickupAccMs: number` (excepto Curling si no usa ticking)
   - `lastPowerPickupUpdateAt: number | null`
3. Anadir `"power-pickup"` al union type `GameInputPayload["action"]` (si no existe ya).

---

## Fase 3: Backend Engine — Kame Knock

**Archivo:** `backend/src/modules/matchmaking/engines/kame-knock.engine.ts`

- `createInitialState()`: llamar `initPowerPickups()` y esparcir resultado en el snapshot.
- `handleInput()`: rutear `"power-pickup"` a `applyPowerPickup()`.
- `applyPowerPickup()`: validar turno, llamar `tickPowerPickups()`, `tryConsumePowerPickup()`, refrescar.
- `tickPowerPickups(state)`: wrapper que llama al helper con delta = `Date.now() - state.lastPowerPickupUpdateAt`.
- Llamar `tickPowerPickups(state)` en `applyRelease()` y `applyTargetHit()` y `applySettled()`.
- `resetRound()`: llamar `resetPowerPickups()`.

---

## Fase 4: Backend Engine — Bell Clash

**Archivo:** `backend/src/modules/matchmaking/engines/bell-clash.engine.ts`

Mismo patron que Kame Knock:

- `createInitialState()` + `initPowerPickups()`.
- `handleInput()`: rutear `"power-pickup"`.
- `applyPowerPickup()`: validar que el jugador no haya puntuado ya en la ronda, tick, consumir.
- `tickPowerPickups()`: igual que Kame Knock.
- Llamar `tickPowerPickups()` en `applyBellHit()` y `applyRoundScore()`.
- `resetRound()`: `resetPowerPickups()`.

---

## Fase 5: Backend Engine — Shell Curl

**Archivo:** `backend/src/modules/matchmaking/engines/shell-curl.engine.ts`

Particularidad de Curling: los pickups existen en el hielo y la stone los recoge al pasar. Flujo:

- `createInitialState()` + `initPowerPickups()`.
- `handleInput()`: rutear `"power-pickup"`.
- `applyPowerPickup()`: validar turno, tick, consumir, refrescar.
- Llamar `tickPowerPickups()` en `applyRelease()` y `applySettled()`.
- `resetEnd()` (en el bloque `state.throwsInEnd >= ...`): `resetPowerPickups()`.

---

## Fase 6: Gateway — broadcast events

**Archivo:** `backend/src/modules/matchmaking/matchmaking.gateway.ts`

Anadir tres bloques `if` en el handler de `game:input`, justo antes del `this.emitState()` final, siguiendo el patron de `bamboo:power-pickup` (lineas 451-478):

```typescript
// Kame Knock
if (payload.action === "power-pickup" && room.gameId === "kame-knock" && ...) {
    // verificar lastPowerPickupIdBySide, emitir "game:kame-power-pickup"
}

// Bell Clash
if (payload.action === "power-pickup" && room.gameId === "bell-clash" && ...) {
    // emitir "game:bell-power-pickup"
}

// Shell Curl
if (payload.action === "power-pickup" && room.gameId === "temple-curling" && ...) {
    // emitir "game:curl-power-pickup"
}
```

Cada evento incluye: `matchId`, `roundNumber`/`turnNumber`, `side`, posicion normalizada `(nx, ny)`, velocidad `(vx, vy)`, `power`.

---

## Fase 7: Frontend online — Kame Knock

**Archivo:** `frontend/src/games/kame-knock/KameKnockScene.ts`

1. **`spawnPowerPickup()`** — cuando `onlineMatch` existe, leer `snapshot.powerPickups` y llamar `this.powerPickups.setPickups()` (como hace Bamboo Bash).
2. **`collectPowerPickup()`** — tras recoger un pickup online, emitir `game:input` con `action: "power-pickup"`, incluyendo `pickupId` y estado del ball.
3. **Listener `game:kame-power-pickup`** — registrarlo en `initOnlineMatch()`. Handler: actualizar posicion del ball del rival y aplicar el power.
4. **`recreatePowerPickups()`** — similar a Bamboo Bash, adaptar para que funcione con `setPickups()` en online.

---

## Fase 8: Frontend online — Bell Clash

**Archivo:** `frontend/src/games/bell-clash/BellClashScene.ts`

Mismo patron que Kame Knock:

1. `spawnPowerPickup()` online -> `setPickups()`.
2. `collectPowerPickup()` -> emitir `"power-pickup"`.
3. Listener `game:bell-power-pickup`.
4. `recreatePowerPickups()`.

---

## Fase 9: Frontend online — Shell Curl

**Archivo:** `frontend/src/games/shell-curl/ShellCurlScene.ts`

Mismo patron, pero la recogida ocurre cuando la stone pasa sobre el pickup (en lugar del ball):

1. `spawnPowerPickup()` online -> `setPickups()`.
2. `collectPowerPickup()` (llamado desde el update loop de la stone) -> emitir `"power-pickup"`.
3. Listener `game:curl-power-pickup`.
4. `recreatePowerPickups()`.

---

## Fase 10: Validacion

- `git status` limpio, sin cambios residuales.
- `cd backend && npm run build` sin errores de tipos.
- `cd frontend && npx tsc --noEmit` sin errores de tipos.
- Verificar manualmente en local con `make dev`: iniciar partida online de cada juego, confirmar que los pickups aparecen, se pueden recoger y el rival los ve.

---

## Orden de ejecucion sugerido

1. Helper + tipos (Fase 1-2)
2. Engine Bell Clash (Fase 4)
3. Engine Kame Knock (Fase 3)
4. Engine Shell Curl (Fase 5)
5. Gateway (Fase 6)
6. Frontend Bell Clash (Fase 8)
7. Frontend Kame Knock (Fase 7)
8. Frontend Shell Curl (Fase 9)
9. Build + validacion (Fase 10)

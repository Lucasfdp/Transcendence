# Tournament — Auditoría de costuras de plataforma (Fase 0)

Fecha: 2026-07-13 · Subagente: `seams-auditor` (read-only) · Revisado y resuelto por: Arquitecto

Verificación de las costuras autorizadas por SPEC-037 contra `main`. Este documento es referencia obligatoria para los subagentes de implementación: aquí están las firmas reales y las resoluciones del Arquitecto a las discrepancias detectadas. No sustituye a las SPECs.

---

## Costuras confirmadas (sin discrepancia)

| Costura | Ubicación | API real |
|---|---|---|
| Creación de partidas | `matchmaking/match-factory.service.ts:47` | `createMatch({ gameId, mode: "casual"\|"ranked", players: {socketId, user: SocketUser, shellSelection}[], powerupsEnabled? }) → Promise<MatchRoom>`. Solo crea la partida PENDING; ready/start es del llamador |
| Eventos de ciclo de vida | `matchmaking/match-lifecycle.events.ts` | `subscribe(listener) → unsubscribe`. Tipos `started\|finished\|abandoned\|cancelled`, payload `{type, room: MatchRoom}`. En memoria, best-effort, single-process; errores de listener tragados+logueados |
| Provably-fair | `casino/casino.fair.ts` | Funciones puras: `generateServerSeed()`, `hashSeed(seed)`, `computeRoll(serverSeed, clientSeed, nonce) → [0,1)`, `computeRolls(..., count)`. El Gambling del torneo las llama directamente con su propio bookkeeping de nonce/commit. `casino.engine.ts` y `wagers` NO se tocan |
| Reconciliación al boot | `game-session.service.ts:37-59` | `onModuleInit`: bulk update de partidas `active` huérfanas → `abandoned`; guard 42P01 para BD fresca. Patrón ya replicado en `TournamentsService` |
| Socket | `matchmaking.gateway.ts:72-172` / `frontend/src/services/network/gameSocket.ts` | Path `/ws/`, cookie `auth_token` verificada con `jwtService.verify` en handshake; salas por `socket.join(id)`. Front: `getGameSocket()` singleton con `withCredentials` |
| Esquema `matches` | `matchmaking/entities/match.entity.ts` | PK uuid; `mode: "casual"\|"ranked"` (sin tercer modo); `status: pending\|active\|finished\|cancelled\|abandoned`; `winnerUserId`, `winnerSide` |
| Migración modelo | `backend/src/migrations/20260704990000-create-user-cards.ts` | Manual, raw SQL, camelCase entre comillas, `IF NOT EXISTS`, down() completo. `synchronize: false` en prod |
| Logro declarativo | `achievements/achievements.constants.ts` | `AchievementDefinition { id, title, description, unlockDescription, reward, progress(ctx), isUnlocked(ctx) }` en array `ACHIEVEMENTS`; validación cruzada al boot en `customization.service.ts:243` |
| Notificaciones | `notifications/notifications.service.ts` | `create(type, fromUserId, toUserId, payload?)` persiste + push `notification:new`; `pushLiveEvent(eventName, toUserId, payload?)` solo live |
| Bloqueo de monedas | `users/user-lock.util.ts:28` | `lockUserForUpdate(manager, userId)` con `loadEagerRelations: false` obligatorio; patrón de uso en `achievements.service.ts:126-144` |

## Cobertura de minijuegos 2–4 jugadores (precondición SPEC-015): **SÍ**

4 minijuegos `available` (`kame-knock`, `bell-clash`, `temple-curling`, `bamboo-bash`; `river-rush` = coming_soon). Todos los engines dimensionan por `room.players.length` (rango efectivo 2–5, `MIN_PLAYERS=2`/`MAX_PLAYERS=5`). Cualquier recuento de activos 2, 3 o 4 tiene los 4 juegos disponibles.

## Discrepancias detectadas y resolución del Arquitecto

| # | Hallazgo | Resolución (vinculante para los subagentes) |
|---|---|---|
| 1 | El arranque server-initiated (`launchPrivateMatch` / `startServerInitiatedMatch`) es código **privado** de `MatchmakingGateway`, no un servicio invocable | El módulo de torneo replica la secuencia con las APIs públicas: `MatchFactoryService.createMatch` → `RoomService.setReady(matchId, userId)` por jugador → `GameSessionService.startIfReady(matchId)`. Nunca editar `matchmaking.gateway.ts` |
| 2 | El molde `PrivateLobbiesService` es en-memoria, expira a 2 min, max 5; SPEC-038 exige lobby en Postgres, 10 min, fijo 4 | Se reutiliza SOLO el algoritmo/forma del PIN (6 chars, alfabeto sin ambiguos `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, normalización uppercase). PIN de torneo: prefijo fijo `T` + 5 aleatorios, espacio de nombres propio (lookup en tabla `tournaments`, no en el Map de lobbies). Ciclo de vida en BD según SPEC-038 |
| 3 | `NotificationType` es una unión hardcodeada de 2 valores en `notification.entity.ts:28` | APROBADO ampliar la unión con `tournament_invite` (columna varchar(32) ya lo admite). Extensión mínima sancionada por SPEC-037 |
| 4 | No existe helper reutilizable `addCoins`; todos los escritores inlinean `transaction + lockUserForUpdate + save` | El paso REWARDS (F5) replica el patrón inline de `achievements.service.ts:126-144`. El valor 500 vive en el catálogo |
| 5 | `AchievementContext` no tiene señal de torneo: `isUnlocked` no puede ver "ganó un torneo" | Decisión diferida al brief de F5 (`persistent-rewards`): extensión mínima del contexto O vía de grant directa en `AchievementsService`; requiere aprobación del Arquitecto en esa fase. No improvisar antes |
| 6 | El catálogo de minijuegos NO tiene metadatos de jugadores soportados; el filtro "exactamente N" de SPEC-015 asume un campo inexistente | v1: el filtro es `status === "available"` del catálogo existente (todos soportan 2–5, verificado en engines). Ninguna lista duplicada. Si un juego futuro diverge, se añadirá el campo al catálogo existente, no al torneo |
| 7 | `apiFetch` es privado del módulo `features/hub/api.ts` (no exportado) | APROBADO exportarlo (cambio de una línea) cuando llegue el Slice/F7; `features/tournaments/api.ts` lo consumirá. Nunca duplicar el wrapper CSRF/retry |
| 8 | `MatchLifecycleEvents "cancelled"` no tiene productor: nunca se emite hoy | No depender de él. La integración de minijuegos se apoya en `finished`/`abandoned` + watchdog con reconciliación desde `matches` (ya es el diseño de SPEC-015) |

Estas resoluciones son defaults técnicos de implementación (no decisiones de diseño de juego): no requieren entrada en SPEC-040, pero cualquier subagente que necesite desviarse debe detenerse y escalar al Arquitecto.

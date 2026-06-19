Plan De Acción
Recomendaría implementar primero Curling Temple en modo online por turnos. Es el camino más seguro para construir la base de matchmaking, rooms, reconexión y servidor autoritativo sin meternos todavía en sincronización realtime de físicas. Después, esa infraestructura se puede reutilizar para Bamboo Bash realtime.
Objetivo MVP
Construir una primera versión online con:
- Matchmaking casual y ranked.
- Usuarios autenticados y guests.
- Espectadores.
- Reconexión con timeout.
- Servidor autoritativo.
- Persistencia de partidas, participantes y resultados.
- Integración con el sistema actual de XP, coins, stats y leaderboard.
Fase 1: Base Realtime Backend
Implementar WebSockets en NestJS.
Tareas:
- Añadir soporte WebSocket en backend con @nestjs/websockets y @nestjs/platform-socket.io, o ws si se prefiere algo más bajo nivel.
- Crear un módulo nuevo: matchmaking o realtime.
- Autenticar el handshake WebSocket usando la cookie auth_token actual.
- Reutilizar la validación JWT existente.
- Crear servicios base:
- PresenceService
- MatchmakingService
- RoomService
- GameSessionService
- Definir eventos iniciales:
- queue:join
- queue:leave
- match:found
- room:join
- room:ready
- game:input
- game:state
- game:end
- spectator:join
- reconnect
Fase 2: Modelo De Datos
Añadir persistencia mínima para partidas online.
Entidades sugeridas:
Match {
  id
  gameId
  mode: 'casual' | 'ranked'
  status: 'pending' | 'active' | 'finished' | 'cancelled' | 'abandoned'
  winnerUserId nullable
  createdAt
  startedAt nullable
  finishedAt nullable
}
MatchPlayer {
  id
  matchId
  userId
  side: 0 | 1
  outcome: 'win' | 'loss' | 'draw' | 'abandoned' nullable
  shellSelection: jsonb
  disconnectedAt nullable
  reconnectedAt nullable
}
MatchSpectator {
  id
  matchId
  userId nullable
  guestId nullable
  joinedAt
  leftAt nullable
}
Opcional para ranked:
UserRating {
  id
  userId
  gameId
  rating
  wins
  losses
  draws
  updatedAt
}
Fase 3: Matchmaking
Implementar cola separada por juego y modo.
Reglas MVP:
- Cola por gameId.
- Cola separada para casual y ranked.
- 1v1.
- Guests permitidos en casual.
- Ranked solo para usuarios persistentes, si el producto necesita integridad de ranking.
- Evitar que el mismo usuario esté en varias colas o partidas activas.
- Timeout si un jugador acepta pero no entra en la room.
- Ready check antes de empezar.
Flujo:
1. Cliente conecta WebSocket.
2. Cliente emite queue:join con gameId, mode y selección de shell.
3. Backend valida usuario/guest y selección.
4. Backend mete al jugador en cola.
5. Cuando hay rival compatible, crea Match.
6. Backend emite match:found.
7. Ambos jugadores entran a la room.
8. Ambos envían room:ready.
9. Backend marca partida como active.
Fase 4: Curling Temple Online Turn-Based
Adaptar primero Curling Temple para online.
Principio clave:
- El cliente envía intenciones/input, no el resultado.
- El backend valida turno, jugador y estado.
- El backend calcula/aprueba la transición de estado.
- El backend emite snapshots a jugadores y espectadores.
Eventos posibles:
game:input {
  matchId
  action: 'aim' | 'power' | 'release'
  payload
}
game:state {
  matchId
  seq
  currentTurn
  players
  objects
  score
  phase
}
El frontend debe soportar:
- Modo local existente.
- Modo online jugador.
- Modo espectador.
- Input bloqueado si no es tu turno.
- Render desde snapshots del servidor.
- Pantalla de reconexión si se pierde conexión.
Fase 5: Reconexión Con Timeout
Implementar comportamiento consistente:
- Si un jugador desconecta, la partida no termina inmediatamente.
- Backend marca disconnectedAt.
- Room sigue viva durante un timeout, por ejemplo 30-60 segundos.
- Si vuelve a conectar con el mismo usuario/guest session:
- Se reune a la room.
- Recibe último snapshot.
- Continúa la partida.
- Si expira el timeout:
- El jugador pierde por abandono.
- El otro gana.
- Se persiste resultado.
- Se notifica a espectadores.
Fase 6: Espectadores
Añadir espectadores después de tener rooms funcionando.
Reglas MVP:
- Un espectador puede unirse a una partida activa por matchId.
- Recibe snapshots game:state.
- No puede emitir game:input.
- Puede desconectarse sin afectar la partida.
- Puede ser usuario autenticado o guest.
Endpoints/eventos útiles:
- GET /api/matches/active
- GET /api/matches/:id
- spectator:join
- spectator:leave
Fase 7: Ranked
Implementar ranked cuando casual ya sea estable.
Reglas recomendadas:
- Ranked solo usuarios no-guest.
- Rating separado por juego.
- Matchmaking por rating con rango expansivo:
- primeros 10s: ±100
- 10-30s: ±200
- 30s+: ±400 o fallback
- Actualizar rating solo desde resultado calculado por servidor.
- No aceptar POST /api/game-results desde cliente para partidas online ranked.
Fase 8: Redis Y Escalabilidad
Para MVP local se puede usar memoria, pero como el proyecto ya tiene Redis, conviene diseñarlo pensando en Redis desde el inicio.
Usos:
- Presencia: presence:{userId}
- Cola: queue:{gameId}:{mode}
- Room state: room:{matchId}
- Locks para evitar doble emparejamiento.
- Pub/sub si hay varias instancias backend.
Si solo hay una instancia backend al principio, se puede implementar InMemoryMatchmakingStore y después cambiarlo por RedisMatchmakingStore, pero solo si no complica demasiado.
Prompt Para Implementación
Actúa como senior backend/frontend developer en el repo `/home/max/code/ft_transcendence/shellsmash`.

Objetivo: implementar la base de conexiones realtime y matchmaking online para el juego, empezando por Curling Temple en modo turn-based. No implementar Bamboo Bash realtime todavía, pero diseñar la arquitectura para que pueda reutilizarse después.

Contexto técnico:
- Backend: NestJS + TypeScript + TypeORM + PostgreSQL.
- Frontend: Phaser 3 + Vite + TypeScript.
- Auth actual: JWT en cookie httpOnly `auth_token`.
- Nginx ya tiene `/ws/` preparado para WebSocket upgrade.
- Redis existe en Docker, pero actualmente casi no se usa.
- El endpoint actual `POST /api/game-results` confía en el cliente; para partidas online el resultado debe ser calculado y persistido por el servidor.
- El juego recomendado para MVP es Curling Temple porque es por turnos.

Requisitos funcionales:
1. Crear capa WebSocket backend autenticada con la cookie JWT actual.
2. Soportar usuarios autenticados y guests.
3. Implementar matchmaking casual y ranked.
4. Permitir espectadores.
5. Implementar reconexión con timeout.
6. Usar servidor autoritativo.
7. Persistir matches y participantes.
8. Integrar resultados online con el sistema existente de game results/stats/progression.
9. Adaptar frontend para conectar a matchmaking y jugar una partida online turn-based.
10. Mantener el modo local existente funcionando.

Prioridades:
- Hacer cambios mínimos y bien integrados con los patrones existentes del repo.
- Empezar con un vertical slice funcional antes de generalizar demasiado.
- No romper auth ni los juegos locales.
- No confiar en resultados enviados por cliente para partidas online.
- Diseñar eventos y tipos claros.

Backend esperado:
- Crear módulo nuevo, por ejemplo `matchmaking`.
- Crear gateway WebSocket, por ejemplo `MatchmakingGateway`.
- Crear servicios:
  - `PresenceService`
  - `MatchmakingService`
  - `RoomService`
  - `GameSessionService`
- Crear entidades:
  - `Match`
  - `MatchPlayer`
  - opcionalmente `MatchSpectator`
  - opcionalmente `UserRating` para ranked
- Eventos mínimos:
  - `queue:join`
  - `queue:leave`
  - `match:found`
  - `room:ready`
  - `game:input`
  - `game:state`
  - `game:end`
  - `spectator:join`
  - `spectator:leave`
  - `reconnect`
- Validar selección de shells reutilizando el servicio existente.
- Evitar que un usuario esté en dos colas o partidas activas.
- Implementar timeout de reconexión.
- Finalizar partida por abandono si expira el timeout.

Frontend esperado:
- Crear wrapper de WebSocket, por ejemplo `src/network/gameSocket.ts`.
- Integrar matchmaking desde el flujo de selección de shells.
- Añadir UI/estado básico:
  - buscando partida
  - cancelar búsqueda
  - match encontrado
  - esperando rival
  - reconectando
  - espectador
- Adaptar Curling Temple para modo online:
  - diferenciar jugador local/remoto
  - bloquear input si no es el turno del jugador local
  - aplicar snapshots del servidor
  - mantener modo local intacto

Arquitectura de juego:
- El cliente debe enviar input/intenciones, no resultado final.
- El backend debe validar turno, jugador y estado.
- El backend debe emitir snapshots autoritativos.
- Los espectadores solo reciben estado y no pueden enviar input de juego.

Ranked:
- Casual permite guests.
- Ranked debe ser solo para usuarios persistentes salvo que el proyecto decida explícitamente permitir guests.
- Rating por juego.
- Actualización de rating solo desde resultado servidor.

Plan de ejecución:
1. Inspeccionar código actual de auth, game-results, shells, frontend API y escenas Phaser.
2. Definir tipos/eventos compartidos si el repo tiene lugar apropiado; si no, mantener tipos cerca de cada lado.
3. Implementar backend WebSocket autenticado.
4. Implementar entidades de match.
5. Implementar matchmaking casual mínimo.
6. Implementar rooms y ready check.
7. Implementar estado turn-based para Curling Temple.
8. Integrar finalización con `GameResultsService`.
9. Implementar reconexión con timeout.
10. Añadir espectadores.
11. Añadir ranked/rating.
12. Integrar frontend.
13. Verificar con tests/build/lint disponibles.

Antes de escribir código, revisa el codebase y confirma rutas reales. Si hay una decisión grande con dos caminos razonables, elige el camino más pequeño y mantenible.
Decisión Recomendada
Empezaría así:
1. Curling Temple online casual.
2. Reconexion con timeout.
3. Espectadores.
4. Persistencia e integración con resultados.
5. Ranked.
6. Después Bamboo Bash realtime usando la infraestructura ya validada.

# Modules Progress And Scope

## Purpose
Este documento traduce `docs/modules.md` al nivel de detalle del enunciado en `docs/en.subject.md` y fija el alcance real del proyecto. Solo se consideran aqui los modulos elegidos, hechos o en progreso.

Estados usados:
- `Hecho`: cumple de forma razonable lo exigido por el enunciado.
- `En progreso`: hay implementacion real, pero faltan requisitos de validacion.
- `No hecho`: no hay implementacion suficiente para reclamar el modulo.

## Web

### Minor: Frontend framework
Estado: `Hecho`

Desglose del enunciado:
- Uso de framework frontend.

Evidencia:
- `frontend/package.json` usa React + Vite.

Faltas para completarse:
- Ninguna especifica del modulo. La calidad general sigue dependiendo del resto del proyecto.

### Minor: Backend framework
Estado: `Hecho`

Desglose del enunciado:
- Uso de framework backend.

Evidencia:
- `backend/package.json` usa NestJS.

Faltas para completarse:
- Ninguna especifica del modulo.

### Major: Real-time features using WebSockets
Estado: `Hecho`

Desglose del enunciado:
- Actualizaciones en tiempo real.
- Manejo de conexion y desconexion.
- Broadcasting eficiente.

Evidencia:
- `backend/src/modules/matchmaking/matchmaking.gateway.ts`
- `frontend/src/services/network/gameSocket.ts`
- Eventos de juego, cola, lobby, reconexion y estado compartido.

Faltas para completarse:
- Reforzar pruebas de caidas de red y reconexion en escenarios limite.

### Major: Allow users to interact with other users
Estado: `En progreso`

Desglose del enunciado:
- Chat basico.
- Sistema de perfil.
- Sistema de amigos con add/remove y lista.

Evidencia:
- Perfiles y actualizacion: `backend/src/modules/users/`
- Amigos y bloqueos: `backend/src/modules/friends/`
- Estado online por sockets: `backend/src/modules/presence/`
- Chat de dm's y grupos (solo entre amigos, con historial persistido, envio de GIFs via Klipy): `backend/src/modules/chat/`, wiring de sockets en `matchmaking.gateway.ts`, UI en la seccion "Messages" del modal Social (`frontend/src/pages/HomePage.tsx`).

Faltas para completarse:
- Ninguna pendiente para el chat basico.

### Major: Public API for database interaction
Estado: `Hecho`

Desglose del enunciado:
- API key segura.
- Rate limiting.
- Documentacion.
- Al menos 5 endpoints.
- Ejemplos `GET`, `POST`, `PUT`, `DELETE`.

Evidencia:
- Hay multiples endpoints REST en `auth`, `users`, `friends`, `matches`, `leaderboard`.
- Hay rate limiting parcial en autenticacion y minijuegos.
- Hay Swagger en backend.
- API publica dedicada en `backend/src/modules/public-api/` protegida por `X-API-Key`.
- Endpoints publicos documentados: `GET /api/public/users`, `GET /api/public/users/:username`, `POST /api/public/users/query`, `PUT /api/public/users/:username`, `DELETE /api/public/users/:username/avatar`.
- `PUBLIC_API_KEY` documentada en `.env.example` y registrada en Swagger.
- Rate limiting compartido en Redis para la API publica mediante `backend/src/modules/auth/redis-rate-limiter.service.ts`.
- Ejemplos de consumo en `docs/public-api.md`.

Faltas para completarse:
- El resto de buckets legacy (`auth`, `casino`) sigue usando el limitador en memoria; solo la API publica usa el compartido en Redis.

### Minor: ORM for database
Estado: `Hecho`

Desglose del enunciado:
- Uso de ORM.

Evidencia:
- TypeORM en `backend/src/app.module.ts` y entidades distribuidas por modulos.

Faltas para completarse:
- Ninguna especifica del modulo.

### Minor: Complete notification system for create, update, and delete actions
Estado: `En progreso`

Desglose del enunciado:
- Sistema completo de notificaciones para crear, actualizar y borrar acciones relevantes.

Evidencia:
- `backend/src/modules/notifications/`
- Inbox en tiempo real en `frontend/src/pages/HomePage.tsx`
- Notificaciones persistentes de amistad.

Faltas para completarse:
- Solo cubre una parte del dominio social.
- No hay cobertura clara de create/update/delete de forma transversal.
- Falta definir catalogo completo de eventos y su persistencia.

### Minor: Server-Side Rendering (SSR)
Estado: `No hecho`

Desglose del enunciado:
- SSR real para rendimiento y SEO.

Evidencia:
- El frontend es Vite SPA; no hay Next.js, Nuxt, SvelteKit ni pipeline SSR.

Faltas para completarse:
- Implementacion completa del renderizado en servidor.

### Minor: Progressive Web App (PWA)
Estado: `No hecho`

Desglose del enunciado:
- Soporte offline.
- Instalabilidad.

Evidencia:
- No hay `manifest`, service worker ni plugin PWA.

Faltas para completarse:
- Todo el modulo.

### Minor: Custom design system with at least 10 reusable components
Estado: `En progreso`

Desglose del enunciado:
- Sistema de diseno propio.
- Al menos 10 componentes reutilizables.
- Paleta, tipografia e iconografia.

Evidencia:
- Componentes reutilizables en `frontend/src/components/`
- Tema y estilos globales en `frontend/src/shared/theme.ts` y `frontend/src/styles/global.css`

Faltas para completarse:
- Falta inventario formal del design system.
- Falta demostrar de forma explicita las 10 piezas y su reutilizacion sistematica.

### Minor: Support additional browsers
Estado: `No hecho`

Desglose del enunciado:
- Compatibilidad completa con al menos 2 navegadores extra.
- Tests y correcciones documentadas.
- Limitaciones especificas documentadas.

Evidencia:
- No hay documentacion ni matriz de compatibilidad.

Faltas para completarse:
- Todo el modulo.

## User Management

### Major: Standard user management and authentication
Estado: `En progreso`

Desglose del enunciado:
- Actualizar perfil.
- Subir avatar con avatar por defecto.
- Amigos y estado online.
- Pagina de perfil.

Evidencia:
- Auth local, guest y OAuth en `backend/src/modules/auth/`
- Perfil editable y avatar upload en `backend/src/modules/users/users.controller.ts`
- Amigos y online status en `friends` y `presence`
- Perfil visible desde `HomePage`

Faltas para completarse:
- Validar que la pagina de perfil y el flujo completo de avatar cumplen bien en la UI.
- Confirmar avatar por defecto consistente en todos los casos.
- Sigue marcado como `pending` en `docs/modules.md`, asi que no debe reclamarse como cerrado todavia.

### Minor: Game statistics and match history
Estado: `Hecho`

Desglose del enunciado:
- Wins, losses, ranking, level y similares.
- Historial con fechas, resultados y rivales.
- Logros y progresion.
- Leaderboards.

Evidencia:
- `backend/src/modules/game-results/`
- `backend/src/modules/leaderboard/`
- `backend/src/modules/achievements/`
- Replays e historial de partidas en `backend/src/modules/matchmaking/replay.service.ts`

Faltas para completarse:
- Conviene revisar cobertura de historial para todos los juegos ya expuestos.

### Minor: Remote authentication with OAuth 2.0
Estado: `Hecho`

Desglose del enunciado:
- OAuth remoto con proveedores tipo Google, GitHub o 42.

Evidencia:
- Flujos 42 y GitHub implementados en `backend/src/modules/auth/`
- UI de OAuth en `frontend/src/components/auth/OAuthButtons.tsx`

Faltas para completarse:
- Varios botones del frontend no implican backend funcional; para reclamar el modulo basta con tener proveedores reales funcionando, pero hay que evitar vender proveedores no implementados.

## Cybersecurity

### Major: Hardened WAF/ModSecurity plus HashiCorp Vault
Estado: `En progreso`

Desglose del enunciado:
- WAF/ModSecurity estricto.
- Vault para secretos, claves y credenciales.

Evidencia:
- Vault y agentes en `docker-compose.yml`
- Scripts y bootstrap en `Makefile` y `scripts/`

Faltas para completarse:
- No se ve ModSecurity/WAF endurecido y demostrable en el estado actual.
- Sin esa parte, el major completo no puede darse por hecho.

## Gaming and User Experience

### Major: Complete web-based game where users can play each other
Estado: `Hecho`

Desglose del enunciado:
- Juego web jugable.
- Partidas en vivo.
- Reglas claras y win/loss conditions.

Evidencia:
- `frontend/src/games/kame-knock/`
- Estados y resultados en `matchmaking` y `game-results`

Faltas para completarse:
- Ninguna critica para reclamar el modulo base.

### Major: Remote players
Estado: `Hecho`

Desglose del enunciado:
- Dos jugadores remotos.
- Manejo de latencia, desconexion y reconexion.

Evidencia:
- `matchmaking.gateway.ts`, `room.service.ts`, `gameSocket.ts`
- Rejoin, away, abandon y reconnect timeout implementados.

Faltas para completarse:
- Afinar pruebas reales multi-equipo antes de evaluacion.

### Major: Multiplayer game with more than two players
Estado: `En progreso`

Desglose del enunciado:
- Minimo 3 jugadores simultaneos.
- Juego justo.
- Sincronizacion correcta.

Evidencia:
- Motores de varios juegos y estructura de matchmaking suficientemente general.
- `shell-curl` apunta a modos con mas de dos participantes.

Faltas para completarse:
- Falta prueba clara y demostrable de una partida funcional 3+ validada de extremo a extremo.

### Major: Add another game with user history and matchmaking
Estado: `Hecho`

Desglose del enunciado:
- Segundo juego distinto.
- Historial y estadisticas.
- Matchmaking.

Evidencia:
- Juegos adicionales en `bell-clash`, `bamboo-bash`, `shell-curl`
- Matchmaking multi-juego en `backend/src/modules/matchmaking/engines/`

Faltas para completarse:
- Ninguna esencial para reclamar el modulo.

### Minor: Tournament system
Estado: `No hecho`

Desglose del enunciado:
- Brackets.
- Orden de cruces.
- Registro y gestion de participantes.

Evidencia:
- No hay implementacion visible de torneos.

Faltas para completarse:
- Todo el modulo.

### Minor: Game customisation options
Estado: `En progreso`

Desglose del enunciado:
- Power-ups, habilidades, mapas o ajustes.
- Opciones por defecto.

Evidencia:
- Powers y mecanicas en `frontend/src/shared/mechanics/`
- `shell-curl` y otros juegos ya usan poderes y seleccion.
- `backend/src/modules/customization/` cubre cosmeticos de usuario.
- `backend/src/modules/cards/` (Shell Cards): binder coleccionable puramente
  cosmetico, con multiples niveles de sobre (`basic`/`deluxe`/`legendary`,
  cada uno con su propio precio y probabilidades — ver
  `docs/SHELL_CARDS_SPEC.md` §11). Catalogo ampliado a 37 cartas (4 nuevos
  personajes gold) y nuevo estado "Prismatic" — un tier mas raro que el
  foil, exclusivo de cartas gold, sin cambios en la economia (ver
  `docs/SHELL_CARDS_SPEC.md` §12). Refuerza, no sustituye, la separacion
  pendiente entre personalizacion de gameplay y personalizacion cosmetica.

Faltas para completarse:
- Separar claramente personalizacion de gameplay de personalizacion cosmetica.
- Demostrar configuracion jugable estable y evaluable por modulo.

### Minor: Gamification system
Estado: `Hecho`

Desglose del enunciado:
- Al menos 3 entre logros, badges, leaderboard, XP/niveles, retos, recompensas.
- Persistencia.
- Feedback visual.

Evidencia:
- Achievements
- Leaderboards
- XP/level y progresion
- Popups visuales de logro

Faltas para completarse:
- Ninguna esencial para reclamarlo.

### Minor: Spectator mode
Estado: `En progreso`

Desglose del enunciado:
- Ver partidas en curso.
- Actualizaciones en tiempo real.
- Chat opcional.

Evidencia:
- Entidades y estructuras de espectadores en `matchmaking`
- `room.service.ts` y escenas frontend contemplan `spectator`

Faltas para completarse:
- Validar flujo completo y accesible desde UI.
- Confirmar entrada real a partidas activas y estabilidad del modo observador.

## Devops

### Major: Monitoring with Prometheus and Grafana
Estado: `En progreso`

Desglose del enunciado:
- Recoleccion de metricas.
- Exporters e integraciones.
- Dashboards custom.
- Alertas.
- Acceso seguro.

Evidencia:
- Servicio `monitoring` en Docker.
- `backend/src/modules/metrics/`
- `backend/src/modules/health/`

Faltas para completarse:
- Falta evidenciar dashboards finales y reglas de alertado.
- Hay monitorizacion montada, pero no queda demostrado que el modulo entero este cerrado.

## Modules of Choice

### Major: Replay mode
Estado: `Hecho`

Desglose del enunciado:
- Debe ser sustancial, relevante al proyecto y justificable como major.

Evidencia:
- Persistencia de replays y eventos en migraciones y entidades.
- API de replays en `backend/src/modules/matchmaking/matches.controller.ts`
- Visualizacion en `frontend/src/pages/HomePage.tsx`

Faltas para completarse:
- Dejar su justificacion final reflejada tambien en `README.md` para evaluacion.

## Module Boundary Rule
Este documento, junto con `AGENTS.md`, marca los limites funcionales del proyecto. El agente no debe proponer, implementar ni ampliar funcionalidades fuera de estos modulos elegidos, salvo que el usuario lo pida de forma explicita.

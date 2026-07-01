Actúa como senior developer en el proyecto Shell Smash.

Objetivo:
Implementar el primer contenido real del botón “Achievements” del Hub, creando un sistema inicial de logros desbloqueables basado en la progresión existente del jugador.

Contexto técnico:
El proyecto ya tiene un Hub en Phaser (`HubScene.ts`) con botones de extras: Shell Cards, Achievements y Costumization. Actualmente esos botones muestran modales “Coming Soon”.

El backend ya registra resultados de partidas mediante `POST /game-results`. Ese flujo actualiza:
- `user.xp`
- `user.level`
- `user.coins`
- `profile.gamesPlayed`
- `profile.totalWins`
- `profile.totalLosses`

El frontend ya llama a `api.submitGameResult(...)` desde las escenas de juego al terminar una partida.

Decisión:
Empezar por Achievements porque tiene datos reales disponibles y puede apoyarse en la progresión ya implementada. Shell Cards y Customization quedan para después porque requieren decisiones adicionales de inventario, economía, rarezas, assets y desbloqueos.

Alcance del MVP:
Crear un sistema mínimo pero extensible de achievements con:
- Catálogo estático de logros.
- Persistencia de logros desbloqueados por usuario.
- Evaluación automática al completar partidas.
- Respuesta del backend con los logros recién desbloqueados.
- Vista/grid de achievements desde el botón del Hub.
- Popup de achievement desbloqueado al terminar una partida.

Logros iniciales sugeridos:
- Primera Partida: completar la primera partida.
- Primer Triunfo: ganar una partida.
- Constancia Dojo: jugar 10 partidas.
- Caparazón Ascendente: alcanzar nivel 2.
- Primer Botín: conseguir monedas por primera vez.

Plan backend:
1. Crear una entidad `UserAchievement`.
   - Relación many-to-one con `User`.
   - Campos recomendados:
     - `id`
     - `user`
     - `achievementId`
     - `unlockedAt`
   - Añadir índice/unique constraint para evitar duplicados por `user + achievementId`.

2. Crear un catálogo estático de achievements.
   - Puede vivir en un archivo tipo `achievements.constants.ts`.
   - Cada achievement debería tener:
     - `id`
     - `title`
     - `description`
     - `unlockDescription`
     - opcionalmente `rewardLabel`
     - condición/evaluación asociada.

3. Crear servicio de achievements.
   - Método para listar achievements de un usuario con estado locked/unlocked.
   - Método para evaluar logros después de una partida.
   - Debe devolver solo los logros recién desbloqueados.
   - Debe ser idempotente: si el logro ya estaba desbloqueado, no se vuelve a insertar ni se vuelve a devolver como nuevo.

4. Integrar evaluación en `GameResultsService.submitResult`.
   - Después de actualizar XP, nivel, monedas y profile stats, evaluar achievements.
   - Ampliar la respuesta de progresión para incluir:
     - `unlockedAchievements: Achievement[]`
   - Para usuarios guest, devolver `unlockedAchievements: []`.

5. Añadir endpoint para consultar achievements.
   - Ejemplo:
     - `GET /achievements`
   - Debe devolver el catálogo completo con estado:
     - `unlocked`
     - `unlockedAt`
   - Protegido con `JwtAuthGuard`.

6. Añadir tests backend.
   - Primera partida desbloquea achievement una sola vez.
   - Primera victoria desbloquea achievement.
   - 10 partidas desbloquea achievement cuando se alcanza el umbral.
   - Guest no persiste ni desbloquea achievements.
   - La respuesta de `submitResult` incluye nuevos logros cuando corresponde.

Plan frontend:
1. Ampliar tipos en `hub/api.ts`.
   - Añadir tipo `Achievement`.
   - Añadir `unlockedAchievements` a `ProgressionResult`.
   - Añadir método `getAchievements()`.

2. Sustituir el comportamiento del botón `Achievements`.
   - En lugar de mostrar “Coming Soon”, debe abrir una vista real.
   - Puede ser un overlay/modal dentro de `HubScene` para mantener el scope pequeño.
   - Mostrar un grid/listado de tarjetas de achievements.

3. Diseñar tarjetas de achievements.
   - Estado desbloqueado:
     - título visible
     - descripción
     - fecha o texto “Unlocked”
     - recompensa/desbloqueo si aplica
   - Estado bloqueado:
     - visual más oscuro
     - título visible o parcialmente oculto según decisión de diseño
     - descripción de condición
   - Mantener el estilo visual del dojo: dorados, fondo oscuro, bordes redondeados, estética de pergamino/tarjeta.

4. Añadir popup de achievement desbloqueado.
   - Al recibir `unlockedAchievements` desde `submitGameResult`, mostrar popup no bloqueante o modal breve.
   - Debe incluir:
     - título del achievement
     - mini descripción
     - posible recompensa/desbloqueo.
   - Si se desbloquean varios a la vez, mostrarlos en cola o en una lista compacta.

5. Integrar popup en escenas de juego.
   - Actualmente `BambooBashScene`, `KameKnockScene` y `ShellCurlScene` llaman a `api.submitGameResult(...)`.
   - Reutilizar una función/helper si el patrón se repite demasiado, pero evitar sobreabstraer en el primer MVP.
   - Como primer paso, se puede guardar temporalmente los achievements desbloqueados en el registry y mostrarlos al volver al Hub, o mostrar el popup directamente al finalizar la partida. Elegir la opción más simple que encaje con la UX actual.

6. Manejar errores de forma no bloqueante.
   - Si falla `getAchievements`, mostrar mensaje dentro del overlay.
   - Si falla `submitGameResult`, mantener el comportamiento actual: log warning y no bloquear la pantalla final.

Criterios de aceptación:
- El botón “Achievements” abre una vista real con tarjetas.
- Un usuario autenticado puede desbloquear “Primera Partida” tras completar una partida.
- El logro no vuelve a aparecer como recién desbloqueado en partidas posteriores.
- La página de achievements refleja correctamente locked/unlocked.
- Usuarios guest no guardan logros.
- Las partidas siguen funcionando aunque falle el sistema de achievements.
- Tests backend relevantes pasan.
- El frontend compila sin errores TypeScript.

Restricciones:
- Mantener cambios pequeños y coherentes con la arquitectura actual.
- No introducir inventario, tienda, cartas ni cosméticos todavía.
- No añadir complejidad de recompensas reales hasta que Customization o Shell Cards estén definidos.
- Evitar crear abstracciones grandes prematuras.
- Preservar el estilo visual existente del Hub.

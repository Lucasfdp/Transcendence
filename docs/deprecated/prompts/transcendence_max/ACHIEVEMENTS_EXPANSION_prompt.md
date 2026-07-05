Actúa como senior backend/frontend engineer en este repo `ft_transcendence/shellsmash`.

Objetivo: ampliar el sistema de achievements para soportar logros específicos por juego/modo, progreso global, monedas históricas, niveles y recompensas variadas, manteniendo el sistema modular para que futuros logros se agreguen principalmente como objetos de configuración.

Contexto actual:
- Los achievements se definen en:
  `srcs/requirements/backend/src/src/achievements/achievements.constants.ts`
- La evaluación/desbloqueo ocurre en:
  `srcs/requirements/backend/src/src/achievements/achievements.service.ts`
- Los resultados de partida se registran en:
  `srcs/requirements/backend/src/src/game-results/game-results.service.ts`
- El DTO actual de submit result está en:
  `srcs/requirements/backend/src/src/game-results/dto/submit-result.dto.ts`
- El frontend llama:
  `api.submitGameResult(gameId, outcome)`
- La UI de achievements está en:
  `srcs/requirements/frontend/src/src/hub/HubScene.ts`
- Los tipos frontend están duplicados manualmente en:
  `srcs/requirements/frontend/src/src/hub/api.ts`
- Los cosméticos existentes están en:
  `srcs/requirements/backend/src/src/customization/customization.constants.ts`
- Actualmente `rewardCosmeticId` solo desbloquea cosméticos.
- Actualmente `user.coins` representa balance actual, no monedas históricas ganadas.
- Actualmente `dto.gameId` se recibe pero no se usa para estadísticas por juego.
- No necesitamos i18n. Todos los textos pueden quedar hardcodeados en inglés.

Requisitos funcionales:
1. Mantener los achievements definidos en una lista/config central.
2. Soportar achievements globales:
   - total matches played
   - total wins
   - total losses si aplica
   - level milestones
   - total historical coins earned
3. Soportar achievements por juego/modo:
   - matches played por `gameId`
   - wins por `gameId`
   - losses por `gameId` si aplica
4. Soportar achievements sin recompensa.
5. Soportar recompensas de cosméticos existentes:
   - shell skins
   - hub backgrounds
6. Preparar el modelo para recompensas de monedas.
7. Preparar el modelo para recompensas de títulos, preferiblemente integrando `title` como un nuevo tipo de cosmetic/customisation si encaja limpio.
8. No implementar un sistema complejo de i18n ni traducciones.
9. Mantener la UI de achievements dinámica.
10. Mostrar el `rewardLabel` real en la UI, no un texto fijo tipo `Reward: skin`.

Diseño recomendado:
1. Agregar persistencia para estadísticas por juego.

Crear una entidad tipo:

```ts
UserGameStats {
  id: number;
  user: User;
  gameId: string;
  gamesPlayed: number;
  totalWins: number;
  totalLosses: number;
}
Debe tener constraint único por (user, gameId).
2. Actualizar GameResultsService.submitResult() para:
- seguir actualizando stats globales existentes
- actualizar/crear stats por dto.gameId
- incrementar gamesPlayed
- incrementar totalWins o totalLosses
- actualizar monedas, XP y nivel como ahora
- actualizar una nueva métrica histórica de monedas ganadas
3. Agregar totalCoinsEarned.
Preferencia:
- Agregarlo en Profile, porque es una estadística de progreso.
- user.coins debe seguir siendo balance actual.
- profile.totalCoinsEarned debe incrementarse por cada coinsGained.
4. Cambiar el modelo de achievements para recibir un contexto más rico.
Ahora progress e isUnlocked reciben solo User. Cambiar a algo similar:
export interface AchievementContext {
  user: User;
  gameStats: Map<string, UserGameStats>;
}

progress: (ctx: AchievementContext) => { current: number; target: number };
isUnlocked: (ctx: AchievementContext) => boolean;
Esto permite logros globales y por juego sin hardcodear queries dentro de cada achievement.
5. Expandir el modelo de recompensa.
Reemplazar o complementar rewardCosmeticId con algo extensible:
export type AchievementReward =
  | { type: 'cosmetic'; cosmeticId: string; label: string }
  | { type: 'coins'; amount: number; label: string }
  | { type: 'title'; titleId: string; label: string }
  | { type: 'none'; label?: string };
O mantener compatibilidad interna mínima si resulta más barato, pero evitar duplicar conceptos innecesariamente.
6. Actualizar AchievementsService.evaluateForUser() para:
- cargar stats por juego del usuario
- construir AchievementContext
- evaluar todos los achievements
- persistir el unlock
- aplicar la recompensa si existe
Recompensas:
- cosmetic: conceder ownership usando el mecanismo existente de UserCosmetic.
- coins: sumar monedas al usuario y guardar.
- title: si se implementa como cosmetic type, concederlo igual que un cosmético.
- none: solo desbloquear achievement.
Importante:
- Evitar doble concesión si el achievement ya está desbloqueado.
- Mantener manejo de unique constraint para evitar race conditions.
- Si se otorgan monedas, asegurarse de que no se otorguen dos veces.
7. Customization/títulos.
Si se implementan títulos ahora:
- Extender CosmeticType:
export type CosmeticType = 'shell_skin' | 'hub_background' | 'title';
- Agregar campo en User, por ejemplo:
playerTitle: string | null;
- Actualizar CustomizationService.equip() e isEquipped() para soportar title.
- Actualizar tipo frontend Cosmetic.
- Actualizar UI de customization solo lo mínimo necesario para listar/equipar títulos si ya renderiza dinámicamente por cosmetic type. Si no, hacer el cambio mínimo.
Si implementar títulos aumenta mucho el alcance, dejar la estructura de reward preparada pero no agregar títulos reales todavía. En ese caso, documentar el follow-up.
8. Frontend.
Actualizar:
- Achievement interface en hub/api.ts
- Cosmetic type si se agrega title
- HubScene.drawAchievementCard() para mostrar achievement.rewardLabel o achievement.reward.label, según el modelo final.
- Mantener popup de achievements funcionando.
- No rediseñar la UI completa.
Gotcha:
- El modal actual puede desbordar si hay muchos achievements porque no parece tener scroll. Si agregas muchos logros, implementar scroll simple o limitar el cambio y dejar TODO explícito. Preferencia: si el número de logros nuevos es alto, agregar scroll al modal de achievements.
9. Achievements iniciales a agregar.
Agregar una selección razonable, no excesiva, para validar el sistema:
Global:
- first-match: play 1 match
- dojo-regular: play 10 matches
- dojo-veteran: play 50 matches
- first-win: win 1 match
- rising-shell: reach level 2
- seasoned-shell: reach level 5
- first-bounty: earn 1 total coin
- coin-collector: earn 500 total coins
Por juego:
- kame-knock-initiate: play 1 Kame Knock match
- kame-knock-regular: play 10 Kame Knock matches
- bamboo-bash-initiate: play 1 Bamboo Bash match
- bamboo-bash-regular: play 10 Bamboo Bash matches
- shell-curl-initiate: play 1 Shell Curl match
- shell-curl-regular: play 10 Shell Curl matches
Recompensas:
- Algunos sin recompensa.
- Algunos con cosmetic existente.
- Uno con coins si se implementa reward coins.
- Uno con title solo si title customization queda implementado limpiamente.
10. Tests.
Actualizar/agregar tests backend:
- achievements.service.spec.ts
- unlock global achievement
- unlock per-game achievement
- no duplicate reward if already unlocked
- grant cosmetic reward
- grant coins reward si implementado
- game-results.service.spec.ts
- updates global stats
- updates per-game stats
- increments totalCoinsEarned
- calls achievement evaluation with updated user/stats
- customization.service.spec.ts
- title equip si se implementa title
- Agregar tests de entidad/repositorio solo si el patrón del repo ya lo hace.
11. Migraciones / DB.
Revisar cómo está configurado TypeORM.
- Ya existe al menos una migration:
srcs/requirements/backend/src/src/migrations/20260614062701-create-shell-inventory.ts
- Si producción no usa synchronize, agregar migration para:
- crear tabla user_game_stats
- agregar columna total_coins_earned en profiles
- agregar columna player_title en users si se implementan títulos
- No depender solo de synchronize salvo que el repo claramente lo haga para desarrollo.
12. Constraints de implementación.
- Hacer cambios pequeños y coherentes.
- No introducir i18n.
- No reescribir arquitectura innecesariamente.
- Mantener nombres claros y consistentes.
- No romper achievements existentes.
- Evitar backward compatibility innecesaria salvo que haya datos persistidos afectados; si se cambia shape API frontend/backend, actualizar ambos lados.
- Mantener todos los textos en inglés.
- No agregar assets nuevos salvo que sean estrictamente necesarios.
- No tocar unrelated files.
13. Verificación.
Ejecutar los tests relevantes del backend.
Si hay scripts disponibles, usar el comando más específico posible, por ejemplo:
- tests de achievements
- tests de game-results
- tests de customization si se tocó
También ejecutar typecheck/build si existe un comando claro y razonable.
Al finalizar, reportar:
- Archivos modificados
- Qué modelo quedó para agregar nuevos achievements
- Cómo agregar un nuevo achievement global
- Cómo agregar un nuevo achievement por juego
- Qué recompensas quedaron soportadas
- Tests ejecutados y resultado
- Cualquier limitación pendiente

Mi recomendación como criterio de alcance: pedirle al implementador que haga **stats por juego + totalCoinsEarned + rewardLabel real + rewards cosmetic/coins** en esta primera pasada.

Dejaría `title` preparado o implementado solo si encaja fácil dentro de `customization`. Si no, títulos puede ser una segunda PR/tarea porque implica UI/equip/display y puede abrir más superficie de la necesaria

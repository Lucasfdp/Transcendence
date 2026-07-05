Actúa como senior fullstack developer en este repo `ft_transcendence/shellsmash`.

Objetivo:
Mejorar la arquitectura de cosméticos y achievements sin sobrediseñar ni agregar features nuevas. Actualmente los catálogos están hardcodeados, pero ya existe persistencia por usuario para desbloqueos/equipados. Quiero un enfoque pragmático e híbrido: mantener en código la lógica de achievements, pero centralizar mejor los catálogos y asegurar persistencia/migraciones correctas.

Contexto detectado:
- Cosméticos:
  - Catálogo hardcodeado en backend:
    `srcs/requirements/backend/src/src/customization/customization.constants.ts`
  - Servicio:
    `srcs/requirements/backend/src/src/customization/customization.service.ts`
  - Persistencia por usuario:
    `srcs/requirements/backend/src/src/customization/entities/user-cosmetic.entity.ts`
  - Equipados en:
    `srcs/requirements/backend/src/src/users/entities/user.entity.ts`
    columnas `shellSkin`, `hubBackground`
  - Frontend consume `GET /customization`, pero todavía tiene datos visuales duplicados en:
    `srcs/requirements/frontend/src/src/shared/cosmetics.ts`
    `srcs/requirements/frontend/src/src/hub/HubScene.ts`

- Achievements:
  - Catálogo y lógica hardcodeados en:
    `srcs/requirements/backend/src/src/achievements/achievements.constants.ts`
  - Servicio:
    `srcs/requirements/backend/src/src/achievements/achievements.service.ts`
  - Persistencia por usuario:
    `srcs/requirements/backend/src/src/achievements/entities/user-achievement.entity.ts`
  - Frontend consume `GET /achievements`
  - El progreso se calcula desde `profiles`, `users.level` y `user_game_stats`.

Problema principal:
- Hay hardcoding válido, pero falta una separación clara entre:
  1. Catálogo/metadata.
  2. Lógica de desbloqueo/progreso.
  3. Estado persistido por usuario.
- Parece que no existen migraciones explícitas para `user_cosmetics` y `user_achievements`, lo cual puede romper en producción si `synchronize` está desactivado.
- Hay duplicación frontend/backend para algunos datos visuales de cosméticos.

Scope estricto:
1. No crear un panel admin.
2. No crear una base de datos separada.
3. No rediseñar todo el sistema de inventario.
4. No cambiar reglas de juego ni condiciones existentes de achievements salvo que sea necesario para tipado/estructura.
5. No introducir features nuevas como badges, avatars, banners, emotes o titles si no existen funcionalmente.
6. No cambiar UX salvo lo mínimo necesario para consumir datos centralizados correctamente.
7. No agregar dependencias nuevas salvo necesidad justificada.

Implementación deseada:

1. Backend: migraciones faltantes
   - Verificar si existen migraciones para:
     - `user_cosmetics`
     - `user_achievements`
   - Si no existen, crear migraciones TypeORM explícitas para esas tablas.
   - Las migraciones deben reflejar las entidades actuales.
   - Incluir índices/constraints razonables:
     - `userId`
     - `cosmeticId` o `achievementId`
     - unicidad por usuario + id de item, si todavía no existe.
   - No depender de `synchronize`.

2. Backend: catálogo de cosméticos
   - Mantener el catálogo en código por ahora, pero convertirlo en una fuente backend clara y completa.
   - Asegurar que cada cosmético tenga toda la metadata necesaria para que el frontend no tenga que duplicar información:
     - `id`
     - `type`
     - `name`
     - `description`
     - `price`
     - `unlockRequirement` si aplica
     - datos visuales mínimos necesarios para render/preview, por ejemplo colour/theme/background si ya se usan en frontend.
   - No mover cosméticos a DB todavía, salvo que el código actual lo haga muy costoso. La solución preferida es catálogo centralizado en backend.

3. Frontend: eliminar duplicación innecesaria de cosméticos
   - Revisar `shared/cosmetics.ts` y el modal de customisation en `HubScene.ts`.
   - Si hay colores/previews hardcodeados que pueden venir desde `GET /customization`, moverlos al contrato del backend.
   - Actualizar tipos en:
     `srcs/requirements/frontend/src/src/hub/api.ts`
   - Mantener fallbacks simples solo si son necesarios para evitar crasheos, pero evitar duplicar el catálogo completo en frontend.

4. Achievements: mantener lógica en código
   - No mover condiciones de achievements a DB.
   - Mantener `isUnlocked` y `progress` en backend.
   - Si hace falta, separar mejor metadata de lógica dentro de `achievements.constants.ts`, pero sin crear una arquitectura grande.
   - Confirmar que rewards que referencian cosméticos validen contra el catálogo existente o al menos no queden inconsistentes.
   - No cambiar IDs existentes de achievements ni cosmetics para no romper datos persistidos.

5. Validaciones
   - En `CustomizationService`, asegurar que:
     - no se pueda comprar/equipar un cosmético inexistente;
     - no se pueda equipar un cosmético no desbloqueado;
     - las rewards de achievements que desbloquean cosméticos usen IDs válidos.
   - En `AchievementsService`, asegurar que:
     - no se creen duplicados de unlocks;
     - el reward se aplique solo una vez;
     - el progreso/listado siga funcionando igual para usuarios existentes.

6. Tests/verificación
   - Ejecutar checks disponibles del proyecto:
     - tests backend si existen;
     - build backend;
     - build frontend;
     - lint/typecheck si están configurados.
   - Si algún comando no existe o falla por entorno, reportarlo claramente.
   - No inventar tests excesivos. Agregar tests solo si ya existe infraestructura clara y son de bajo coste.
   - Como mínimo, verificar manualmente mediante lectura/compilación que:
     - `GET /customization` sigue devolviendo catálogo + estado de usuario;
     - `GET /achievements` sigue devolviendo catálogo + estado/progreso;
     - compra/equip de cosméticos no rompe;
     - unlock de achievement con reward cosmético sigue funcionando.

Criterios de aceptación:
- Existen migraciones explícitas para `user_cosmetics` y `user_achievements` si faltaban.
- El backend sigue siendo la fuente de verdad para cosméticos.
- El frontend no mantiene un catálogo duplicado de cosméticos cuando esos datos pueden venir del backend.
- Achievements mantienen su lógica en código, sin migrar condiciones a DB.
- No se cambian IDs persistidos.
- No se agregan features fuera de scope.
- La app compila o se reportan claramente los bloqueos.
- La implementación es mínima, legible y consistente con el estilo actual del repo.

Antes de editar:
1. Inspecciona los archivos relevantes y confirma el estado real.
2. Si descubres que ya existen migraciones o que el contrato API ya incluye los datos necesarios, no dupliques trabajo.
3. Si aparece una decisión grande fuera de este scope, detente y pregunta.

Entrega final esperada:
- Resumen breve de cambios.
- Archivos modificados.
- Comandos ejecutados y resultado.
- Riesgos pendientes o decisiones que quedan para después.

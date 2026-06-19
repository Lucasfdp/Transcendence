Implementa fondos vectoriales preset desbloqueables/equipables para el Hub desde la pantalla de customization.

Contexto:
- El fondo del Hub se dibuja actualmente de forma procedural/vectorial en Phaser dentro de:
  srcs/requirements/frontend/src/src/hub/HubScene.ts
- La función relevante es drawBackground(), que dibuja el fondo actual completo.
- Actualmente existe un sistema de customization/cosmetics para shell skins.
- Backend relevante:
  srcs/requirements/backend/src/src/customization/customization.constants.ts
  srcs/requirements/backend/src/src/customization/customization.service.ts
  srcs/requirements/backend/src/src/users/entities/user.entity.ts
- Frontend API/types relevante:
  srcs/requirements/frontend/src/src/hub/api.ts
- El objetivo NO es permitir dibujo libre por parte del usuario.
- El objetivo es que nosotros definamos varios fondos vectoriales preset, que el usuario pueda desbloquear mediante achievements u otros mecanismos, y equipar desde customization.

Objetivo principal:
Añadir un nuevo tipo de cosmetic llamado hub_background, persistir el fondo equipado en el usuario y hacer que HubScene dibuje un preset vectorial distinto según el fondo equipado.

Requisitos funcionales:
1. Mantener el fondo actual como preset default, por ejemplo:
   - default_dojo
2. Añadir al menos un segundo preset vectorial simple para validar el sistema, por ejemplo:
   - sunset_dojo
3. Preparar la arquitectura para añadir más presets después:
   - snow_dojo
   - cyber_dojo
   - champion_dojo
4. Permitir equipar fondos desde el modal/panel de customization.
5. Los fondos deben comportarse como cosmetics normales:
   - aparecen en customization;
   - solo se pueden equipar si el usuario los tiene/desbloqueó;
   - el estado equipado se refleja correctamente;
   - se persisten en backend.
6. No integrar todavía la lógica completa de achievements si no existe un sistema claro para ello.
   - Dejar el modelo preparado para que achievements puedan desbloquear cosmetics en el futuro.
   - Si ya existe un mecanismo de unlock/ownership, reutilizarlo.

Plan técnico backend:
1. Extender CosmeticType:
   - de 'shell_skin'
   - a 'shell_skin' | 'hub_background'
2. Añadir nuevos cosmetics en el catálogo:
   - default_dojo como fondo base.
   - sunset_dojo como fondo adicional.
3. Añadir una columna/campo persistido en User:
   - hubBackground
   - default: 'default_dojo'
4. Actualizar CustomizationService.equip():
   - si cosmetic.type === 'shell_skin', actualizar user.shellSkin.
   - si cosmetic.type === 'hub_background', actualizar user.hubBackground.
5. Actualizar CustomizationService.toViews():
   - marcar equipped comparando por tipo:
     - shell_skin contra user.shellSkin.
     - hub_background contra user.hubBackground.
6. Mantener compatibilidad con el flujo actual de compra/equipado.
7. Añadir o actualizar tests backend si el proyecto ya tiene tests para customization:
   - equipar shell_skin sigue funcionando.
   - equipar hub_background funciona.
   - equipped se calcula correctamente para ambos tipos.

Plan técnico frontend:
1. Actualizar tipos en hub/api.ts:
   - User debe incluir hubBackground.
   - Cosmetic.type debe aceptar 'hub_background'.
2. Refactorizar HubScene.ts:
   - convertir drawBackground() en un dispatcher por preset.
   - mantener el dibujo actual como drawDefaultDojoBackground() o equivalente.
   - añadir drawSunsetDojoBackground() reutilizando la misma geometría base.
3. El método principal debe usar algo como:
   - this.user.hubBackground ?? 'default_dojo'
4. Todos los presets deben respetar:
   - resolución lógica 1080x1080;
   - composición general del Hub;
   - zonas visuales donde están los hotspots/botones;
   - escala/resize actual.
5. Actualizar el modal de customization:
   - agrupar cosméticos por categoría, mínimo:
     - Shell Skins
     - Hub Backgrounds
   - permitir equipar ambos tipos.
6. Cuando el usuario equipe un hub_background:
   - actualizar this.user.hubBackground;
   - actualizar registry si actualmente se usa para estado de usuario;
   - redibujar el fondo inmediatamente sin reiniciar toda la escena si es simple;
   - si redibujar in-place es arriesgado, hacer refresh controlado de la escena.
7. Evitar introducir imágenes/assets para estos fondos; deben seguir siendo dibujos Phaser vectoriales/procedurales.

Diseño de presets:
- default_dojo:
  - debe ser exactamente el fondo actual, salvo refactor mínimo.
- sunset_dojo:
  - reutilizar montañas/camino/faroles/base layout.
  - cambiar paleta a cielo naranja/morado.
  - cambiar luna por sol bajo o glow cálido.
  - ajustar niebla/luces para ambiente atardecer.
  - no mover hotspots ni elementos estructurales importantes.

Criterios de aceptación:
1. El Hub carga con default_dojo por defecto.
2. Desde customization se ve una categoría/sección de Hub Backgrounds.
3. El usuario puede equipar un fondo hub_background desbloqueado.
4. Al equiparlo, el fondo del Hub cambia visualmente.
5. Al recargar/reentrar, el fondo equipado persiste.
6. Las shell skins siguen funcionando como antes.
7. El fondo sigue escalando correctamente en resize.
8. No se rompen los hotspots/click targets del Hub.
9. El código queda preparado para añadir nuevos presets con poco esfuerzo.

Restricciones:
- Hacer cambios mínimos y localizados.
- No reescribir el Hub completo.
- No introducir sistemas genéricos innecesarios.
- No añadir compatibilidad legacy salvo que haya datos persistidos que lo requieran.
- Preferir una implementación simple con switch/record de presets antes que abstracciones complejas.
- Mantener el estilo existente del proyecto.

Orden recomendado de implementación:
1. Revisar cómo se modelan User, Cosmetic y customization actualmente.
2. Implementar backend: CosmeticType, catálogo, user.hubBackground, equip(), toViews().
3. Actualizar frontend API/types.
4. Refactorizar drawBackground() conservando el fondo actual como default_dojo.
5. Añadir sunset_dojo como segundo preset.
6. Actualizar customization UI para mostrar/equipar hub_background.
7. Verificar manualmente:
   - login/entrada al Hub;
   - cambio de fondo;
   - persistencia;
   - resize;
   - shell skins.
8. Ejecutar tests/lint/build disponibles.
9. Documentar brevemente dónde añadir nuevos fondos en el futuro.
Mi recomendación como enfoque senior: primero validar todo el flujo con solo default_dojo y sunset_dojo. Una vez que eso esté sólido, añadir snow_dojo, cyber_dojo y champion_dojo es trabajo incremental de diseño visual, no de arquitectura.

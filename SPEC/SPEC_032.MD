# SPEC-032 — Proceso de Desarrollo, Integración y Calidad

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-001 → SPEC-031

Consolida las antiguas SPEC-032 (Responsibility Matrix), SPEC-033 (Integration Protocol), SPEC-034 (Coding Standards) y SPEC-035 (Quality Gates), que quedan fusionadas aquí.

---

# Contexto real

Este proyecto lo desarrolla una persona con Claude Code (Arquitecto orquestador + subagentes, SPEC-036), sobre `main`, sin CI automática.

El proceso debe servir a esa realidad: pocas reglas, todas aplicables.

---

# Dominios de trabajo

Los dominios agrupan responsabilidades para acotar el contexto de cada subagente. Son una guía de asignación, no muros infranqueables: la mayoría de features cruzan dominios y eso es esperable.

- Runtime: Tournament Runtime, State Machine, Turn Flow, Match Lifecycle.
- Board: Board, Tiles, Movement.
- Gameplay: Dice, Random Events, Boss, Final Challenge, Key Items.
- Economy: Economy, Shop, Inventory, Rewards, Leaderboard.
- Integration: Minigame Integration, Gambling Integration, costuras con servicios existentes.
- Infrastructure: Configuration, Registries, Logging, Analytics.
- Networking: Sincronización, Snapshots, Reconexión.
- Frontend: HUD, Board UI, Shop UI, Inventory UI, Animations, Audio, FX. Nunca implementa lógica de juego.
- QA: Tests de todos los niveles. Nunca corrige gameplay: informa al dominio responsable.

Reglas:

- Cada tarea tiene un dominio principal. Si toca contratos públicos de otro dominio, lo revisa el Arquitecto.
- Los sistemas existentes de la plataforma (matchmaking, minijuegos, casino, amigos, networking) NO se modifican, salvo las ampliaciones mínimas de costuras autorizadas en SPEC-037, siempre con aprobación del Arquitecto.
- Comunicación entre dominios: exclusivamente APIs públicas, eventos (SPEC-004), Registries y configuración.

---

# Contratos públicos

Se consideran contratos públicos: definiciones de eventos, interfaces públicas, Intents, APIs de Runtime y Registries, esquemas de configuración, y los contratos WS/REST del módulo.

No se modifican sin aprobación del Arquitecto. Las implementaciones internas sí pueden cambiar libremente.

---

# Integración

- Integración incremental: bloques pequeños y autocontenidos. Nunca merges masivos.
- Cada integración deja el proyecto compilando y con los tests en verde.
- Sin CI: antes de cada merge es obligatorio ejecutar localmente `cd backend && npm run test` (y los Simulation Tests cuando existan, SPEC-028).
- Toda integración debe poder revertirse completamente.
- Si dos tareas tocan el mismo sistema: detener, resolver con el Arquitecto, nunca continuar en paralelo.
- Antes de cada merge que toque contratos WS: ejecutar el script de comprobación estructural del espejo front/back de tipos WS (`scripts/`, SPEC-037).
- Cada merge indica: SPECs implementadas, sistemas modificados, contratos afectados.

---

# Estándares de código

- Seguir el estilo existente del repositorio (tabs, convenciones NestJS/React descritas en `CLAUDE.md` y `AGENTS.md`).
- Composición e interfaces antes que herencia profunda.
- Responsabilidad única por clase y por función.
- Eventos: nombre claro, hecho ya ocurrido, inmutable.
- Errores: nunca silenciarlos; registrar con contexto (Logging, SPEC-027) y mantener el Runtime consistente.
- No optimizar prematuramente: corrección → legibilidad → optimización con métricas.
- Si una implementación requiere romper la arquitectura o aparece una mejora estructural: detener, documentar, escalar al Arquitecto. Nunca cambios estructurales unilaterales.

Convenciones de nomenclatura:

- Eventos: PascalCase, hecho en pasado (PlayerMoved, ItemPurchased); las peticiones sin resultado usan el sufijo `*Requested`. Cada evento tiene exactamente un propietario-emisor (catálogo canónico, SPEC-004).
- Intents de cliente: sufijo `*Intent`.
- Actions (incluidos los Item Effects): sufijo `*Action` en el ActionRegistry (SPEC-007, SPEC-008).
- Rules: sufijo `*Rule`. Rewards: sufijo `*Reward`. Registries: sufijo `*Registry`.
- Comandos de API pública: verbos imperativos (Economy.Award/Remove/Transfer, Board.movePlayer/teleportPlayer).
- Servicios NestJS: sufijo `*Service`.
- Handlers WebSocket: prefijo `tournament:*`.
- Estados de la State Machine: UPPER_SNAKE_CASE (SPEC-003).
- IDs de catálogo: snake_case con prefijo de tipo (item_lucky_dice, tile_random_event).

Prohibido:

- Hardcodear reglas de juego (viven en catálogos, SPEC-024).
- Duplicar sistemas existentes.
- Implementar mutaciones como listeners cuando el emisor necesita el resultado (regla comandos/eventos de SPEC-004).
- Acceder al estado interno de otro sistema.
- Dependencias circulares.
- Lógica de negocio en UI o en configuración.

---

# Definition of Done

Una tarea está terminada únicamente cuando:

- Compila y todos los tests pasan (con tests nuevos donde corresponde; todo bug corregido añade un test de regresión).
- Respeta las SPECs aplicables: sin hardcode, sin duplicación, sin aumentar acoplamiento, sin dependencias circulares.
- No rompe contratos públicos; toda API nueva está documentada.
- El contenido configurable vive en catálogos validados (IDs únicos, referencias resueltas).
- Todas las Intents se validan en servidor; el cliente nunca puede modificar el estado oficial.
- Los errores relevantes se registran con contexto suficiente.
- La documentación afectada está actualizada (incluido `docs/modules-progress.md` cuando aplique, regla de `CLAUDE.md`).

"Funciona" no significa "terminado".

---

# Criterios de rechazo automático

Una implementación se rechaza si: duplica un sistema existente, rompe una SPEC, introduce lógica en la UI, accede al estado interno de otro sistema, añade dependencias circulares, elimina tests sin justificación o introduce deuda técnica deliberada.

---

# Auditoría de fase

Antes de cerrar cada fase de SPEC-031: revisión arquitectónica completa (coherencia, cumplimiento de SPECs, cobertura de los flujos principales).

---

# Criterios de aceptación

✓ Cada tarea tiene un dominio y un responsable claros.

✓ Los contratos públicos permanecen estables.

✓ El proyecto compila y pasa tests tras cada merge.

✓ Existe una única Definition of Done para todo el proyecto.

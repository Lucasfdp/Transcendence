# Tournament — Implementation Roadmap (v1)

Fecha: 2026-07-13 · Autor: Arquitecto (Claude) · Fuente de verdad: `SPEC/` (congelada; SPEC-031 define las fases oficiales)

Este documento es el plan operativo del Arquitecto: convierte SPEC-031 en tareas, subagentes, dependencias y checkpoints. No redefine arquitectura. Ante conflicto, prevalecen las SPECs.

> **Estado de ejecución** (act. 2026-07-14):
> - **F0 Grounding — COMPLETA.** Módulo, entidades, migración, contratos WS/REST congelados + espejo front + script de drift, y flujo entrada/lobby SPEC-038.
> - **F1 Core Runtime — COMPLETA.** Event Bus (004), State Machine (003), Registry (025), Configuration (024), Logger con contexto (027) y reloj inyectable (028); Runtime vacío (001) + Match Lifecycle (023) con snapshot-por-transición, mapeo fase→status, handoff desde el lobby y hardening de concurrencia (lock pesimista en join/start). Checkpoint cumplido: torneo vacío recorre CREATED→FINISHED (DEFEAT en `maxRound`) reproducible con seed.
> - **F2 Motores — COMPLETA.** Los seis motores construidos y revisados contra sus SPECs: Economy (011), Rule Engine (009, 5 modificadores), Leaderboard (018), Action Engine + Registry/Factory (008), Inventory + Item Framework (014/007), Reward Resolver (013). Integración en el Runtime (`runtime/tournament-engines.ts`): se construyen por-torneo, se cablean las costuras diferidas (adaptador Rule→Economy `RewardRuleApplier`; bundle `ActionServices` {economy, rules, inventory}; un único runner sobre el Action Engine que satisface `ItemEffectRunner` + `RewardActionRunner`; `GrantItemAction` que estrecha `InventoryPort`) y se serializan en el snapshot del Runtime. `inventoryCapacity` añadido a settings (024). **Checkpoint cumplido:** una Reward compuesta (puntos+item) acredita el wallet y llena el inventario end-to-end a través del único Action Engine (`tournament-engines.spec.ts`). Suite backend 1085 verde; `tsc` limpio; drift de contratos verde.
> - **Siguiente: F3 Gameplay Base** (board+tiles ∥ dice → turn-system).

---

## 1. Estado de partida

- 41 SPECs leídas y reconciliadas (D1–D13 resueltas en SPEC-040). Sin decisiones abiertas bloqueantes salvo las diferidas: sesión de contenido (D11, inicio Fase 6) y balance con simulador (D2, Fase 8).
- Costuras de plataforma verificadas en `main`: `MatchFactoryService`, `MatchLifecycleEvents`, `PrivateLobbiesService` (molde PIN), `casino/casino.fair.ts`, `NotificationsService`, `achievements`, `frontend/src/features/`.
- No existe `backend/src/modules/tournaments/` ni `frontend/src/features/tournaments/`: greenfield dentro de las fronteras de SPEC-037.

## 2. Fases (SPEC-031, con hitos de validación)

| Fase | Contenido | SPECs núcleo | Resultado verificable |
|---|---|---|---|
| **F0 Grounding** | Auditoría de costuras; módulo `tournaments/` + entidades + migración; archivo único de contratos WS `tournament:*` + espejo front + script de verificación; REST de entrada/lobby | 037, 038, 022 (contratos), 024 (esqueleto settings) | El esqueleto persiste y expone un Tournament vacío (crear lobby por REST, sobrevive a refresh) |
| **F1 Core Runtime** | Event Bus, Registry Framework, Configuration, State Machine, Runtime orquestador, Match Lifecycle (sesión + snapshot en BD + cancelación al boot), Logging con contexto, reloj/scheduler inyectable | 001, 003, 004, 023, 024, 025, 027, 028 (timers) | Un Tournament recorre CREATED→FINISHED con fases vacías, persistiendo snapshot tras cada transición; reproducible con seed |
| **F2 Motores** | Economy, Rule Engine (5 modificadores), Action Engine + ActionRegistry, Reward Resolver, Inventory, Leaderboard | 006–009, 011, 013, 014, 018 | Motores aislados con tests unitarios + integración (Shop-less): Award/Remove/Transfer, reglas componibles, rewards→actions |
| **F3 Gameplay Base** | Board + Tiles (sucesor único), Dice (listas de números + seed), Turn System (timeouts, auto-resolución), catálogo Board v1 placeholder | 002, 005, 006, 010, 024 | Una ronda completa de turnos de tablero jugable por simulación (sin UI) |
| **HITO Vertical Slice** | Networking snapshot-first (`seq`, Intents, salas) + UI mínima provisional (tablero esquemático + dado + HUD) | 022, 039 (mínimo) | Verificable en navegador con `make dev`: 4 jugadores tiran dado y se mueven |
| **F4 Progresión Principal** | Minigame Integration (watchdog 10 min, casual, activos), Gambling Integration (provably-fair + pity), Key Item Progression | 015, 016, 017 | Ronda→minijuego→gambling→Key Items funciona end-to-end. **GATE D9** |
| **F5 Final de partida** | Boss, Final Challenge (muerte súbita), VICTORY/DEFEAT/REWARDS, premios persistentes (500 monedas + logro) | 020, 021, 037 (rewards), 018 (final) | Ciclo completo de principio a fin, incluidas derrota colectiva y cancelación |
| **F6 Contenido Secundario** | Shop (ventana de interacción), Items + Effects (dados alternativos, escudo…), Random Events, Steal. **Sesión de contenido con el usuario al inicio (D11)** | 012, 019, 006 (steal), 007, 024 | Bucle enriquecido; el juego ya era completable sin esta fase |
| **F7 Frontend** | Escena Phaser del tablero, HUD, tienda, inventario, gambling espectador, boss FX, clasificación final, reconexión | 039, 022, 037 | Modo completamente jugable con presentación |
| **F8 Calidad** | Simulador (miles de partidas, balance D2), Analytics/Prometheus, performance, E2E, bug fixing | 026, 028, 029 | Release candidate |

## 3. Grafo de dependencias

```
F0 ──► F1 ──► F2 ──► F3 ──► [Vertical Slice] ──► F4 ──► F5 ──► F7 ──► F8
                      │                            ▲              ▲
                      └────────► F6 ───────────────┼──────────────┘
                                                   │
              [EXTERNO] Estabilización netcode arena (D9) ──gate──┘
```

- Dentro de F1: `EventBus ∥ Registry ∥ Logging` → `Configuration` (usa Registry) → `StateMachine` (usa EventBus) → `Runtime + MatchLifecycle` (usa todo).
- Dentro de F2: `Economy ∥ RuleEngine` → `ActionEngine` (consume contratos de ambos vía Services) → `Inventory` → `RewardResolver`; `Leaderboard` solo escucha `WalletUpdated` (paralelo desde que Economy existe).
- Dentro de F3: `Dice` (necesita RuleEngine) ∥ `Board` (necesita ActionEngine) → `TurnSystem` (necesita ambos + StateMachine).
- F6 depende de F2+F3, **no** de F4/F5: puede solaparse con F4 si el gate D9 retrasa.
- F7 consume contratos WS estables (F0) y eventos de todas las fases; su arranque real requiere F5 (o F4 para pantallas parciales).

## 4. Gates y riesgos

1. **GATE D9 (externo, decide el usuario):** F4 no comienza hasta que el netcode de arena (`c426caad`) produzca resultados fiables. F0–F3+F6 no dependen de él.
2. **Determinismo no retrofiteable:** RNG con seed y reloj/scheduler inyectable se construyen en F1 (SPEC-028). Cualquier `setTimeout` directo o `Math.random` en motores = rechazo.
3. **Espejo de tipos WS front/back:** mitigado en F0 con archivo único + script de comprobación estructural en `scripts/` (checklist de merge, SPEC-032).
4. **Disciplina de eventos:** un solo propietario-emisor por evento (catálogo SPEC-004). Se revisa en cada merge.
5. **Sin CI:** gate local obligatorio `cd backend && npm run test` antes de cada merge; front se valida con `make dev` (nunca tsc suelto).
6. **Balance económico:** cifras provisionales (SPEC-024); la propiedad "el bucle cierra sobre el papel" se revalida en cada cambio y se afina con el simulador en F8.
7. **Contenido placeholder hasta F6 (D11):** ninguna fase anterior puede introducir temática hardcodeada.

## 5. Roster de subagentes

Regla: un dominio por agente, contexto mínimo, brief con Objetivo/Contexto/SPECs/archivos permitidos y prohibidos/criterios/DoD/dependencias/outputs. Ningún agente genérico.

| # | Subagente | Fase | Razón de existir | Paraleliza con |
|---|---|---|---|---|
| 1 | `seams-auditor` (read-only) | F0 | Verificar APIs reales de MatchFactory/Lifecycle/fair/PrivateLobbies y cobertura 2–4 jugadores del catálogo de minijuegos antes de escribir nada | 2 |
| 2 | `persistence-skeleton` | F0 | Módulo Nest + entidades + migración + reconciliación onModuleInit (SPEC-037) | 1 |
| 3 | `ws-rest-contracts` | F0 | Archivo único de tipos WS + DTOs REST + espejo front + script de verificación (contratos públicos: los congela el Arquitecto) | — (tras 1,2) |
| 4 | `entry-lobby` | F0 | REST + servicio de lobby con PIN e invitaciones (SPEC-038), molde PrivateLobbies | — (tras 3) |
| 5 | `event-bus` | F1 | Emisor tipado por partida, orden garantizado, aislamiento de errores | 6,7 |
| 6 | `registry-config` | F1 | Registry<T> genérico + catálogos TS + validación al boot (SPEC-024/025) | 5,7 |
| 7 | `logging-clock` | F1 | Logger con contexto de torneo + reloj/scheduler inyectable (testabilidad) | 5,6 |
| 8 | `state-machine` | F1 | Interfaz TournamentState + grafo canónico + serialización | — (tras 5) |
| 9 | `runtime-lifecycle` | F1 | Orquestador + máquina de sesión + snapshot en BD + cancelación al boot | — (tras 6,7,8) |
| 10 | `economy` | F2 | Wallets, transacciones, Award/Remove/Transfer, WalletUpdated | 11 |
| 11 | `rule-engine` | F2 | 5 puntos de consulta, prioridad/composición, duraciones | 10 |
| 12 | `action-engine` | F2 | IAction, ActionRegistry, ActionContext.Services, Actions base sin dependencias de F3 | — (tras 10,11) |
| 13 | `inventory` | F2 | Slots, instancias únicas, consumo vía Action Engine | — (tras 12) |
| 14 | `reward-resolver` | F2 | Traducción Reward→Actions, CompositeReward | — (tras 12,13) |
| 15 | `leaderboard` | F2 | Proyección derivada de WalletUpdated, empates compartidos | — (tras 10) |
| 16 | `board-tiles` | F3 | Estado del tablero, movimiento, resolución de Tile, anti-bucle teleport | 17 |
| 17 | `dice` | F3 | Listas de números, seed, integración DiceModifier | 16 |
| 18 | `turn-system` | F3 | Turno cerrado, timeouts, auto-resolución, ventana de interacción | — (tras 16,17) |
| 19 | `networking-sync` | Slice | Snapshot-first con `seq`, Intents validadas, salas por torneo | 20 |
| 20 | `slice-ui` | Slice | UI mínima provisional (tablero esquemático + dado + HUD) verificable con `make dev` | 19 |
| 21 | `minigame-integration` | F4 | MatchFactory casual, espera por eventos + watchdog + reconciliación | 22 |
| 22 | `gambling-integration` | F4 | Primitivas provably-fair sobre puntos, pity, timeout 30 s, espectadores | 21 |
| 23 | `key-items` | F4 | Progresión global, único emisor de KeyItemUnlocked | — (tras 21,22) |
| 24 | `boss` | F5 | Spawn, intro, Boss Rules vía Rule Engine | 25 parcial |
| 25 | `final-challenge` | F5 | Muerte súbita reutilizando pipeline de SPEC-015 | — (tras 24) |
| 26 | `persistent-rewards` | F5 | 500 monedas lockUserForUpdate + logro; DEFEAT sin premio | 24,25 |
| 27 | `shop` | F6 | Offers, sesión de interacción, Key Item Offer | 28,29 |
| 28 | `items-content` | F6 | Items/Effects v1 (dados alternativos, escudo…) como catálogo | 27,29 |
| 29 | `random-events-steal` | F6 | Random Events ponderados con seed + AttemptStealAction | 27,28 |
| 30 | `frontend-*` (board-scene, hud, shop-ui, inventory-ui, gambling-ui, boss-final-ui, connection-ux) | F7 | Un agente por superficie del inventario de SPEC-039 | entre sí, por superficie |
| 31 | `simulator-balance` | F8 | Miles de partidas con seeds, balance D2, detección de bloqueos | 32,33 |
| 32 | `analytics` | F8 | Listeners → Prometheus/Grafana existentes | 31,33 |
| 33 | `qa-e2e` | F8 | Casos obligatorios de SPEC-028, regresiones | 31,32 |

QA transversal: cada agente entrega sus tests (DoD de SPEC-032); `qa-e2e` cubre lo interdominio.

## 6. Orden de ejecución estimado

1. **F0** — olas: (1∥2) → 3 → 4. Auditoría de fase → merge.
2. **F1** — olas: (5∥6∥7) → 8 → 9. Checkpoint: partida vacía reproducible con seed.
3. **F2** — olas: (10∥11) → 12 → (13∥15) → 14. Checkpoint: integración Reward→Inventory/Economy en verde.
4. **F3** — olas: (16∥17) → 18. Checkpoint: ronda simulada completa sin UI.
5. **Slice** — (19∥20). Checkpoint en navegador (`make dev`).
6. **F4** — cuando el usuario confirme el gate D9: (21∥22) → 23. Si el gate se retrasa, adelantar F6.
7. **F5** — (24∥26) → 25. Checkpoint: E2E completo VICTORY + DEFEAT + CANCELLED.
8. **F6** — sesión de contenido (D11) → (27∥28∥29).
9. **F7** — agentes por superficie en paralelo tras congelar contratos de presentación.
10. **F8** — (31∥32∥33) → release candidate.

## 7. Protocolo de cada fase

1. El Arquitecto redacta los briefs y lanza la ola.
2. Cada entrega vuelve al Arquitecto: revisión contra SPECs (criterios de rechazo de SPEC-032) antes de integrar.
3. Gate local de tests antes de cada merge; script de espejo WS si tocó contratos.
4. Auditoría de fase (SPEC-032) antes de abrir la siguiente.
5. Toda duda funcional → SPEC-040; toda mejora estructural → ADR y espera de aprobación.

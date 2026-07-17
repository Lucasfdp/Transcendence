# SPEC-040 — Decisiones Abiertas

Status: LIVING DOCUMENT — decisiones D1–D12 RESUELTAS el 2026-07-13; D13 añadida como defaults provisionales en el Reconciliation Pass (2026-07-13)

Priority: CRITICAL

---

# Propósito

Registro único de las decisiones de diseño del usuario.

Regla de SPEC-000: ningún subagente resuelve estos puntos por su cuenta. Al reabrir o añadir una decisión, registrarla aquí; al cerrarla, actualizar las SPECs afectadas en la misma tarea.

---

# D1 — Robo (Steal) — RESUELTA (2026-07-13)

Decisión: robo automático a una víctima aleatoria (RNG con seed) con puntos > 0; cantidad fija (25); si el saldo es menor se transfiere lo disponible; StealPrevention lo bloquea.

Aplicado en: SPEC-006, SPEC-011, SPEC-024.

---

# D2 — Números del bucle económico — RESUELTA (2026-07-13)

Decisión: cifras provisionales para desarrollo (SPEC-024); el simulador de SPEC-028 las afinará en la fase de Calidad.

Valores: 100 iniciales / minijuego 50 ganador + 15 resto / gambling 120 al 40% base con pity +5% / offer Key Item 500 / robo 25 / dados chiquito 20, grande 60, OP 150.

Propiedad a preservar: el bucle debe cerrar sobre el papel — quien gana minijuegos costea apuestas en pocas rondas.

Aplicado en: SPEC-024.

---

# D3 — Anti-estancamiento — RESUELTA (2026-07-13)

Decisión: pity (probabilidad de gambling +5% por ronda completada sin Key Item nuevo, reset a base al desbloquear) Y ADEMÁS derrota colectiva en la ronda máxima: si se llega a la ronda 15 sin los 4 Key Items, la partida termina y PIERDEN TODOS — nadie obtiene la Shell, `winnerUserId` nulo, leaderboard final solo por puntos, sin premios persistentes.

Consecuencia estructural: nuevo estado terminal DEFEAT en la máquina de estados; la invariante pasa a "existe como máximo un ganador".

Aplicado en: SPEC-001, SPEC-003, SPEC-016, SPEC-018, SPEC-023, SPEC-024, SPEC-037.

---

# D4 — Puntos del minijuego de ronda — RESUELTA (2026-07-13)

Decisión: todos los participantes activos cobran según outcome — ganador 50, resto 15, pasivos/desconectados 0. Costes ajustados para compensar la inflación (gambling 120, offer 500).

Aplicado en: SPEC-001, SPEC-015, SPEC-024.

---

# D5 — Modo de las partidas de minijuego — RESUELTA (2026-07-13)

Decisión: `casual`. Nunca afectan al ELO. XP/monedas por partida se cobran mediante el flujo existente.

Aplicado en: SPEC-015, SPEC-037.

---

# D6 — Cumplimiento del módulo del subject — RESUELTA (2026-07-13)

Decisión: el board mode ES el tournament — se defiende con registro de participantes (lobby) y orden de juego visible antes y durante la partida. No se implementa bracket adicional.

Aplicado en: SPEC-038.

---

# D7 — Entrada: PIN y cola pública — RESUELTA (2026-07-13)

Decisión: invitación de amigos + PIN de 6 caracteres (molde `PrivateLobbiesService`). Cola pública: futuro.

Aplicado en: SPEC-038.

---

# D8 — Dados y movimiento — RESUELTA (2026-07-13)

Decisión sobre dados: un dado es una LISTA DE NÚMEROS, todas las caras equiprobables. Sin pesos (el sesgo se expresa repitiendo números), sin caras especiales, sin Actions en caras. Los efectos vienen de Items/Rules.

Dados v1: Normal [1–6] por defecto; Chiquito [1–3], Grande [4–6], OP [6–10] como Items consumibles de tienda (1 tirada, se usan antes de tirar).

Aplicado en: SPEC-010 (reescrita), SPEC-007, SPEC-024.

Defaults provisionales asociados (aplicados, revisables): tras un Teleport la casilla de destino SIEMPRE se resuelve, con límite anti-bucle de un salto encadenado (SPEC-002); MovementInterrupted eliminado de v1 (SPEC-002).

---

# D9 — Estabilización del netcode de arena — RESUELTA (2026-07-13)

Decisión: las Fases 0–3 del Tournament avanzan en paralelo a la estabilización del netcode (trabajo externo al plan). La Fase 4 (Progresión Principal) no comienza hasta que los minijuegos sean fiables.

Aplicado en: SPEC-031.

---

# D10 — Recompensas persistentes — RESUELTA (2026-07-13)

Decisión: campeón = 500 monedas (lockUserForUpdate) + logro "THE PARROT'S SHELL". Sin cosmético en v1. El resto no recibe premio de torneo (ya cobra por minijuego). En derrota colectiva nadie recibe premio persistente.

Aplicado en: SPEC-037.

---

# D11 — Contenido y temática — RESUELTA (2026-07-13, aplazamiento deliberado)

Decisión: se trabaja con placeholders hasta el inicio de la Fase 6. En ese momento se hará una sesión de definición de contenido: temática/narrativa del Boss, nombres e iconos de los 4 Key Items, diseño del tablero v1, lista de Items, catálogo de tienda, música/FX.

Aplicado en: SPEC-039. Bloquea únicamente Fases 6–7.

---

# D12 — Tiempo de espectador — RESUELTA (2026-07-13)

Decisión: v1 solo ver en directo (acción del jugador activo y fase de Gambling difundidas a todos). Emotes/predicciones: futuro.

Aplicado en: SPEC-001, SPEC-016, SPEC-039.

---

# D13 — Defaults editoriales del Reconciliation Pass — DEFAULT PROVISIONAL (2026-07-13)

Tres huecos funcionales detectados en la Architecture Review que ninguna SPEC definía. Se fijan como defaults provisionales (la opción más simple y determinista) para que la documentación sea implementable; revisables si el playtesting los desmiente:

- Orden de turnos: el TurnOrder se genera en INITIALIZING con la seed del Tournament y es FIJO durante toda la partida. No rota entre rondas.
- Topología del tablero v1: sucesor único (cada Tile tiene exactamente una conexión de salida). Bifurcaciones con elección del jugador: extensión futura.
- Selección de Random Events: la selección ponderada usa la seed del Tournament (capa determinista, SPEC-000).

Aplicado en: SPEC-001, SPEC-002, SPEC-019.

---

# Pendientes futuros (no bloquean v1)

- Sesión de contenido al inicio de la Fase 6 (D11).
- Balance definitivo con el simulador en la fase de Calidad (D2).
- Revisión opcional de los defaults de Teleport (D8) si el playtesting los desmiente.
- Revisión opcional de los defaults editoriales de D13 si el playtesting los desmiente.

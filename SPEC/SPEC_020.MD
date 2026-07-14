# SPEC-020 — Boss System

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-003 Tournament State Machine
- SPEC-008 Action Engine
- SPEC-009 Rule Engine
- SPEC-017 Key Item Progression

---

# Objetivo

El Boss System gestiona la aparición del Boss Final y el inicio del Final Challenge.

El Boss no representa un combate tradicional.

Su función consiste en transformar el estado de la partida, incrementar la tensión y activar el desafío final.

---

# Filosofía

El Boss nunca implementa mecánicas propias.

El Boss es un orquestador.

Toda modificación del juego se realiza mediante Rules y Actions.

---

# Responsabilidades

- Aparecer cuando se desbloquean todos los Key Items.
- Presentar la secuencia de aparición.
- Activar las Rules del Boss.
- Iniciar el Final Challenge.
- Finalizar su participación cuando exista un ganador.

---

# Arquitectura

Key Item Progression

↓

Boss System

↓

Rule Engine

↓

Action Engine

↓

Tournament Runtime

---

# Aparición

El Boss únicamente puede aparecer cuando:

UnlockedKeyItems == RequiredKeyItems

No existe ninguna otra condición.

---

# Definición

Boss

id

name

description

icon

introSequence

activeRules[]

finalChallengeId

metadata

---

# Inicio

Pipeline

All Key Items Unlocked

↓

Boss Spawn

↓

Play Intro Sequence

↓

Activate Rules

↓

Emit BossIntroCompleted

↓

Transition Runtime (la State Machine consume BossIntroCompleted, SPEC-003)

↓

Final Challenge

---

# Boss Rules

El Boss nunca modifica sistemas directamente.

Toda alteración se realiza activando Rules.

Ejemplos

No Robbery

Double Dice

Half Rewards

Extra Random Events

Expensive Shop

Reverse Movement

Estas Rules serán completamente configurables.

---

# Final Challenge

El Boss selecciona qué Final Challenge debe iniciarse.

La implementación del desafío pertenece al Final Challenge System.

---

# Finalización

Cuando exista un ganador:

Desactivar todas las Boss Rules.

Finalizar Boss.

Cerrar Tournament.

---

# Integración con Rule Engine

El Boss únicamente puede:

Activar Rules.

Desactivar Rules.

Nunca modifica sistemas directamente.

---

# Integración con Action Engine

Las secuencias del Boss (animaciones, sonido, mensajes) utilizan exclusivamente Actions.

---

# Integración con UI

La UI escucha:

BossSpawned

BossRulesActivated

BossFinished

Nunca consulta el estado del Boss.

---

# Eventos

BossSpawnRequested

BossSpawned

BossRulesActivated

BossIntroCompleted

BossRulesRemoved

BossFinished

BossIntroCompleted se emite cuando la secuencia de introducción termina y las Boss Rules están activas: es el evento que consume la State Machine para transicionar BOSS_EVENT → FINAL_CHALLENGE (SPEC-003).

---

# Casos límite

Se intenta invocar antes de completar los Key Items

↓

Rechazar.

---

Boss ya activo

↓

Ignorar.

---

Error durante la secuencia

↓

Registrar error.

↓

Continuar hacia Final Challenge.

---

# Restricciones

El Boss nunca:

Entrega recompensas.

Calcula ganador.

Gestiona inventarios.

Gestiona economía.

Controla el tablero.

Toda interacción se realiza mediante Rules y Actions.

---

# Pendiente de definición funcional

La temática del Boss.

La narrativa.

La presentación visual.

Las Rules concretas que activará.

Estas decisiones pertenecen al diseño de contenido y no afectan a la arquitectura.

El comportamiento del Final Challenge ya está definido en SPEC-021 (muerte súbita de minijuegos en v1).

---

# Criterios de aceptación

✓ El Boss aparece únicamente al desbloquear todos los Key Items.

✓ Toda modificación del juego se realiza mediante Rules.

✓ Toda presentación utiliza Actions.

✓ El Boss nunca contiene lógica específica de gameplay.

✓ El Final Challenge comienza automáticamente tras finalizar la introducción del Boss.
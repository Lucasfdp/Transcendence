# SPEC-028 — Testing Strategy

Status: APPROVED

Priority: CRITICAL

Depends on

- Todo el Core Arquitectónico (SPEC-001 a SPEC-027)

---

# Objetivo

Definir la estrategia de testing del Tournament para garantizar que todas las mecánicas puedan evolucionar sin introducir regresiones.

La arquitectura deberá diseñarse pensando en ser testeable.

El testing no es una fase posterior del desarrollo.

Es un requisito de diseño.

---

# Filosofía

Todo sistema importante debe poder probarse de forma aislada.

Todo bug debe poder reproducirse mediante un test automatizado.

---

# Pirámide de Testing

Unit Tests

↓

Integration Tests

↓

Runtime Simulation Tests

↓

End-to-End Tests

---

# Unit Tests

Framework: Jest (`*.spec.ts`), como el resto del backend.

Cada sistema deberá poder ejecutarse de forma independiente mediante mocks.

Ejemplos

Rule Engine

Action Engine

Reward Resolver

Economy

Shop

Inventory

Leaderboard

Random Events

Boss

Final Challenge

---

# Integration Tests

Validar la comunicación entre sistemas.

Ejemplos

Reward Resolver

↓

Inventory

↓

Action Engine

---

Shop

↓

Reward Resolver

↓

Economy

---

Minigame

↓

Gambling

↓

Key Items

↓

Boss

---

# Runtime Simulation

El Runtime deberá poder ejecutarse completamente sin interfaz gráfica.

El simulador permitirá ejecutar miles de partidas automáticamente.

Objetivos

Balance.

Probabilidades.

Detección de bloqueos.

Validación de reglas.

---

# Simulación

El simulador deberá soportar:

Bots aleatorios.

Bots deterministas.

Seeds fijas.

Configuraciones personalizadas.

---

# Determinismo

Toda simulación deberá poder reproducirse utilizando:

Seed

+

Configuration Version

+

Tournament Version

---

# Tiempo y timers

Todos los timers del Tournament (timeouts de turno, de interacción, de Gambling, watchdogs) se crean mediante un reloj/scheduler inyectable propiedad del Runtime.

Los estados nunca usan setTimeout directamente.

La expiración de un timeout se registra como evento de entrada: forma parte de las "acciones" de la capa determinista (SPEC-000), lo que permite simular partidas completas sin tiempo real.

---

# End-to-End

Validar el flujo completo.

Create Match

↓

Play Tournament

↓

Unlock Key Items

↓

Boss

↓

Final Challenge

↓

Shell

↓

Finish Match

---

# Casos obligatorios

Crear partida.

Completar varias rondas.

Comprar Items.

Usar Items.

Ganar Minijuegos.

Perder Gambling.

Ganar Gambling.

Completar Key Items.

Invocar Boss.

Obtener ¡¡THE PARROT'S SHELL!!.

Cerrar partida.

Reconexión.

Desconexión.

---

# Regresión

Todo bug corregido deberá incorporar un nuevo test.

Nunca volverán a aceptarse regresiones conocidas.

---

# Cobertura

No se establece un porcentaje obligatorio.

La prioridad será cubrir:

Toda lógica de negocio.

Todos los sistemas críticos.

Todos los flujos principales.

---

# Integración Continua

El repositorio no dispone hoy de CI automática.

Hasta que exista, antes de cada merge es obligatorio ejecutar localmente:

`cd backend && npm run test` (Unit + Integration).

Simulation Tests.

Si se añade CI (GitHub Actions), estos pasos se automatizan sin cambiar la estrategia.

---

# Restricciones

Los tests nunca dependerán de:

UI.

Animaciones.

Assets.

Red real.

Tiempo real.

---

# Criterios de aceptación

✓ Todo sistema crítico posee tests automatizados.

✓ El Tournament puede simularse completamente sin cliente.

✓ Las partidas son reproducibles mediante Seeds.

✓ Todo bug corregido añade un nuevo test.

✓ La arquitectura favorece el testing desde su diseño.
# SPEC-029 — Performance & Scalability

Status: APPROVED

Priority: HIGH

Depends on

- SPEC-001 Tournament Runtime
- SPEC-004 Tournament Event Bus
- SPEC-022 Tournament Networking & Synchronization

---

# Objetivo

Garantizar que el Tournament pueda escalar a un gran número de partidas simultáneas manteniendo un consumo eficiente de recursos y una experiencia fluida para todos los jugadores.

El rendimiento deberá ser una propiedad de la arquitectura, no una optimización posterior.

---

# Filosofía

Optimizar primero el diseño.

Optimizar el código únicamente cuando existan métricas que lo justifiquen.

---

# Objetivos de rendimiento

El Runtime deberá:

- Minimizar asignaciones de memoria.
- Evitar bloqueos innecesarios.
- Evitar operaciones de complejidad elevada por turno.
- Escalar linealmente con el número de partidas.

---

# Arquitectura

Todos los sistemas deberán diseñarse para:

- Bajo acoplamiento.
- Bajo consumo de memoria.
- Procesamiento mediante eventos.
- Operaciones deterministas.

---

# Runtime

Cada Tournament deberá ser completamente independiente.

Nunca compartirá estado mutable con otros Tournament.

---

# Memoria

Los objetos temporales deberán minimizarse.

Siempre que sea posible se reutilizarán estructuras de datos.

---

# CPU

No deberán existir sistemas basados en polling.

Toda actualización deberá producirse únicamente mediante eventos.

---

# Networking

La estrategia de sincronización es snapshot-first y la define SPEC-022, que prevalece sobre este documento.

La redundancia del snapshot completo es deliberada: elimina la desincronización por construcción y a la escala de v1 (4 jugadores, estado pequeño) su coste es despreciable.

No debe "optimizarse" sustituyéndola por deltas o eventos incrementales en v1.

---

# Configuración

Las configuraciones deberán cargarse una única vez.

Nunca volverán a parsearse durante una partida.

---

# Registries

Los Registries serán de solo lectura durante el Runtime.

Todas las búsquedas deberán ser eficientes.

---

# Escalabilidad

El sistema deberá soportar múltiples Tournament ejecutándose simultáneamente sin dependencias entre ellos.

Contexto real: el backend es hoy una única instancia Node sin adapter Redis de Socket.IO.

"Escalar" en v1 significa muchos Tournament aislados dentro del mismo proceso.

El escalado horizontal queda fuera de alcance y no debe condicionar el diseño más allá del aislamiento por partida.

---

# Paralelización

Dos Tournament distintos deberán poder ejecutarse en paralelo sin sincronización adicional.

---

# Monitorización

Deberán registrarse como mínimo:

Duración media de turno.

Duración media de ronda.

Tiempo de carga.

Consumo de memoria.

Tiempo de procesamiento de eventos.

Tiempo de generación de snapshots.

---

# Profiling

La arquitectura deberá permitir instrumentar cualquier sistema sin modificar su comportamiento.

---

# Restricciones

Nunca optimizar sacrificando:

Legibilidad.

Desacoplamiento.

Testabilidad.

Configurabilidad.

---

# Criterios de aceptación

✓ No existen sistemas basados en polling.

✓ El Runtime es completamente independiente por partida.

✓ Los Registries son de solo lectura durante la ejecución.

✓ La arquitectura permite ejecutar múltiples Tournament en paralelo.

✓ El rendimiento puede monitorizarse mediante métricas objetivas.
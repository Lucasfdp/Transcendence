# SPEC-024 — Tournament Configuration System

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-002 Board System
- SPEC-006 Tile Action Framework
- SPEC-007 Item Framework
- SPEC-008 Action Engine
- SPEC-009 Rule Engine

---

# Objetivo

Centralizar toda la configuración del Tournament en archivos de datos.

El comportamiento del modo de juego deberá ser configurable sin modificar código.

---

# Filosofía

El código implementa motores.

La configuración define el juego.

---

# Qué significa "configuración" en este repositorio

Catálogos declarativos en TypeScript, siguiendo el patrón ya existente en la plataforma (`achievements.constants.ts`, `cards.constants.ts`, `customization.constants.ts`):

- módulos de datos sin lógica,
- tipados,
- validados al arranque.

No se construirá un cargador de archivos externos, ni formatos propios, ni migraciones de archivos en v1.

"Sin modificar código" significa: añadir contenido toca únicamente catálogos de datos, nunca motores.

---

# Responsabilidades

- Cargar configuraciones.
- Validarlas.
- Resolver referencias.
- Exponerlas a los sistemas.
- Detectar configuraciones inválidas.

Nunca implementa lógica de gameplay.

---

# Elementos configurables

Boards

Tiles

Dice

Items

Shop Catalogs

Random Events

Rules

Bosses

Final Challenges

Key Items

Economy Values

Tournament Settings

UI Labels

Placeholders

---

# Arquitectura

Catálogos TypeScript

↓

Configuration Validator (al arranque del módulo)

↓

Registries

↓

Runtime

---

# Principios

Toda configuración deberá ser:

Declarativa.

Versionable.

Serializable.

Validable.

Reutilizable.

---

# Referencias

Los sistemas nunca referencian clases.

Siempre utilizan IDs.

Ejemplo

Tile

↓

tile_random_event

↓

Registry

↓

Tile Definition

---

# Validación

Toda configuración deberá validarse durante el arranque.

Errores posibles

ID duplicado.

Referencia inexistente.

Tipo incorrecto.

Valor fuera de rango.

Dependencia circular.

Una configuración inválida nunca deberá cargarse.

---

# Versionado

Cada catálogo exporta:

id

version

metadata

El versionado sirve para trazabilidad (logs, analytics, replays futuros), no para migraciones de archivos en v1.

---

# Hot Reload

Fuera de alcance v1.

Los catálogos TypeScript se cargan con el proceso; un cambio de contenido implica redeploy.

La arquitectura (sistemas que solo leen Registries) permitiría añadirlo en el futuro.

---

# Integración con Registries

Toda configuración validada será registrada automáticamente.

Los sistemas nunca leerán archivos directamente.

Siempre consultarán los Registries.

---

# Configuración de Tournament

Ejemplo de elementos configurables

Número máximo de jugadores.

Número de Key Items.

Coste del Gambling.

Catálogo de tienda.

Board inicial.

Boss utilizado.

Final Challenge utilizado.

Todo configurable.

Valores iniciales v1 (cifras provisionales para desarrollo; balance definitivo en la fase de Calidad de SPEC-031, ver SPEC-040):

- Jugadores por Tournament: 4.
- Key Items requeridos: 4.
- Puntos iniciales por jugador: 100.
- Recompensa del minijuego de ronda: 50 puntos al ganador, 15 al resto de participantes activos, 0 a pasivos/desconectados (D4, SPEC-040).
- Coste del Gambling: 120 puntos. Probabilidad de victoria: base 40%, +5% por ronda completada sin desbloquear un Key Item (pity, D3); se restablece a la base al desbloquear uno.
- Cantidad robada por AttemptStealAction: 25 puntos.
- Rangos de bonus/penalización de casillas: definidos por Tile en el catálogo del Board.
- Precio de la Offer de Key Item en tienda: 500 puntos.
- Dados alternativos en tienda (Items consumibles de 1 tirada, D8): chiquito [1–3] 20 pts, grande [4–6] 60 pts, OP [6–10] 150 pts.
- Ronda máxima: 15. Al alcanzarla sin completar los Key Items, la partida termina en derrota colectiva (DEFEAT, SPEC-001).
- Timeout de turno: 30 segundos.
- Timeout de decisión de Gambling: 30 segundos.
- Timeout de interacción de tienda (ventana de turno): 30 segundos (SPEC-012).
- Watchdog de reconciliación de minijuego: 10 minutos (SPEC-015).
- Timeout de partida con todos desconectados: 10 minutos.
- Un Board, un Boss y un Final Challenge (muerte súbita, SPEC-021).

Estos valores viven en el catálogo, nunca en los motores.

El bucle económico debe cerrar sobre el papel: con los valores del catálogo, el ganador de un minijuego debe poder costear una apuesta en un número razonable de rondas. Cualquier cambio de balance debe revalidar esta propiedad.

---

# Eventos

ConfigurationLoaded

ConfigurationValidated

ConfigurationRejected

ConfigurationReloaded (Future)

---

# Casos límite

Configuración inexistente

↓

Cancelar carga.

---

Configuración inválida

↓

Registrar errores.

↓

No iniciar Tournament.

---

Versión incompatible

↓

Rechazar configuración.

---

# Restricciones

Ningún sistema podrá contener datos hardcodeados del Tournament salvo constantes técnicas imprescindibles.

Toda regla de diseño deberá vivir en configuración.

---

# Criterios de aceptación

✓ Todo el contenido del Tournament proviene de configuración.

✓ Las configuraciones son validadas antes del inicio.

✓ Los sistemas consumen Registries y nunca archivos.

✓ Añadir contenido nuevo no requiere modificar código.

✓ El Tournament puede evolucionar principalmente mediante datos.
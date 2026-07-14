# SPEC-030 — Extensibility & Plugin Architecture

Status: FUTURE — FUERA DE ALCANCE v1

Priority: LOW

Depends on

- SPEC-008 Action Engine
- SPEC-009 Rule Engine
- SPEC-024 Configuration System
- SPEC-025 Registry Framework

---

# Objetivo

Garantizar que el Tournament pueda evolucionar durante años mediante la incorporación de nuevo contenido y nuevas mecánicas sin modificar la arquitectura existente.

La arquitectura deberá estar abierta a la extensión y cerrada a la modificación.

---

# Alcance v1

Este documento describe una evolución futura y NO genera tareas de implementación.

En v1 la extensibilidad se consigue con los catálogos declarativos (SPEC-024) y el Registry Framework (SPEC-025).

No implementar sistema de Plugins, versionado de Plugins ni carga dinámica.

---

# Filosofía

El código implementa motores.

Los Plugins implementan contenido.

Añadir contenido nunca deberá requerir modificar sistemas existentes.

---

# Definición

Un Plugin representa un paquete de contenido o funcionalidades registradas durante la inicialización del Tournament.

Un Plugin puede aportar uno o varios tipos de contenido.

---

# Contenido soportado

Un Plugin podrá registrar:

Boards

Tiles

Items

Dice

Rules

Actions

Random Events

Bosses

Final Challenges

Shop Catalogs

UI Assets

Localización

Configuraciones

---

# Arquitectura

Plugin

↓

Configuration Loader

↓

Registry Framework

↓

Tournament Runtime

---

# Registro

Cada Plugin deberá registrar su contenido utilizando exclusivamente los Registries oficiales.

Nunca modificará directamente otros sistemas.

---

# Dependencias

Un Plugin podrá declarar dependencias respecto a otros Plugins.

La carga deberá validar dichas dependencias antes del registro.

---

# Aislamiento

Los Plugins nunca compartirán estado mutable entre sí.

Toda comunicación se realizará mediante:

Configuration

Registries

Event Bus

---

# Compatibilidad

El Runtime nunca dependerá de un Plugin concreto.

Toda referencia se realizará mediante IDs registrados.

---

# Versionado

Cada Plugin deberá declarar:

id

version

author

dependencies

compatibleTournamentVersion

metadata

---

# Carga

Pipeline

Load Plugin

↓

Validate Metadata

↓

Validate Dependencies

↓

Register Content

↓

Registry Validation

↓

Plugin Ready

---

# Descarga

La descarga dinámica no será necesaria en la primera versión.

La arquitectura deberá permitir incorporarla en el futuro.

---

# Errores

Plugin inválido

↓

Cancelar carga.

↓

Registrar error.

↓

Continuar con el resto de Plugins.

---

Dependencia inexistente

↓

Cancelar carga.

---

Contenido duplicado

↓

Rechazar registro.

---

# Integración

Todos los sistemas del Tournament deberán descubrir contenido mediante Registries.

Nunca mediante referencias directas.

---

# Restricciones

Los Plugins nunca:

Modifican Runtime.

Modifican Networking.

Modifican Event Bus.

Modifican Rule Engine.

Modifican Action Engine.

Únicamente amplían contenido.

---

# Criterios de aceptación

✓ Todo el contenido puede añadirse mediante Plugins.

✓ Ningún sistema depende de contenido concreto.

✓ Los Plugins utilizan exclusivamente Registries y Configuración.

✓ El Runtime puede ejecutarse sin conocer qué Plugins están instalados.

✓ La incorporación de nuevo contenido no requiere modificar la arquitectura.
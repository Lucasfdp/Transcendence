# SPEC-025 — Registry Framework

Status: APPROVED

Priority: CRITICAL

Depends on

- SPEC-024 Tournament Configuration System

---

# Objetivo

Proporcionar una infraestructura genérica para registrar y resolver cualquier definición de contenido utilizada por Tournament.

Todos los registros del proyecto deberán construirse sobre este framework.

No existirán implementaciones independientes para cada tipo de contenido.

---

# Filosofía

Los sistemas nunca conocen implementaciones.

Los sistemas únicamente conocen IDs.

Toda resolución se realiza mediante Registries.

---

# Responsabilidades

- Registrar definiciones.
- Resolver definiciones por ID.
- Validar duplicados.
- Validar referencias.
- Exponer consultas de solo lectura.

Nunca contiene lógica de gameplay.

Nunca modifica objetos registrados.

---

# Arquitectura

Catálogos TypeScript (SPEC-024)

↓

Registry Framework

↓

Specialized Registries

↓

Gameplay Systems

---

# Registry Base

Todos los registros implementan la misma interfaz.

Registry<T>

register()

unregister()

get()

exists()

getAll()

validate()

clear()

---

# Registries

La primera versión deberá incluir:

BoardRegistry

TileRegistry

ActionRegistry

RuleRegistry

ItemRegistry

DiceRegistry

RandomEventRegistry

BossRegistry

FinalChallengeRegistry

ShopCatalogRegistry

KeyItemRegistry

---

# Identificadores

Todos los registros utilizan IDs únicos.

Los IDs son inmutables.

Nunca dependen del nombre visible.

---

# Resolución

Ejemplo

item_lucky_dice

↓

ItemRegistry

↓

Item Definition

↓

Inventory

---

# Inmutabilidad

Las definiciones registradas son de solo lectura.

Ningún sistema puede modificarlas en tiempo de ejecución.

Los cambios deberán realizarse mediante Runtime State o Rules.

---

# Validación

Durante el registro:

ID duplicado

↓

Rechazar.

---

Referencia inexistente

↓

Rechazar.

---

Tipo incompatible

↓

Rechazar.

---

# Consultas

Todos los sistemas deberán utilizar consultas de solo lectura.

Nunca obtendrán referencias mutables.

---

# Dependencias

Los Registries pueden resolver referencias cruzadas.

Ejemplo

Board

↓

Tile IDs

↓

TileRegistry

↓

Tile Definitions

---

# Ciclo de vida

Load Configuration

↓

Validate

↓

Register

↓

Ready

↓

Read Only

---

# Integración

Los sistemas nunca crean contenido.

Siempre consultan:

Registry

↓

Definition

↓

Runtime Instance

---

# Eventos

RegistryLoaded

RegistryValidated

RegistryReady

RegistryError

---

# Casos límite

ID inexistente

↓

Null Result

↓

Registrar advertencia.

---

Registro duplicado

↓

Cancelar registro.

---

Configuración inválida

↓

No registrar definición.

---

# Restricciones

Los Registries nunca:

Crean Runtime Objects.

Gestionan estado.

Ejecutan lógica.

Modifican definiciones.

Contienen referencias a UI.

---

# Criterios de aceptación

✓ Existe una única implementación genérica de Registry.

✓ Todos los tipos de contenido reutilizan esa implementación.

✓ Toda resolución se realiza mediante IDs.

✓ Las definiciones son inmutables.

✓ Añadir un nuevo Registry requiere únicamente especializar Registry<T>.
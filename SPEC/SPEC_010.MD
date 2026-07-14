# SPEC-010 — Dice System

Status: APPROVED (modelo revisado por D8, SPEC-040)

Priority: CRITICAL

Depends on

- SPEC-005 Turn System
- SPEC-007 Item Framework
- SPEC-009 Rule Engine

---

# Objetivo

El Dice System es responsable de resolver todas las tiradas de dados del juego.

No conoce:

- Board
- Runtime
- Boss
- Economía
- Minijuegos
- Gambling

Su única responsabilidad consiste en producir un resultado numérico válido.

---

# Modelo (D8, SPEC-040)

Un dado es una lista de números. Nada más.

- Toda cara es un número de movimiento.
- Todas las caras son equiprobables.
- No existen pesos: un dado sesgado se expresa repitiendo números en la lista.
- No existen caras especiales ni Actions en caras. Los efectos especiales provienen exclusivamente de Items y Rules.

---

# Definición

Todo dado contiene exclusivamente datos.

Dice

id

name

icon

description

faces[] (lista de números)

metadata

---

# Ejemplos

Dado Normal

[1, 2, 3, 4, 5, 6]

---

Dado Chiquito

[1, 2, 3]

---

Dado Grande

[4, 5, 6]

---

Dado OP

[6, 7, 8, 9, 10]

---

Dado sesgado (patrón para el futuro; no existe en v1)

[4, 4, 5, 5, 6, 6]

(la repetición de números ES la ponderación; nunca un campo de peso)

---

# Resultado

Todo lanzamiento devuelve

DiceRollResult

diceId

value

seed

timestamp

---

# Generación

El servidor genera el resultado.

Nunca el cliente.

Nunca confiar en el Frontend.

El algoritmo acepta la seed del Tournament (determinismo, SPEC-000): misma seed y mismas acciones producen la misma tirada.

---

# Roll Pipeline

Request Roll

↓

Validate

↓

Resolver dado activo (normal por defecto; override si hay un Item de dado en uso)

↓

Elegir cara con la seed

↓

Apply Rules (modificadores)

↓

Emit Events

↓

Return Result

---

# Dados disponibles v1

Dado Normal [1–6]

Es el dado por defecto de todos los jugadores en todos los turnos.

Dados alternativos: Chiquito [1–3], Grande [4–6], OP [6–10].

Se obtienen ÚNICAMENTE como Items consumibles de la tienda (precios en SPEC-024).

Uso: el jugador usa el Item en su turno antes de tirar; esa única tirada utiliza el dado del Item y el Item se consume.

Mecanismo: el Item activa un modificador DiceModifier de duración 1 tirada (SPEC-009) que sustituye el dado activo. El Dice System no conoce Items.

---

# Rule Engine

Antes de devolver el resultado, el Rule Engine puede modificar mediante DiceModifier:

- El dado activo (override por Item de dado): parámetro exclusivo, mayor prioridad gana.
- El valor final (p. ej. +2 de Lucky Dice, x2 de Double Dice Rule): modificadores de valor, se aplican TODOS en orden de prioridad (SPEC-009, "Prioridad y composición").

Nunca comunicación directa Item→Dado: los Items activan Rules y las Rules modifican la tirada.

---

# Eventos

DiceRolled

DiceModified

(DiceRollRequested lo emite el Turn System, SPEC-005; este sistema lo consume. DiceRolled y DiceModified son propiedad del Dice System. Catálogo canónico en SPEC-004.)

---

# Integración con UI

La UI únicamente recibe

DiceRolled

Y reproduce animaciones, sonidos y FX.

Nunca calcula resultados.

---

# Dados futuros

Cualquier dado nuevo se define añadiendo su lista de números al catálogo (SPEC-024) y, si se vende, su Offer a la tienda.

Siempre listas de números. Las caras especiales (Teleport, Steal, etc.) quedan descartadas por decisión de diseño (D8, SPEC-040).

---

# Casos límite

Dado sin caras o configuración inválida

↓

No registrar dado (falla la validación del catálogo, SPEC-024).

---

Seed inválida

↓

Generar nueva.

↓

Registrar advertencia.

---

Item de dado usado fuera de turno

↓

Lo rechaza el Trigger del Item (SPEC-007); el Dice System no interviene.

---

# Restricciones

El Dice System nunca mueve jugadores.

Nunca concede recompensas.

Nunca abre tiendas.

Nunca modifica inventarios.

Nunca inicia turnos.

Únicamente genera resultados numéricos.

---

# Criterios de aceptación

✓ Todo dado es una lista de números en el catálogo.

✓ Todas las caras son equiprobables; el sesgo se expresa repitiendo números.

✓ El Rule Engine puede modificar cualquier tirada (override de dado y modificadores de valor).

✓ El cliente nunca decide el resultado.

✓ Las tiradas son reproducibles con la seed del Tournament.

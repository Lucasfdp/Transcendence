## Vista del Hub y Juegos

Una **solución híbrida**, pero con una jerarquía clara:

> **Hub visual con minimapa como pantalla principal + panel/preview grande al hacer hover o seleccionar una zona.**

Es decir: no haría una simple cuadrícula de minijuegos como pantalla principal, porque perdería parte del encanto del mundo. Pero tampoco dejaría que todo dependa solo del hover sobre el minimapa, porque eso puede ser menos claro y peor para móvil.

---

## Opción A: selector de minijuegos tipo grid

Sería algo así:

```txt
[ Shell Smash Arena ] [ River Rush ]
[ Bamboo Bash       ] [ Oni Dodge  ]
[ Sakura Sweep      ] [ Bell Clash ]
```

### Ventajas

Es muy claro, muy rápido y muy fácil de usar.

El jugador entiende enseguida:

* qué modos existen,
* cuáles están desbloqueados,
* cuáles están bloqueados,
* dónde hacer clic.

### Problema

Es menos especial. Parece más un menú tradicional que un **gaming hub**. Funciona, pero pierde parte del rollo de “mundo de tortugas”.

---

## Opción B: minimapa interactivo con hover

Sería un mapa bonito con edificios/nodos:

```txt
Templo de la Campana  → Bell Clash
Río del Cerezo        → River Rush
Bosque de Bambú       → Bamboo Bash
Arena Dohyō           → Shell Smash Arena
Templo Oni            → Oni Dodge
```

Al pasar el ratón o seleccionar uno, aparece una imagen/preview.

### Ventajas

Es mucho más bonito y da sensación de mundo.

Hace que el hub parezca un lugar, no solo un menú. Esto encaja mejor con la estética japonesa, los templos, zonas, caminos, faroles, niebla, cofres, etc.

### Problema

El hover no existe bien en móvil/tablet. Y si los nodos son pequeños, puede ser menos accesible.

---

# La mejor solución

## Hub con mapa + panel de preview fijo

La pantalla principal podría ser:

```txt
┌──────────────────────────────────────────────┐
│ Perfil / monedas / misiones                  │
├───────────────────────┬──────────────────────┤
│                       │                      │
│      MINIMAPA         │   PREVIEW DEL MODO   │
│      INTERACTIVO      │                      │
│                       │   Imagen grande      │
│  [Arena] [Río]        │   Nombre             │
│  [Bambú] [Oni]        │   Descripción        │
│  [Campana] [Cartas]   │   Recompensas        │
│                       │   Botón JUGAR        │
├───────────────────────┴──────────────────────┤
│ Personalizar | Cartas | Tienda | Perfil      │
└──────────────────────────────────────────────┘
```

En PC:

* Hover sobre una zona → cambia el preview.
* Click → selecciona.
* Doble click o botón → entrar.

En móvil:

* Tap en una zona → cambia el preview.
* Botón grande `JUGAR`.
* Swipe opcional entre modos.

Así tienes lo mejor de ambos mundos:

* **bonito** porque hay mapa;
* **claro** porque hay preview grande;
* **accesible** porque no dependes solo del hover;
* **user friendly** porque el jugador siempre ve nombre, descripción y botón.

---

# Cómo lo plantearía visualmente

## Zona izquierda o central: mapa

Un mapa ilustrado estilo pergamino/santuario con zonas:

* **Dohyō central** → Shell Smash Arena.
* **Río lateral** → River Rush.
* **Bosque de bambú** → Bamboo Bash.
* **Templo oscuro** → Oni Dodge.
* **Patio de faroles** → Lantern Push.
* **Campana gigante** → Bell Clash.
* **Jardín sakura** → Sakura Sweep.
* **Pabellón de cartas** → Shell Cards.

Cada zona tiene un icono, nombre corto y estado:

```txt
Disponible
Bloqueado
Próximamente
Evento
Nuevo
```

## Zona derecha: preview

Cuando seleccionas un modo:

```txt
BELL CLASH
Golpea la campana desde el mejor ángulo y supera a tu rival.

Modo: 1v1
Duración: 2 min
Recompensas: monedas, cartas, cofres
Estado: disponible

[JUGAR]
```

Y de fondo o arriba, una miniatura grande del modo.

---

El minimapa con preview gana visualmente.

Hace que el juego parezca más grande de lo que realmente es. Aunque solo haya uno o dos modos implementados, podéis mostrar el resto como templos cerrados o caminos bloqueados.

Ejemplo:

```txt
River Rush       Disponible
Shell Arena      Disponible
Bamboo Bash      Próximamente
Oni Dodge        Próximamente
Bell Clash       Próximamente
Shell Cards      Disponible / Beta
```

Esto da sensación de roadmap interno sin tener que explicarlo demasiado.

---

# Lo más accesible

El grid gana si hablamos de claridad pura.

* panel de preview siempre visible,
* botón `JUGAR` grande,
* nombres legibles,
* navegación con teclado/gamepad,
* selección por click/tap, no solo hover,
* filtros o pestañas si hay muchos modos.

---

# Posible estructura final:

## Pantalla principal del Hub

**Mapa interactivo + preview del modo seleccionado.**

## Acceso secundario

Un botón llamado:

```txt
Todos los juegos
```

Que abre un selector tipo grid/lista.

Así el jugador tiene dos formas de navegar:

* La forma bonita: mapa.
* La forma rápida: lista.

Esto es muy habitual en juegos con hubs: el mapa da identidad, la lista da comodidad.

---

# Para este caso concreto

No haría una pantalla independiente de selector de minijuegos como primera opción.

Haría:

```txt
Gaming Hub = minimapa vivo
Selector de minijuegos = panel lateral dentro del hub
```

De esta forma, el hub no se siente como “menú de botones”, sino como un pequeño mundo. Y cada modo puede tener su preview al seleccionarlo.

La frase de diseño sería:

> **El mapa es el menú. El preview explica el juego. El botón confirma la entrada.**


## Vista de las Tortugas

La clave es separar dos cosas:

> **Tortuga de gameplay** = pequeña, cenital, legible.
> **Tortuga principal/personalizable** = grande, expresiva, vista 3/4 o frontal.

---

La mejor opción sería una tortuga grande en **vista 3/4 frontal**, como la del Hub.

No completamente frontal, sino algo así:

```txt
      cabeza visible
          ↓
   cuerpo girado 30º
          ↓
 caparazón muy visible
          ↓
 mawashi y postura pesada
```

La vista 3/4 permite ver:

* cara,
* expresión,
* moño,
* hombros/brazos,
* caparazón,
* cinturón,
* postura,
* accesorios.

Una vista frontal pura enseña mejor la cara, pero pierde importancia el caparazón, que es uno de los elementos más potentes del personaje.

---

# Sistema ideal de vistas

## 1. Vista 3/4 frontal

Para:

* Hub.
* Perfil.
* Personalización.
* Tienda.
* Pantallas de victoria.
* Cartas de personaje.

Es la vista más carismática.

## 2. Vista trasera / 3/4 espalda

Para personalización del caparazón.

Esta sería importante porque el caparazón es el elemento más coleccionable.

```txt
[FRONTAL] [CAPARAZÓN] [GAMEPLAY]
```

Cuando el jugador cambia caparazón, pulsas “ver caparazón” y la tortuga aparece de espaldas o girada.

## 3. Vista cenital

Para previsualizar cómo se verá en los minijuegos.

Esto es muy importante porque evita una decepción típica:

> “Me he personalizado una tortuga preciosa, pero luego en gameplay no reconozco nada.”

Entonces en la pantalla de personalización mostraría siempre una mini-preview:

```txt
Así se ve en el Hub        Así se ve en combate
[ tortuga grande 3/4 ]     [ tortuga cenital pequeña ]
```

---

## 1. Rotación falsa con 5 poses


```txt
Frontal
3/4 izquierda
Espalda
3/4 derecha
Cenital
```

El jugador pulsa flechas y parece que la tortuga rota.

Esto da sensación de “modelo inspeccionable”, pero sigue siendo 2D.

Dificultad: media.
Resultado visual: alto.

---

## 2. Capas de personalización

Cada vista puede estar compuesta por capas:

```txt
base_body
shell
mawashi
chonmage
face/expression
arm_accessory
back_accessory
aura/effect
shadow
```

---

## 3. Animaciones pequeñas

Aunque sea 2D, puede sentirse viva:

* respiración lenta,
* parpadeo,
* movimiento del moño,
* polvo al pisar,
* pequeño gruñido,
* giro de cabeza,
* brillo en el caparazón,
* reacción al equipar algo,
* pose de victoria.

---

## 4. Probador de estilo

La personalización debería tener una zona central grande:

```txt
┌─────────────────────────────────────┐
│                                     │
│        TORTUGA GRANDE 3/4           │
│                                     │
│   [girar] [ver caparazón] [pose]    │
└─────────────────────────────────────┘
```

Y alrededor:

```txt
Caparazón
Mawashi
Moño
Armadura
Tatuajes
Efectos
Fondo
```

Cada vez que equipas algo, la tortuga hace una pequeña animación.

---

# Lo más importante: el caparazón

En el juego, el caparazón debería ser casi como la “skin principal”.

Podrían una sección propia:

```txt
CAPARAZONES
- Kanagawa
- Dragón
- Bambú
- Oni
- Campana
- Sakura
- Tormenta
- Piedra antigua
```

Y cada caparazón tendría:

* vista grande,
* rareza,
* pequeño lore,
* cómo se consiguió,
* preview cenital,
* efectos asociados.

Ejemplo:

```txt
CAPARAZÓN KANAGAWA
Rareza: Épica
Efecto visual: estela de ola azul
Desbloqueo: gana 10 partidas en River Rush
```

---

# Personalización más disfrutable

## “Modo pose”

El jugador puede elegir cómo se muestra su tortuga en perfil:

```txt
Seria
Orgullosa
Enfadada
Dormida
Preparada para embestir
Victoria
```

## “Fondo de perfil”

La tortuga puede mostrarse delante de:

```txt
Dojo
Jardín zen
Río
Bosque de bambú
Templo Oni
Patio de la campana
```

## “Preview por modo”

Cada modo enseña cómo se verá:

```txt
Hub
Arena
River Rush
Cartas
Perfil
```

## “Antes/después”

Cuando cambias algo:

```txt
Equipado actualmente → Nuevo objeto
```

Esto hace que la tienda y las recompensas sean más claras.

---

# Estructura

```txt
Pantalla de personalización
│
├── Centro
│   ├── Tortuga grande 3/4
│   ├── Botón girar
│   ├── Botón ver gameplay
│   └── Botón cambiar pose
│
├── Izquierda
│   ├── Categorías
│   │   ├── Caparazón
│   │   ├── Mawashi
│   │   ├── Moño
│   │   ├── Armadura
│   │   ├── Efectos
│   │   └── Fondo
│
├── Derecha
│   ├── Detalle del objeto
│   ├── Rareza
│   ├── Lore
│   ├── Desbloqueo
│   └── Botón equipar
│
└── Abajo
    ├── Miniaturas de objetos
    ├── Filtros
    └── Preview cenital
```

---

# Decisión final

## Para MVP

Una sola vista grande **3/4 frontal** + una mini vista cenital.

Suficiente para que se sienta bien.

## Para versión más pulida

Añadiría rotación falsa:

```txt
3/4 frontal → espalda/caparazón → cenital
```

---

La solución más equilibrada sería:

> **Tortuga 2D ilustrada en 3/4, con capas personalizables, animaciones suaves y una vista alternativa del caparazón.**


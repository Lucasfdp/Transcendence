# 1. Cambio de visión técnica

## Antes

```txt
Shell Smash
└── Juego principal 1vs1
    ├── Arena circular
    ├── Físicas
    ├── Matchmaking
    ├── Ranking
    └── Personalización simple
```

## Ahora

```txt
Shell Smash
├── Gaming Hub
├── Perfil persistente
├── Tortuga personalizable
├── Economía
├── Inventario
├── Cartas coleccionables
├── Misiones/recompensas
├── Ranking global y por modo
└── Minijuegos
    ├── Shell Smash Arena
    ├── Bell Clash
    ├── River Rush
    ├── Lantern Push
    ├── Temple Curling
    ├── Sakura Sweep
    ├── Oni Dodge
    └── Coming Soon
```

La arquitectura debe pasar de “servidor de combate” a **plataforma modular de juego**.

---

# 2. Cambio principal de arquitectura

## Lo más importante

Hay que separar claramente:

```txt
Core del jugador
Core visual
Core de economía
Core de modos de juego
Core de recompensas
Core online
```

El error sería meter todo dentro de `arena`, `game`, `battle` o `match`.

Ahora el proyecto necesita una arquitectura tipo:

```txt
backend/src/modules/
  auth/
  users/
  profile/
  turtle/
  customization/
  inventory/
  currencies/
  rewards/
  missions/
  cards/
  decks/
  mini-games/
  matchmaking/
  matches/
  leaderboards/
  events/
```

Y en frontend:

```txt
frontend/src/features/
  hub/
  turtle/
  customization/
  cards/
  economy/
  rewards/
  mini-games/
  arena/
  matchmaking/
  profile/
  shop/
  missions/
```

---

# 3. Frontend actualizado

El frontend ya no debe ser solo una pantalla de juego con canvas. Ahora tiene tres capas.

## Capa 1: UI de aplicación

Para pantallas tipo:

```txt
Hub
Perfil
Personalización
Cartas
Tienda
Misiones
Ranking
Coming Soon
Selector de minijuegos
Resultados
Recompensas
```

Tecnologías:

```txt
React + TypeScript
TailwindCSS
Zustand
GSAP
```

Esto ya encaja con la arquitectura técnica que tenías planteada: React + TypeScript, PixiJS, Tailwind, Zustand, GSAP y Vite .

---

## Capa 2: Render visual 2D

Para:

```txt
Tortuga principal 3/4
Tortuga cenital
Preview de minijuegos
Animaciones de recompensa
Cartas
Efectos visuales
Fondos del hub
```

Aquí usaría:

```txt
PixiJS
Sprites por capas
Spritesheets
WebP/PNG
JSON de configuración visual
```

No metería todo en React puro. React gestiona UI, PixiJS gestiona piezas visuales animadas.

---

## Capa 3: Gameplay

Para minijuegos físicos:

```txt
Shell Smash Arena
Bell Clash
Lantern Push
Temple Curling
River Rush
```

Aquí conviene tener un motor común:

```txt
frontend/src/game-engine/
  physics/
  input/
  camera/
  renderer/
  entities/
  collisions/
  effects/
  ui-overlay/
```

Y luego cada modo define sus reglas:

```txt
frontend/src/game-modes/
  shell-arena/
  bell-clash/
  lantern-push/
  river-rush/
  temple-curling/
```

---

# 4. Backend actualizado

El backend ya no debe estar centrado solo en Socket.io/matchmaking.

Necesita dos grandes partes:

```txt
REST/HTTP API
Realtime/WebSocket API
```

## REST API

Para todo lo persistente:

```txt
GET /api/me
GET /api/profile
PATCH /api/profile

GET /api/turtle
PATCH /api/turtle/customization

GET /api/inventory
GET /api/currencies
GET /api/missions
POST /api/missions/claim

GET /api/cards
GET /api/decks
POST /api/decks

GET /api/minigames
GET /api/leaderboards/:mode

POST /api/rewards/claim
```

## Realtime API

Solo para modos que lo necesiten:

```txt
matchmaking:join
matchmaking:cancel
match:input
match:state
match:end
```

No todos los minijuegos necesitan realtime fuerte desde el día 1. Algunos pueden ser:

* single player con ranking,
* async,
* por turnos,
* contra IA,
* práctica.

Eso reduce mucho la dificultad inicial.

---

# 5. Base de datos replanteada

Antes bastaba con usuarios, estadísticas y cosméticos.

Ahora necesitas algo más parecido a esto:

```txt
users
profiles
turtles
cosmetic_items
user_cosmetics
currencies
wallets
mini_games
user_game_stats
missions
user_missions
rewards
cards
user_cards
decks
deck_cards
matches
leaderboards
events
```

## Tablas clave

### `profiles`

```txt
user_id
display_name
level
xp
rank
created_at
updated_at
```

### `turtles`

```txt
user_id
base_turtle_id
shell_id
mawashi_id
chonmage_id
armor_id
pose_id
background_id
effect_id
```

### `wallets`

```txt
user_id
soft_currency
card_dust
event_tokens
```

### `mini_games`

```txt
id
name
slug
status
mode_type
is_realtime
is_ranked
thumbnail_url
preview_url
```

### `user_game_stats`

```txt
user_id
mini_game_id
wins
losses
played
best_score
rating
rank
updated_at
```

### `cards`

```txt
id
name
rarity
type
attack
guard
ki
ability_id
art_url
```

### `user_cards`

```txt
user_id
card_id
quantity
level
created_at
```

---

# 6. Arquitectura recomendada del monorepo

```txt
shell-smash/
  apps/
    frontend/
    backend/

  packages/
    shared/
      types/
      constants/
      schemas/

    game-core/
      physics/
      math/
      rules/
      entities/

    assets-config/
      cosmetics.ts
      cards.ts
      minigames.ts

  docs/
    gdd/
    architecture/
    art-style/
    mvp-roadmap/

  docker/
  infra/
```

Para empezar también puedes mantenerlo más simple:

```txt
shell-smash/
  frontend/
  backend/
  shared/
  docs/
  docker/
```

Pero sí dejaría preparado `shared`, porque vais a compartir tipos entre frontend y backend.

---

# 7. Replanteamiento de assets

Ahora necesitáis una estructura mucho más ordenada.

```txt
frontend/src/assets/
  turtle/
    base/
      hub_3q/
      back/
      top/
      poses/
    shells/
      kanagawa/
        hub_3q.webp
        back.webp
        top.webp
        icon.webp
    mawashi/
    chonmage/
    armor/
    effects/

  cards/
    tortugas/
    tecnicas/
    espiritus/
    equipo/
    lugares/

  minigames/
    shell-arena/
      thumbnail.webp
      preview.webp
      background.webp
    bell-clash/
    river-rush/
    bamboo-bash/
    oni-dodge/

  ui/
    buttons/
    panels/
    icons/
    currencies/
    rarity/
```

## Punto importante

Cada cosmético debería tener variantes para las vistas necesarias:

```txt
hub_3q
back
top
icon
```

No hace falta hacer todo desde el principio, pero sí diseñar el sistema pensando en eso.

---

# 8. Estado global del frontend

Zustand puede dividirse por dominios.

```txt
stores/
  useAuthStore.ts
  useProfileStore.ts
  useTurtleStore.ts
  useInventoryStore.ts
  useWalletStore.ts
  useCardsStore.ts
  useMiniGamesStore.ts
  useMatchStore.ts
  useUiStore.ts
```

Pero evitaría un store gigante.

Ejemplo conceptual:

```txt
useTurtleStore
- customization actual
- vista seleccionada
- pose seleccionada
- item seleccionado
- preview cenital

useMiniGamesStore
- lista de modos
- modo seleccionado
- estado: disponible / bloqueado / próximamente
- preview actual

useWalletStore
- monedas
- fragmentos
- tokens
```

---

# 9. Minijuegos: cómo plantearlos técnicamente

Todos deberían compartir una interfaz común.

```ts
interface MiniGameDefinition {
  id: string;
  slug: string;
  name: string;
  status: "available" | "locked" | "coming_soon";
  modeType: "realtime_1v1" | "turn_based" | "solo_score" | "practice";
  rewards: RewardDefinition[];
  thumbnail: string;
  preview: string;
}
```

Y para gameplay:

```ts
interface GameMode {
  init(): void;
  update(delta: number): void;
  render(): void;
  handleInput(input: PlayerInput): void;
  destroy(): void;
}
```

Así luego `ShellArena`, `BellClash`, `RiverRush`, etc. comparten base.

---

# 10. Online: no todo debe ser online desde el día 1

Esto es importante.

Antes el proyecto nacía como 1vs1 online obligatorio. Ahora, con un hub más grande, conviene que el primer modo online sea solo uno.

## MVP online recomendado

```txt
Shell Smash Arena
└── 1vs1 online
```

El resto puede empezar como:

```txt
Bell Clash       práctica / IA / score local
River Rush       score attack
Temple Curling   por turnos local o IA
Cards            colección primero, combate después
```

Luego se añade online progresivamente.

---

# 11. Backend de partidas

Separaría:

```txt
matchmaking/
matches/
game-results/
leaderboards/
```

## Matchmaking

```txt
Crear cola
Buscar rival
Crear partida
Asignar servidor/sala
Cancelar búsqueda
```

## Match

```txt
room_id
players
mode
state
started_at
ended_at
winner
```

## Game result

```txt
match_id
user_id
mode
score
result
rewards_granted
```

## Leaderboard

Redis para ranking rápido, Supabase/Postgres para histórico.

```txt
leaderboard:shell-arena
leaderboard:bell-clash
leaderboard:river-rush
```

---

# 12. MVPs recomendados

Aquí es donde más cuidado tendría. No intentaría hacer todo el hub real desde el principio.

---

## MVP 0 — Base técnica y vertical slice visual

Objetivo: tener el proyecto levantado y navegar entre pantallas.

Incluye:

```txt
Frontend con React/Vite
Backend con Fastify
Supabase Auth
Redis local
Docker Compose
Layout base
Rutas principales
Tema visual inicial
```

Pantallas:

```txt
Login
Hub placeholder
Personalización placeholder
Cartas placeholder
Minijuegos placeholder
```

Resultado: ya hay app navegable.

---

## MVP 1 — Hub funcional + perfil persistente

Objetivo: que Shell Smash ya parezca producto.

Incluye:

```txt
Login real
Perfil de jugador
Wallet básica
Hub visual
Selector de minijuegos
Coming Soon
Panel de modo seleccionado
Misiones diarias simples
```

Sin gameplay complejo todavía.

Datos:

```txt
profile
wallet
mini_games
missions
```

Resultado: el jugador entra y ve su mundo.

---

## MVP 2 — Personalización disfrutable

Objetivo: que la tortuga sea el centro del producto.

Incluye:

```txt
Tortuga grande 3/4
Vista de caparazón
Preview cenital
Categorías de cosméticos
Equipar/guardar
Inventario básico
Animaciones simples
```

Cosméticos iniciales:

```txt
3 caparazones
3 mawashi
3 chonmage
2 poses
2 fondos
```

Resultado: el jugador ya siente “esta es mi tortuga”.

---

## MVP 3 — Shell Smash Arena offline/prototipo

Objetivo: validar físicas.

Incluye:

```txt
Arena cenital
Movimiento por impulso
Colisiones
Rebote
Salida del ring
Victoria/derrota
Práctica contra IA simple o dummy
```

Sin online todavía.

Resultado: validáis si la mecánica principal es divertida.

---

## MVP 4 — Shell Smash Arena 1vs1 online

Objetivo: cumplir el core competitivo.

Incluye:

```txt
Matchmaking
Sala 1vs1
Sincronización básica
Input del jugador
Estado de partida
Resultado
Ranking
Recompensas
```

Este es el MVP más crítico técnicamente.

Resultado: ya existe el primer juego real del hub.

---

## MVP 5 — Cartas colección

Objetivo: añadir progresión coleccionable sin combate aún.

Incluye:

```txt
Colección de cartas
Rarezas
Tipos de carta
Sobres
Recompensas de sobres
Duplicados -> fragmentos
Mazo visual
```

Resultado: las recompensas empiezan a tener sentido.

---

## MVP 6 — Recompensas y economía completa básica

Objetivo: cerrar el loop.

Incluye:

```txt
Monedas por partida
XP
Misiones diarias
Cofre diario
Recompensas por nivel
Fragmentos de cartas
```

Loop:

```txt
Jugar → ganar monedas/XP → desbloquear cosméticos/cartas → personalizar → jugar más
```

---

## MVP 7 — Segundo minijuego simple

Mi recomendación: **Bell Clash** o **Temple Curling**.

Por qué:

```txt
Mecánica simple
Muy visual
Puede ser offline primero
Reutiliza física
No requiere matchmaking al principio
```

Bell Clash:

```txt
Golpear campana
Ángulo correcto
Puntos
Onda expansiva
Ranking de puntuación
```

Temple Curling:

```txt
Lanzamiento por turnos
Diana
Precisión
Empujar rivales
```

Resultado: el hub empieza a justificar que es un hub.

---

## MVP 8 — Shell Cards combate simple

Objetivo: dar uso a la colección.

No haría TCG complejo todavía.

Sistema simple:

```txt
Mazo de 6 cartas
Seleccionas 3
Combate automático por rondas
Fuerza / Guardia / Ki
Habilidad simple
Resultado
Recompensa
```

Resultado: segundo pilar de juego no físico.

---

# 13. Orden recomendado realista

Yo lo haría así:

```txt
1. Base técnica
2. Hub
3. Personalización
4. Arena offline
5. Arena online
6. Recompensas
7. Cartas colección
8. Segundo minijuego
9. Combate de cartas
10. Eventos / clanes / torneos
```

No metería cartas antes de que exista al menos un modo jugable, salvo que queráis enseñar producto visual.

---

# 14. Qué dejar fuera por ahora

Para no explotar el scope:

```txt
3D real
Clanes
Torneos complejos
Eventos temporales reales
Trading entre jugadores
Marketplace
Chat
Múltiples minijuegos online
Cartas PvP complejas
Editor profundo de tortuga
Battle pass completo
```

Podéis mostrarlos como Coming Soon, pero no implementarlos todavía.

---

# 15. Stack actualizado recomendado

## Frontend

```txt
React + TypeScript
Vite
TailwindCSS
Zustand
PixiJS
GSAP
Matter.js o Rapier2D
Socket.io-client
Supabase client
```

## Backend

```txt
Node.js + TypeScript
Fastify
Socket.io
Supabase/Postgres
Redis
Zod
Vitest
```

## Infra

```txt
Docker Compose
GitHub Actions
Vercel/Netlify para frontend
Railway/Fly.io/Render para backend
Supabase gestionado
Redis gestionado o contenedor
```

---

# 16. Decisión sobre Matter.js vs PixiJS

PixiJS no sustituye a Matter.js.

```txt
PixiJS = dibujar
Matter.js = física
React = UI
Backend = estado persistente y online
```

Para el modo arena:

```txt
Input jugador
↓
Motor de física
↓
Estado de entidades
↓
Render con PixiJS
↓
Resultado enviado al backend
```

---

# 17. Nueva arquitectura mental

```txt
Shell Smash App
│
├── App Shell
│   ├── Auth
│   ├── Navigation
│   ├── Layout
│   └── Theme
│
├── Player Core
│   ├── Profile
│   ├── Turtle
│   ├── Inventory
│   ├── Wallet
│   └── Progression
│
├── Hub Core
│   ├── Map
│   ├── MiniGame Selector
│   ├── Preview Panel
│   ├── Coming Soon
│   └── Events
│
├── Game Core
│   ├── Physics
│   ├── Input
│   ├── Rules
│   ├── Rendering
│   └── Results
│
├── Collection Core
│   ├── Cards
│   ├── Decks
│   ├── Packs
│   └── Dust
│
└── Online Core
    ├── Matchmaking
    ├── Rooms
    ├── Sync
    ├── Leaderboards
    └── Rewards
```

---

# 18. Recomendación final

El cambio es bueno, pero hay que disciplinar mucho el scope.

La versión técnica correcta sería:

> **Construir primero una plataforma mínima: perfil + hub + tortuga + un minijuego online. Después añadir colección, recompensas y nuevos modos como módulos.**

El primer gran objetivo no debería ser “tener muchos minijuegos”, sino:

```txt
Que el jugador pueda entrar,
ver su tortuga,
elegir un modo,
jugar una partida,
ganar algo,
y volver al hub con progreso.
```

Ese es el loop que convierte Shell Smash en producto.


# Guía Técnica: Gestión de Assets Compartidos (React + Phaser)

**Proyecto:** Dojo Turtle Game
**Alcance:** Landing/Menús en React, Área de juego en Phaser
**Objetivo:** Una sola fuente de assets, cero duplicación entre ambos sistemas

---

## 1. Principio rector

> **Un asset, una ubicación, múltiples consumidores.**

React (landing, menús, UI fuera del canvas) y Phaser (dentro del canvas de juego) son rendering engines distintos, pero ambos pueden leer **el mismo archivo de imagen**. La duplicación no está en los archivos — está en si generamos el botón "vacío" correctamente una sola vez y lo tratamos como 9-slice en los dos lados.

```
/public/assets/
├── ui/
│   ├── button-base.png        ← usado por React (CSS) y Phaser (NineSlice)
│   ├── button-base.json       ← metadata de slicing (ver sección 4)
│   ├── icons/
│   │   ├── bell.svg
│   │   ├── sakura.svg
│   │   └── lantern.svg
│   └── atlas/
│       ├── ui-atlas.png       ← solo Phaser (spritesheet empaquetado)
│       └── ui-atlas.json
├── character/
│   ├── turtle-base.png        ← cuerpo base, sin caparazón/bandana
│   ├── shells/
│   │   ├── shell-fire.png
│   │   ├── shell-electric.png
│   │   └── ...
│   ├── headwear/
│   │   ├── bandana-red.png
│   │   └── ...
│   └── tattoos/
│       ├── tattoo-flame.png
│       └── ...
```

**Regla:** si un asset se usa en ambos sistemas (botones, fondos, logo), va en `/ui/` plano (PNG/SVG). Si es exclusivo de Phaser (sprites de personaje, partículas, tiles), va empaquetado en un atlas.

---

## 2. Por qué NO duplicar: el costo real

| Si duplicas | Si compartes |
|---|---|
| 2 archivos a mantener si cambia el diseño | 1 archivo, un solo cambio |
| Riesgo de inconsistencia visual (landing ≠ juego) | Identidad visual garantizada |
| Doble peso de descarga si el usuario navega landing→juego | Caché del navegador reutiliza el mismo PNG |
| Doble trabajo de generación con IA | Un prompt, un asset, dos consumidores |

El cacheo del navegador es un beneficio real: si el usuario carga `button-base.png` en la landing, al entrar al juego Phaser lo pide con la misma URL y **ya está en caché**, sin nueva descarga.

---

## 3. Config compartida: una sola fuente de verdad

Antes de tocar código de React o Phaser, define las medidas del 9-slice **una vez**, en un JSON consumido por ambos:

```json
// /public/assets/ui/button-base.json
{
  "source": "/assets/ui/button-base.png",
  "nativeSize": { "width": 600, "height": 200 },
  "slice": {
    "left": 40,
    "right": 40,
    "top": 40,
    "bottom": 40
  }
}
```

Este archivo es la "verdad" sobre cómo se comporta el botón al escalar. Tanto el componente React como el objeto Phaser lo leen — si el diseñador cambia el grosor del borde de cinta adhesiva, se actualiza **un número en un solo lugar**.

```js
// /src/shared/assetConfig.js
export const BUTTON_BASE = {
  src: '/assets/ui/button-base.png',
  slice: { left: 40, right: 40, top: 40, bottom: 40 },
};
```

Este módulo se importa tanto en componentes React como en escenas Phaser.

---

## 4. Lado React: CSS `border-image`

El navegador tiene su propio 9-slice nativo (`border-image`), que replica exactamente el comportamiento de Phaser's NineSlice sin reescalar el centro de forma distorsionada.

```jsx
// /src/components/MenuButton.jsx
import { BUTTON_BASE } from '../shared/assetConfig';
import './MenuButton.css';

export function MenuButton({ children, onClick, variant = 'default' }) {
  return (
    <button className={`dojo-button dojo-button--${variant}`} onClick={onClick}>
      {children}
    </button>
  );
}
```

```css
/* /src/components/MenuButton.css */
.dojo-button {
  border-style: solid;
  border-width: 40px; /* debe coincidir con BUTTON_BASE.slice */
  border-image-source: url('/assets/ui/button-base.png');
  border-image-slice: 40 fill;
  border-image-repeat: stretch;
  background: transparent;
  padding: 16px 36px;
  font-family: var(--font-dojo);
  color: white;
  cursor: pointer;
  min-width: fit-content;
}

.dojo-button:hover {
  filter: brightness(1.1);
}
```

**Uso:**
```jsx
<MenuButton onClick={goToShop}>TIENDA</MenuButton>
<MenuButton onClick={goToProfile}>PERFIL DEL JUGADOR</MenuButton>
```

Ambos botones, distinto largo de texto, **mismo PNG**, sin distorsión.

> Nota: idealmente `border-width` se inyecta vía CSS variable leyendo `BUTTON_BASE.slice`, para que si cambias el JSON no tengas que tocar el CSS a mano. Con Tailwind o CSS-in-JS esto es trivial; con CSS plano puede hacerse con custom properties seteadas desde JS al montar el componente.

---

## 5. Lado Phaser: `NineSlice` GameObject

Phaser ≥3.60 trae `NineSlice` nativo, que lee la misma imagen.

```js
// /src/game/ui/createDojoButton.js
import { BUTTON_BASE } from '../../shared/assetConfig';

export function createDojoButton(scene, x, y, label, { width = 240, height = 90 } = {}) {
  const { left, right, top, bottom } = BUTTON_BASE.slice;

  const button = scene.add.nineslice(
    x, y,
    'button-base',     // key precargada en preload()
    undefined,
    width, height,
    left, right, top, bottom
  );

  const text = scene.add.text(x, y, label, {
    fontFamily: 'DojoFont',
    fontSize: '24px',
    color: '#ffffff',
  }).setOrigin(0.5);

  button.setInteractive({ useHandCursor: true });

  return { button, text };
}
```

```js
// En la escena, preload():
this.load.image('button-base', '/assets/ui/button-base.png');
```

**Uso dentro de una escena:**
```js
createDojoButton(this, 400, 300, 'KAME KNOCK', { width: 280, height: 100 });
createDojoButton(this, 400, 420, 'TEMPLE CURLING', { width: 340, height: 100 });
```

Mismo archivo `button-base.png` que React. El ancho lo decides dinámicamente según el texto (puedes medir `text.width` antes de fijar el `width` del nineslice y agregar padding).

---

## 6. Qué SÍ duplicar (y por qué no es un problema)

No todo debe compartirse — hay una diferencia entre **duplicar el asset** (malo) y **tener dos formas de cargar el mismo asset** (normal y esperado):

| Elemento | React | Phaser | ¿Mismo archivo? |
|---|---|---|---|
| Botón base | CSS `border-image` | `NineSlice` | ✅ Sí, mismo PNG |
| Iconos (campana, sakura) | `<img>` o inline SVG | Atlas Phaser | ✅ Sí, pero Phaser los empaqueta en atlas por rendimiento |
| Sprites de personaje (tortuga, caparazones) | No aplica (no se ve en landing) | Atlas Phaser | N/A — exclusivo del juego |
| Tipografía | `@font-face` en CSS | `loadFont` o Bitmap Font en Phaser | El `.woff2`/`.ttf` es el mismo archivo, cargado distinto en cada sistema |

La fuente tipográfica es un buen ejemplo: el archivo físico (`DojoFont.woff2`) es uno solo en `/public/fonts/`, pero React lo declara en CSS (`@font-face`) y Phaser lo carga como Bitmap Font o WebFont Loader plugin. Mismo archivo, dos mecanismos de carga — eso **no** es duplicación, es la naturaleza de tener dos renderers.

---

## 7. Checklist antes de generar un nuevo asset

Antes de pedirle a la IA (o a un diseñador) un nuevo botón/ícono:

- [ ] ¿Ya existe un asset base que pueda reutilizarse vía nineslice/atlas en vez de generar uno nuevo a medida?
- [ ] ¿El nuevo asset se usará en React, Phaser, o ambos? → define dónde vive desde el inicio (`/ui/` plano vs atlas)
- [ ] ¿Tiene texto quemado en la imagen? → si sí, regenerar sin texto; el texto siempre va como capa de texto real (HTML o `Phaser.Text`)
- [ ] ¿Actualiza el JSON de config (`assetConfig.js`)? → si cambian los márgenes de slice, un solo lugar

---

## 8. Resumen ejecutivo

1. **Un repositorio físico de assets** en `/public/assets/`, no copias por sistema.
2. **Botones y UI compartida** → 9-slice nativo en cada lado (`border-image` en CSS, `NineSlice` en Phaser), leyendo la misma imagen y la misma config de slicing.
3. **Sprites exclusivos de Phaser** (personaje, partículas) → atlas empaquetado, no tocan React.
4. **Texto siempre como texto real**, nunca quemado en el PNG, en ningún sistema.
5. **Una config compartida** (`assetConfig.js` / JSON) define medidas de slicing una sola vez para que ambos sistemas queden sincronizados ante cualquier cambio de diseño.

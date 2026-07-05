# Guía de Resoluciones de Assets

**Contexto:** Generación con Gemini (Nano Banana) / IA generativa → uso en React (landing/selector) + Phaser (gameplay)

---

## 0. El problema de base con Gemini/IA generativa

Los modelos de imagen (Gemini, GPT Image, Midjourney) generan en **resoluciones fijas predefinidas**, normalmente:
- Cuadrado: `1024x1024`
- Vertical: `1024x1536` (o similar 2:3)
- Horizontal: `1536x1024` (o similar 3:2)

**No vas a poder pedirle "dame esto en 600x200px exactos"** de forma confiable — el modelo generará en su resolución nativa y tú necesitas un paso de post-procesamiento (recorte + ajuste) antes de meterlo al proyecto. Esto es normal y se planifica, no es un error de la IA.

**Flujo correcto:**
1. Genera en la resolución nativa más cercana a la proporción que necesitas (cuadrado para iconos/personaje, horizontal para botones anchos, etc.)
2. Recorta/ajusta en Figma, Photoshop o Photopea (gratis) a la proporción exacta de tu nineslice/grid
3. Exporta al tamaño final que tu proyecto consume
4. Comprime (TinyPNG, Squoosh) antes de subir a `/public/assets/`

---

## 1. Resoluciones objetivo por categoría de asset

### 1.1 Botones (9-slice)

| Propiedad | Valor recomendado |
|---|---|
| Tamaño de generación en Gemini | `1536x1024` (horizontal) — el botón siempre es más ancho que alto |
| Tamaño base de trabajo (post-recorte) | `600x200px` |
| Margen de slice (esquinas no deformables) | `40-50px` por lado |
| Formato final | PNG-24 con transparencia |
| Peso objetivo tras compresión | < 80kb |

> Por qué 600x200 y no más: el nineslice estira el centro, así que no necesitas generar en alta resolución — necesitas que el **borde/esquina** (la parte que NO se estira) tenga suficiente detalle. 600x200 es más que suficiente incluso en pantallas 4K, porque el centro estirado no tiene detalle que perder.

### 1.2 Iconos sueltos (campana, sakura, linterna, etc.)

| Propiedad | Valor recomendado |
|---|---|
| Tamaño de generación en Gemini | `1024x1024` |
| Tamaño base de trabajo | `128x128px` o `256x256px` |
| Formato final | SVG si es posible (vectorizar con herramienta tipo Vectorizer.ai), si no, PNG con transparencia |
| Peso objetivo | < 15kb por ícono |

> Si puedes, vectoriza estos. Son formas simples y repetidas en distintos tamaños (campanita en botón chico, campanita en header grande) — SVG escala sin pérdida y pesa una fracción de un PNG.

### 1.3 Personaje base (tortuga) y capas de personalización

Esto es lo más sensible de la guía, porque **todas las capas deben coincidir en resolución y proporción exacta** para que el caparazón A encaje igual que el caparazón B sobre el mismo cuerpo.

| Propiedad | Valor recomendado |
|---|---|
| Tamaño de generación en Gemini | `1024x1024` (cuadrado, deja espacio de aire alrededor del personaje) |
| Tamaño base de trabajo (todas las capas) | `512x512px` — **idéntico para cuerpo base, caparazones, bandanas, tatuajes** |
| Canvas/lienzo | Mismo tamaño y mismo punto de origen (0,0) en todas las capas — el personaje debe estar en la **misma posición de píxel** en cada imagen |
| Formato | PNG-24 con transparencia, obligatorio (no JPG) |
| Resolución para gameplay animado (Phaser, si se anima por sprite sheet) | Define el frame individual en `256x256` o `128x128` según tamaño en pantalla final, empaquetado en atlas |

**Regla crítica:** genera el cuerpo base de la tortuga **primero**, fija ese canvas, y luego pide cada variante de caparazón/bandana/tatuaje pidiéndole explícitamente al modelo "mismo ángulo, misma pose, mismo tamaño relativo del personaje dentro del lienzo" — o mejor aún, usa la función de edición (no generación desde cero) de Gemini sobre la imagen base para garantizar alineación.

Para el preview estático en React (sección del selector) puedes usar directamente estos 512x512. Para el sprite animado dentro de Phaser, normalmente se reduce a un tamaño de frame más chico una vez definida la escala real en pantalla.

### 1.4 Fondos / Escenarios (background del selector y del gameplay)

| Propiedad | Valor recomendado |
|---|---|
| Tamaño de generación en Gemini | `1536x1024` (horizontal) — la más cercana a 16:9 |
| Tamaño base de trabajo | `1920x1080px` mínimo (full HD), idealmente `2560x1440` si el presupuesto de peso lo permite |
| Formato | JPG (sin transparencia, peso menor) salvo que necesites capas transparentes sobre el fondo |
| Peso objetivo | < 300-500kb tras compresión (usar formato WebP si el navegador lo soporta, ~30% más liviano que JPG) |

> Importante: 1536x1024 generado por IA **no es suficiente para llenar una pantalla 1920x1080 sin pérdida de nitidez** si lo escalas tal cual. Vas a necesitar hacer **upscale** (Topaz Gigapixel, o el upscale nativo de Photoshop/Krea) del resultado de Gemini antes de usarlo como fondo a pantalla completa. Si el fondo se usa con `background-size: cover` y se ve principalmente en zonas no críticas (bordes/sangrado, como vimos antes), la pérdida de nitidez es tolerable; si es protagonista (close-up), necesitas el upscale.

### 1.5 Atlas/Spritesheet para Phaser (gameplay, no UI)

| Propiedad | Valor recomendado |
|---|---|
| Tamaño máximo de atlas recomendado | `2048x2048px` (límite seguro cross-device; algunos móviles antiguos no soportan más) |
| Tamaño individual por sprite dentro del atlas | Depende del elemento — personaje jugable suele ir en `128x128` a `256x256` por frame |
| Formato | PNG-24, empaquetado con TexturePacker o free-tex-packer |
| Power-of-two | No es obligatorio en WebGL moderno, pero recomendado si el target incluye dispositivos viejos (`256, 512, 1024, 2048`) |

---

## 2. Tabla resumen rápida (referencia de bolsillo)

| Asset | Generar en Gemini | Trabajar/exportar a | Formato |
|---|---|---|---|
| Botón (nineslice) | 1536x1024 | 600x200 | PNG-24 |
| Ícono suelto | 1024x1024 | 128–256px | SVG / PNG |
| Cuerpo tortuga base | 1024x1024 | 512x512 | PNG-24 |
| Caparazón / bandana / tatuaje | 1024x1024 (editando sobre base) | 512x512 (mismo canvas que base) | PNG-24 |
| Fondo selector/gameplay | 1536x1024 + upscale | 1920x1080 o 2560x1440 | JPG / WebP |
| Atlas Phaser | N/A (composición manual) | hasta 2048x2048 | PNG-24 |

---

## 3. Checklist antes de pedirle el asset a Gemini

- [ ] ¿Sé si esto va a usarse como nineslice (botón), capa de personaje, ícono o fondo? → determina la proporción de generación
- [ ] ¿Necesito transparencia? → pedir explícitamente "fondo transparente" o "isolated on white background" para luego quitar el fondo (Gemini no siempre da transparencia real, a veces hay que remover el fondo después con remove.bg o similar)
- [ ] Si es una capa de personaje, ¿ya generé el cuerpo base? → todas las variantes deben editarse sobre esa base, no generarse sueltas desde cero
- [ ] ¿Este asset será visto en close-up (necesita upscale) o es decorativo de fondo (resolución nativa basta)?

---

## 4. Nota sobre transparencia con Gemini

Gemini (como la mayoría de modelos de generación de imagen) entrega **fondo sólido**, no transparencia real en el PNG, incluso si le pides "transparent background" — a veces lo intenta y queda con halos o imperfecciones. Plan B siempre disponible:

1. Pide el asset con fondo **blanco liso** o de colour sólido contrastante (más confiable que pedir transparencia directa)
2. Usa una herramienta de remoción de fondo (remove.bg, Photoshop's "Select Subject", o Photopea gratis) para obtener el PNG transparente real antes de subirlo al proyecto

Esto te ahorra reintentos de prompt tratando de forzar transparencia que el modelo no siempre entrega de forma limpia.

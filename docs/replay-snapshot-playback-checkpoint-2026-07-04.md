# Checkpoint Replay Snapshot Playback

Fecha: 2026-07-04

## Objetivo

Este checkpoint documenta la aplicacion de la fase 5 del plan de reparacion de replays. La fase mueve el visor hacia playback principal desde snapshots y deja la simulacion derivada por eventos solo como fallback legacy.

## Cambios Aplicados

### ReplayScene

- `frontend/src/games/shared/ReplayScene.ts`
  - Temple Curling ahora normaliza stones desde `entities` cuando existen.
  - `objects` queda como fallback de compatibilidad para replays antiguos.
  - Bamboo Bash, Kame Knock y Bell Clash ya normalizan projectiles desde `entities` de forma preferente.
  - `balls` queda como fallback de compatibilidad cuando no hay `entities`.
  - Kame Knock solo usa `buildProjectileStatesFromEvents` si el frame no tiene `replayVersion`.
  - Los frames con contrato v1 no usan simulacion por eventos para reconstruir projectiles.

## Regla Actual

- Replays v1:
  - render principal desde `snapshot.entities`;
  - interpolacion entre frame actual y siguiente;
  - eventos no reconstruyen estado visible principal.

- Replays legacy:
  - si faltan `entities`/`balls`, se permite fallback por eventos;
  - la simulacion derivada queda limitada a compatibilidad historica.

## Compatibilidad

- No se elimina `buildProjectileStatesFromEvents`, porque aun puede ser necesario para replays antiguos.
- No se cambia el contrato de backend ni la persistencia.
- No se rompe lectura de `objects` o `balls`.

## Limitaciones Pendientes

- Todavia no hay fixtures automatizados de replay por juego.
- Todavia falta matriz manual completa online/local/importado.
- La validacion de imports no comprueba rangos finos de coordenadas ni relacion exacta `balls` contra `entities`.

## Siguiente Paso

Ejecutar fase 7: validacion.

Trabajo recomendado:

1. Probar manualmente Temple Curling, Bamboo Bash, Kame Knock y Bell Clash.
2. Validar online multiplayer, local-versus y singleplayer importado.
3. Revisar duracion, turnos, fondo activo, entidades, trails, score, final de partida y powerups.
4. Crear fixtures de imports validos e invalidos.
5. Anadir pruebas unitarias para normalizacion, validacion y resolucion visual.

## Validacion Realizada

- `backend`: `npm run build`.
- `frontend`: `npm run build`.

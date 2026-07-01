# Docker Architecture Review — 2026-06-24

## Objetivo

Analizar la arquitectura Docker del proyecto para detectar:

- ineficiencias de build y arranque
- consumo excesivo de disco e imágenes
- decisiones de diseño que no aportan valor
- riesgos de seguridad o puntos mal planteados

## Situación observada

Medición inicial en Docker:

```text
Images:       14.44GB
Build Cache:   5.976GB
Local Volumes: 2.745GB
```

Imágenes relevantes antes de optimizar:

```text
transcendence/backend:local       925MB
transcendence/frontend:local      397MB
transcendence/monitoring:local   1.03GB
transcendence/reverse_proxy:local 215MB
transcendence/database:local      402MB
transcendence/redis:local         57.5MB
transcendence/vault:local         662MB
transcendence/vault-agent:local   662MB
```

## Problemas detectados

### 1. Contextos de build mal definidos

`backend` y `frontend` estaban enviando al build contenido que no debía formar parte del contexto:

- `node_modules`
- `dist`
- ficheros `.env`
- logs

Eso forzaba:

- transferencias de cientos de MB al daemon
- invalidación frecuente de la caché
- builds más lentos sin aportar nada útil

### 2. Frontend en producción usando Node para servir estáticos

El frontend compilado se servía con `serve` sobre una imagen Node. Para un bundle estático, eso encarece:

- tamaño de imagen
- superficie de ataque
- tiempo de arranque

### 3. Backend incluyendo dependencias de desarrollo en runtime

La imagen final del backend copiaba `node_modules` completos desde la etapa builder. Eso metía en producción:

- `typescript`
- `jest`
- `eslint`
- `@nestjs/cli`
- otras devDependencies

Consecuencia:

- imagen mucho más pesada
- más superficie vulnerable
- más tiempo de extracción y arranque

### 4. Vault y Vault Agent se construían localmente sin necesidad

Había Dockerfiles locales casi vacíos para `vault` y `vault-agent`, aunque realmente se usaba la imagen oficial de HashiCorp sin valor añadido relevante.

Eso solo aportaba:

- builds adicionales
- más ruido en la arquitectura
- más tiempo en `make up`, `make dev` y `make re`

### 5. `make dev` recreaba demasiado

El target `dev` usaba recreación agresiva de contenedores incluso cuando no era necesario.

Eso empeoraba:

- tiempo de arranque
- feedback loop de desarrollo
- reutilización de contenedores ya válidos

### 6. `monitoring` estaba serializado innecesariamente

El servicio `monitoring` esperaba a que `backend`, `database` y `redis` estuvieran `healthy` antes de arrancar.

Eso no es necesario para que Grafana/Prometheus levanten. Como mucho puede afectar a que algunos targets aparezcan como `DOWN` al principio, pero no impide que el stack de monitoring arranque.

### 7. `make re` destruye demasiado

`make re` sigue siendo estructuralmente caro porque hace:

- eliminación de imágenes
- eliminación de volúmenes
- recreación completa del stack

Eso impide aprovechar caché y persistencia. Es correcto si de verdad se quiere un reset total, pero es mala opción para el ciclo habitual de desarrollo.

### 8. Riesgos de seguridad pendientes

Se detectaron puntos a revisar, aunque no se modificaron todavía:

- CSP del reverse proxy con `'unsafe-inline'` y `'unsafe-eval'`
- vulnerabilidades reportadas por `npm` en frontend y backend
- imágenes pesadas como `monitoring`, que concentran demasiadas responsabilidades

## Cambios aplicados

### A. Contextos de build optimizados

Se corrigieron:

- `.dockerignore`
- `backend/.dockerignore`
- `frontend/.dockerignore`

Con esto, los contextos de build bajaron aproximadamente a:

- `backend`: ~8KB
- `frontend`: ~9KB

### B. Backend multi-stage real

Se reorganizó `backend/Dockerfile` en etapas:

- `deps`
- `builder`
- `prod-deps`
- runtime final

Resultado:

- build reproducible con `npm ci`
- runtime con solo dependencias de producción
- menos tamaño final

### C. Frontend runtime migrado a Nginx

Se sustituyó el runtime Node + `serve` por Nginx Alpine con config SPA.

Resultado:

- imagen más pequeña
- menos complejidad
- mejor ajuste al caso de uso real

### D. Vault y Vault Agent pasan a imagen oficial directa

`docker-compose.yml` ahora usa `hashicorp/vault:1.18.5` directamente para:

- `vault`
- `backend_vault_agent`
- `database_vault_agent`
- `redis_vault_agent`
- `monitoring_vault_agent`

### E. `make dev` menos agresivo

Se eliminaron recreaciones y builds innecesarios para mejorar el ciclo de desarrollo.

### F. `monitoring` menos bloqueante

Se redujeron dependencias de health innecesarias para que Grafana/Prometheus no queden serializados detrás de toda la aplicación.

### G. Descarga de Prometheus estabilizada

Antes se descargaba Prometheus desde GitHub en build-time. Eso ya se cambió para copiar binarios desde la imagen oficial `prom/prometheus`.

## Resultado medido tras optimizar runtime

Build de producción validado para `frontend` y `backend`.

Tamaños resultantes:

```text
transcendence/frontend:local 160MB
transcendence/backend:local  390MB
```

Mejoras aproximadas:

- frontend: `397MB -> 160MB`
- backend: `925MB -> 390MB`

## Conclusiones

Las mayores ineficiencias no estaban en Docker Compose en sí, sino en:

- contextos de build mal acotados
- imágenes Node usadas donde no hacían falta
- devDependencies colándose en runtime
- builds locales de imágenes wrapper sin valor real
- targets de Make demasiado destructivos para el día a día

## Recomendaciones siguientes

### Prioridad alta

1. Dejar de usar `make re` como flujo habitual de desarrollo.
2. Añadir un target intermedio tipo `fast-re`, `reset-app` o `dev-refresh` que:
   - no borre imágenes
   - no borre volúmenes
   - solo reconstruya servicios necesarios
3. Revisar vulnerabilidades de `npm audit` en backend y frontend.

### Prioridad media

1. Revisar si `monitoring` debe seguir siendo un contenedor único o dividirse.
2. Reducir el tamaño de `monitoring`, que todavía supera 1GB.
3. Endurecer la CSP cuando el frontend permita eliminar `unsafe-inline` y `unsafe-eval`.

### Prioridad baja

1. Revisar si `database` necesita realmente una imagen custom o si basta con la oficial más un entrypoint bind-mount.
2. Valorar si `reverse_proxy` puede adelgazar algo más, aunque no es el principal problema ahora mismo.

## Ficheros modificados en esta revisión

- `.dockerignore`
- `backend/.dockerignore`
- `frontend/.dockerignore`
- `backend/Dockerfile`
- `frontend/Dockerfile`
- `frontend/conf/default.conf`
- `docker-compose.yml`
- `Makefile`
- `infra/monitoring/Dockerfile`

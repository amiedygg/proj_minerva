# PLAN — proj_minerva

> Sandbox del plan de la tarea actual. Se actualiza al empezar/terminar cada fase.
> Control de tareas y bitácora: `TASKS.md`. Estrategia multi-agente: `WORKFLOW.md`.

## Iteración actual (2026-07-11): F10 — v0.3.0 Lista de PRs: filtro de estado, refresh, watcher de cambios y leído/no-leído

> Rama `feature/pr-list-filters-watcher` (desde `main`). Versión `0.3.0`.
> Pedido de Edilson (2026-07-11) con 4 decisiones confirmadas vía preguntas:
> 1. Filtro segmented **Abiertos / Cerrados / Todos** (Cerrados incluye merged; badge
>    distingue merged vs closed en cada item). Default: Abiertos.
> 2. Polling desde **main cada 60s** (pausa sin sesión, backoff ante rate limit).
> 3. **Solo indicadores in-app** (dots/colores). Notificaciones nativas del SO: follow-up.
> 4. Un PR se marca **visto al abrirlo en el detalle** (sella `updatedAt` +
>    `commentCount` actuales; si luego llega un update/comentario, el dot vuelve).

### Estado actual (relevado)

- `is:open` HARDCODEADO en la búsqueda (`real-service.ts:533`); sin paginación (top 50).
- Sin polling de PRs, sin `refetch` en `use-pull-requests`, sin refresh manual en UI.
- Único evento push main→renderer: `analysisProgress` (patrón `broadcastProgress` en
  `handlers.ts:32` replicable).
- Ningún estado leído/no-leído; `updatedAt` y `commentCount` YA vienen en el summary.
- `PrListItem` no pinta `commentCount` hoy.
- Fixtures mock: TODOS los PRs son `open` — hay que añadir closed/merged.

### Diseño

**Contrato (`src/shared/`)**
- `types.ts`: `PrStateFilter = 'open' | 'closed' | 'all'`;
  `PrUnread = { isNew: boolean; hasUpdates: boolean; hasNewComments: boolean }`;
  `PullRequestSummary.unread?: PrUnread` — OPCIONAL: lo decora SOLO el handler IPC
  (los servicios GitHub quedan puros; `PullRequestDetail` no lo necesita).
- `ipc.ts`: `github:listPullRequests` req → `{ search?, state?: PrStateFilter }`;
  canal nuevo `github:markPrSeen` req `{ prId: string; updatedAt: string;
  commentCount: number }` → res `{ ok: true }`.
- `events.ts`: `MINERVA_EVENTS.prListChanged`, payload `PrListChangedEvent =
  { changes: PrChange[] }` con `PrChange = { type: 'new_pr' | 'pr_closed' |
  'pr_merged' | 'new_comments' | 'updated'; prId; number; title; repo: RepoRef }`.
  Se emite SOLO cuando hay cambios (el primer snapshot es baseline silencioso).
- Preload: `events.onPrListChanged(cb)` (método concreto, como `onAnalysisProgress`).

**Main — GitHub (`src/main/github/`)**
- `real-service.ts`: qualifier por estado — open→`is:open`, closed→`is:closed`,
  all→ninguno — y `sort:updated-desc` SIEMPRE (determinismo; con closed en juego los
  50 más recientes son los relevantes).
- `mock-service.ts`: filtro por estado en memoria; `fixtures.ts` gana 2–3 PRs
  closed/merged (gotcha: sin backticks en strings de fixtures).
- `seen-store.ts` NUEVO: `pr-seen.json` en userData, patrón `settings/store.ts`
  (lazy `app.getPath` — nunca en import/constructor —, escritura atómica tmp+rename,
  tolerante a corrupción). Map `prId → { updatedAt, commentCount, seenAt }`, cap 1000
  entradas (prune por `seenAt` más viejo). API: `get`, `markSeen`,
  `computeUnread(summary): PrUnread` (`isNew` = sin entrada; `hasUpdates` =
  `summary.updatedAt > entry.updatedAt`; `hasNewComments` = `commentCount >` sellado).
  Primer arranque: sin entradas ⇒ todo aparece como no visto (honesto, decisión de diseño).
- `pr-watcher.ts` NUEVO: `createPrWatcher({ list, broadcast })` con `start()/stop()`.
  Tick cada 60s (`MINERVA_WATCH_INTERVAL_MS` lo overridea para e2e): pide
  `listPullRequests({ state: 'all' })`, diff contra snapshot anterior (Map por id):
  id nuevo → `new_pr`; open→closed/merged → `pr_closed`/`pr_merged`;
  `commentCount`↑ → `new_comments`; `updatedAt` distinto → `updated`.
  Broadcast `prListChanged` solo con `changes.length > 0`. Errores: "No autenticado"
  ⇒ skip silencioso (reintenta al próximo tick); rate limit ⇒ backoff exponencial
  (x2 hasta 15 min, reset al éxito). `stop()` en `before-quit`.

**Main — IPC (`src/main/ipc/`)**
- `validators.ts`: `listPullRequests` acepta `state` (enum de 3); validator nuevo para
  `markPrSeen` (prId string no vacío ≤200, updatedAt string ISO ≤64, commentCount
  entero ≥0).
- `handlers.ts`: decorar la respuesta de `listPullRequests` con `unread` vía seen-store
  (capa handler, no servicio); handler `github:markPrSeen`; instanciar y arrancar el
  watcher con el mismo `githubService` + patrón broadcast existente.

**Renderer (`src/renderer/src/`)**
- `app-store.ts`: `prStateFilter: PrStateFilter` (default `'open'`) + `setPrStateFilter`
  (sesión, sin persistir).
- `use-pull-requests.ts`: param `state`; expone `refetch()`; se suscribe a
  `onPrListChanged` → `refetch()` (respeta search+filtro vigentes); expone
  `markSeen(pr)` → IPC `markPrSeen` + clear optimista de `unread` en el estado local.
- `Sidebar.tsx`: header con segmented control (Abiertos | Cerrados | Todos) + botón
  refresh (`RefreshCw`, `animate-spin` mientras `loading`); `onClick` del item:
  `selectPr(pr)` + `markSeen(pr)`.
- `PrListItem.tsx`: dot rojo (título) si `unread.isNew || unread.hasUpdates`; contador
  de comentarios (icono `MessageSquare` + count, hoy no se pinta) con mini-dot rojo si
  `unread.hasNewComments`; badge de estado para closed (gris/rojo) y merged (morado)
  cuando `state !== 'open'`; título de PR visto sin updates ligeramente atenuado vs
  no visto en `text-text`.

### Invariantes / gotchas a respetar
- Secretos solo en main; preload expone métodos concretos, jamás `ipcRenderer` crudo.
- Main: sin backticks en strings largos, `import.meta.dirname`, preload CJS intacto.
- `app.getPath('userData')` SIEMPRE perezoso (patrón settings-store).
- Nada de `setState`-en-efecto en renderer (patrón `cancelled` + callbacks).
- Suites e2e: target CDP excluye `#didactic`, limpiar estado global al arrancar,
  señales inequívocas, `location.reload()` para resetear el store si hace falta.

### Fases (tareas en TASKS.md)
- **T50** — Contrato compartido + preload + validators (shared/ipc/events/preload).
- **T51** — Main: filtro de estado real+mock, fixtures closed/merged, seen-store,
  decoración unread + markPrSeen, watcher + broadcast. (Tras T50.)
- **T52** — Renderer: filtro segmented + refresh + dots/badges + markSeen al abrir.
  (Tras T50; en paralelo con T51.)
- **T53** — Suite e2e `scripts/smoke-pr-list.mjs` + verificación integral.

### Verificación (orquestador)
- typecheck/lint/`npm test` verdes.
- E2e (MINERVA_MOCK=1 + CDP): (1) filtro: Abiertos no muestra closed, Cerrados muestra
  closed+merged con badges, Todos muestra ambos; (2) refresh manual re-fetchea (spinner
  + lista estable); (3) dots: PR no visto tiene dot, seleccionarlo lo apaga y persiste
  tras reinicio (seen-store en disco); postComment sube commentCount ⇒ dot de
  comentarios al refrescar; (4) watcher: con `MINERVA_WATCH_INTERVAL_MS` corto, un
  cambio en el mock dispara `prListChanged` y la lista se actualiza sola.
- Captura MIRADA de la sidebar: segmented + refresh + dots + badges merged/closed.

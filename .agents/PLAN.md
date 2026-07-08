# PLAN — proj_minerva

> Sandbox del plan de la tarea actual. Se actualiza al empezar/terminar cada fase.
> Control de tareas y bitácora: `TASKS.md`. Estrategia multi-agente: `WORKFLOW.md`.

## Iteración actual (2026-07-07): F9 — Persistencia del análisis + metadata de generación + staleness por SHA

> Rama `feature/analysis-persistence` (desde `feature/model-effort`/F8, aún sin PR/merge a
> main). Nace de dos issues reportados por Edilson tras F8.

### Los dos issues

1. **Banner obsoleto (Issue 1).** El header del panel didáctico muestra "vía
   proveedor · modelo · esfuerzo" (`ActiveModelHint`), pero lo lee de la config ACTUAL
   (`useSettings` → `settings:get`). Si cambio el proveedor/modelo/effort en Settings, el
   banner de un análisis YA generado con la config anterior cambia — miente sobre con qué
   se generó ese reporte. **El banner debe reflejar con qué se generó el análisis que se
   está mostrando, no la config vigente.**

2. **Persistencia + staleness por SHA (Issue 2).** Hoy `AnalysisCache` es SOLO en memoria
   (se pierde al cerrar la app). El último resumen de un PR debe **persistir** entre
   sesiones. Pero un PR puede recibir commits nuevos: si el **SHA del último commit del
   head** cambia respecto al que tenía cuando se generó el resumen, hay que **avisar al
   usuario y sugerirle actualizar** el panel didáctico (re-analizar re-pide diff/detalle,
   así se re-solicitan los cambios del PR). Estrategia de alerta = comparar
   `analysis.headSha` (sellado al generar) contra el `headSha` ACTUAL del PR.

### Diseño

**Modelo de datos (`shared/types.ts`)** — split limpio productor/consumidor:
- `GeneratedAnalysis` = lo que produce un `AiService`: `{ prId, sections, generatedAt }`
  (la forma vieja de `DidacticAnalysis`). El return type de `AiService.analyzePullRequest`
  pasa a ser este.
- `AnalysisGenerationInfo` = `{ provider: AiProviderId; model: string; options: Record<string,string> }`.
- `DidacticAnalysis extends GeneratedAnalysis` = `+ headSha: string + generatedWith: AnalysisGenerationInfo`.
  Es lo que se cachea, se persiste y se devuelve al renderer. **Solo el handler construye
  este objeto enriquecido** (sella `headSha` + `generatedWith`); los servicios NO tocan
  esos dos campos → cambio mínimo en openrouter/claude/codex/mock (solo su return type).
- `PullRequestSummary` gana `headSha: string` (SHA del último commit del head), heredado
  por `PullRequestDetail`.

**GitHub (`main/github/`)**:
- `real-service.ts`: añadir `oid` al `lastCommit { nodes { commit { oid statusCheckRollup } } }`
  en AMBAS queries (search + detail); mapear a `headSha` en `mapSearchNode`/`mapDetailNode`.
- `mock-service.ts` + `fixtures.ts`: cada fixture con un `headSha` estable; el mock devuelve
  ese SHA en summary/detail. **Afordance de test** (solo mock): poder mutar el `headSha` de
  un PR en runtime para verificar staleness e2e (canal debug gated a mock — ver T42).

**Persistencia a disco (`main/ai/analysis-store.ts` nuevo)**:
- Réplica del patrón de `settings/store.ts`: `analyses.json` en `app.getPath('userData')`,
  escritura atómica (tmp + rename), lectura perezosa tolerante a corrupción.
- Forma: `{ version: 1, entries: [{ key: "owner/name#n", analysis: DidacticAnalysis }] }`,
  orden = recencia LRU, cap 20 (igual que la cache en memoria).
- `AnalysisCache` pasa a ser disk-backed: hidrata de disco en el primer acceso (perezoso,
  app ya ready), write-through en `set`/`invalidate`. Entradas en disco con forma inválida
  (sin `headSha`/`generatedWith`, corruptas) se descartan al hidratar, sin crashear.

**Handler (`ipc/handlers.ts`, `ai:analyzePullRequest`)** — sellado en el análisis NUEVO
(solo en el camino de cache-miss, tras generar):
- Captura `getEffectiveAiSelection()` → `{ provider, model, options }` = `generatedWith`.
- Captura `headSha` del PR (fetch de `githubService.getPullRequestDetail(req)` — barato,
  solo en cache-miss; el SHA rara vez cambia durante el análisis).
- Enriquecer el `GeneratedAnalysis` del servicio → `DidacticAnalysis` completo antes de
  `analysisCache.set(...)`. El evento terminal y el snapshot no cambian.

**Renderer — Issue 1 (`ActiveModelHint` + `DidacticAnalysisArea`)**:
- `ActiveModelHint` acepta un `generatedWith?: AnalysisGenerationInfo` opcional: si viene,
  pinta proveedor/modelo/effort DESDE él (los labels salen del catálogo estático de
  `useSettings().info.catalog`, que no cambia con la selección); si no viene (streaming en
  curso, aún sin `analysis`), cae a la config actual como hoy.
- `DidacticAnalysisArea`: cuando hay `analysis`, pasa `analysis.generatedWith`; en streaming
  no pasa nada (se genera con la config vigente, es correcto mostrarla).

**Renderer — Issue 2 (staleness)**:
- `DidacticAnalysisArea` acepta `currentHeadSha?: string` opcional:
  - Panel acoplado: `DidacticPanel` lo pasa desde `selectedPr.headSha` (ya lo tiene).
  - Ventana desacoplada: no lo tiene → un hook fetchea el detalle una vez para el headSha.
- `isStale = analysis && currentHeadSha && analysis.headSha !== currentHeadSha`.
- Barra de aviso NO destructiva sobre el análisis: "Este PR recibió commits nuevos desde
  que se generó este resumen (abc123 → def456). [Actualizar]". "Actualizar" = `reanalyze()`
  (invalida + re-analiza; el AiService re-pide diff/detalle → re-solicita los cambios).
  El análisis viejo sigue visible debajo mientras tanto.

### Invariantes / gotchas a respetar
- Pipeline de streaming AGNÓSTICO del proveedor (protocolo `@@@SECTION`): no se toca.
- Secretos solo en main; el renderer nunca ve tokens/keys.
- Gotchas de main: sin backticks en strings largos, `import.meta.dirname`, preload CJS,
  reiniciar `npm run dev` al tocar `src/main/**`.
- `analysisCache` es singleton de módulo: `app.getPath('userData')` SOLO perezoso (como
  `settings/store.ts`), nunca en el constructor (app puede no estar ready).
- Persistir SOLO análisis completos (mismo punto que el `analysisCache.set` actual).

### Fases (tareas en TASKS.md)
- **T39** — Backbone de datos + GitHub headSha (types split, real-service `oid`, mock+fixtures).
- **T40** — Stamping en el handler + persistencia a disco (`analysis-store.ts`, cache disk-backed).
- **T41** — Banner desde el análisis (Issue 1).
- **T42** — Staleness UI + prompt de actualización + afordance de test del mock (Issue 2).

### Verificación (orquestador)
- typecheck/lint/`npm test` verdes.
- E2e: (1) banner sella la config: analizar con proveedor A, cambiar Settings a B, el banner
  sigue mostrando A; (2) persistencia: analizar → reiniciar app → el análisis sigue (sin
  re-pagar LLM); (3) staleness: analizar (sha A) → mutar el sha del mock a B → reabrir el PR
  → aparece la barra "commits nuevos" → "Actualizar" re-analiza y la barra desaparece.
- Captura mirada de: banner sellado tras cambiar config, y barra de staleness.

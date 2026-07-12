# PLAN — proj_minerva

> Sandbox del plan de la tarea actual. Se actualiza al empezar/terminar cada fase.
> Control de tareas y bitácora: `TASKS.md`. Estrategia multi-agente: `WORKFLOW.md`.

## Iteración actual (2026-07-11): F11 — Panel didáctico como harness agéntico sobre snapshot del PR + proveedor OpenCode

> Rama `feature/didactic-agentic-harness` (desde `main`, pedido explícito de Edilson —
> F10 sigue en su propia rama sin mergear; la numeración de tareas T54+ no colisiona
> con T50–T53 de F10). Versión objetivo `0.4.0`.
> Pedido de Edilson (2026-07-11), iterado en diseño en sesión. Decisiones confirmadas:
> 1. Cada análisis trabaja sobre una **copia local del commit exacto del PR** (tarball
>    de GitHub por `headSha`, con limpieza periódica), y el modelo tiene **herramientas
>    read-only** (grep/read/glob) sobre ese directorio — deja de ver solo diff+metadatos.
> 2. **OpenCode reemplaza a OpenRouter** como proveedor (patrón T3 Code: `opencode
>    serve` + `@opencode-ai/sdk`). El usuario configura OpenRouter/otros upstream
>    DENTRO de OpenCode (`opencode auth login`). Se elimina toda la gestión de API key
>    de OpenRouter en Minerva.
> 3. Los TRES proveedores (OpenCode, Claude Code, Codex) se **agentizan desde el día 1**
>    — nada de migración gradual con proveedores en modo texto.
> 4. Sin ningún CLI instalado (y sin `MINERVA_MOCK=1`): **mensaje-guía accionable** con
>    los enlaces oficiales de instalación de los tres CLIs (ver abajo), tanto en el
>    panel didáctico como en Settings.

### Referencias de implementación (investigadas 2026-07-11)

- **t3code** (repo público `pingdotgg/t3code`, MIT; clon local en el scratchpad de la
  sesión del orquestador): `apps/server/src/provider/opencodeRuntime.ts` (spawn de
  `opencode serve --hostname=127.0.0.1 --port=<libre>` con `OPENCODE_CONFIG_CONTENT`
  inline, ready-line "opencode server listening", kill de process-group
  SIGTERM→SIGKILL), `Layers/OpenCodeAdapter.ts` (session.create → promptAsync →
  event.subscribe SSE), `Layers/OpenCodeProvider.ts` (probe `opencode --version` +
  mínimo de versión; modelos vía `client.provider.list()`, SOLO providers upstream
  "connected", slug `<provider>/<model>`, variants → descriptores de opción).
- **Doc OpenCode**: opencode.ai/docs/{server,sdk,permissions,config,agents}.
- **Gotchas confirmados**:
  - Streaming: basarse en `message.part.delta` + `session.idle` (bug conocido con
    `message.part.updated`, issues anomalyco/opencode #27966/#26697); consolidar al
    final con `session.messages()`.
  - SDK npm `@opencode-ai/sdk` va en **lockstep** con el CLI → pinnear versión exacta
    y gatear versión mínima del CLI (t3code exige ≥1.14.19). Hay API v2 en desarrollo
    (t3code importa `@opencode-ai/sdk/v2`; la doc pública muestra v1) — decidir v1/v2
    al implementar contra el binario real y anotar en bitácora.
  - `OPENCODE_CONFIG_CONTENT` tiene precedencia máxima pero se MERGEA sobre la config
    global del usuario (no la reemplaza) → reglas de permiso deny/allow explícitas y
    NUNCA `ask` (en headless un `ask` cuelga la sesión).
  - cwd por sesión: opción `directory` de `createOpencodeClient` (header
    `x-opencode-directory`) — un solo server sirve N directorios.
  - System prompt custom: campo `system` del prompt por request (v1), o agente
    "minerva" declarado inline en `OPENCODE_CONFIG_CONTENT`.
  - Local de Edilson: `opencode` **1.17.18** en `~/.local/bin`, ya con github-copilot
    conectado (56 modelos visibles vía `opencode models`) — se puede verificar el wire
    EMPÍRICAMENTE contra el binario real (lección T29: nunca adivinar el protocolo).

### Enlaces oficiales de instalación (verificados 2026-07-11)

| CLI | Página oficial | Instalación rápida (Linux/macOS) |
|---|---|---|
| OpenCode | https://opencode.ai/docs/ | `curl -fsSL https://opencode.ai/install \| bash` (tb. `npm i -g opencode-ai`, `brew install anomalyco/tap/opencode`) |
| Claude Code | https://code.claude.com/docs/en/setup | `curl -fsSL https://claude.ai/install.sh \| bash` |
| Codex | https://developers.openai.com/codex/cli/ (308 → learn.chatgpt.com/docs/codex/cli) | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` |

OJO: el link viejo `docs.claude.com/en/docs/claude-code/overview` (hardcodeado hoy en
`claude-code-service.ts`) redirige 301 a code.claude.com — actualizarlo en F11.

### Diseño

**Snapshot store (`src/main/github/snapshot-store.ts`)**
- `ensureSnapshot(repo, headSha): Promise<string>` → path a
  `userData/snapshots/<owner>-<name>-<sha7>/`. Fuente: método nuevo del
  `GithubService`: `writeSnapshot(req { repo, headSha }, destDir)` — real: tarball de
  `GET /repos/{o}/{r}/tarball/{sha}` (Octokit autenticado, NO git) extraído con la dep
  `tar` (node-tar, `strip: 1`, protección de traversal integrada); mock
  (`MINERVA_MOCK=1`): escribe un árbol fixture pequeño y plausible del universo
  shopwave directamente con `fs` (sin tarballs falsos).
- Dedupe de descargas en vuelo (patrón `inFlightAnalyses` del handler, T22).
- LRU en disco: tope de snapshots (10) y de bytes (2 GB); `touch` de mtime al usar;
  barrido al arrancar + timer periódico propio con `stop()` cableado en
  `app.on('before-quit')` de `main/index.ts`. Tarball sobre un tope (150 MB) se
  aborta con error claro.
- El snapshot es **contenido no confiable**: jamás ejecutarlo; solo lo leen las
  herramientas enjauladas de los proveedores. Sanitizar `owner`/`name`/`sha` a
  `[A-Za-z0-9._-]` antes de formar paths.

**Runtime OpenCode (`src/main/ai/providers/opencode-runtime.ts`)**
- `resolve-cli.ts` gana `'opencode'`; gate de versión mínima 1.14.19 vía
  `opencode --version` (probe cacheado, patrón `cli-probe.ts`).
- Spawn de `opencode serve` en puerto efímero (net.listen(0)) con env saneado
  (`spawn-env.ts` — OpenCode usa su propio auth store `~/.local/share/opencode/`,
  no necesita nuestras keys) + `OPENCODE_CONFIG_CONTENT` con permisos read-only:
  `"*"/edit/bash/webfetch/websearch/question/external_directory: "deny"`,
  `read/grep/glob/list: "allow"`.
- Ready: parsear stdout "opencode server listening on <url>" (timeout 10s); si el
  proceso muere antes, error con stdout/stderr. UN server para toda la app (lazy al
  primer uso); kill de process-group (spawn `detached`, SIGTERM→1s→SIGKILL) cableado
  en `before-quit`.

**`OpenCodeAiService` (`src/main/ai/providers/opencode-service.ts`)**
- Mismo contrato `AiService`. Por análisis: `ensureSnapshot` → cliente SDK con
  `directory=snapshot` → suscripción a eventos ANTES del prompt → `session.create` →
  prompt (`system` = system prompt didáctico; `model` = slug parseado a
  `{providerID, modelID}`; parts de texto) → filtrar `message.part.delta` del
  sessionID (solo texto del asistente; los eventos de tool alimentan la fase
  "explorando") → `StreamSectionParser` → fin por `session.idle`. Errores accionables
  (`opencode auth login`, CLI ausente → link de instalación).
- Timeouts NUEVOS agénticos en `analysis-timeouts.ts` (total 300s / inactividad 60s),
  usados por los TRES proveedores agentizados.

**User message agéntico (evolución de `analysis-prompt.ts`, compartido por los 3)**
- Sigue llevando metadatos + diff presupuestado (el snapshot es el estado FINAL: sin
  el diff el agente no sabe qué cambió) y añade: "el repo al commit del PR está en tu
  directorio de trabajo — explóralo (grep/read) antes de responder; no ejecutes nada".
- El system prompt (`prompts/analyze-pr.ts`) gana la sección de herramientas; el
  protocolo `@@@SECTION` y el parser NO cambian.

**Agentizar Claude Code y Codex (mismo día 1)**
- Claude Code: `cwd` = snapshot + tools read-only (`Read`/`Grep`/`Glob` — verificar
  nombres contra el .d.ts del SDK instalado), `maxTurns` alto, MANTENER
  `settingSources: []` y `persistSession: false` (el snapshot puede contener un
  CLAUDE.md/hooks hostiles — verificar que no se cargan).
- Codex: `thread/start` gana `cwd` = snapshot; YA corre `sandbox:'read-only'` (T29).
  Verificar el nombre real del param con `codex app-server generate-json-schema`
  (lección T29: el binario genera su propio esquema).

**Proveedores/modelos/settings**
- T57 AÑADE `'opencode'` a `AiProviderId`/registry/catálogo; T59 ELIMINA
  `'openrouter'` (orden importa). Probe "authenticated" = server responde y
  `provider.list()` reporta ≥1 upstream connected (criterio t3code).
- Modelos dinámicos vía `provider.list()` con cache TTL + fallback curado (patrón
  exacto `codex-model-catalog.ts`); slugs `<provider>/<model>`; "variants" →
  `ModelOptionDescriptor` (patrón T34).
- Migración de settings persistidos (en T59): `provider:'openrouter'` → `'opencode'`
  con modelo `openrouter/<id-viejo>`; borrar la key cifrada huérfana.
  `DEFAULT_AI_PROVIDER` → `'opencode'`; `DEFAULT_MODEL_BY_PROVIDER.opencode` →
  `'opencode/big-pickle'` (gateway free de OpenCode, presente sin upstream; revisar
  al verificar e2e).

**UI sin ningún CLI / estado "explorando"**
- `CliLoginGuide` se generaliza a los 3 proveedores y gana `installUrl` (tabla de
  arriba) como link real (`target="_blank"` → `external-link-guard`, que ya limita a
  http/https).
- Panel didáctico: si `ai:getProviderStatus` reporta TODOS `unavailable`, el
  placeholder muestra card "Necesitás al menos un CLI de IA" con los 3 enlaces +
  "Volver a comprobar". `createAiService` mantiene el throw accionable como red.
- Estado "explorando el repo…": `AnalysisProgressEvent` gana campo opcional
  `phase?: 'exploring' | 'writing'` (aditivo); el panel lo pinta antes de la primera
  sección.

### Tareas (T54–T61, control en TASKS.md)

- **T54** — `snapshot-store` + `GithubService.writeSnapshot` + limpieza periódica +
  fixtures mock. (Sin deps.)
- **T55** — `opencode-runtime`: resolve-cli, spawn `serve` + config read-only inline,
  ciclo de vida, versión mínima. (Sin deps.)
- **T56** — `OpenCodeAiService` end-to-end + user message agéntico compartido +
  timeouts agénticos. (Tras T54+T55.)
- **T57** — Registry/probe/modelos dinámicos de `opencode` + plumbing de settings.
  (Tras T55; en paralelo con T56.)
- **T58** — Agentizar Claude Code (cwd+tools) y Codex (cwd) sobre el snapshot.
  (Tras T54; en paralelo con T56/T57.)
- **T59** — Eliminar OpenRouter + migración de settings + limpieza UI/canales. (Tras T57.)
- **T60** — UI: card "sin CLIs" con enlaces + `CliLoginGuide` x3 + estado
  "explorando…". (Tras T57.)
- **T61** — Verificación integral + revisión de seguridad + docs + v0.4.0. (Final.)

### Invariantes / gotchas a respetar
- Secretos solo en main; preload con métodos concretos; validators por canal.
- Main: sin backticks en strings largos, `import.meta.dirname`, preload CJS intacto.
- `app.getPath('userData')` SIEMPRE perezoso (patrón settings-store).
- Prompt injection: snapshot y diff son DATO hostil; herramientas enjauladas (deny
  bash/write/red) y el system prompt mantiene la defensa `<pr_data>`.
- Procesos hijos: env saneado, kill en `before-quit`, nunca `ask` headless.
- E2e: target CDP excluye `#didactic`, limpiar estado global, señales inequívocas,
  captura MIRADA al final.

### Verificación (orquestador)
- typecheck/lint/`npm test` verdes.
- E2e `MINERVA_MOCK=1` (mock IA): pipeline intacto (secciones mock streameando).
- E2e con IA real (OpenCode + upstream de Edilson): análisis de un PR mock con
  exploración real del snapshot fixture → secciones reales; cambio de proveedor en
  Settings sin reiniciar; sin CLIs (PATH capado) la card muestra los 3 enlaces y
  abren en el navegador.
- Snapshots: se crean bajo userData, LRU expulsa al exceder topes, limpieza al arrancar.
- Captura mirada: "explorando…", análisis final, card sin CLIs, Settings x3.

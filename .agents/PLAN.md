# PLAN — proj_minerva

> Sandbox del plan de la tarea actual. Se actualiza al empezar/terminar cada fase.
> Control de tareas y bitácora: `TASKS.md`. Estrategia multi-agente: `WORKFLOW.md`.

## PROPUESTA (2026-07-07): F8 — Selector de modelo dinámico + reasoning effort

> **Estado: PLAN PROPUESTO, pendiente de decisión de Edilson (¿ejecutamos?).** No se ha
> tocado código. Nace de dos preguntas de Edilson sobre F7 ya mergeable.

### Las dos preguntas y sus respuestas (verificadas en vivo)

1. **"¿Por qué Codex solo muestra `gpt-5.5`?"** Porque el catálogo de Codex está
   HARDCODEADO a ese id en `shared/ai-providers.ts`. La RPC `model/list` de tu cuenta
   (plan *prolite*) devuelve **4 modelos**: `gpt-5.5` (default), `gpt-5.4`, `gpt-5.4-mini`,
   `gpt-5.3-codex-spark`. La lista la decide el propio `codex app-server` según el plan de
   la cuenta ChatGPT — NO debemos filtrar/curar nosotros (lección t3code: expone
   literalmente lo que devuelve `model/list`, sin `filter` por plan/`hidden`). Ya existe
   `codex-model-catalog.ts` con el fetch dinámico, pero (a) está SIN cablear a la UI y
   (b) fue escrito a ciegas y tiene bugs (asume `{models}`, real es `{data}`; `initialize`
   sin params).
2. **"¿Se puede configurar el esfuerzo (high/xhigh)?"** SÍ, en los tres proveedores
   (confirmado en los esquemas reales):
   - **Codex**: cada `Model` de `model/list` trae `supportedReasoningEfforts`
     (`[low, medium, high, xhigh]`) + `defaultReasoningEffort` (varía por modelo:
     gpt-5.5=medium, spark=high). Se pasa en `turn/start.effort`.
   - **Claude Code**: el Agent SDK define `EffortLevel = low|medium|high|xhigh|max` y
     `supportedEffortLevels` por modelo. Se pasa en `query({ options: { effort } })`.
     OJO: el set varía por modelo/versión del CLI y hay remapeos de compatibilidad
     (t3code: `xhigh`→`max` en modelos viejos, `max`→`high` en sonnet-4.6; `ultrathink`
     es un prefijo de prompt, no un param).
   - **OpenRouter**: parámetro `reasoning: { effort }` de la API, para los modelos que lo
     soporten (GPT-5.x, etc.) — verificar formato exacto al implementar.

### Diseño (patrón de t3code adaptado a la simplicidad de Minerva)

La joya de t3code: **descriptores de opción autocontenidos por modelo**
(`optionDescriptors: (Select|Boolean)[]`). Cada modelo declara SUS opciones (con choices +
default); la UI es 100% genérica sobre ese array (sin `if proveedor`), y cambiar de modelo
recalcula el valor contra las choices del nuevo modelo (si el guardado ya no aplica, cae al
default) — así NUNCA se manda un effort que el modelo no soporta. Copiamos esa forma pero
implementamos SOLO el descriptor `effort` por ahora (extensible a service tier / context
window / thinking después sin re-arquitecturar). Minerva NO necesita la complejidad de
`instanceId`/multi-cuenta de t3code: una sesión por proveedor.

### Tareas propuestas (detalle iría a TASKS.md § F8 si se aprueba)

- **T34 — Modelo de datos: option descriptors + selección con opciones.**
  `ai-providers.ts`: `AiModelOption` gana `options?: ModelOptionDescriptor[]`
  (`{ id: 'effort', label, choices: {value,label,description?,isDefault?}[] }`). Poblar los
  efforts hardcode de Claude (matriz por modelo, con los remapeos de compat) y OpenRouter
  (qué modelos soportan reasoning). `PersistedSettings` gana
  `modelOptions?: Partial<Record<AiProviderId, Record<string,string>>>` (p.ej.
  `{codex:{effort:'high'}}`) con migración (settings viejos → sin opciones = defaults).
  `getEffectiveAiSelection` → `{provider, model, options:{effort?}}` resolviendo el effort
  contra las choices del modelo actual (fallback al default del modelo). IPC
  `settings:setModelOption` ({provider, optionId, value}) + validador. Tests (incl. la
  resolución robusta: effort inválido para el modelo → default).
- **T35 — Catálogo dinámico de Codex (corregir + cablear).** Reescribir
  `codex-model-catalog.ts` con el protocolo REAL (`initialize` con clientInfo+capabilities;
  respuesta `{data, nextCursor}`; extraer `id`, `displayName`→label,
  `supportedReasoningEfforts`→choices del descriptor effort, `defaultReasoningEffort`→
  isDefault). Cablearlo a la UI con canal async propio (`ai:getProviderModels` o similar)
  con **cache TTL + fallback** al curado — NO meter async en el `settings:get` síncrono de
  T26. Sin filtrar por plan/`hidden` (lección t3code). Tests contra la forma real.
- **T36 — Pasar el effort a los servicios.** Codex: `turn/start.effort`. Claude Code:
  `query({options:{effort}})` con un ÚNICO punto de normalización (remapeos de compat estilo
  `normalizeClaudeCliEffort`). OpenRouter: `reasoning:{effort}` en el body para modelos que lo
  soporten (no mandarlo si no). Tests de que cada servicio inyecta el effort.
- **T37 — UI del selector de effort (+ modelos dinámicos de Codex).** En Settings, bajo el
  modelo elegido, un selector GENÉRICO sobre los option descriptors del modelo seleccionado
  (solo effort por ahora): muestra los choices soportados, marca el default, persiste vía
  `setModelOption`; remount por `key` al cambiar modelo/proveedor. Codex muestra los modelos
  dinámicos de T35 (con loading + fallback). Captura mirada.
- **T38 (opcional, diferible) — Gating por versión del CLI.** Ofrecer solo modelos/efforts
  soportados por la versión instalada de `claude`/`codex` (semver). t3code lo hace; para
  Minerva es pulido.

### Riesgos / decisiones abiertas

- El fetch dinámico de Codex agrega async/latencia y un modo de fallo (red/CLI) a la carga
  de la pantalla de modelos → canal aparte con cache y estado de carga, no en `settings:get`.
- La normalización del effort de Claude es sutil (compat por modelo/versión) → un solo punto.
- OpenRouter: confirmar el formato exacto de `reasoning` y por-modelo cuáles lo aceptan.
- Alcance: se entrega EFFORT (lo pedido) sobre una abstracción extensible; service tier /
  context window / thinking quedan como extensiones futuras con la misma forma.
- Rama: si se ejecuta, sobre `feature/multi-provider-ai` (encima de F7) o en rama nueva desde
  main tras mergear el PR de F7 — a decidir al arrancar.

---

## Iteración actual (2026-07-07): IA multi-proveedor (OpenRouter + Claude Code + Codex) — F7

> **Estado: T26–T30 + T32 HECHAS Y VERIFICADAS E2E (2026-07-07). Falta solo T31
> (empaquetado).** Rama `feature/multi-provider-ai`. Los tres proveedores conviven y son
> seleccionables desde Settings; la inferencia real por suscripción funciona:
> - **Claude Code** (Agent SDK oficial, plan Max de Edilson): análisis real de un PR mock
>   en ~20s, 4 secciones.
> - **Codex** (`codex app-server` JSON-RPC, cuenta ChatGPT de Edilson): análisis real en
>   ~28s, 4 secciones. El protocolo se descubrió con `codex app-server generate-ts`
>   (auto-genera su contrato) — el subagente lo había adivinado mal; reescrito por el
>   orquestador y validado en vivo (ver bitácora TASKS.md § "Gotcha clave").
> - **OpenRouter** (API key): intacto + ahora con campo persistente (safeStorage).
> El cambio de proveedor surte efecto sin reiniciar (fix del handler: `createAiService` se
> resuelve por análisis). 378 tests unit verdes; captura mirada de la pantalla en 2 estados.
> Rama de trabajo: `feature/multi-provider-ai` (creada desde `origin/main`).

### Pedido de Edilson

Poder elegir, desde una pantalla en Settings, **qué proveedor de IA** usa el panel
didáctico y **qué modelo** dentro de ese proveedor. Los tres deben convivir:

- **OpenRouter** (lo actual, por API key) — la lista de modelos curada de hoy aplica
  SOLO a este proveedor.
- **Claude Code** (la suscripción Claude Pro/Max de Anthropic).
- **Codex** (la suscripción ChatGPT Plus/Pro de OpenAI).

Cada proveedor tiene su propio login; hay que soportarlos y mantener **varias sesiones
vivas a la vez** (OpenRouter con key + Claude logueado + Codex logueado simultáneamente).

### Investigación previa (3 subagentes, 2026-07-07)

- **`pingdotgg/t3code`**: NO reimplementa OAuth. **Spawnea los binarios oficiales**
  (`claude` vía `@anthropic-ai/claude-agent-sdk`; `codex app-server` vía JSON-RPC sobre
  stdio) y deja login/tokens/refresh dentro de esos binarios. Lee el estado de cuenta del
  handshake de inicialización (`query().initializationResult().account` en Claude;
  `account/read` RPC en Codex). Multi-cuenta = aislar `HOME`/`CODEX_HOME` por instancia
  (Codex usa "shadow-home" con symlinks para no duplicar estado). Modelos: Claude
  hardcode (`BUILT_IN_MODELS`, filtrado por versión del CLI); Codex dinámico vía
  `model/list` RPC. Patrón "Driver" uniforme: provider = instancia de driver configurada;
  model = `{slug, capabilities}`; selección = `{instanceId, model, options}`.
- **`sst/opencode` (fork `anomalyco/opencode`)**: SÍ reimplementaba OAuth in-app
  (PKCE, loopback :1455 para OpenAI, `auth.json` 0600). PERO **removió el flujo de
  Anthropic en agosto 2025** cuando Anthropic bloqueó el uso de tokens OAuth de Claude
  Code por terceros. Ese flujo dependía de **suplantar al cliente oficial**: header
  `anthropic-beta: oauth-2025-04-20` + system prompt obligatorio
  `"You are Claude Code, Anthropic's official CLI for Claude."`. El de Codex (vigente)
  reescribe la URL a `https://chatgpt.com/backend-api/codex/responses`, manda
  `ChatGPT-Account-Id`, usa `instructions` en vez de mensajes `system` y `store:false`.
- **Mapa interno de Minerva**: la interfaz `AiService` (`src/main/ai/service.ts:45`) y
  TODO el pipeline de streaming (`stream-parser.ts` protocolo `@@@SECTION`,
  `analysis-cache.ts` LRU, `use-didactic-analysis.ts`) son **agnósticos del proveedor**.
  El trabajo se concentra en: el factory `createAiService` (`src/main/ai/index.ts:26`,
  hoy un `if key → OpenRouter : mock`), los settings (hoy solo guardan `{aiModel}`,
  `src/main/settings/store.ts`), la lista curada (`src/shared/ai-models.ts`, plana, sin
  campo de proveedor), y **replicar el patrón `src/main/auth/`** (auth-manager +
  token-store con `safeStorage`) para las sesiones nuevas.

### Decisión de arquitectura: CLIs/SDK oficiales, NO OAuth suplantado

Se implementa el **enfoque t3code** (orquestar binarios oficiales), NO el enfoque
opencode de reimplementar el OAuth de Anthropic/OpenAI.

**Por qué se descarta el OAuth in-app estilo opencode (Anthropic):** para que el backend
de Anthropic acepte un token de suscripción Claude Pro/Max hay que mandar el header
`anthropic-beta: oauth-...` y el system prompt `"You are Claude Code..."` — es decir,
hacer pasar Minerva por el cliente oficial. Eso **evade los controles de acceso de
Anthropic y viola sus Términos**; es exactamente lo que Anthropic bloqueó y por lo que
opencode borró ese código. Implementarlo arriesga el **baneo de la cuenta de Edilson**.
No se implementa. (Si en el futuro Anthropic publica un flujo OAuth soportado para
terceros, se reabre esta decisión.)

**Enfoque adoptado (limpio y sin suplantación):**

- **Claude Code**: depender de `@anthropic-ai/claude-agent-sdk` y llamar `query()` con el
  prompt de análisis (una sola vuelta, sin tools). El login lo hace el binario `claude`
  del usuario (`claude login`), Anthropic maneja token/refresh, y Minerva lee el estado de
  cuenta del handshake. No falsificamos nada: usamos la herramienta oficial tal como
  Anthropic la distribuye, con la sesión que el usuario ya autorizó.
- **Codex**: spawnear `codex app-server` (binario oficial de OpenAI) y hablar JSON-RPC por
  stdio (`initialize` → `account/read` → `thread/start` → `turn/start`), capturando los
  deltas de texto. Login por `codex login`. Igual: cero reimplementación de OAuth.
- **OpenRouter**: intacto, por API key (lo actual).
- **Sesiones simultáneas**: cada proveedor persiste su propia sesión donde ya la guarda
  (OpenRouter: key en env/`.env`, futuro safeStorage; Claude: `~/.claude`; Codex:
  `~/.codex`). Minerva solo persiste **qué proveedor+modelo está activo** y detecta el
  estado de login de cada uno por probe. Los tres pueden estar autenticados a la vez sin
  conflicto porque viven en almacenes distintos.

Cada proveedor nuevo es una clase que implementa `AiService` y **emite el mismo protocolo
`@@@SECTION`** (alimentando `StreamSectionParser` delta a delta con la salida del SDK/RPC),
así el panel didáctico, la cache y la ventana desacoplada no se tocan.

### Diseño técnico (fases, detalle de tareas en TASKS.md § F7)

1. **T26 — Modelo de datos de proveedor+modelo (shared + settings).** Extender
   `ai-models.ts` a un catálogo por proveedor (`{provider, models[]}`); extender
   `PersistedSettings` a `{ aiProvider, models: {openrouter?, claudeCode?, codex?} }` con
   **migración** del `{aiModel}` viejo (→ `provider:'openrouter', models.openrouter`);
   nuevos canales IPC `settings:setAiProvider` / `settings:setProviderModel` + validadores;
   precedencia settings > env (`MINERVA_AI_PROVIDER`/`MINERVA_AI_MODEL`) > default.
2. **T27 — Abstracción de proveedores + probe de estado.** `src/main/ai/providers/`:
   `registry.ts` (metadata: id, nombre, cómo se autentica, cómo lista modelos),
   `cli-probe.ts` (¿está instalado `claude`/`codex`? ¿logueado? email/plan del handshake),
   canal `ai:getProviderStatus` (por proveedor: `unavailable|installed|authenticated` +
   cuenta). Refactor de `createAiService` para elegir implementación por proveedor activo,
   con fallback a mock si el activo no tiene credenciales.
3. **T28 — `ClaudeCodeAiService`.** Adaptador sobre `@anthropic-ai/claude-agent-sdk`:
   `query()` con `ANALYZE_PR_SYSTEM_PROMPT` + `buildUserMessage`, capturar deltas de texto
   → `parser.push(delta)`, mismos timeouts. Modelos hardcode (Fable 5, Opus 4.8, Sonnet 5,
   Haiku 4.5) filtrables por versión del CLI. Login: detectar y, si falta, guiar/spawnear.
4. **T29 — `CodexAiService`.** Cliente JSON-RPC de `codex app-server` (stdio): initialize →
   account/read → thread/start → turn/start; mapear item deltas de texto → parser. Modelos
   vía `model/list` RPC (o hardcode de fallback). Login por `codex login`.
5. **T30 — UI de selección de proveedor y modelo (Settings).** Nueva vista en
   `SettingsModal`: lista de proveedores con su **estado de login** (chip + botón
   "Conectar" que dispara el login del proveedor), y al elegir proveedor, sus modelos
   disponibles. `ActiveModelHint` muestra proveedor+modelo. Hook `use-provider-status`.
6. **T31 — Empaquetado y frontera de seguridad.** El Agent SDK trae binarios nativos por
   plataforma → `asarUnpack` en electron-builder; spawnear procesos hijos desde `main` con
   entorno saneado; nunca exponer tokens de los CLIs al renderer; revisar CSP/child-process.
7. **T32 — `OPENROUTER_API_KEY` persistente vía safeStorage + campo en Settings.** Cierra
   el pendiente histórico. Backend: reutilizar el patrón `src/main/auth/token-store.ts`
   (cifrado `safeStorage`, archivo `.bin` en userData) para la key; precedencia
   safeStorage > env `OPENROUTER_API_KEY` en `ai/env.ts`. UI: campo en la pantalla de
   proveedores (T30) para pegar/borrar la key, con estado "configurada / no configurada"
   (nunca se re-muestra la key). La key sigue viviendo SOLO en `main`.

### Riesgos / decisiones abiertas

- **Dependencia de binarios externos**: el usuario debe tener `claude` y `codex`
  instalados y logueados. Es una **acción humana** ineludible con este enfoque (a cambio
  de no violar ToS ni mantener OAuth propio). Minerva debe degradar con gracia (proveedor
  marcado "no disponible", no crash) cuando falten.
- **Codex `app-server`**: protocolo interno; conviene fijar una versión mínima del CLI y
  detectar incompat. `packages/effect-codex-app-server` de t3code es la referencia del wire.
- **Empaquetado**: binarios nativos del Agent SDK dentro del AppImage (asarUnpack + tamaño).
- **Latencia de arranque**: el probe de CLIs no debe bloquear el arranque de la app.

### Acción humana pendiente (Edilson)

1. **Confirmar el enfoque** (CLIs oficiales, sin OAuth suplantado) antes de implementar.
2. Instalar y loguear los CLIs que quiera usar: `claude` (probablemente ya) y `codex`.
3. Verificación por proveedor: correr un análisis real de un PR con cada proveedor elegido.

---

## Estado al 2026-07-06

MVP + F4 completos y verificados (T1–T15): GitHub real (Device Flow, sesión
persistente), diff GitKraken, comentarios Markdown, panel didáctico con OpenRouter
multi-LLM (settings UI, streaming tagged, cache), ventana desacoplable + visor con
zoom, CSP explícita. **Pendiente**: empaquetado electron-builder, key vía
safeStorage + campo en settings, comentar en PR real de prueba. T16 (calidad de
diagramas) completada y verificada 2026-07-06: fondo blanco + tema neutral, layout
C4 abierto, viewBox recortado a contenido, DSL sobrio en prompt/skill, y de paso
cayeron dos bugs latentes (el '#' en títulos C4 rompía el lexer de mermaid; el
naturalSize del visor nunca aplicaba a C4 por el parse XML de xlink). Lo de abajo es el
plan histórico del scaffold inicial; la arquitectura vigente está en `CLAUDE.md`.

## Iteración actual (2026-07-06, tarde): pulido visual reportado por Edilson

Dos problemas reportados con capturas sobre el PR real #70 de clevr-merlin:

1. **T17 — Contraste del tema oscuro.** En el visor amplio ("Endpoint — vista
   amplia") y el panel didáctico casi no se distinguen headers de tabla,
   headings, inline code ni bloques de código: todo queda plano sobre
   `panel`/`bg`. Fix en `ui/Markdown.tsx` (jerarquía + superficies) +
   `DidacticSectionCard` + token de fondo de código; subir un paso
   `--color-border`.
2. **T18 — Alineación del visor de diff.** Diagnóstico verificado contra el
   patch real de GitHub (que viene limpio): cada hunk renderiza su PROPIO grid
   y las columnas `auto` de los gutters absorben el espacio libre sobrante →
   el inicio del código salta de hunk a hunk (~100px en la captura) y parece
   indentación rota. Fix: un solo grid por archivo con filas header
   (`gridColumn: 1 / -1`) y gutters `max-content`.

Implementación delegada a subagentes Sonnet (archivos disjuntos, en paralelo);
verificación del orquestador: typecheck/lint/test + smoke-diff + capturas
miradas (split/inline, wrap on/off; visor amplio con tabla).

## Iteración actual (2026-07-06, noche): sección setup + highlighting (F5)

Pedido de Edilson:

1. **T20 — Sección `setup` ("Cómo levantar la app")** en el análisis didáctico:
   instructivo para el desarrollador — Docker si aplica, corrida local, env vars
   necesarias y detección de env vars NUEVAS que introduce el PR. Siempre
   presente, segunda tras `summary`. Slice vertical completo (tipos → mapper →
   parser → prompt → agente .md → fixtures → renderer → tests); detalle en
   TASKS.md. Delegada a subagente Sonnet; verificación del orquestador:
   typecheck/lint/test + mock e2e + captura mirada.
2. **T21 — Syntax highlighting** en `CodeSnippet` y fences de `Markdown.tsx`.
   BLOQUEADA hasta que Edilson apruebe la librería (propuesta: Shiki; la CSP ya
   permite `style-src 'unsafe-inline'`).

## Iteración actual (2026-07-06, noche 2): sincronía del panel didáctico (F5.1)

Tres problemas reportados por Edilson (captura sobre el PR real #70 de clevr-merlin):

1. **Desacoplar no sincroniza.** La ventana desacoplada a mitad de un streaming
   muestra el placeholder: main no registra análisis EN CURSO (`getCachedAnalysis`
   solo ve completados) y el hook solo se suscribe a `onAnalysisProgress` dentro de
   `analyze()`. Pedido explícito: al desacoplar se CIERRA el panel acoplado y la
   ventana nueva conserva lo ya streameado + sigue recibiendo.
2. **Cerrar/abrir el panel pierde resultados.** El panel acoplado no pasa
   `autoLoadFromCache` → siempre placeholder al reabrir. Y sin dedupe de análisis
   en vuelo, re-pulsar "Analizar PR" mientras el anterior sigue corriendo lanza una
   SEGUNDA llamada LLM (gasto real de tokens).
3. **El panel acoplado no se puede redimensionar** (`w-[380px]` fijo).

Diseño (T22): registro in-flight en el handler `ai:analyzePullRequest`
(promesa compartida + último snapshot), canal nuevo `ai:getAnalysisState`
(cached | streaming | idle), evento terminal SIEMPRE (éxito tras cachear, y
también en error con `error: string` — hoy en error nadie se entera), hook con
auto-attach por defecto en ambas superficies, y cerrar el panel al desacoplar.
T23 (resize) va después de verificar T22 — ambos tocan `DidacticPanel.tsx`.

Implementación T22 delegada a subagente Sonnet; T23 fix directo del orquestador.
Verificación: typecheck/lint/test, smoke-detach EXTENDIDA (attach a mitad de
streaming, panel cerrado al desacoplar), smoke-didactic/streaming, capturas.

**Resultado (2026-07-06, noche 2): T22 y T23 hechas y verificadas.** La
verificación visual destapó un bug que los smokes no veían (ventana ya abierta
en un PR quedaba sorda a análisis lanzados después → el hook ahora mantiene un
listener de progreso permanente, attach pasivo). smoke-detach quedó en 17
checks; detalle y gotchas nuevos (hyprlock también mata la captura CDP) en la
bitácora de TASKS.md. Pendiente menor: captura visual de T23 (verificada
numéricamente; la pantalla estaba bloqueada).

## Iteración actual (2026-07-06, noche 3): empaquetado (T24)

Pedido de Edilson: "empaquetar la aplicación". Es el pendiente explícito que quedó
anotado en T11/PLAN desde el MVP. Herramienta: **electron-builder** (la decisión ya
estaba tomada en el plan).

Hechos relevados por el orquestador antes de delegar:

- Main ya distingue dev/prod correctamente: `app.isPackaged`, `loadFile` relativo a
  `import.meta.dirname` (ventana principal y didáctica) — no hay rutas rotas en asar.
- Main es ESM (`"type": "module"`) — soportado empaquetado desde Electron 28; usamos 43.
- **Riesgo de seguridad**: `ai/env.ts` busca `.env` en la raíz del app
  (`import.meta.dirname + '../..'` = raíz del asar). electron-builder NO excluye
  `.env` por defecto → hay que excluirlo explícitamente en `files`. Sin key el
  packaged cae al mock de IA (correcto); la key en producción llega por variable de
  entorno hasta que exista la tarea "key vía safeStorage".
- Con `externalizeDepsPlugin`, solo main/preload usan node_modules en runtime, y el
  único import externo es **`octokit`** (express/react solo aparecen en tests y en
  strings de fixtures — verificado con grep). El resto de `dependencies` (react,
  mermaid, shiki, …) se bundlea en el renderer al hacer build → deben migrar a
  `devDependencies` para no engordar el asar (patrón recomendado por electron-vite).
- Target: Linux (Arch de Edilson). AppImage como artefacto principal +
  `linux-unpacked` para verificación. Sin icono propio por ahora (usa el default de
  Electron; pulido posterior).
- userData del empaquetado usa `productName` → sesión GitHub/settings NO compartidos
  con dev (esperado, no es bug).

Implementación delegada a subagente Sonnet (T24). Verificación del orquestador:
build del paquete, asar SIN `.env`, lanzar el AppImage real con MINERVA_MOCK=1 +
CDP → suite nueva `smoke-packaged.mjs` + captura mirada.

**Resultado: T24 hecha y verificada.** `dist/Minerva-0.1.0.AppImage` (124M),
asar sin `.env`, smoke-packaged 7/7 contra el AppImage real (target file://),
captura mirada, safeStorage con gnome_libsecret también en el empaquetado.
Hallazgo de entorno: esta máquina no tiene fuse2 → el AppImage requiere
`--appimage-extract-and-run` (o instalar `fuse2`, o usar `dist/linux-unpacked/`).
Pulido futuro: icono propio, desktopName. Detalle en la bitácora de TASKS.md.

## Iteración actual (2026-07-06/07, noche 3b): CI de release multi-OS (T25)

Pedido de Edilson: GitHub Action con runners **Blacksmith** que se active en
releases y construya Windows + macOS + Linux. Relevamiento hecho (labels de
runners, cache transparente, prerequisito de la GitHub App de Blacksmith en la
cuenta). El repo ya vive en github.com/edyggclevr/proj_minerva (subido hoy).
Diseño: matrix de 3 jobs (ubuntu-2404 / windows-2025 / macos-latest M4),
electron-builder por SO con `--publish never` y `gh release upload` al release
que disparó el workflow. macOS/Windows sin firma de código por ahora.
Detalle completo en TASKS.md § T25. Implementación delegada a Sonnet;
verificación del orquestador: YAML + release de prueba real mirando los runs.

## Objetivo de la iteración histórica (scaffold)

Dejar un scaffold **funcional y verificado** de la app Electron: procesos main/preload/
renderer bien separados, IPC tipado, shell de UI de tres paneles, y las capas de GitHub
e IA con interfaces definidas (aunque la lógica profunda venga después).

## Arquitectura objetivo (resumen)

```
electron-vite (main / preload / renderer)
src/
  main/
    index.ts            ventana + lifecycle
    auth/               GitHub OAuth Device Flow + safeStorage
    github/             Octokit: repos, PRs, diffs, comentarios
    ai/                 OpenRouter (multi-LLM): pipeline didáctico
    ipc/                registro de handlers (validación de payloads)
  preload/
    index.ts            contextBridge → window.minerva.{auth,github,ai}
  shared/
    ipc.ts              contratos IPC tipados (canales + tipos req/res)
    types.ts            modelos de dominio (PR, RepoRef, DiffFile, ...)
  renderer/
    src/
      App.tsx           shell 3 paneles: sidebar PRs | diff | panel didáctico
      views/            pr-list/, diff-view/, didactic-panel/, comments/
      stores/           zustand
```

## Decisiones tomadas

- **electron-vite** con plantilla react-ts como base, adaptada a nuestro layout.
- **IPC**: cada canal definido una sola vez en `src/shared/ipc.ts`; main valida payloads;
  preload expone API con nombre (`window.minerva`), jamás ipcRenderer crudo.
- **Auth**: GitHub OAuth **Device Flow** (no requiere client secret en la app). Token
  cifrado con `safeStorage`, guardado en `userData`. Solo vive en main.
- **Estilo UI**: Tailwind v4 (via @tailwindcss/vite), tema oscuro por defecto (estilo GitKraken).
- **Stubs primero**: GitHub/IA arrancan con interfaces + datos mock detrás de un flag,
  para poder construir y probar la UI sin credenciales; luego se conectan de verdad.

## Estrategia de verificación (por tarea)

1. `npm run typecheck` y `npm run lint` en verde.
2. `npm run build` en verde.
3. Prueba de humo: lanzar `npm run dev` (hay display disponible) y comprobar que la
   ventana abre y la vista esperada renderiza sin errores en consola.
4. Para lógica pura (parsers, clasificadores): tests con vitest.

## Acciones humanas pendientes (Edilson)

- [x] **Crear una GitHub OAuth App** con Device Flow habilitado. Entregada 2026-07-05
      (Client ID `Ov23liwnuK40dnyINVGy`, en `src/main/auth/config.ts` — es público por
      diseño en Device Flow).
- [x] **OPENROUTER_API_KEY** para el panel didáctico con IA real (tarea T9-final).
      Decisión de Edilson 2026-07-05: usar OpenRouter (openrouter.ai) en vez de la API
      de Anthropic directa, para poder alternar entre múltiples LLMs. API
      OpenAI-compatible: base `https://openrouter.ai/api/v1`, endpoint /chat/completions.
      Entregada 2026-07-05: `.env` en la raíz del proyecto (gitignored).
- [x] Probar manualmente el flujo de login. Hecho 2026-07-06: Edilson autorizó el device
      code y quedó `signed_in` como `edygg`; token cifrado con safeStorage en userData.

## Estado

- **F1 completa** (T1–T3). **F2 completa** (T4–T8, incl. auth real verificada con login
  de Edilson). **F3 completa salvo pulido** (T9-final + T10 verificadas e2e con OpenRouter
  real; T11 con pendientes menores: CSP explícita y empaquetado electron-builder —
  la validación profunda de IPC ya se hizo en T6).
- Próximos candidatos: empaquetado (electron-builder), settings UI (modelo de IA,
  key vía safeStorage en vez de .env), streaming del análisis, comentar en PRs reales
  (verificación con cuenta real), auto-detect de PRs nuevos/refresh.
- **Verificación**: suite de smokes e2e vía CDP en `scripts/smoke-*.mjs` (correr la app
  con `npm run dev -- -- --remote-debugging-port=9222`). Todos en verde.
- Gotchas acumulados: ver log de TASKS.md (preload CJS, import.meta.dirname,
  sin backticks en patches de fixtures/prompts largos, binario electron via install.js).
- Última actualización: 2026-07-05 (T9-final implementada).

# TASKS — proj_minerva

Estados: `[ ]` pendiente · `[~]` en progreso · `[x]` hecha y **verificada** · `[!]` bloqueada

Regla: una tarea no pasa a `[x]` sin correr su verificación (ver PLAN.md). Cada tarea
anota **quién** la hizo (subagente/directo) y **cómo** se verificó.

---

## F1 — Base del proyecto

- [x] **T1. Scaffold electron-vite + React + TS**
  Crear la estructura base con electron-vite (main/preload/renderer), TypeScript
  estricto, ESLint + Prettier, y scripts `dev/build/typecheck/lint`. Conservar
  README.md, CLAUDE.md, .claude/ y .agents/ existentes.
  _Aceptación:_ `npm run typecheck`, `lint` y `build` en verde; `npm run dev` abre ventana.

- [x] **T2. Contratos IPC tipados + preload bridge**
  `src/shared/ipc.ts` con canales y tipos req/res; `src/shared/types.ts` con modelos
  de dominio (RepoRef, PullRequestSummary, PrDetail, DiffFile, CommentThread, …).
  Preload expone `window.minerva.{auth,github,ai}` tipado vía contextBridge. Main
  registra handlers en `src/main/ipc/` con validación de payloads.
  _Aceptación:_ typecheck verde; renderer llama un handler `ping` de prueba y recibe
  respuesta tipada; contextIsolation on, nodeIntegration off, sandbox on.

- [x] **T3. Shell de UI de 3 paneles (Tailwind, tema oscuro)**
  Layout estilo GitKraken: sidebar izquierda (lista de PRs), centro (diff), panel
  derecho colapsable (didáctico). Tailwind v4, tema oscuro, Zustand para estado de
  layout. Datos mock.
  _Aceptación:_ dev abre la ventana con los 3 paneles navegables; build verde.

## F2 — GitHub

- [x] **T4. Capa GitHub en main con datos mock detrás de interfaz**
  `src/main/github/` con interfaz `GithubService` (listPRs, getPrDetail, getPrFiles,
  getComments, postComment, …) e implementación mock (fixtures realistas). Handlers
  IPC conectados. Flag `MINERVA_MOCK=1`.
  _Aceptación:_ la UI lista PRs mock end-to-end (renderer→IPC→main→mock).

- [x] **T5. Vista de lista de PRs real (renderer)** _(absorbida por T3+T4)_
  Lista de PRs abiertos agrupados por repo, con búsqueda/filtros, estados de CI y
  reviewers. Loading/error states.
  _Aceptación:_ contra mocks: estados de carga, error y datos se ven correctos.

- [x] **T6. Auth GitHub real (Device Flow) + Octokit**
  OAuth Device Flow en main, token cifrado con safeStorage en userData, implementación
  real de `GithubService` con Octokit (GraphQL para listados, REST para acciones).
  _Aceptación:_ login manual de Edilson funciona; PRs reales listados; token nunca
  llega al renderer (revisión con electron-security-reviewer).

- [x] **T7. Vista de diff estilo GitKraken**
  Árbol de archivos (toggle tree/list), split view e inline view, syntax highlighting
  (Shiki), word wrap, navegación entre archivos.
  _Aceptación:_ con un PR mock con varios archivos, ambas vistas renderizan bien.

- [x] **T8. Comentarios: leer y publicar**
  Hilos de comentarios de PR y de línea; publicar comentario general y por línea.
  _Aceptación:_ contra mocks e2e; con cuenta real, comentar en un PR de prueba.

## F3 — Panel didáctico (IA)

- [x] **T9-final. `OpenRouterAiService` real (OpenRouter, multi-LLM)**
  Decisión 2026-07-05 (Edilson): usar OpenRouter en vez de Anthropic directo para poder
  elegir entre múltiples LLMs. Implementado en `src/main/ai/`:
  `env.ts` (lee `OPENROUTER_API_KEY`/`MINERVA_AI_MODEL` de `process.env`, con fallback a
  parsear el `.env` de la raíz en dev), `prompts/analyze-pr.ts` (system prompt versionado,
  adaptado de `.claude/agents/pr-didactic-analyzer.md`, pide JSON estricto), `diff-budget.ts`
  (presupuesto ~60k chars, trunca por archivo y lista omitidos), `json-extract.ts` (extrae
  el primer `{...}` balanceado de la respuesta, por si el modelo la envuelve en texto/code
  fence), `section-mapper.ts` (valida/mapea a `DidacticSection[]`, descarta secciones
  malformadas con log, lanza si ninguna sobrevive), y `openrouter-service.ts`
  (`OpenRouterAiService implements AiService`: pide detalle+archivos al `GithubService`
  ACTIVO inyectado, arma el prompt, hace POST con fetch nativo + `AbortController` a 60s,
  mapea errores 401/402/429/otros a mensajes en español sin exponer la key).
  `createAiService(github)` (`./index.ts`) ahora recibe el `GithubService` activo y elige
  `OpenRouterAiService` si hay key (INDEPENDIENTE de `MINERVA_MOCK`, para poder probar IA
  real sobre PRs mock) o `MockAiService` si no. `handlers.ts` actualizado para pasar la
  instancia de `githubService` a `createAiService`.
  _Aceptación:_ typecheck/lint/test/build verdes (11 archivos de test nuevos, ~40 casos,
  fetch mockeado — nunca se llama a OpenRouter real en tests). VERIFICADA e2e por el
  orquestador 2026-07-06: análisis real sobre PR mock #482 en 13.4s (ver log).

- [x] **T10. Panel didáctico en renderer (Markdown + Mermaid)**
  Render de streaming Markdown + bloques Mermaid (C4, erDiagram) con fallback si el
  diagrama no parsea. Secciones: resumen, arquitectura, endpoints (con snippet curl/.http
  copiable), esquema.
  _Aceptación:_ fixtures de las 3 categorías renderizan diagramas válidos.

- [~] **T11. Revisión de seguridad + pulido**
  Pasar electron-security-reviewer a todo el código; arreglar hallazgos; revisar
  empaquetado básico.
  _Aceptación:_ 0 hallazgos altos; build de producción arranca.
  _Estado:_ revisión hecha (0 altos, 2 medios, 3 bajos). Arreglados: validación de
  esquema http(s) en `setWindowOpenHandler` y eliminación de la rama de fallback sin
  contextIsolation en preload (ahora lanza error). Validación por canal hecha
  (`ipc/validators.ts`). CSP explícita hecha en T15 (2026-07-06): img-src 'self'
  data: https:, font-src, connect-src, object-src 'none', base-uri 'none',
  form-action 'none' (frame-ancestors no aplica vía <meta>). PENDIENTE: empaquetado
  (electron-builder) — no existe aún.

## F4 — Features post-MVP (pedidas por Edilson 2026-07-06)

- [x] **T12. Settings UI: selector de modelo de IA**
  Modal de settings (engrane en TitleBar). Lista curada de modelos (IDs verificados
  contra la API pública de OpenRouter): `z-ai/glm-5.2` (DEFAULT), `moonshotai/kimi-k2.7-code`,
  `google/gemini-3.5-flash`, `openai/gpt-5.5`, `anthropic/claude-opus-4.8`,
  `anthropic/claude-sonnet-5`. Persistencia en main (JSON en userData, no secreto).
  Precedencia: settings > env MINERVA_AI_MODEL > default glm-5.2.
  _Aceptación:_ cambiar modelo desde la UI persiste tras reiniciar y el análisis usa el
  modelo elegido (verificable en la respuesta de OpenRouter).

- [x] **T13. Streaming del análisis didáctico**
  El texto del análisis aparece en vivo. Protocolo de secciones incremental (el modelo
  emite secciones en formato tagged parseable en streaming), SSE de OpenRouter en main,
  eventos push main→renderer (nuevo canal de eventos en preload con suscripción tipada).
  _Aceptación:_ al pulsar Analizar PR se ve texto fluyendo en <2s del primer token;
  el resultado final renderiza igual que hoy (secciones + Mermaid).

- [x] **T14. Panel didáctico desacoplable + visor de recursos**
  (a) Botón "abrir en ventana": el panel se abre en una BrowserWindow propia, más ancha,
  sincronizada con el PR seleccionado (cache de análisis en main para no re-pagar el LLM).
  (b) Visor de recursos: cada diagrama Mermaid/tabla/snippet tiene "expandir" → lightbox
  con zoom/pan (diagramas) y vista amplia (tablas), también disponible en la ventana
  desacoplada.
  _Aceptación:_ desacoplar muestra el mismo análisis sin nueva llamada al LLM; zoom/pan
  fluido en un diagrama C4 grande.

- [x] **T15. Bugfixes reportados por Edilson (2026-07-06)**
  (a) Botones Copiar/Expandir del snippet superpuestos → el expandir ahora vive DENTRO
  del header de `CodeSnippet`, junto a Copiar (el overlay `ExpandableResource` queda
  solo para diagramas). (b) Comentarios de GitHub como texto plano → `Markdown`
  compartido en `ui/` (movido desde `didactic/DidacticMarkdown`), usado en hilos,
  descripción del PR y panel didáctico; con override de `img`. (c) Visor de Mermaid
  vacío → el SVG (width:100% de mermaid) colapsaba a 0px dentro del wrapper absolute
  del zoom; fix: `withNaturalSize` reescribe el STRING del SVG a los px del viewBox
  antes de insertarlo, y `fitToContainer` calcula el fit desde el viewBox (idempotente).
  (d) Iconos rotos en C4 → CSP sin `img-src data:` bloqueaba el PNG base64 del person
  icon; CSP explícita nueva (cierra el pendiente (b) de T11). (e) BONUS descubierto por
  la suite endurecida: reutilizar la ventana didáctica con otro PR cambiaba la URL pero
  NO el contenido (navegación same-document al cambiar solo el hash) → `main.tsx` ahora
  escucha `hashchange` y remonta `DidacticWindowApp` con `key={hash}`.
  _Aceptación:_ smoke-bugfixes 7/7 + regresión de las 9 suites verde.

- [x] **T16. Calidad de diagramas: lienzo claro + layout C4 + DSL más sobrio**
  Reportado por Edilson con captura (2026-07-06): en el visor, las etiquetas de las
  flechas de un C4 son ilegibles (tema dark sobre fondo oscuro, sin fondo propio) y se
  enciman entre sí y sobre las cajas (layout C4 por defecto: 4 shapes por fila,
  márgenes mínimos, etiquetas de Rel largas generadas por la IA).
  (a) Tema claro: mermaid pasa de `theme: 'dark'` a `'neutral'`; los diagramas se
  renderizan SIEMPRE sobre fondo blanco — tarjeta inline del panel y área del visor
  (`MermaidZoomPan`) con `bg-white`. Decisión de Edilson: blanco en ambas superficies,
  un solo tema.
  (b) Config de layout en el `initialize` (mermaid 11.16): `c4: { c4ShapeInRow: 3,
  c4BoundaryInRow: 1, c4ShapeMargin ↑, c4ShapePadding ↑, diagramMarginX/Y ↑,
  messageFontSize ↑ }` + ajustes análogos razonables para `er` y `flowchart`.
  (c) DSL más sobrio: prompt (`analyze-pr.ts`) y skill `mermaid-c4-diagram` exigen
  etiquetas de `Rel()` de ≤4 palabras (el detalle va en el Markdown de la sección, no
  en la flecha), ≤8 elementos por diagrama y tecnología corta.
  Decisión de Edilson: mantener sintaxis C4 (no migrar a flowchart) y hacer (a)+(b)+(c).
  _Aceptación:_ captura del visor con un C4 real donde TODAS las etiquetas de relación
  sean legibles sobre blanco y no pisen cajas; typecheck/lint/tests + suites afectadas
  (smoke-bugfixes, smoke-detach) verdes.

- [x] **T17. Contraste del tema oscuro (markdown didáctico + superficies)**
  Reportado por Edilson con captura (2026-07-06, visor "Endpoint — vista amplia"):
  en el tema oscuro casi no se distinguen los resaltes — headers de tabla, headings,
  inline code y bloques de código quedan planos sobre `panel`/`bg`.
  Archivos: `src/renderer/src/components/ui/Markdown.tsx` (principal),
  `src/renderer/src/components/didactic/DidacticSectionCard.tsx`,
  `src/renderer/src/styles.css`.
  Entregables:
  (a) `styles.css`: nuevo token `--color-code-bg` (fondo de bloques de código, más
  oscuro que `panel`, ~`#15181d`) y subir un paso `--color-border` (~`#353b47`)
  para que bordes/separadores se noten. NO tocar `--color-muted` ni el resto.
  (b) `Markdown.tsx`: cuerpo de texto legible — `p`/`li`/`td` pasan de `text-muted`
  a texto principal con leve atenuación (p.ej. `text-text/90`; `muted` queda para
  metadatos, no para el contenido). Jerarquía de headings visible: `h2` un paso más
  grande con `border-b border-border pb-1`; `h3` claramente semibold en `text-text`.
  Inline code como chip visible (fondo más claro tipo `bg-white/10` + texto casi
  blanco). `pre` sobre `bg-[var(--color-code-bg)]` (o utilidad `bg-code-bg` del
  token) + borde. `thead` con fondo notorio (p.ej. `bg-border/60`) y `text-text`;
  zebra sutil en filas (`even:bg-white/[0.03]` en `tr` del tbody o equivalente).
  (c) `DidacticSectionCard`: header de sección con fondo levemente elevado
  (p.ej. `bg-white/[0.04]`) para que el título de cada sección se note.
  Gotchas: `Markdown.tsx` es compartido con los comentarios de GitHub
  (ConversationTab) — la mejora aplica a ambos, no bifurcar. Tailwind v4 CSS-first:
  los tokens `@theme` generan utilidades (`--color-code-bg` → `bg-code-bg`).
  _Aceptación:_ typecheck/lint/`npm test` verdes; captura del visor amplio con una
  sección de endpoint (tabla + JSON): headers de tabla, headings, chips de inline
  code y bloque de código claramente distinguibles a simple vista.

- [x] **T18. Visor de diff: un solo grid por archivo (alineación entre hunks)**
  Reportado por Edilson con captura (2026-07-06, PR real #70 de clevr-merlin):
  "la indentación del visor de cambios tiene varios problemas". Diagnóstico del
  orquestador VERIFICADO contra el patch crudo de GitHub (viene limpio, 4 espacios,
  `)` en columna 0): la indentación dentro de cada hunk es correcta, pero cada
  `HunkBlock` renderiza su PROPIO grid y en las plantillas actuales
  (`auto max-content ...`) las columnas `auto` de los gutters ABSORBEN el espacio
  libre sobrante del contenedor → el inicio de la columna de código varía por hunk
  (~100px entre hunks en la captura) y se percibe como sangría rota/inconsistente.
  Archivos: `src/renderer/src/components/pr-detail/{DiffView,SplitDiff,InlineDiff}.tsx`.
  NO tocar `lib/diff-parser.ts` (sus tests quedan como están).
  Entregables:
  (a) `SplitDiff`/`InlineDiff` pasan a recibir `hunks: DiffHunk[]` y renderizan UN
  solo grid por archivo: por cada hunk, una fila header con el estilo actual
  (`border-y border-border bg-panel px-3 py-1 font-mono text-[11px] text-muted`)
  en `style={{ gridColumn: '1 / -1' }}`, seguida de sus filas (armadas con los
  builders existentes `buildSplitRows([hunk])`/`buildInlineRows([hunk])`).
  (b) Gutters que NO absorben espacio libre: split
  `max-content minmax(max-content, 1fr) max-content minmax(max-content, 1fr)`
  (wrap: `max-content minmax(0, 1fr) max-content minmax(0, 1fr)`); inline
  `max-content max-content max-content minmax(max-content, 1fr)`
  (wrap: `... minmax(0, 1fr)`). El `minmax(..., 1fr)` del contenido mantiene los
  fondos verde/rojo llegando al borde derecho.
  (c) `HunkBlock` desaparece o queda mínimo; keys de filas únicos por
  `${hunkIndex}:${rowIndex}`; el patrón `group/row contents` para el hover del
  botón "+" y las filas de threads/composer (`gridColumn: '1 / -1'`) se conservan.
  Gotchas: NO resetear estado con setState-en-efecto (regla del linter); el
  `overflow-auto` vive en el contenedor de `DiffView`, no meter overflow por hunk.
  _Aceptación:_ typecheck/lint/`npm test` verdes; `smoke-diff.mjs` verde; captura
  de un diff mock con varios hunks donde los números de línea y el inicio del
  código quedan en la MISMA x en TODOS los hunks del archivo — en split e inline,
  con word wrap on y off — y la indentación relativa se conserva.

- [ ] **T19. Silenciar los "Payload inválido" de arranque (CenterPane placeholder)**
  Hallazgo del orquestador (2026-07-06, revisando logs de dev): con la app recién
  abierta (sin PR seleccionado), `CenterPane` llama `usePullRequestDetail` y
  `useCommentThreads` con un placeholder `{owner:'', name:'', fullName:''}` /
  `number: 0` para respetar las reglas de hooks; el validador de main lo rechaza
  (correctamente) y loguea `Error occurred in handler ... Payload inválido` en
  `github:getPullRequestDetail` y `github:getCommentThreads` en cada arranque o
  deselección. Inofensivo (el guard `!selectedPr` ignora el resultado) pero es
  ruido que asusta en el log y un round-trip IPC inútil.
  Fix sugerido: que ambos hooks acepten `repo: RepoRef | null` y hagan no-op
  (sin fetch, `loading: false`) cuando `repo === null || number < 1`, y que
  `CenterPane` pase `selectedPr?.repo ?? null`. Sin cambios en main.
  _Aceptación:_ arrancar la app y deseleccionar PR sin que aparezca ningún
  "Payload inválido" en el log de dev; smoke-e2e y smoke-comments verdes.

## F5 — Iteración 2026-07-06 (noche): sección "levantar la app" + highlighting

- [x] **T20. Nueva sección `setup` del análisis didáctico: instructivo para levantar la app**
  Pedido de Edilson (2026-07-06): el agente debe explicar al desarrollador cómo
  levantar la app para probar el PR — si se puede con Docker cómo, cómo correrla
  en local, qué variables de entorno necesita y, si el PR agrega variables de
  entorno nuevas, listarlas explícitamente. Todo en UNA sección propia
  (instructivo), SIEMPRE presente, segunda en el orden (tras `summary`).
  Alcance (slice vertical):
  - `src/shared/types.ts`: variante `{ kind: 'setup'; snippets: DidacticSnippet[] }`;
    `DidacticSnippet.language` pasa a `'curl' | 'http' | 'bash' | 'env'`.
  - `src/shared/events.ts`: variante draft `setup` (como `endpoint`).
  - `src/main/ai/section-mapper.ts`: `case 'setup'` (misma forma que `endpoint`);
    `mapSnippet` acepta `bash`/`env`.
  - `src/main/ai/stream-parser.ts`: `KNOWN_KINDS` + `toDraft` + `sectionToText`
    (snippets también para `setup`).
  - `src/main/ai/prompts/analyze-pr.ts`: kind `setup` en marcadores y contrato:
    siempre presente, con docker si el diff/metadata lo evidencia, corrida local,
    env vars requeridas y OBLIGATORIO detectar env vars nuevas del diff
    (`process.env.X`, `os.environ`, `ENV` en Dockerfile, `.env.example`, config);
    honestidad cuando el diff no alcanza; snippets `bash` (comandos) y `env`
    (bloque para `.env`). OJO gotcha: concatenación de comillas, sin backticks.
  - `.claude/agents/pr-didactic-analyzer.md`: misma sección en el contrato
    ("🚀 Cómo levantar la app", siempre).
  - `src/main/ai/fixtures.ts`: sección `setup` en al menos 2 fixtures shopwave
    (una con env vars nuevas). Sin backticks en strings.
  - `DidacticAnalysisArea.tsx`: `SECTION_META.setup` (título "Cómo levantar la app",
    icono `Rocket`); render de snippets para `endpoint` **o** `setup` en ambas
    variantes (final y draft).
  - Tests: casos `setup` + lenguajes nuevos en `section-mapper.test.ts` y
    `stream-parser.test.ts` (round-trip `stringifySections`).
  _Aceptación:_ typecheck/lint/test verdes; con `MINERVA_MOCK=1` el PR con fixture
  `setup` muestra la card con snippets copiables (captura mirada); smoke-didactic
  (o suite equivalente) verde.

- [x] **T21. Syntax highlighting en bloques de código (didáctico + comentarios)**
  Pedido de Edilson (2026-07-06): resaltar sintaxis donde mostramos código
  (`CodeSnippet.tsx` y fences de `ui/Markdown.tsx`). **Librería APROBADA por
  Edilson (2026-07-06): Shiki** (motor TextMate de VS Code), elegida frente a
  highlight.js y prism-react-renderer por calidad y por cubrir exactamente
  nuestros lenguajes (`shellscript`, `http`, `dotenv`, `docker`, `sql`, `diff`,
  ts/tsx/json/yaml — verificado contra tm-grammars). **Hallazgo del orquestador
  al arrancar:** Shiki 4.3.1 YA es dependencia — la vista de diff (T7) usa
  `src/renderer/src/lib/highlighter.ts` (singleton lazy `createHighlighterCore`,
  imports finos `@shikijs/langs/*`, motor regex JS, tema `github-dark-default`,
  render por tokens React sin innerHTML). Decisión revisada: EXTENDER ese módulo,
  no crear otro highlighter ni otro tema (coherencia visual con el diff):
  - Agregar gramáticas: `dotenv`, `http`, `docker`, `diff`, `python`.
  - Nueva API multilínea `highlightCode(code, lang)` (la existente
    `highlightLine` es por línea, limitación propia del diff que aquí no aplica).
  - Mapa de lenguajes de dominio: snippet `curl`→bash, `env`→dotenv, `http`,
    `bash`; fences de markdown (`language-xxx`) con aliases comunes; lo
    desconocido cae a texto plano sin romper.
  - Componente compartido `HighlightedCode` (tokens → spans React) usado por
    `CodeSnippet.tsx` y el override `code` de `ui/Markdown.tsx`; fallback al
    `<pre>` plano mientras el highlighter carga (async) y para langs no
    soportados. Sin `dangerouslySetInnerHTML` (contenido de PRs no confiable).
  _Aceptación:_ typecheck/lint/test verdes; captura mirada con un snippet bash y
  un fence resaltados en el panel didáctico y en la vista amplia del visor.

## F5.1 — Iteración 2026-07-06 (noche 2): sincronía del panel didáctico

- [x] **T22. Sincronía del análisis entre panel acoplado y ventana desacoplada**
  Reportado por Edilson con captura (PR real clevr-merlin #70): (a) desacoplar a
  mitad de un streaming abre una ventana que muestra el placeholder — debe
  conservar lo ya streameado y seguir recibiendo, y el panel acoplado debe
  CERRARSE al desacoplar; (b) cerrar y reabrir el panel acoplado vuelve al
  placeholder aunque el análisis ya se pagó, y re-pulsar "Analizar PR" con un
  análisis aún en vuelo lanza una SEGUNDA llamada LLM (sin dedupe in-flight).
  Causas raíz diagnosticadas por el orquestador:
  - Main no registra análisis EN CURSO: `ai:getCachedAnalysis` solo ve
    completados; el hook solo se suscribe a `onAnalysisProgress` dentro de
    `analyze()` → una ventana montada a mitad del streaming no tiene forma de
    engancharse.
  - `openrouter-service.ts` emite `onProgress(sections, { done: true })` SOLO en
    éxito; en error lanza sin evento terminal → una ventana adjunta se quedaría
    en "streaming" para siempre.
  - El panel acoplado (`DidacticPanel` → `DidacticAnalysisArea`) no pasa
    `autoLoadFromCache`.
  Alcance (slice vertical):
  - `src/main/ipc/handlers.ts`: registro in-flight
    `Map<key, { promise, snapshot }>` (key `owner/name#number`) DENTRO de
    `registerIpcHandlers`. `ai:analyzePullRequest`: cache hit → igual que hoy;
    in-flight hit → devolver LA MISMA promesa (cero llamadas LLM extra); miss →
    arrancar, guardar snapshot en cada `onProgress` y hacer el broadcast como
    hoy, PERO suprimir el broadcast del `{ done: true }` que emite el servicio
    en éxito: el evento terminal lo emite el handler DESPUÉS de
    `analysisCache.set(...)` (garantiza que quien reciba `done: true` sin error
    ya encuentra el cache poblado), con las secciones finales del snapshot. En
    catch: broadcast terminal `{ done: true, error: <message>, sections:
    <último snapshot o []> }` y re-throw para que el invoke del solicitante
    rechace como hoy. `finally`: borrar la entrada in-flight.
  - `src/shared/events.ts`: `AnalysisProgressEvent.error?: string` (solo en el
    evento terminal de un análisis fallido; documentarlo).
  - `src/shared/types.ts`: tipo `AnalysisState =
    { status: 'idle' } | { status: 'streaming'; sections: DraftDidacticSection[] }
    | { status: 'cached'; analysis: DidacticAnalysis }` (importa el draft de
    `events.ts`; si genera ciclo de imports, definirlo en `events.ts`).
  - `src/shared/ipc.ts`: canal `ai:getAnalysisState`
    `{ req: { repo; number }; res: AnalysisState }` + entrada en la lista de
    canales.
  - `src/main/ipc/validators.ts`: `'ai:getAnalysisState': isRepoAndNumberPayload`.
  - Handler `ai:getAnalysisState`: cache hit → `cached`; in-flight → `streaming`
    con el último snapshot; si no → `idle`.
  - `src/preload/index.ts`: exponer `ai.getAnalysisState`; en
    `isAnalysisProgressPayload` aceptar `error` opcional string (no exigirlo).
  - `src/renderer/src/hooks/use-didactic-analysis.ts`: reemplazar
    `autoLoadFromCache` por **auto-attach SIEMPRE** (deja de existir la opción):
    al montar, `getAnalysisState`; `cached` → `setAnalysis`; `streaming` →
    `setStreamingSections(snapshot)` + suscribirse a `onAnalysisProgress`
    filtrando por PR; al recibir evento con `done: true`: si trae `error` →
    `setError`; si no → `getCachedAnalysis` y `setAnalysis` con el hit (si
    diera null — no debería — quedarse con el último snapshot). Desuscribir en
    terminal y al desmontar. OJO linter react-hooks: `setState` SOLO dentro de
    callbacks de promesa/evento, nunca síncrono en el cuerpo del efecto (patrón
    ya usado en el hook actual); el análisis lanzado por `analyze()` local
    conserva su flujo actual (requestSeq) — el attach solo aplica al montar
    cuando NO hay análisis local en curso, y un `analyze()` local posterior
    tiene prioridad (cortar la suscripción de attach al llamar `analyze()`).
  - `DidacticAnalysisArea.tsx` y `DidacticWindowApp.tsx`: eliminar la prop
    `autoLoadFromCache` (el comportamiento pasa a ser el default en ambas
    superficies).
  - `DidacticPanel.tsx`: en el onClick de "Abrir en ventana", tras
    `openDidactic(...)` cerrar el panel (`toggleDidacticPanel()` con el panel
    abierto; o agregar `closeDidacticPanel` al store si queda más claro).
  - `scripts/smoke-detach.mjs`: EXTENDER con: (1) con un análisis en curso
    (invalidar + `analyzePullRequest` sin await), abrir la ventana desacoplada
    a mitad del streaming y verificar que muestra contenido parcial y termina
    mostrando el análisis completo sin segunda llamada LLM (contar eventos /
    verificar que `getAnalysisState` pasó por `streaming`); (2) verificar que
    el panel acoplado quedó cerrado tras desacoplar (el aside colapsado a
    w-10 / botón "Abrir panel didáctico" presente); (3) cerrar y reabrir el
    panel acoplado con cache poblado → muestra el análisis SIN pulsar
    "Analizar PR". Reglas de suites del CLAUDE.md: target CDP excluye
    `#didactic`, limpiar estado global al arrancar, señales inequívocas.
  Gotchas conocidos a respetar: sin backticks en strings de main; preload es
  CJS (no tocar config); `import.meta.dirname` en main; el evento push va a
  TODAS las ventanas (el filtro por PR es del hook); mock de IA streamea por el
  mismo pipeline (las suites corren con `OPENROUTER_API_KEY=` vacío +
  `MINERVA_MOCK=1`).
  _Aceptación:_ typecheck/lint/test verdes; smoke-detach extendida verde;
  smoke-didactic y smoke-streaming sin regresión; verificación del orquestador
  con capturas MIRADAS (attach a mitad de streaming en la ventana desacoplada;
  panel reabierto mostrando cache).

- [x] **T23. Resize del panel didáctico acoplado**
  Reportado por Edilson: el panel acoplado no se puede redimensionar
  (`w-[380px]` fijo en `DidacticPanel.tsx`). Handle de arrastre en el borde
  izquierdo (cursor `col-resize`, pointer events con `setPointerCapture`),
  ancho en `app-store` (`didacticPanelWidth`), clamp razonable (mín ~320px,
  máx ~60% del viewport), persistencia en `localStorage` y doble-click en el
  handle para volver al ancho por defecto. Fix directo del orquestador TRAS
  verificar T22 (mismo archivo).
  _Aceptación:_ arrastre funcional verificado por CDP + captura mirada; el
  ancho sobrevive reinicio del renderer; typecheck/lint verdes.

## F6 — Empaquetado

- [x] **T24. Empaquetado con electron-builder (Linux)**
  Pedido de Edilson (2026-07-06): empaquetar la aplicación. Cierra el pendiente
  de T11. Contexto relevado por el orquestador: main ya es packaged-aware
  (`app.isPackaged` + `loadFile` relativo a `import.meta.dirname` en ventana
  principal Y didáctica); main ESM soportado (Electron 43); el único import de
  node_modules en runtime de main/preload es `octokit` (verificado — el resto
  se bundlea en el renderer por vite).
  Entregables:
  (a) `electron-builder` como devDependency (versión estable actual).
  (b) `package.json`: mover a `devDependencies` las deps que solo usa el
  renderer (lucide-react, mermaid, react, react-dom, react-markdown,
  remark-gfm, shiki, zustand) — vite las bundlea en build; en `dependencies`
  queda SOLO `octokit`. NO tocar versiones.
  (c) `electron-builder.yml` en la raíz: `appId: dev.edygg.minerva`,
  `productName: Minerva`, `directories.output: dist`,
  `files: ['out/**/*', 'package.json', '!**/.env', '!**/.env.*']` —
  **CRÍTICO excluir `.env`**: `ai/env.ts` lo busca en la raíz del app y
  electron-builder NO lo excluye por defecto (la key se filtraría al asar).
  `asar: true`, `npmRebuild: false` (no hay deps nativas),
  `electronLanguages` NO configurar (mermaid necesita locales? no — dejar
  default). Linux: `target: [AppImage]`, `category: Development`,
  `executableName: minerva`, `maintainer: Edilson`. Sin icono propio (default
  de Electron; pulido posterior).
  (d) Scripts npm: `"dist": "electron-vite build && electron-builder --linux"`
  y `"dist:dir": "electron-vite build && electron-builder --linux dir"`
  (unpacked rápido para verificar).
  (e) `.gitignore`: agregar `dist/`.
  (f) Correr `npm run dist` y reportar: artefactos generados, tamaño, y
  cualquier warning de electron-builder.
  Gotchas a respetar: NO tocar `electron.vite.config.ts` (preload CJS
  obligatorio); si falta el binario de electron tras el install:
  `node node_modules/electron/install.js`; para matar procesos usar patrones
  con corchete (`pkill -f "[e]lectron"`); no hace falta lanzar la app — la
  verificación e2e del empaquetado la hace el orquestador.
  _Aceptación (verifica el orquestador):_ `typecheck`/`lint`/`npm test`/`build`
  verdes tras el cambio de deps; `npm run dist` produce `dist/Minerva-*.AppImage`
  y `dist/linux-unpacked/`; el asar NO contiene `.env` (listar con
  `npx @electron/asar list`); el AppImage arranca con `MINERVA_MOCK=1` +
  `--remote-debugging-port=9222`, smoke-e2e verde contra el binario empaquetado
  y captura MIRADA; sesión/settings en userData `Minerva` propio (esperado:
  no comparte con dev).

- [x] **T25. GitHub Action de release multi-OS** _(Blacksmith revertido a
  runners hosteados de GitHub por pedido de Edilson; verificada e2e con el
  release real v0.1.0 — ver bitácora 2026-07-07)_
  Pedido de Edilson (2026-07-06): workflow que se active en releases y construya
  la app para Windows, macOS y Linux usando Blacksmith
  (docs.blacksmith.sh). Relevamiento del orquestador (de llms-full.txt):
  labels `blacksmith-{2,4,8,16,32}vcpu-ubuntu-{2204,2404}[-arm]`,
  `blacksmith-{2..32}vcpu-windows-2025` (beta pública),
  `blacksmith-{6,12}vcpu-macos-{latest,15,26}` (solo Apple Silicon M4/arm64);
  las actions de cache propias de Blacksmith están ARCHIVADAS — se usan las
  estándar (`actions/setup-node` con `cache: npm`) que pegan al cache
  colocado de Blacksmith sin cambios. PREREQUISITO humano: la GitHub App de
  Blacksmith instalada en la cuenta `edyggclevr` (app.blacksmith.sh) — sin
  eso los jobs quedan en cola para siempre.
  Entregables:
  (a) `.github/workflows/release.yml`: trigger `release: types: [published]`;
  `permissions: contents: write`; matrix de 3 jobs con `fail-fast: false`:
  - linux → `blacksmith-4vcpu-ubuntu-2404`, `npx electron-builder --linux`
  - windows → `blacksmith-4vcpu-windows-2025`, `npx electron-builder --win`
  - mac → `blacksmith-6vcpu-macos-latest`, `npx electron-builder --mac`
  Pasos por job: checkout@v4, setup-node@v4 (node 22, cache npm), `npm ci`,
  `npm run typecheck` (barato, corta builds rotos), `npm run build`
  (electron-vite), electron-builder del SO con `--publish never`, y subida de
  artefactos al release con `gh release upload "$GITHUB_REF_NAME" <archivos>
  --clobber` (env `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `shell: bash`
  también en Windows). Subir: `dist/*.AppImage` (linux), `dist/*.exe` (win),
  `dist/*.dmg` (mac). `timeout-minutes: 30` por job. En mac exportar
  `CSC_IDENTITY_AUTO_DISCOVERY: false` (sin firma; evita que electron-builder
  busque certificados). Paso previo no bloqueante que avise si la versión de
  package.json no coincide con el tag del release.
  (b) `electron-builder.yml`: agregar targets `mac` (dmg, arch arm64 y x64 —
  el runner M4 compila ambos) con `category: public.app-category.developer-tools`,
  y `win` (nsis x64). NO tocar la sección linux ni `files` (la exclusión de
  `.env` es requisito de seguridad).
  (c) README: nota corta en la sección Empaquetado sobre el workflow de
  release (cómo se dispara, dónde quedan los binarios, prerequisito
  Blacksmith, y que macOS/Windows salen SIN firmar — Gatekeeper/SmartScreen
  avisarán).
  Gotchas: los artefactos toman la versión de package.json (bump antes de
  taggear); no usar actions `useblacksmith/*` (archivadas); runner macOS es
  arm64 (electron-builder baja los dist x64 para el arch cruzado dentro de
  mac sin problema).
  _Aceptación (verifica el orquestador):_ YAML válido (parseo + actionlint si
  está disponible); typecheck/lint/tests locales intactos; push del workflow
  y release de prueba `v0.1.0` (prerelease) disparando los 3 jobs; los
  binarios quedan adjuntos al release — o, si Blacksmith no está instalado
  aún, los jobs quedan en cola y se reporta la acción humana a Edilson.

---

## F7 — IA multi-proveedor (OpenRouter + Claude Code + Codex) — 2026-07-07

> Rama `feature/multi-provider-ai` (desde `origin/main`). Diseño y contexto de
> investigación: `PLAN.md` § "Iteración actual (2026-07-07)". **Decisión de arquitectura
> clave**: se usan los CLIs/SDK OFICIALES (`@anthropic-ai/claude-agent-sdk`,
> `codex app-server`), NO se reimplementa el OAuth de Anthropic/OpenAI. El flujo OAuth
> in-app estilo opencode para Claude Pro/Max exige suplantar al cliente oficial (header
> `anthropic-beta: oauth-...` + system prompt "You are Claude Code...") — evade los
> controles de acceso de Anthropic, viola sus ToS y arriesga el baneo de la cuenta de
> Edilson; opencode lo removió por eso. **No se implementa.**
>
> **CONFIRMADO por Edilson (2026-07-07)**: enfoque de CLIs oficiales aprobado; instalará
> `codex`; pidió avisar antes de las pruebas e2e de T28/T29 para asegurar sesiones válidas
> de Claude/Codex. Requisito añadido: **T32** (campo persistente para `OPENROUTER_API_KEY`).
>
> Invariante que respetan TODAS: el pipeline de streaming es agnóstico del proveedor —
> cada proveedor nuevo emite el MISMO protocolo `@@@SECTION` alimentando
> `StreamSectionParser` delta a delta; el panel didáctico, la cache LRU y la ventana
> desacoplada NO se tocan. Gotchas de main vigentes (sin backticks en strings largos,
> `import.meta.dirname`, preload CJS, reiniciar `npm run dev` al tocar `src/main/**`).

- [x] **T26. Modelo de datos proveedor+modelo (shared + settings + IPC)**
  _Hecha y verificada (2026-07-07, subagente `a568dae75cf640dcd`). `src/shared/ai-providers.ts`
  nuevo (catálogo por proveedor, `AiProviderId`, guards, defaults); `ai-models.ts` re-exporta
  el slice OpenRouter. `store.ts`: `PersistedSettings={aiProvider, models}` con migración
  in-memory de `{aiModel}` (no reescribe disco hasta el próximo setter). `env.ts`:
  `getEffectiveAiSelection()` + `getAiSettingsInfo()`. IPC: `settings:get`→`AiSettingsInfo`,
  nuevos `settings:setAiProvider`/`setProviderModel` con guards. Renderer adaptado al mínimo
  (OpenRouter sin cambios de comportamiento). Verificado por el orquestador: typecheck (node+web),
  lint, 318 tests verdes; migración y precedencia con tests unit. index.ts (factory) sin tocar,
  lo refactoriza T27._
  Contexto: hoy `src/shared/ai-models.ts` es una lista plana de IDs de OpenRouter y
  `src/main/settings/store.ts` persiste `{ aiModel: string }`. Hay que modelar N
  proveedores, cada uno con su lista de modelos y su modelo seleccionado, y qué proveedor
  está activo — sin romper archivos `settings.json` viejos.
  Entregables:
  (a) `src/shared/ai-providers.ts` (o extender `ai-models.ts`): tipo `AiProviderId =
  'openrouter' | 'claude-code' | 'codex'`; catálogo `{ provider, label, models: {id,
  label, vendor}[] }`. La lista curada ACTUAL migra bajo `openrouter` (los IDs de hoy
  aplican SOLO a OpenRouter). Claude Code: `claude-fable-5`, `claude-opus-4-8`,
  `claude-sonnet-5`, `claude-haiku-4-5` (labels legibles). Codex: placeholder curado
  (`gpt-5.5-codex`, etc.) que T29 podrá refrescar dinámicamente. `DEFAULT_AI_PROVIDER =
  'openrouter'`, default de modelo por proveedor.
  (b) `store.ts`: `PersistedSettings` → `{ aiProvider: AiProviderId, models: Partial<Record<AiProviderId,string>> }`.
  **Migración**: si al leer aparece la forma vieja `{ aiModel }`, mapear a
  `{ aiProvider:'openrouter', models:{openrouter: aiModel} }` (no perder la elección
  previa de Edilson). `isValidPersistedSettings` acepta ambas formas; setters nuevos
  `setAiProvider(id)` y `setProviderModel(provider, modelId)`, escritura atómica intacta.
  (c) `src/main/ai/env.ts`: `getEffectiveAiSelection()` → `{ provider, model }` con
  precedencia settings > env (`MINERVA_AI_PROVIDER` + `MINERVA_AI_MODEL`) > default.
  Mantener `getEffectiveAiModel()` como shim si algo lo usa aún.
  (d) `src/shared/ipc.ts` + validators + handlers + preload: `settings:get` responde la
  selección completa + catálogo; nuevos `settings:setAiProvider` y
  `settings:setProviderModel` con sus guards (provider ∈ enum; model string ≤100). El
  tipo `AssertNoMissingChannel` obliga a tocar `IPC_CHANNELS` y `payloadValidators`.
  _Aceptación:_ typecheck/lint/tests verdes; test unit de migración (forma vieja → nueva);
  el settings viejo `{aiModel:"z-ai/glm-5.2"}` en userData se lee como OpenRouter+ese
  modelo tras el cambio (sin perder selección). Sin tocar UI todavía (T30).

- [x] **T27. Abstracción de proveedores + probe de estado de login**
  _Hecha y verificada (2026-07-07, subagente `aa6a336cbfbed9b48`). `providers/registry.ts`
  (metadata authKind api-key/cli + binario), `providers/cli-probe.ts` (execFile `--version`
  timeout 1500ms, cache TTL 5s, login best-effort por existencia de `~/.claude/.credentials.json`
  con `subscriptionType`→plan y `~/.codex/auth.json`; TODO handshake real en T28/T29),
  `providers/provider-status.ts` (agregador). Canal `ai:getProviderStatus` → `Record<AiProviderId,
  {status:'unavailable'|'installed'|'authenticated', account?:{email?,plan?}}>` (sin secretos).
  Factory `createAiService` refactor: elige por proveedor activo, OpenRouter idéntico al actual,
  claude-code/codex caen a mock con `// T28`/`// T29`. Verificado por orquestador: typecheck,
  lint, 333 tests (nuevos: cli-probe, provider-status, index factory)._
  Contexto: `createAiService` (`src/main/ai/index.ts:26`) hoy es binario (key→OpenRouter,
  else mock). Pasa a resolver por proveedor activo. Se necesita saber, por proveedor, si
  está disponible/autenticado (OpenRouter: ¿hay key?; Claude/Codex: ¿CLI instalado y
  logueado?). Patrón a imitar: `src/main/auth/auth-manager.ts` (estado sin exponer
  secretos vía `getStatus()`).
  Entregables:
  (a) `src/main/ai/providers/registry.ts`: metadata por proveedor (id, label, cómo se
  autentica: `api-key` | `cli`, binario esperado, cómo lista modelos).
  (b) `src/main/ai/providers/cli-probe.ts`: detección no bloqueante de `claude`/`codex`
  (existe en PATH; versión; ¿logueado? leyendo el handshake — Claude:
  `query().initializationResult().account`; Codex: `account/read` RPC). Cachear resultado
  con TTL corto; NUNCA colgar el arranque (timeout + degradar a "no disponible").
  (c) canal IPC `ai:getProviderStatus` → por proveedor `{ status:
  'unavailable'|'installed'|'authenticated', account?: {email?, plan?} }` (SIN tokens).
  (d) refactor `createAiService(github)` → lee selección de settings, instancia
  `OpenRouterAiService` | `ClaudeCodeAiService` | `CodexAiService`; fallback a
  `MockAiService` si el proveedor activo no está autenticado (con log claro del porqué).
  _Aceptación:_ typecheck/lint/tests; el probe reporta correcto el estado real de la
  máquina de Edilson (claude instalado/logueado; codex según lo instale); arranque de la
  app NO se degrada en tiempo aunque los CLIs falten; con OpenRouter activo + key, el
  comportamiento actual queda idéntico (no-regresión del análisis existente).

- [x] **T28. `ClaudeCodeAiService` (Agent SDK oficial)**
  Contexto: adaptador que implementa `AiService` usando `@anthropic-ai/claude-agent-sdk`
  (NUEVA dependencia; binarios nativos por plataforma — anotar para T31/empaquetado).
  Reutiliza `buildUserMessage` y `ANALYZE_PR_SYSTEM_PROMPT` (mismos que OpenRouter) y
  emite el protocolo `@@@SECTION` alimentando `StreamSectionParser`.
  Entregables: `src/main/ai/providers/claude-code-service.ts`: `query({ prompt, options:{
  ... , model, allowedTools:[], persistSession:false }})`, iterar el stream, empujar los
  deltas de texto al parser (`onProgress`), mismos timeouts (120s total / 20s inactividad)
  y mapeo de errores (no autenticado → mensaje accionable "corré `claude login`"). Modelos
  desde el registry (T26), filtrables por versión del CLI si aplica.
  Gotchas: sin tools (una sola vuelta de generación, no un loop de agente); el system
  prompt de análisis va por el canal que el SDK ofrezca para system/append; NO inventar
  headers de suplantación — el SDK ya se autentica solo con la sesión del CLI.
  _Aceptación (orquestador):_ typecheck/lint/tests; análisis real de un PR mock con Claude
  Code seleccionado, streameando secciones por el mismo pipeline; captura mirada del panel
  con contenido real; verificar que sin login degrada con mensaje claro (no crash).
  **Acción humana**: Edilson con `claude` logueado.
  _Implementado y verificado a nivel unit (2026-07-07, subagente `adec8a6ea6cd03e41`).
  Dep `@anthropic-ai/claude-agent-sdk@0.3.203`. `claude-code-service.ts` usa `query({prompt,
  options:{model, systemPrompt: ANALYZE_PR_SYSTEM_PROMPT, tools:[], maxTurns:1,
  persistSession:false, settingSources:[], includePartialMessages:true, abortController}})`;
  extrae deltas de `stream_event`→`content_block_delta`→`text_delta` → parser. Errores
  accionables (authentication_failed→`claude login`, ENOENT→binario). Módulos compartidos
  extraídos: `analysis-prompt.ts` (prId, buildUserMessage) y `analysis-timeouts.ts`. IDs de
  modelo verificados contra el .d.ts del SDK (`claude-sonnet-5`/`opus-4-8`/`fable-5`
  coinciden; `haiku-4-5` a confirmar e2e). Probe NO refinado al handshake (decisión: hot
  path barato). 10 tests unit. **FIX del orquestador**: `createAiService` se volvió async
  (consulta el probe) y `handlers.ts` lo resolvía UNA vez al arranque → el cambio de
  proveedor en Settings no surtía efecto sin reiniciar; movido a resolverse POR ANÁLISIS
  dentro del handler (tras cache/in-flight hits). typecheck/lint/358 tests verdes.
  **VERIFICADO e2e (2026-07-07)**: análisis real de shopwave/api#482 con Claude Code (plan Max) en 19.6s → 4 secciones reales (summary, setup, architecture, endpoint). Probe reporta claude-code authenticated con plan="max". Captura mirada de la pantalla de proveedores. **HECHO.**_

- [x] **T29. `CodexAiService` (`codex app-server` JSON-RPC)**
  Contexto: adaptador que spawnea `codex app-server` y habla JSON-RPC 2.0 por stdio.
  Referencia de wire: `packages/effect-codex-app-server` de t3code. Emite `@@@SECTION` al
  parser igual que los demás.
  Entregables: `src/main/ai/providers/codex-service.ts` + un cliente JSON-RPC mínimo sobre
  el stdio del proceso hijo: `initialize` → `initialized` → `account/read` (estado) →
  `thread/start` → `turn/start` (con el prompt de análisis), capturar los item deltas de
  texto (`item/*`) → `parser.push`. Modelos vía `model/list` RPC (paginado) con fallback
  al curado de T26. Manejo de: no autenticado (`codex login`), CLI ausente, cierre/limpieza
  del proceso hijo, timeouts.
  Gotchas: proceso hijo de larga vida gestionado desde `main` (matar en `app.quit`); fijar
  versión mínima del CLI y detectar incompatibilidad del protocolo; sanear el entorno del
  spawn.
  _Aceptación:_ typecheck/lint/tests; análisis real de un PR mock con Codex seleccionado,
  streameando por el pipeline; captura mirada; sin login/CLI degrada con mensaje claro.
  **Acción humana**: Edilson instala y loguea `codex`.
  _Implementado por subagente `a9915ffaec7c2a6cc` PERO **reescrito por el orquestador**: el
  subagente no encontró el clon de t3code y adivinó el wire (initialize sin params,
  `instructions`, input como string) → NO habría funcionado. El orquestador descubrió el
  protocolo REAL del binario 0.142.5 con `codex app-server generate-ts`/`generate-json-schema`
  (¡el binario genera su propio esquema!) + un turno de humo en vivo, y corrigió
  `codex-service.ts`: `initialize` con clientInfo+capabilities{experimentalApi:true};
  system prompt en `baseInstructions` (NO `instructions`); `thread/start` con
  `sandbox:'read-only'`+`approvalPolicy:'never'` (Codex es agente de código, sin esto ejecuta
  comandos); threadId de `result.thread.id`; `turn/start.input` = `[{type:'text',text,text_elements:[]}]`
  (Array<UserInput>); **`turn/start` es ack inmediato (`inProgress`) — el fin es la
  notificación `turn/completed`** (el código original mataba el proceso tras el ack → 0
  deltas); delta de texto SOLO en `item/agentMessage/delta`.params.delta. Modelo real =
  `gpt-5.5` (no `gpt-5.5-codex`; catálogo corregido). El cliente JSON-RPC (framing JSONL) del
  subagente estaba OK. **VERIFICADO e2e (2026-07-07)**: análisis real de shopwave/api#482 con
  Codex (gpt-5.5, cuenta ChatGPT prolite de Edilson) en 28.5s → 4 secciones reales. Probe
  reporta codex authenticated. 10 tests unit reescritos al protocolo real. **HECHO.**_

- [x] **T30. UI de selección de proveedor y modelo (Settings) + estado de login**
  Contexto: `src/renderer/src/components/settings/SettingsModal.tsx` monta hoy un
  `ModelPicker` de lista plana. Nueva pantalla: elegir PROVEEDOR (con su estado de login)
  y luego MODELO dentro del proveedor. Transparente al hook `use-didactic-analysis` (no se
  toca).
  Entregables:
  (a) Vista de proveedores: card por proveedor con chip de estado (`ai:getProviderStatus`)
  — "Conectado (email/plan)" | "Instalado, sin sesión" | "No disponible" — y acción
  contextual: OpenRouter → gestionar key (o nota de que va por `.env` hasta que exista la
  tarea safeStorage); Claude/Codex → botón "Conectar" que dispara/guía el login del CLI y
  un enlace a instalarlo si falta.
  (b) Al seleccionar proveedor, `ModelPicker` filtra a los modelos de ese proveedor
  (catálogo de T26); persistir vía `settings:setAiProvider`/`setProviderModel`.
  (c) `use-provider-status.ts` (hook) + `ActiveModelHint` muestra "proveedor · modelo".
  _Aceptación:_ typecheck/lint/tests; smoke e2e CDP nuevo (`smoke-providers.mjs`):
  cambiar de proveedor, ver estados de login, seleccionar modelo, persistencia tras
  reabrir; **captura mirada** de la pantalla en cada estado. Reglas de suites: target CDP
  `!url.includes('#didactic')`, limpiar estado global al arrancar, verificar contenido.
  _Hecha y verificada (2026-07-07, subagente `adec8a6ea6cd03e41`). `ProviderPicker` (card por
  proveedor con chip de estado desde `ai:getProviderStatus`), `OpenRouterKeyForm` (campo
  password + Guardar/Borrar + fuente de la key), `CliLoginGuide` (guía `claude login`/`codex
  login` + "Volver a comprobar"), `ModelPicker` filtrado por proveedor (campo libre "Otro"
  solo OpenRouter), hooks `use-provider-status`/`use-openrouter-key`, `ActiveModelHint` =
  "proveedor · modelo". **VERIFICADO e2e por el orquestador (2026-07-07)**: captura mirada de
  la pantalla con los 3 proveedores "Conectado" (Claude Code · max, Codex, OpenRouter),
  detalle por proveedor, selector filtrado (4 modelos Claude / 6 OpenRouter+Otro / gpt-5.5
  Codex), y el campo de key de OpenRouter mostrando "Tomada de tu archivo .env — guardala acá
  para que quede cifrada". El cambio de proveedor surte efecto en el análisis sin reiniciar
  (fix del handler, ver T28). **HECHO.**_

- [x] **T31. Empaquetado + frontera de seguridad de los CLIs/SDK**
  Contexto: el Agent SDK trae binarios nativos por plataforma; hay spawn de procesos hijos
  desde `main`. Revisar contra la frontera de seguridad de `CLAUDE.md`.
  Entregables: `asarUnpack` en `electron-builder.yml` para los binarios del Agent SDK
  (verificar que el AppImage los ejecuta); confirmar que los tokens de los CLIs NUNCA
  llegan al renderer (viven en `~/.claude`/`~/.codex`, fuera de Minerva); entorno saneado
  en los spawns; nota en README (§ Empaquetado / requisitos) de que Claude/Codex requieren
  sus CLIs instalados y logueados; medir el impacto en tamaño del AppImage.
  _Aceptación:_ `npm run dist` produce un AppImage funcional; `smoke-packaged.mjs` sigue
  verde; análisis real con Claude Code funcionando DESDE el empaquetado (no solo dev);
  captura mirada; revisión de que no se filtran secretos al renderer.
  _**HECHA Y VERIFICADA E2E** (2026-07-07, subagente `a467578c9338cef66` + verificación del
  orquestador). ENFOQUE: NO se bundlea el binario del Agent SDK (~250MB/plataforma); se usa el
  `claude`/`codex` del sistema. Verificado que el SDK funciona con `pathToClaudeCodeExecutable`
  al claude del PATH. Entregables: `resolve-cli.ts` (resuelve el binario en PATH + ubicaciones
  comunes ~/.local/bin, /usr/local/bin, /opt/homebrew/bin, ~/.npm-global/bin, ~/.bun/bin, etc.;
  Windows best-effort con .cmd/.exe), usado en claude-code-service (`pathToClaudeCodeExecutable`),
  codex-app-server-client (spawn) y cli-probe (si null → unavailable sin spawnear).
  `spawn-env.ts` compartido (sanea OPENROUTER_API_KEY/GITHUB_TOKEN del entorno del hijo, ahora
  también en Claude). `electron-builder.yml`: `!**/node_modules/@anthropic-ai/claude-agent-sdk-*/**`.
  392 tests. **Verificación del orquestador**: `npm run dist` → AppImage **125M** (vs 124M
  pre-SDK, o sea el binario de 250MB QUEDÓ FUERA); asar confirma SDK JS `sdk.mjs` presente pero
  `claude-agent-sdk-linux` ausente; `.env` excluido; **análisis real con Claude Code DESDE el
  AppImage empaquetado en 21.0s → 4 secciones** (resuelve el claude del sistema); probe reporta
  claude-code=max/codex=ok/openrouter=unavailable (correcto: .env fuera del asar → la key va por
  safeStorage/T32 en prod); smoke-packaged 6/6. **HECHA.**
  MEJORA IDENTIFICADA (investigación de t3code, subagente `a0796af9884396a46`): t3code valida el
  mismo enfoque (usa `claude`/`codex` del sistema, NO el binario vendorizado; de hecho ellos NO
  excluyen el peso muerto de 250MB → nuestro build es MÁS liviano). PERO t3code resuelve el PATH
  de forma más robusta: al arrancar lanza un **shell de login** (`$SHELL -ilc` para leer `$PATH`
  real; `launchctl getenv PATH` en macOS; PowerShell con perfil en Windows) e inyecta ese PATH en
  `process.env` — así encuentra CLIs instalados vía nvm/volta/fnm/rutas custom que nuestra lista
  hardcodeada de `resolve-cli.ts` no cubre. Para Edilson (claude en ~/.local/bin) YA funciona;
  la mejora es para robustez de distribución general. Candidata a T33 (opcional)._

- [x] **T32. `OPENROUTER_API_KEY` persistente (safeStorage) — backend + IPC**
  _Backend hecho y verificado (2026-07-07, subagente `aa59330f9b40573dd`). `openrouter-key-store.ts`
  (cifra con safeStorage, `openrouter-key.bin`, degrada a memoria); `env.ts` precedencia
  safeStorage > env > .env vía `resolveOpenRouterApiKey()` + `getOpenRouterKeyStatus()`; canales
  `settings:setOpenRouterKey` ({key}, vacío=borrar) y `settings:getOpenRouterKeyStatus` →
  `{configured, source:'safeStorage'|'env'|'none'}`. La key NUNCA cruza al renderer (verificado:
  `loadApiKey` solo en env.ts). provider-status ya la reconoce como authenticated. 346 tests.
  **La UI del campo se implementa en T30.**_
  Contexto: cierra el pendiente histórico "key vía safeStorage + campo en Settings". Hoy
  la key SOLO se lee de `.env`/`process.env` (`src/main/ai/env.ts`, `getAiEnv`). Patrón a
  imitar exacto: `src/main/auth/token-store.ts` (cifra con `safeStorage`, guarda un `.bin`
  en `app.getPath('userData')`, degrada a solo-memoria si `isEncryptionAvailable()` es
  false). La key es SECRETA → NO va en `settings.json` plano (ese es para provider/model,
  T26); va cifrada aparte.
  Entregables:
  (a) `src/main/ai/openrouter-key-store.ts` (o extender token-store parametrizado):
  `saveApiKey(key)`, `loadApiKey(): string|null`, `clearApiKey()`, archivo
  `openrouter-key.bin`. Mismo comportamiento de degradación que el token de GitHub.
  (b) `ai/env.ts`: `getAiEnv()` / la resolución de la key pasa a precedencia
  **safeStorage > env `OPENROUTER_API_KEY`** (la key guardada por el usuario gana; si no
  hay, cae al `.env`/env var de hoy — no romper el flujo actual de dev).
  (c) IPC: `settings:setOpenRouterKey` (`{key: string}`, se guarda y se limpia si viene
  vacía) y `settings:getOpenRouterKeyStatus` (→ `{ configured: boolean, source:
  'safeStorage'|'env'|'none' }` — NUNCA devuelve la key). Guards + handlers + preload.
  El refactor del factory (T27) debe reconocer la key de safeStorage como "OpenRouter
  autenticado".
  (d) UI (se integra en la pantalla de proveedores de T30): en la card de OpenRouter, un
  campo para pegar la key (input `password`), botón guardar y botón borrar, con estado
  "Configurada (safeStorage) / Tomada de .env / No configurada". Nunca re-mostrar la key.
  Gotchas: la key jamás cruza al renderer (solo el `configured`/`source`); `safeStorage`
  en Hyprland necesita el `--password-store=gnome-libsecret` que main ya fuerza (mismo
  gotcha que el token de GitHub); escritura del `.bin` con permisos restrictivos.
  _Aceptación (orquestador):_ typecheck/lint/tests; guardar una key desde la UI, reiniciar
  la app y verificar que OpenRouter queda autenticado sin `.env`; borrar la key vuelve a
  "no configurada" (o cae al `.env` si existe); la key NO aparece en ningún payload del
  renderer (revisión de la frontera); captura mirada del campo en sus tres estados.
  Ordena: depende de T26 (settings/ipc reestructurados) y se coordina con T27 (factory) y
  T30 (UI). Implementar tras T26; la parte UI junto con T30.
  _**HECHO** (backend subagente `aa59330f9b40573dd`, UI dentro de T30). VERIFICADO e2e
  (2026-07-07): con la key en `.env`, la card de OpenRouter muestra el campo con estado
  "Tomada de tu archivo .env — guardala acá para que quede cifrada" + Guardar/Borrar
  (captura mirada); provider-status reporta openrouter authenticated; la key no cruza al
  renderer (grep: `loadApiKey` solo en env.ts). Pendiente opcional: que Edilson pruebe el
  guardado real vía safeStorage desde la UI si quiere migrar del `.env`._

- [x] **T33. PATH robusto para app GUI (hidratación vía shell de login)**
  Contexto: mejora identificada en la investigación de t3code (ver nota de T31). Una app
  Electron lanzada desde el LAUNCHER del SO hereda un PATH mínimo, no el del shell del
  usuario → `resolve-cli.ts` podría no encontrar `claude`/`codex` si viven en una ruta que
  solo el shell conoce (nvm/volta/fnm/mise, prefijos globales de npm/pnpm/bun, rutas custom).
  Entregables: `src/main/system/shell-path.ts` — `hydratePathFromLoginShell()`: lanza el
  shell de login del usuario (`$SHELL -ilc`, marcadores para aislar el `$PATH` del ruido del
  perfil, timeout 2.5s), con fallback `launchctl getenv PATH` en macOS; fusiona (append sin
  duplicar, nunca reemplaza) el PATH capturado en `process.env.PATH`. No-op en Windows (las
  GUI heredan el PATH del registro) y nunca lanza (fallo → PATH intacto). Enganchado en
  `index.ts` (whenReady, **solo si `app.isPackaged`**, ANTES de `registerIpcHandlers` para que
  el probe/resolve-cli ya vean el PATH completo desde la primera resolución; en dev desde
  terminal el PATH ya viene completo → no se toca). Helpers puros exportados
  (`extractMarkedPath`, `mergePaths`) para test.
  _**HECHA Y VERIFICADA** (2026-07-07). 8 unit tests (parseo con ruido + merge append-only +
  dedupe + segmentos vacíos). **Mecanismo probado aislado en la máquina de Edilson**: con
  `PATH=/usr/bin:/bin` (recortado como el launcher), `hydratePathFromLoginShell()` recupera
  `~/.local/bin` Y `~/.local/share/mise/.../bin` (Edilson usa **mise** — ruta que resolve-cli
  NO hardcodea, así que T33 aporta valor real más allá de ~/.local/bin). AppImage rebuildeado
  con T33 = 125M, arranca OK con la hidratación activa, smoke-packaged 6/6 (el enganche no
  rompió el arranque). 400 tests totales. **HECHA.**_

---

## F8 — Selector de modelo dinámico + reasoning effort — 2026-07-07

> Rama `feature/model-effort` (desde `feature/multi-provider-ai`). Diseño y respuestas a las
> dos preguntas de Edilson: `PLAN.md` § "PROPUESTA F8". Aprobado por Edilson (F8 completo).
> Patrón base (de t3code): **descriptores de opción autocontenidos por modelo** — cada modelo
> declara sus choices válidas + default; la UI es genérica sobre eso; al cambiar de modelo el
> valor se recalcula (si el guardado no aplica → default). Se implementa SOLO el descriptor
> `effort` (extensible a service tier / thinking / context window después).
>
> Datos del protocolo REAL ya relevados (F7 + esta investigación):
> - Codex `model/list` (paginado `{data, nextCursor}`): tu cuenta expone `gpt-5.5`,`gpt-5.4`,
>   `gpt-5.4-mini`,`gpt-5.3-codex-spark`; cada `Model` trae `supportedReasoningEfforts`
>   (array de `{reasoningEffort, description}`), `defaultReasoningEffort`, `displayName`,
>   `hidden`. Regenerar esquema: `codex app-server generate-ts --out DIR`.
> - Codex effort se pasa en `turn/start.effort` (string low|medium|high|xhigh).
> - Claude Agent SDK: `EffortLevel = low|medium|high|xhigh|max`, campo `effort` en las options
>   de `query()`, `supportsEffort`/`supportedEffortLevels` por modelo (en `sdk.d.ts`).
> - OpenRouter: `reasoning: { effort }` en el body (verificar por-modelo cuáles lo aceptan).
> Gotchas de main vigentes: `import.meta.dirname`, sin backticks en strings largos, preload CJS.

- [x] **T34. Modelo de datos: option descriptors + selección con opciones**
  _HECHA Y VERIFICADA (2026-07-07, subagente `a60898bc8ab417210`). typecheck/lint/424 tests. Resolución robusta con test (xhigh en haiku-4-5 -> default high; max en sonnet-5 respetado; modelo sin descriptor -> options vacío). Bug arreglado de paso: setAiProvider/setProviderModel preservan modelOptions._
  `src/shared/ai-providers.ts`: `AiModelOption` gana `options?: ModelOptionDescriptor[]`,
  con `ModelOptionDescriptor = { id: string (por ahora 'effort'), label: string, choices:
  { value: string, label: string, description?: string, isDefault?: boolean }[] }`. Poblar el
  descriptor `effort` HARDCODE para Claude Code (matriz por modelo: fable-5/opus-4.8/sonnet-5
  soportan low|medium|high|xhigh|max; los demás según t3code — sin xhigh en varios; anotar los
  remapeos de compat para T36) y OpenRouter (qué modelos soportan reasoning + sus choices
  low|medium|high). Codex queda con su curado (los efforts reales llegan dinámicos en T35).
  `src/main/settings/store.ts`: `PersistedSettings` gana
  `modelOptions?: Partial<Record<AiProviderId, Record<string, string>>>` (p.ej.
  `{codex:{effort:'high'}}`). MIGRACIÓN aditiva: settings sin `modelOptions` → `{}` (usa
  defaults); no romper la migración de `{aiModel}` de T26 ni la forma `{aiProvider, models}`.
  Setter `setModelOption(provider, optionId, value)`. `src/main/ai/env.ts`:
  `getEffectiveAiSelection()` → `{ provider, model, options: Record<string,string> }`
  resolviendo cada opción contra las choices del modelo activo (si el valor guardado no está
  en las choices → default del modelo; si el modelo no tiene esa opción → se omite). IPC
  `settings:setModelOption` ({provider, optionId, value}) + guard + handler + preload.
  Extender `AiSettingsInfo` (respuesta de `settings:get`) con las opciones seleccionadas
  actuales (`selectedOptions` por proveedor) para que la UI pinte el estado.
  _Gotchas:_ TS estricto; la resolución robusta es el corazón (test explícito: guardar
  effort='max' para Codex —que no lo soporta— y verificar que resuelve al default del modelo).
  _Aceptación:_ typecheck/lint/tests (incl. migración aditiva + resolución robusta). Sin UI aún.

- [x] **T35. Catálogo dinámico de Codex (corregir `codex-model-catalog.ts` + cablear)**
  _HECHA (2026-07-07, subagente `a8a8cb6600a0f1583`). codex-model-catalog.ts reescrito con protocolo real (initialize con params, data/nextCursor, Model.supportedReasoningEfforts -> descriptor effort). provider-models.ts (canal `ai:getProviderModels` con cache TTL 60s + fallback). typecheck/lint/450 tests. Falta verificación e2e (4 modelos reales) que hace el orquestador en T37._
  Reescribir `src/main/ai/providers/codex-model-catalog.ts` con el protocolo REAL: `initialize`
  con `{clientInfo, capabilities:{experimentalApi:true}}`; `initialized`; paginar `model/list`
  leyendo `result.data` (NO `.models`) y `result.nextCursor`; por cada `Model` construir un
  `AiModelOption` con `id`, `label`=`displayName`, `vendor`='OpenAI', y `options`=[descriptor
  `effort` armado desde `supportedReasoningEfforts` (choices) + `defaultReasoningEffort`
  (isDefault)]. NO filtrar por `hidden`/plan (lección t3code: exponer lo que da la RPC).
  Fallback al curado (`AI_PROVIDER_CATALOG.codex.models`) ante cualquier fallo. Cablear a la UI
  con un canal IPC NUEVO async `ai:getProviderModels` (o `ai:getCodexModels`) con **cache TTL**
  (p.ej. 60s) + fallback — NO meter async en el `settings:get` síncrono de T26. El renderer lo
  consume aparte (con loading/fallback). Reutilizar el `CodexAppServerClient` (ya resuelve el
  binario del sistema vía resolve-cli). Tests contra la forma real (mock del cliente devolviendo
  `{data:[...], nextCursor}`).
  _Aceptación:_ typecheck/lint/tests; verificación e2e del orquestador (con la sesión de Edilson,
  los 4 modelos reales aparecen); fallback al curado si no hay sesión.

- [x] **T36. Pasar el reasoning effort a los tres servicios**
  _HECHA (2026-07-07, subagente `ad31a67d2cf7d79f5`). Codex turn/start.effort; Claude query effort + normalizeClaudeEffort (hook de compat, hoy identidad); OpenRouter body.reasoning.effort (formato verificado en docs). Solo se manda si hay effort resuelto (sin effort = comportamiento actual). typecheck/lint/450 tests. Falta e2e con effort alto real (coordinar sesión)._
  Leer `options.effort` de `getEffectiveAiSelection()` (T34) e inyectarlo:
  - `codex-service.ts`: agregar `effort` a los params de `turn/start` (solo si hay valor).
  - `claude-code-service.ts`: pasar `effort` en las `options` de `query()`, con un ÚNICO punto
    de normalización de compatibilidad (estilo `normalizeClaudeCliEffort` de t3code: p.ej.
    `xhigh`→`max` para modelos que no soportan xhigh nativo; `max`→`high` donde no exista).
    Documentar la matriz.
  - `openrouter-service.ts`: agregar `reasoning: { effort }` al body JSON (solo para modelos que
    lo soporten según T34; no mandarlo si no). Verificar el formato exacto contra la API de
    OpenRouter al implementar.
  _Gotchas:_ no romper el análisis actual cuando no hay effort seleccionado (comportamiento por
  defecto idéntico a hoy). Sin backticks en strings largos de main.
  _Aceptación:_ typecheck/lint/tests (cada servicio inyecta el effort cuando corresponde y lo
  omite si no); verificación e2e del orquestador: análisis real con effort alto en cada proveedor
  (coordinar sesión con Edilson para Claude/Codex).
  Puede ir en paralelo con T35 (archivos disjuntos: servicios vs catalog/ipc).

- [x] **T37. UI: selector de effort + modelos dinámicos de Codex**
  _HECHA Y VERIFICADA e2e (2026-07-07, subagente `a1579dcf0725db3fc` + verificación del orquestador). use-provider-models (fetch dinámico con fallback estático), ModelPicker dinámico, ModelOptionPicker (segmented de effort, genérico sobre descriptores, remount por key), setModelOption, ActiveModelHint con effort. **BUG destapado por la verificación e2e y ARREGLADO por el orquestador**: getEffectiveAiSelection (main) resolvía el effort contra el catálogo ESTÁTICO, donde Codex no tenía descriptor effort (solo el dinámico lo traía) -> el effort guardado se descartaba (selectedOptions.codex={}). Fix: poblar el estático de Codex (ai-providers.ts) con los 4 modelos + descriptor effort comun [low,medium,high,xhigh]; el dinámico sigue siendo la fuente de verdad para la UI. Verificado: selectedOptions.codex={effort:xhigh} tras setear; Codex ACEPTA effort xhigh en turn/start (turno corre, solo que xhigh es lento >2min). Captura mirada del selector RAZONAMIENTO con los 4 modelos Codex. 451 tests. OBSERVACIÓN: xhigh puede rozar el timeout total de 120s -> pulido futuro. **HECHA.**_
  En `src/renderer/src/components/settings/`: bajo el `ModelPicker`, un selector GENÉRICO sobre
  los `options` (descriptores) del modelo SELECCIONADO — por ahora renderiza el descriptor
  `effort` como radios/segmented con sus choices (label + description), marca el default,
  persiste vía `settings:setModelOption`. Remount por `key` al cambiar modelo/proveedor (para
  que el valor se recalcule contra el nuevo modelo). Para Codex, poblar el `ModelPicker` con los
  modelos DINÁMICOS de T35 (`ai:getProviderModels`) con estado de carga + fallback al curado.
  Componente reutilizable (`ModelOptionPicker` o similar) para poder sumar service tier/thinking
  después sin reescribir.
  _Gotchas:_ linter react-hooks (reset por remount, no setState-en-efecto); estados de carga/error
  visibles; el selector solo muestra choices soportadas por el modelo actual (vienen del descriptor).
  _Aceptación:_ typecheck/lint/tests; smoke e2e CDP (cambiar modelo/effort, persistencia tras
  reabrir, Codex muestra 4 modelos); **captura mirada** del selector de effort en cada proveedor.

- [ ] **T38. (Opcional/diferible) Gating por versión del CLI**
  Ofrecer solo modelos/efforts soportados por la versión instalada de `claude`/`codex` (semver,
  estilo `getBuiltInClaudeModelsForVersion` de t3code). Pulido; se decide al final de F8.

---

## Log F7 — Gotcha clave: el protocolo de `codex app-server` se AUTO-GENERA

**2026-07-07 (T29).** El binario `codex` puede emitir su propio contrato del app-server:
`codex app-server generate-ts --out <dir>` (bindings TypeScript) y
`codex app-server generate-json-schema --out <dir>` (JSON Schema). Es la FUENTE DE VERDAD por
versión del CLI — mejor que t3code (que puede ir en otra versión). Verdades del protocolo
0.142.5 (transport `stdio://` default, framing **JSONL** = un objeto JSON por línea, NO
Content-Length):
- Handshake: `initialize`(request, params `{clientInfo, capabilities:{experimentalApi:true,…}}`)
  → `initialized`(notify, sin params) → `account/read`(`{refreshToken:false}` →
  `{account: {type:'chatgpt', email, planType} | null, requiresOpenaiAuth}`; **auth = account
  != null**, `requiresOpenaiAuth` es true aun logueado).
- `thread/start` params `{model, baseInstructions, sandbox:'read-only', approvalPolicy:'never'}`
  → `{thread:{id}, model}`. El system prompt va en **`baseInstructions`**. sandbox+approval
  evitan que el agente ejecute comandos.
- `turn/start` params `{threadId, input: Array<UserInput>}` con `UserInput = {type:'text',
  text, text_elements:[]}`. **Resuelve con un ACK inmediato (`turn.status:'inProgress'`)** — el
  fin real es la notificación **`turn/completed`**.
- Deltas de texto del asistente: notificación **`item/agentMessage/delta`** con
  `params.delta:string`. (Razonamiento va por `item/reasoning/textDelta` — ignorar.)
- Modelos vía `model/list` → `{data:[{id:'gpt-5.5',…}]}`. Hoy solo `gpt-5.5` (default del
  thread). NO existe un id `gpt-5.5-codex`.
- Errores: notificación `error` `{message}`; o `turn/completed` con `turn.status:'failed'`.
Reproducir el descubrimiento: `codex app-server generate-ts --out /tmp/x/ts` y leer
`ClientRequest.ts`/`ServerNotification.ts`/`v2/*Params.ts`. El esquema JSON completo está en
`codex_app_server_protocol.v2.schemas.json`.

---

## Log

- 2026-07-05: Plan creado. T1 lanzada a subagente Sonnet.
- 2026-07-05: **T1 hecha y verificada** (subagente Sonnet `adffa4a9458bb8541` + verificación del orquestador).
  typecheck/lint/build verdes; ventana "Minerva" confirmada mapeada vía `hyprctl clients`.
  Gotchas: (a) hubo que correr `node node_modules/electron/install.js` porque el binario
  de Electron no se descargó en el install inicial; (b) electron pineado a vite 7.x
  (peer dep de electron-vite 5); (c) preload se emite como `.mjs`.
- 2026-07-05: T2 lanzada a subagente Sonnet.
- 2026-07-05: **T2 hecha y verificada** (subagente `af17719ebd6674455`). Contratos en
  `src/shared/ipc.ts` (IpcContract + MinervaApi derivado por tipos), validación de
  payloads en `src/main/ipc/register.ts`, preload sin ipcRenderer crudo. Prueba de
  tipos negativa confirmada (TS2322). Checks verdes + ventana OK.
- 2026-07-05: T3 lanzada a subagente Sonnet.
- 2026-07-05: **BUG encontrado en verificación de T3** (venía desde T1): con `sandbox: true`
  el preload NO puede ser ESM — Electron lanzaba `SyntaxError: Cannot use import statement
  outside a module` y `window.minerva` quedaba undefined → TitleBar crasheaba → pantalla
  en blanco. Fix (orquestador): preload forzado a CJS en electron.vite.config.ts
  (`format: 'cjs'`, `entryFileNames: '[name].cjs'`) + ruta `.cjs` en main. Hardening:
  `useConnectionStatus` defensivo + `ErrorBoundary` global en main.tsx.
  Lección: verificar SIEMPRE con la app corriendo y captura de pantalla, no solo checks.
- 2026-07-05: **T3 hecha y verificada** (subagente `abca3fdf8fa2a4daa` + fix del orquestador).
  Captura visual confirma: sidebar 3 repos/8 PRs con badges, empty state, panel didáctico,
  indicador "Conectado" verde (IPC end-to-end OK). Checks verdes.
- 2026-07-05: T4 implementada (subagente). `src/main/github/{service,mock-service,fixtures,index}.ts`
  (interfaz `GithubService` tipada sobre `IpcRequest/IpcResponse` del contrato, mock en memoria
  con latencia simulada 180-320ms y `postComment` mutando hilos del proceso), 5 handlers
  `github:*` delegando a una instancia única en `registerIpcHandlers`. Renderer: hooks
  `usePullRequests` (debounce 250ms), `usePullRequestDetail`, `usePullRequestFiles`,
  `useCommentThreads` (con `reload`), store con `selectedPr` completo (no solo id) para no
  tener que re-buscarlo al pedir detalle/archivos/hilos. `ConversationTab` ahora incluye
  formulario de comentario general end-to-end. Eliminado `src/renderer/src/mocks/pull-requests.ts`.
  typecheck/lint/build verdes.
  Gotcha de build no trivial: con `main` a ESM, el plugin `vite:esm-shim` de electron-vite
  usa una regex de texto plano (no AST) para ubicar dónde termina el último `import ... from
  '...'` del bundle e insertar ahí un shim de interop CJS (necesario porque `main/index.ts`
  usaba `__dirname`). Esa regex no distingue código real de texto dentro de un string: los
  fixtures mock (diffs de ejemplo con `import { X } from 'y'` como texto) calzaban con el
  patrón y el shim quedaba insertado en medio de esas cadenas, corrompiendo el bundle
  (`Unterminated string literal` solo en `npm run build`, típecheck/lint no lo detectan).
  Fix: `main/index.ts` usa `import.meta.dirname` en vez de `__dirname` — sin ese global de
  CommonJS el plugin de interop nunca se activa. Pendiente: verificación visual del
  orquestador (no se corrió `npm run dev` por instrucción explícita de la tarea).
- 2026-07-05: **T4 hecha y verificada** con smoke e2e vía CDP (`scripts/smoke-e2e.mjs`,
  app corriendo con `--remote-debugging-port=9222`): 5/5 PASS — lista vía IPC, indicador
  Conectado, selección de PR (#479), tab Archivos con DiffFiles, y **postComment
  end-to-end** (comentario visible en el hilo tras recarga). Captura visual confirma.
  Se agregó `ws` como devDependency para el harness CDP.
- 2026-07-05: **T5 verificada como absorbida por T3+T4**: agrupación por repo, badges
  CI/draft/reviewDecision, estados loading/error en hooks, y búsqueda con debounce
  filtrando en main — verificada e2e con `scripts/smoke-search.mjs` (PASS).
- 2026-07-05: T7 lanzada a subagente Sonnet.
- 2026-07-05: **T7 hecha y verificada** (subagente `a9d98db100c78a2e5`). Parser de unified
  diff propio + split/inline + árbol tree/list + Shiki (via shiki/core con langs estáticos
  y engine JS — evita ~150 chunks en el build; highlighting línea a línea con tokens React,
  sin dangerouslySetInnerHTML). 29/29 tests vitest. Smoke e2e `scripts/smoke-diff.mjs`:
  7/7 PASS. Captura visual confirma split view con hunks, números, colores y highlighting.
- 2026-07-05: T8 lanzada a subagente Sonnet.
- 2026-07-05: **T8 hecha y verificada** (subagente `acd364604ba0454f4`). Hilos de línea en
  el diff (indicador en gutter, expansión inline, reply, crear hilo con "+", side
  LEFT/RIGHT), chip path:line navegable desde Conversación, hilos resueltos colapsados.
  36/36 tests. Smoke `scripts/smoke-comments.mjs`: 5/5 PASS. Nota de verificación: los 2
  fallos iniciales eran del PROPIO TEST (clickeaba el botón de colapso padre en vez del
  span[role=link] del chip) — la app estaba bien; debug con `scripts/debug-t8.mjs`.
- 2026-07-05: T9(mock)+T10 lanzadas juntas a subagente Sonnet: panel didáctico completo
  en renderer (Markdown+Mermaid) contra un `AiService` mock en main con fixtures de
  DidacticAnalysis; el Anthropic real se enchufa en T9-final cuando haya API key.
- 2026-07-05: **T10 hecha y verificada** (subagente `a7dc9045832b2c275`). Panel didáctico
  e2e con AiService mock: secciones summary/endpoint/architecture/schema, Mermaid lazy
  (chunk separado ~1MB, securityLevel strict, theme dark, fallback a código fuente),
  react-markdown+gfm, snippets copiables. Smoke `scripts/smoke-didactic.mjs`: 9/9 PASS
  (C4 #482, ER #479, C4Component #201, reset de panel al cambiar PR). T9 queda [~]:
  estructura/interfaz lista, falta impl real Anthropic (bloqueada por API key).
- 2026-07-05: T11 (revisión de seguridad) lanzada a subagente Sonnet.
- 2026-07-05: **Revisión de seguridad completada** (subagente `a66b63f5c713f8db3`):
  0 altos. Fixes aplicados por el orquestador (openExternal solo http/https; preload
  lanza si no hay contextIsolation). Regresión completa de smokes tras los fixes:
  smoke-e2e 5/5, smoke-diff 7/7, smoke-comments 5/5, smoke-search PASS, smoke-didactic 9/9.
  Nota: dos fallos intermedios de smoke-e2e eran del PROPIO test (querySelector('textarea')
  tomaba el reply de un hilo en vez del composer general tras T8; y /comentar/i matcheaba
  "· 1 comentario" del header de hilos). La app estaba bien en ambos casos.
- 2026-07-05: Edilson entregó el OAuth Client ID (`Ov23liwnuK40dnyINVGy`, Device Flow
  habilitado). T6 lanzada a subagente Sonnet, incluyendo la validación profunda de
  payloads IPC (hallazgo medio #2 de la revisión de seguridad).
- 2026-07-05: Edilson entregó `OPENROUTER_API_KEY` (`.env` en la raíz, ya en
  `.gitignore`). T9-final lanzada a subagente Sonnet.
- 2026-07-05: **T9-final implementada** (subagente Sonnet). `src/main/ai/env.ts`
  (parser propio de `.env`, `process.env` primero), `prompts/analyze-pr.ts` +
  `prompts/README.md` (reescrito: el diseño previo de clasificador multi-paso con
  Anthropic Agent SDK quedó obsoleto, ahora es una sola llamada de chat a OpenRouter
  que clasifica y genera todo junto), `diff-budget.ts`, `json-extract.ts`,
  `section-mapper.ts`, `openrouter-service.ts` (`OpenRouterAiService`). `createAiService`
  (`ai/index.ts`) ahora toma el `GithubService` activo por parámetro y elige real vs.
  mock según haya o no `OPENROUTER_API_KEY` — independiente de `MINERVA_MOCK`, a
  propósito, para poder correr IA real sobre PRs mock. `handlers.ts` actualizado para
  pasarle `githubService` a `createAiService`. Gotcha aplicado: el prompt (string largo)
  se armó con concatenación de comillas normales, no template literal con backticks
  (mismo bug de `vite:esm-shim` que en `github/fixtures.ts`); build final confirma
  `out/main/index.js` sin corrupción (`node -c` OK, contenido del prompt presente en el
  bundle). Fix de lint: los `throw` en el catch de la llamada a `fetch` necesitaban
  `{ cause: error }` (regla `preserve-caught-error`, mismo patrón que `ipc/register.ts`).
  typecheck/lint/test (150/150, ~40 nuevos)/build verdes. PENDIENTE: verificación e2e
  del orquestador con la app corriendo (`MINERVA_MOCK=1` + key real) antes de pasar a `[x]`.
- 2026-07-06: **T6 hecha y verificada**: login real de Edilson completado vía Device Flow
  (código 6934-F39F → `signed_in` como `edygg`, observado por watcher CDP). Bug encontrado
  y arreglado en verificación: la Sidebar no refetcheaba al cambiar el estado de auth
  (3 instancias de useAuth con estado local independiente) → `authStatus` movido al store
  de zustand como fuente única, `usePullRequests(search, authState)` refetchea al loguear,
  y useAuth retoma polling si monta con device flow pendiente. Lista real devuelve `[]`
  legítimo (query base `is:pr is:open involves:@me`; el buscador acepta cualificadores
  `org:`/`repo:` — empty state nuevo lo explica).
- 2026-07-06: **T9-final hecha y verificada**: Edilson entregó OPENROUTER_API_KEY
  (guardada en `.env` raíz, modo 600, gitignored, + `.env.example`). Verificación e2e
  real: `ai:analyzePullRequest` sobre PR mock shopwave/api#482 con MINERVA_MOCK=1 +
  key real → 13.4s, secciones [summary, endpoint], resumen de calidad (detectó falta
  de persistencia del cupón en el modelo Cart). Modelo: anthropic/claude-sonnet-4.5
  vía MINERVA_AI_MODEL. Lint/typecheck/tests(150)/build verdes tras fix de deps de
  useCallback en use-auth.
- 2026-07-06: Gotcha de tooling del orquestador: `pkill -f "<patrón>"` en los comandos
  de verificación mataba el PROPIO shell si el patrón aparece literal en la línea de
  comando (por eso todos los "exit 144"). Usar `[e]lectron` en el patrón.
- 2026-07-06: **T12 hecha y verificada** (subagente `a8ec8959ac1812fed`). Settings en
  userData/settings.json (atómico), lista curada en shared/ai-models.ts, precedencia
  settings>env>default, modal con radio-cards + "Otro (avanzado)", hint "vía <modelo>".
  Smoke `scripts/smoke-settings.mjs` 6/6: default GLM 5.2, persistencia en disco, y
  PRUEBA de que el análisis usa settings (modelo inválido → 400 de OpenRouter; GLM 5.2
  → análisis real OK). 170/170 tests. T13 lanzada.
- 2026-07-06: **T13 hecha y verificada** (subagente `adae073f8f6e3b9a3`). Protocolo tagged
  @@@SECTION/@@@MERMAID/@@@SNIPPET (reemplaza JSON — más robusto para streaming),
  StreamSectionParser incremental (24 tests), SSE real en openrouter-service (timeouts
  120s total + 20s inactividad), mock streamea con el mismo parser, eventos push
  main→renderer (preload expone onAnalysisProgress concreto, sin `on` genérico).
  188/188 tests. Smoke `scripts/smoke-streaming.mjs`: mock 6/6 (7 eventos, 909ms) y
  REAL 6/6 (GLM 5.2: primer evento 5.3s, total 10.5s, crecimiento 0→2126 chars).
  T14 lanzada.
- 2026-07-06: **T14 hecha y verificada** (subagente `a51e416ddd0ef0ffd`). Cache LRU de
  análisis en main (20 entradas; hit → instantáneo sin eventos ni costo LLM), canales
  ai:getCachedAnalysis/ai:invalidateAnalysis/window:openDidactic, ventana didáctica
  única (reutilizada por navegación, hash #didactic/<owner>/<name>/<n>, misma frontera
  de seguridad extraída a src/main/windows/), botón Re-analizar, ResourceViewer con
  zoom/pan (rueda hacia cursor, drag, fit, Esc). 229/229 tests.
  Smoke `scripts/smoke-detach.mjs` 8/8 (dos targets CDP, uno por ventana).
- 2026-07-06: **Lección de la suite e2e**: los "6/9 flaky" de smoke-didactic NUNCA
  fueron bug de la app — era contaminación entre suites en la misma sesión de app:
  (a) smoke-search dejaba el buscador filtrando 'refunds' → los clicks de selección
  de otras suites fallaban en silencio; (b) el cache de T14 convierte el "primer
  análisis" de suites posteriores en cache-hit sin streaming. Fixes: smoke-didactic
  limpia el buscador al arrancar; smoke-detach invalida el cache de su PR. Regresión
  completa de las 7 suites en una sola sesión: TODAS verdes.
  Regla para futuras suites: dejar el estado global (buscador, cache) como lo
  encontraste o limpiarlo al empezar.
- 2026-07-06: **T15 hecha y verificada** (bugs reportados por Edilson con capturas).
  Fixes de app: (1) botón "Expandir snippet" integrado al header de CodeSnippet
  (antes el overlay flotante caía encima de "Copiar" — ambos incliqueables);
  (2) `ui/Markdown.tsx` compartido (ex DidacticMarkdown) para hilos de comentarios
  y descripción del PR (ConversationTab/ThreadCard renderizaban <pre> plano);
  (3) visor de recursos vacío: el SVG de mermaid (width:100% + max-width) colapsaba
  a 0px dentro del wrapper `absolute` de MermaidZoomPan → `withNaturalSize` fija
  width/height del viewBox EN EL STRING del SVG (mutar el nodo montado se pierde si
  React re-inserta el innerHTML) y el fit se calcula del viewBox (medir rect/zoom
  era orden-dependiente: dos fits en el mismo frame — StrictMode — componían el
  factor hasta clavarse en 25%); (4) CSP explícita con `img-src 'self' data: https:`
  (el person icon de C4 es PNG base64 → icono roto; también habilita avatares e
  imágenes de comentarios de GitHub); (5) BUG REAL destapado al endurecer la suite:
  reutilizar la ventana didáctica con otro PR era navegación same-document (solo
  cambia el hash) → Chromium NO recarga y quedaba el contenido del PR anterior con
  la URL del nuevo; main.tsx ahora es reactivo a `hashchange` con `key={hash}`.
  229/229 tests; 9 suites e2e verdes (nueva `scripts/smoke-bugfixes.mjs` 7/7).
- 2026-07-06: **Lecciones de suites e2e (ronda 2)**:
  (a) TODA suite debe excluir la ventana didáctica al elegir target CDP
  (`!t.url.includes('#didactic')`) — smoke-didactic se conectó a la ventana
  desacoplada y todos sus clicks "fallaban" sin bug alguno (6/9 fantasma, otra vez).
  (b) El check de reuso de ventana era solo-URL y por eso el bug (5) vivió oculto:
  verificar CONTENIDO, no solo URL. (c) No esperar por textos que ya existen en el
  placeholder ('Resumen'); esperar señales inequívocas (botón Re-analizar habilitado).
  (d) Con IA real las secciones del análisis varían por corrida: los checks de
  snippet/diagrama necesitan fallback a otro PR (cache) o tolerancia; el residuo de
  flakiness de smoke-bugfixes en batch es eso — standalone pasa 7/7 consistente.
  (e) Suites que analizan un PR concreto deben invalidar su cache al arrancar
  (streaming/settings cayeron por cache-hit de corridas previas).
- 2026-07-06: **T15-bis: el visor de mermaid SEGUÍA vacío para Edilson** (captura suya:
  diálogo colapsado a header+toolbar, zoom clavado en 25% = clamp mínimo). Causa REAL
  (distinta a la de T15): el diálogo del ResourceViewer tenía `max-h-[90vh]` y altura
  por contenido, pero el diagrama dentro de MermaidZoomPan es `absolute` (fuera de
  flujo, no aporta altura) → el diálogo colapsaba y el `overflow-hidden` escondía todo.
  Fix: `h-[90vh]` FIJO para recursos mermaid (markdown/snippet conservan max-h).
  Extra: `page-title-updated` bloqueado en la ventana didáctica (el <title> del HTML
  pisaba el título por-PR).
  **LECCIÓN CLAVE (pedida por Edilson): las verificaciones de UI deben terminar en una
  CAPTURA DE PANTALLA mirada de verdad.** Mis checks CDP daban PASS porque
  getBoundingClientRect ignora el clipping: el SVG "medía" 991x355 dentro de un área
  de 0px de alto. Nuevo helper `scripts/screenshot-app.sh` (hyprctl+grim, no
  interactivo, mismo mecanismo que omarchy-capture-screenshot; segundo arg apunta a
  la ventana didáctica por título). Suites endurecidas: smoke-bugfixes y smoke-detach
  ahora exigen altura real del área de zoom (>300px) y solape vertical.
  Verificado VISUALMENTE con grim: visor con C4 a fit 86% (ventana ancha) y 53%/34%
  (tileada), zoom a 151% funcionando, y ventana desacoplada también OK.
  typecheck/lint/229 tests/smoke-bugfixes 7/7/smoke-detach 8/8 verdes.
- 2026-07-06: **Fix: sesión de GitHub no persistía (login en cada arranque)**.
  Causa: Chromium no reconoce XDG_CURRENT_DESKTOP=Hyprland → password store
  `basic_text` → `safeStorage.isEncryptionAvailable() = false` → token-store se
  niega (bien) a persistir el token sin cifrar → re-login SIEMPRE, en dev Y en
  producción en esa máquina — aunque gnome-keyring estaba corriendo con
  org.freedesktop.secrets. Fix en `main/index.ts` (antes de whenReady): si el
  desktop no está en la lista que Chromium reconoce, se fuerza
  `--password-store=gnome-libsecret` (Secret Service de D-Bus); override con
  MINERVA_PASSWORD_STORE. + Log diagnóstico permanente del backend al arrancar.
  Verificado: probes de electron (basic_text/false sin switch → gnome_libsecret/
  true con switch), roundtrip cifrar→archivo→REINICIO de proceso→descifrar OK,
  y la app real loguea "backend: gnome_libsecret — cifrado disponible: true".
  Falta 1 login manual de Edilson para confirmar el ciclo completo (el token
  se guarda al completar el device flow).
- 2026-07-06: **Documentación actualizada al estado real (cierre de sesión)**:
  CLAUDE.md reescrito (stack actual, OpenRouter+settings+streaming tagged+cache,
  ventana desacoplada reactiva a hashchange, CSP, gotchas duros, reglas de
  verificación con suites CDP + captura obligatoria); README con features F4,
  puesta en marcha real, sección de desarrollo/verificación y roadmap al día;
  PLAN.md con nota de estado; .env.example con MINERVA_PASSWORD_STORE.
  NUEVO `.agents/WORKFLOW.md`: documenta la estrategia multi-agente del proyecto —
  **Fable 5 como orquestador** (plan, definición de tareas, verificación e2e,
  diagnóstico de causas raíz, bitácora) y **Sonnet 5 en subagentes** para la
  implementación de tareas bien descritas; regla de oro: nada pasa a [x] sin
  verificación del orquestador.
- 2026-07-06: **T16 (calidad de diagramas) — implementación + 2 gotchas nuevos**.
  Cambios (subagente Sonnet `ae4a8010cbc71ac7f` + ajustes del orquestador):
  mermaid `theme: 'neutral'` + fondo blanco en tarjeta inline y área del visor;
  config de layout en `initialize` (c4ShapeInRow 3, c4BoundaryInRow 1, márgenes/
  padding arriba, messageFontSize 14; er/flowchart análogos); prompt y skill
  `mermaid-c4-diagram` con reglas de DSL sobrio (Rel ≤4 palabras, ≤8 elementos,
  tecnología corta). El efecto medido en el C4 del fixture: viewBox pasa de
  2412x512 (fila única apretada) a 1316x1042, 0 pares de etiquetas solapadas.
  **GOTCHA (mermaid): el carácter `#` dentro de un diagrama C4 rompe el lexer**
  ("Lexical error on line N") con CUALQUIER config — el fixture del PR 482 tenía
  `title ... PR #482 ...` y por eso el visor caía a "Diagrama no renderizable";
  era un bug LATENTE (no lo introdujo T16). Ojo: un render fallido de mermaid
  deja un SVG residual en el DOM (los checks que cuentan SVGs mienten; verificar
  el fallback card, no la presencia de SVG). Fix: sin `#` en fixtures + regla
  explícita en prompt y skill. Además el catch de `MermaidDiagram` ahora hace
  `console.error` del motivo (antes tragaba el error en silencio y el fallback
  era indistinguible entre DSL malo y bug nuestro).
  **GOTCHA (electron-vite): `electron-vite dev` SIN `--watch` NO reconstruye ni
  reinicia main al cambiar `src/main/**`** (solo el renderer tiene HMR) — la
  nota de CLAUDE.md de "main cambia ⇒ reinicio completo" solo aplica con `-w`.
  Cambios en fixtures/prompts requieren reiniciar `npm run dev` a mano.
  Verificación: typecheck/lint/229 tests verdes; smoke-bugfixes 7/7 y
  smoke-detach 8/8 (contra instancia propia con CDP en :5174, sin tocar la
  instancia del usuario); DOM del visor: fondo rgb(255,255,255), fills de texto
  #444/negro sobre blanco, 0 solapes. Captura visual pendiente de hyprlock
  (vigía en background la toma al desbloquear) — T16 queda [~] hasta MIRARLA.
- 2026-07-06: **T16 cerrada [x] — segunda ronda tras MIRAR la captura** (la lección
  de T15-bis salvó la tarea otra vez: el DOM decía "todo bien" y la captura mostró
  el diagrama en miniatura). Tres fixes adicionales del orquestador:
  (1) **`withNaturalSize` nunca funcionó con C4**: mermaid emite el person icon como
  `<image xlink:href=...>` SIN declarar `xmlns:xlink` y DOMParser en modo
  `image/svg+xml` rechaza el documento entero → la función devolvía el markup
  intacto (width 100% → colapso en el wrapper absolute). Fix: parsear como
  `text/html` (tolerante y coherente con dangerouslySetInnerHTML).
  (2) **Recorte de lienzo**: el motor C4 emite >100px de bandas muertas por lado;
  ahora `normalizeSvg` mide el bbox real (host oculto con visibility:hidden — con
  display:none getBBox da 0) y recorta el viewBox a contenido+24px. El auto-fit
  pasó de 51% a 67% en el fixture. Aplica también a la tarjeta inline (max-width).
  (3) **`c4ShapeMargin: 110`** (60 se quedaba corto: las etiquetas de Rel
  horizontales pisaban las cajas vecinas) + etiquetas del fixture 482 acortadas a
  la regla de ≤4 palabras.
  NUEVO `scripts/screenshot-cdp.mjs`: captura por CDP (`Page.captureScreenshot`),
  independiente del workspace visible de Hyprland y de hyprlock — grim capturaba
  el lockscreen o un workspace ajeno; para verificar CONTENIDO de la app este es
  el camino robusto (la captura hyprctl+grim sigue valiendo para geometría real
  de ventana).
  Verificación final: typecheck/lint/229 tests; smoke-bugfixes 7/7, smoke-detach
  8/8, smoke-didactic 9/9; captura CDP MIRADA: fondo blanco, fit 67%, todas las
  etiquetas de Rel legibles en los huecos sin pisar cajas, title y boundary
  correctos. Diagramas de PR 479 (ER) y 201 (C4) también renderizan.
- 2026-07-06: **T17 y T18 hechas y verificadas** (reportes de Edilson con capturas
  sobre el PR real #70 de clevr-merlin; implementación en paralelo por dos
  subagentes Sonnet; verificación del orquestador).
  **T17 (contraste)**: token `--color-code-bg #15181d` + `--color-border` a
  `#353b47`; `Markdown.tsx` con cuerpo `text-text/90` (muted ya no se usa para
  contenido), h2 con `border-b`, inline code `bg-white/10`, `pre` sobre
  `bg-code-bg`, `thead bg-border/60` + zebra `even:bg-white/[0.03]`, `td
  text-text/85`; header de `DidacticSectionCard` con `bg-white/[0.04]`.
  **T18 (alineación diff)**: GOTCHA CSS GRID aprendido — las pistas `auto` de un
  grid ABSORBEN el espacio libre del contenedor (a diferencia de `max-content`):
  con un grid POR HUNK, los gutters se inflaban distinto en cada hunk según su
  línea más larga y el inicio del código saltaba ~100px entre hunks (se percibía
  como "indentación rota"; el patch crudo de GitHub venía limpio — verificado
  con `gh api .../pulls/70/files`). Fix: UN grid por archivo (SplitDiff/InlineDiff
  reciben `hunks` y renderizan los headers `@@` como filas `gridColumn: 1 / -1`),
  gutters `max-content` y contenido `minmax(max-content, 1fr)` (los fondos
  verde/rojo siguen llegando al borde); `OpenComposer` pasó a key compuesta
  `hunk:fila`. `HunkBlock` eliminado de DiffView.
  Verificación: typecheck/lint/229 tests; smoke-diff 7/7, smoke-comments 5/5;
  capturas CDP MIRADAS: split e inline con hunks múltiples alineados (números y
  código en la misma x, sangría relativa intacta, wrap on/off), análisis real de
  #482 (kimi-k2.7-code) y visor "Endpoint — vista amplia" con tabla, chips y JSON
  claramente distinguibles. Sin regresiones visibles en lista de PRs/conversación.
- 2026-07-06: **T20 hecha y verificada** (subagente Sonnet + verificación del
  orquestador). Nueva sección `setup` ("Cómo levantar la app"), SIEMPRE presente,
  2ª tras summary: Docker si el diff lo evidencia, corrida local, env vars
  requeridas y tabla OBLIGATORIA de env vars nuevas del PR (o declaración
  explícita de que no hay). Slice completo: types/events (kind `setup` +
  languages `bash`/`env` en snippets), section-mapper, stream-parser
  (KNOWN_KINDS/toDraft/sectionToText), prompt analyze-pr.ts, agente
  pr-didactic-analyzer.md, fixtures pr482 (con env var nueva
  COUPON_MAX_DISCOUNT_RATE) y pr479 (caso "sin env vars"), SECTION_META con
  icono Rocket y render de snippets en endpoint|setup (final y draft).
  Verificación: typecheck/lint/235 tests; smoke-didactic EXTENDIDA con 4 checks
  de setup (card presente, env vars documentadas, snippets copiables, caso
  "sin env vars") 13/13; smoke-streaming 6/6; smoke-detach 8/8 — todo con IA
  mock forzada (OPENROUTER_API_KEY= vacío gana al .env) + MINERVA_MOCK=1.
  Capturas CDP MIRADAS: card con markdown jerárquico, tabla de la env var nueva
  y snippets bash/env con "Copiar". Nota de diseño de la suite: checks de
  contenido estrictos contra fixture con fallback laxo al contrato ("habla de
  variables de entorno") para cuando corre con IA real.
- 2026-07-06: **T21 hecha y verificada** (subagente Sonnet + verificación del
  orquestador). Shiki aprobado por Edilson tras comparar con highlight.js y
  prism-react-renderer; al arrancar se descubrió que Shiki 4.3.1 YA estaba en el
  proyecto (diff view, T7) — se EXTENDIÓ `lib/highlighter.ts` en vez de crear
  otro highlighter: gramáticas dotenv/http/docker/diff/python, `highlightCode`
  multilínea (contexto completo, a diferencia de `highlightLine` del diff),
  `resolveSnippetLang` (curl→bash, env→dotenv, aliases de fences, desconocido→
  null) y componente compartido `ui/HighlightedCode.tsx` (tokens→spans React,
  sin innerHTML; remount-por-key para el fallback plano mientras carga, la
  convención del repo para el linter set-state-in-effect). Integrado en
  `CodeSnippet` y el override `code` de `ui/Markdown.tsx` (fences con
  `language-xxx`; inline intacto); `ResourceViewer` lo hereda vía CodeSnippet.
  De paso: fence del bodyMarkdown del PR mock 482 etiquetado ` ```bash ` para
  ejercitar e2e la ruta de fences. Verificación: typecheck/lint/271 tests +
  build; smoke-didactic 13/13, smoke-streaming 6/6, smoke-diff 7/7 (el
  highlighter es compartido con el diff), smoke-detach 8/8; capturas MIRADAS:
  snippets bash/env de la card setup coloreados (dotenv resalta claves) y fence
  curl del comentario del PR 482 con 11 spans coloreados.
  GOTCHA nuevo (verificación): el watcher de electron-vite dev NO recompiló
  main al tocar `github/fixtures.ts` (el fence tagueado no aparecía tras
  esperar el "restart"); hizo falta matar y relanzar `npm run dev`. Y al
  relanzar: `pkill -f "vite"` sin el truco del corchete mata el PROPIO shell
  del comando compuesto (exit 144) — usar siempre `pkill -f "[v]ite"` /
  `pkill -f "[e]lectron"`.
- 2026-07-06: **T21-bis (fix directo del orquestador, reportado por Edilson con
  captura del PR real clevr-merlin #70)**: la vista de diff mostraba archivos
  `.py` sin resaltar — T21 agregó gramáticas nuevas para fences/snippets pero
  NO actualizó `EXTENSION_TO_LANG` (el mapa por extensión que usa
  `inferLanguage` en el diff). Fix en `lib/highlighter.ts`: extensiones
  py/pyi→python, toml→toml (gramática nueva), env→dotenv, http, diff/patch,
  dockerfile→docker, y `inferLanguage` ahora resuelve por BASENAME los archivos
  sin extensión útil (`Dockerfile`, `Dockerfile.*`, `.env`, `.env.example`).
  `resolveSnippetLang` hereda todo por el spread. LECCIÓN: al sumar una
  gramática de Shiki hay que tocar DOS mapas (aliases de fences y extensiones
  del diff) — quedaron uno al lado del otro en el mismo archivo.
  Verificación: typecheck/lint/281 tests; e2e contra el PR REAL #70 (sesión
  GitHub persistida): archivo de tests Python con 1653 spans coloreados,
  captura mirada (imports/strings/comentarios diferenciados); smoke-diff 7/7 y
  smoke-didactic 13/13 en mock.
- 2026-07-06: **T22 hecha y verificada** (subagente Sonnet `ad98f3613035c3f3c` +
  fix del orquestador + verificación del orquestador). Reporte de Edilson con
  captura: desacoplar a mitad de un streaming abría una ventana en placeholder;
  cerrar/reabrir el panel perdía el resultado; y re-analizar con uno en vuelo
  pagaba el LLM dos veces. Implementado: registro in-flight en
  `ai:analyzePullRequest` (promesa compartida por PR + snapshot vivo vía getter),
  canal nuevo `ai:getAnalysisState` (cached|streaming|idle), evento terminal
  SIEMPRE (el `done:true` del servicio se suprime y se re-emite DESPUÉS de
  poblar el cache; en error se emite con `error: string` — antes en error nadie
  se enteraba jamás), hook con auto-attach en ambas superficies (la opción
  `autoLoadFromCache` desapareció) y "Abrir en ventana" cierra el panel acoplado.
  BUG encontrado por la VERIFICACIÓN VISUAL del orquestador (los smokes no lo
  atrapaban): la primera implementación solo se suscribía al streaming si
  montaba a MITAD de uno; una ventana ya abierta en un PR (reutilizada con el
  MISMO PR no hay `hashchange` → no hay remount) quedaba SORDA ante un análisis
  lanzado después desde otra superficie. Fix: el hook mantiene un listener de
  progreso PERMANENTE durante todo el montaje (attach pasivo; un chunk nuevo
  limpia analysis/error viejos y re-sincroniza; `analyze()` local tiene
  prioridad vía ref `localAnalysisActive`). smoke-detach EXTENDIDA a 17 checks
  (panel cerrado tras desacoplar, reabrir muestra cache sin click, dedupe
  in-flight por `generatedAt`, attach a mitad de streaming, ventana sorda se
  re-sincroniza); tres bugs de SUITE corregidos por el orquestador en el camino:
  (1) el click de "Abrir en ventana" requiere PR seleccionado en la UI (las
  suites viejas llamaban IPC directo); (2) matcher ambiguo — "Re-analizar"
  visible NO implica análisis terminado, se muestra también durante streaming
  adjunto (la señal buena: contenido + `getAnalysisState === 'streaming'`, o
  el cursor ▍); (3) el estado final se pollea hasta `cached` (carrera con los
  ~900ms del mock). smoke-didactic ahora invalida el cache de TODOS sus PRs al
  arrancar: con T22 el panel auto-adjunta el cache al montar, y "partir del
  placeholder" ya no se logra solo con el remount por cambio de PR.
  Verificación: typecheck/lint/290 tests; smoke-detach 17/17 (x2), smoke-didactic
  13/13, smoke-streaming 6/6, smoke-bugfixes 7/7; capturas CDP MIRADAS:
  desacoplada enganchada a mitad de streaming con el resumen ya transmitido,
  principal con panel cerrado, desacoplada completa, panel reabierto con cache.
- 2026-07-06: **T23 hecha y verificada** (fix directo del orquestador tras T22,
  mismo archivo). Resize del panel acoplado: handle de 6px en el borde
  izquierdo (pointer capture, sin listeners globales), `didacticPanelWidth` en
  app-store con clamp [320, 60% del viewport EVALUADO por llamada] y
  persistencia en localStorage (`minerva.didacticPanelWidth`); doble click
  restaura los 380px por defecto. Verificación por CDP con input REAL
  (`Input.dispatchMouseEvent` — los PointerEvent sintéticos de JS no activan
  `setPointerCapture`, tiran NotFoundError): crecer 180px → 349→528, achicar
  120px → 528→407, doble click → 380, ancho sobrevive `Page.reload`; typecheck/
  lint/290 tests y las 3 suites afectadas en verde tras el cambio.
  GOTCHA nuevo (verificación): con **hyprlock activo, TAMPOCO sirve la captura
  por CDP** — Chromium deja de producir frames con la superficie ocluida y
  `Page.captureScreenshot` (fromSurface true o false, incluso con
  `--disable-backgrounding-occluded-windows`) se cuelga en vez de fallar; la
  captura de T23 quedó pendiente por eso (la geometría se verificó numérica
  vía CDP, que sí funciona bajo el lock). Otro artefacto del entorno: con la
  ventana principal TILEADA angosta por Hyprland el layout desborda en X y el
  handle puede quedar fuera del viewport — verificar resize con la ventana a
  ancho completo.
- 2026-07-06: **T24 hecha y verificada** (subagente Sonnet `a20d8e25a96b72c58` +
  verificación del orquestador contra el binario real). Empaquetado
  electron-builder 26.15.3: `electron-builder.yml` (appId dev.edygg.minerva,
  productName Minerva, target AppImage, asar, npmRebuild false) con
  **exclusión explícita de `.env`** en `files` (electron-builder NO lo excluye
  solo y `ai/env.ts` lo busca en la raíz del app — la key se habría filtrado
  al asar; verificado con `npx @electron/asar list | grep .env` → vacío).
  Split de deps al patrón electron-vite: `dependencies` queda SOLO `octokit`
  (único import de node_modules en runtime de main/preload — verificado);
  react/mermaid/shiki/etc. a devDependencies (vite los bundlea en el
  renderer; react ya NO viaja como node_modules en el asar). Scripts `dist` y
  `dist:dir`. Artefactos: `dist/Minerva-0.1.0.AppImage` (124M) +
  `dist/linux-unpacked/` (324M).
  Verificación del orquestador: typecheck/lint/290 tests verdes tras el split
  de deps; NUEVA suite `scripts/smoke-packaged.mjs` (7/7) contra el AppImage
  REAL corriendo con MINERVA_MOCK=1 y CDP en :5175 — el target es la URL
  `file://...app.asar/out/renderer/index.html` (prueba en sí de que corre el
  build, no el dev server): preload CJS cargado, IPC vivo, PRs mock, detalle,
  tab Archivos con diff resaltado; captura CDP MIRADA (3 paneles correctos).
  safeStorage en el empaquetado: backend `gnome_libsecret`, cifrado
  disponible true (el fix del password-store viaja al binario). userData
  propio (`~/.config/Minerva`) — sesión/settings NO compartidos con dev
  (esperado).
  GOTCHA nuevo (entorno): **esta máquina Arch no tiene `libfuse.so.2`** (solo
  fuse3) → el AppImage NO corre por doble click; sale con "AppImages require
  FUSE". Workarounds: `./Minerva-0.1.0.AppImage --appimage-extract-and-run`
  (así se verificó), instalar el paquete `fuse2`, o usar
  `dist/linux-unpacked/minerva` directo. Además las suites dev NO sirven
  contra el packaged (su matcher de target exige `localhost:5173`) — para
  eso existe smoke-packaged.mjs (puerto CDP configurable vía
  MINERVA_CDP_PORT, default 5175, para no chocar con una instancia dev).
  Pendiente de pulido futuro: icono propio (hoy usa el default de Electron,
  warning esperado de electron-builder) y `desktopName`/WM_CLASS.
- 2026-07-07: **Repo subido a GitHub** (pedido de Edilson): git init + commit
  inicial `1ebe31e` (151 archivos) + push SSH a
  `github.com/edyggclevr/proj_minerva` (existía vacío; cuenta gh
  `edyggclevr`). Chequeo de seguridad previo: `.env` real fuera (solo
  `.env.example` con key vacía, verificado línea a línea), node_modules/out/
  dist ignorados. OJO: el repo es PÚBLICO y la bitácora menciona
  `clevr-merlin#70` (repo interno de la empresa de Edilson; solo el nombre,
  sin código) — avisado a Edilson, decide él si privatizar o limpiar.
- 2026-07-07: **T25 implementada y pusheada, bloqueada en verificación e2e**
  (subagente Sonnet `a0cae5a6d07055ab4` + verificación local del orquestador).
  `.github/workflows/release.yml`: trigger `release: published`, matrix
  fail-fast:false de 3 jobs (blacksmith-4vcpu-ubuntu-2404 → AppImage;
  blacksmith-4vcpu-windows-2025 → NSIS x64; blacksmith-6vcpu-macos-latest
  (M4/arm64) → DMG arm64+x64 con CSC_IDENTITY_AUTO_DISCOVERY=false, sin
  firma), pasos checkout→setup-node 22 (cache npm)→npm ci→warning no
  bloqueante si package.json ≠ tag→typecheck→build→electron-builder
  `--publish never`→`gh release upload "$GITHUB_REF_NAME" <glob> --clobber`
  con `shell: bash` (también en Windows; el glob expandido por bash NO se
  re-separa por espacios — "Minerva Setup 0.1.0.exe" viaja como un arg).
  `electron-builder.yml` ganó secciones `mac` (dmg arm64+x64, categoría
  developer-tools) y `win` (nsis x64); linux y `files` (exclusión de `.env`)
  intactos. Relevamiento Blacksmith (llms-full.txt): labels
  blacksmith-{2..32}vcpu-ubuntu-{2204,2404}[-arm] / -windows-2025 (beta) /
  blacksmith-{6,12}vcpu-macos-{latest,15,26} (solo Apple Silicon M4); las
  actions useblacksmith/* de cache están ARCHIVADAS — las estándar
  (actions/cache, setup-node) usan el cache de Blacksmith sin cambios;
  gotcha Windows runner: sin contenedores Linux (no nested virt).
  Verificación local: YAML parseado OK (js-yaml transitivo; actionlint no
  disponible), typecheck/lint/290 tests verdes. El intento del orquestador
  de crear el release de prueba fue denegado por el clasificador de
  permisos (crear superficie pública) — queda como acción humana.
- 2026-07-07: **T25 cerrada [x] — verificada e2e con release real.** Edilson
  pidió quitar Blacksmith (problemas configurándolo) → runners hosteados de
  GitHub (`ubuntu-latest`/`windows-latest`/`macos-latest`) con actions
  vigentes (checkout@v7, setup-node@v6 — verificadas contra los releases de
  GitHub). Con autorización explícita de Edilson el orquestador publicó el
  prerelease `v0.1.0` → run 28837863415: **3/3 jobs verdes** (~2.5–4 min c/u)
  y 4 assets adjuntos al release: `Minerva-0.1.0.AppImage` (130MB),
  `Minerva.Setup.0.1.0.exe` (105MB, NSIS x64), `Minerva-0.1.0-arm64.dmg`
  (122MB) y `Minerva-0.1.0.dmg` (124MB, x64). DATO: el repo ahora vive en
  `amiedygg/proj_minerva` (Edilson lo movió desde `edyggclevr`; el remote
  local sigue apuntando al nombre viejo y GitHub redirige — repuntar el
  remote quedó denegado por permisos, puede hacerlo Edilson). En repos
  públicos los runners hosteados no consumen minutos pagos.

---

## F9 — Persistencia del análisis + metadata de generación + staleness por SHA — 2026-07-07

> Rama `feature/analysis-persistence` (desde `feature/model-effort`/F8). Diseño completo en
> `PLAN.md` § "Iteración actual (2026-07-07): F9". Dos issues de Edilson: (1) el banner
> "vía proveedor·modelo·esfuerzo" del panel didáctico miente cuando cambio la config
> después de generar un análisis (lee la config vigente, no con qué se generó); (2) el
> último resumen de un PR debe persistir entre sesiones, y si el head del PR recibe commits
> nuevos (cambia el SHA) hay que avisar y sugerir actualizar.
>
> Invariantes: pipeline de streaming AGNÓSTICO (protocolo `@@@SECTION`) intacto; secretos
> solo en main; gotchas de main (sin backticks en strings largos, `import.meta.dirname`,
> preload CJS, reiniciar `npm run dev` al tocar `src/main/**`); persistir SOLO análisis
> completos.

- [x] **T39. Backbone de datos: `DidacticAnalysis` con `headSha`+`generatedWith`, `PullRequestSummary.headSha`, GitHub `oid`**
  _Hecha y verificada (2026-07-07, subagente `a0456b1ca98053cd8`). Split limpio
  `GeneratedAnalysis` (lo que produce el `AiService`) vs `DidacticAnalysis extends
  GeneratedAnalysis` (+`headSha`+`generatedWith: AnalysisGenerationInfo`, lo que cachea/
  devuelve el handler); `service.ts` retorna `Promise<GeneratedAnalysis>` (los 4 servicios
  solo cambian la anotación); `shared/ipc.ts` sin tocar (res sigue `DidacticAnalysis`).
  `PullRequestSummary.headSha` + GraphQL `oid` en ambas queries + mapping `?? ''`. Fixtures:
  8 PRs con headSha hex estable. El subagente además dejó un SELLADO PUENTE en handlers.ts
  (`headSha:''` + `generatedWith: getEffectiveAiSelection()`) para que compile — bien marcado
  como "headSha real y persistencia = T40". Verificado por el orquestador: typecheck (node+web),
  lint, 451 tests verdes. E2e de headSha del mock diferido a T40 (reinicia la app igual)._
  Contexto: hoy `DidacticAnalysis` (`src/shared/types.ts`) es `{ prId, sections, generatedAt }`
  — sin proveedor/modelo/effort ni SHA. `PullRequestSummary` tiene `headRef` (nombre de
  rama) pero NO el SHA del commit. Las queries GraphQL de `real-service.ts` piden
  `lastCommit: commits(last:1) { nodes { commit { statusCheckRollup { state } } } }` pero
  NO `oid`. Esta tarea sienta el modelo de datos SIN cambiar comportamiento observable aún
  (T40 hace el sellado real; T41/T42 la UI).
  Entregables:
  (a) `src/shared/types.ts`:
    - Nuevo `interface GeneratedAnalysis { prId: string; sections: DidacticSection[]; generatedAt: string }`
      (exactamente la forma vieja de `DidacticAnalysis`).
    - Nuevo `interface AnalysisGenerationInfo { provider: AiProviderId; model: string; options: Record<string, string> }`
      (importar `AiProviderId` de `./ai-providers`, ya se importa ahí).
    - `DidacticAnalysis` pasa a `extends GeneratedAnalysis` + `headSha: string` +
      `generatedWith: AnalysisGenerationInfo`. Documentar en JSDoc que SOLO el handler
      (`ipc/handlers.ts`) construye el objeto enriquecido; los servicios producen
      `GeneratedAnalysis`.
    - `PullRequestSummary` gana `headSha: string` (SHA del último commit del head; `''` si
      GitHub no lo devolviera). `PullRequestDetail` lo hereda.
  (b) DESACOPLAR lo que produce el servicio de lo que recibe el renderer. HOY
    `src/main/ai/service.ts` declara `AiService.analyzePullRequest(...): Promise<IpcResponse<'ai:analyzePullRequest'>>`
    y `IpcResponse<'ai:analyzePullRequest'>` (en `shared/ipc.ts`, L54) es `DidacticAnalysis`.
    Si `DidacticAnalysis` exige ahora `headSha`+`generatedWith`, los servicios (que solo
    construyen `{prId, sections, generatedAt}`) dejarían de compilar. Fix:
    - `service.ts`: `AiService.analyzePullRequest` pasa a retornar `Promise<GeneratedAnalysis>`
      (importar `GeneratedAnalysis` de `../../shared/types`), NO `IpcResponse<...>`. Actualizar
      el JSDoc: el servicio produce el CONTENIDO; el handler (`ipc/handlers.ts`) lo enriquece a
      `DidacticAnalysis` (con headSha+generatedWith) antes de cachear/devolver (T40).
    - `shared/ipc.ts`: `'ai:analyzePullRequest'.res` SIGUE siendo `DidacticAnalysis` (es lo que
      el renderer recibe, ya enriquecido por el handler). NO cambiar. Igual `ai:getCachedAnalysis`.
    - Los 4 servicios (`openrouter-service.ts`, `providers/claude-code-service.ts`,
      `providers/codex-service.ts`, `mock-service.ts`): cambiar la anotación de retorno de
      `Promise<IpcResponse<'ai:analyzePullRequest'>>` a `Promise<GeneratedAnalysis>`. El objeto
      que ya construyen (`{prId, sections, generatedAt}`) es un `GeneratedAnalysis` válido —
      NO añadir headSha/generatedWith en los servicios. Revisar helpers internos del mock
      (`streamAndReturn`/`final`) que tipen el retorno.
  (c) `src/main/github/real-service.ts`: añadir `oid` dentro de `commit { ... }` en el
    `lastCommit` de AMBAS queries (`SEARCH_PULL_REQUESTS_QUERY` y `PULL_REQUEST_DETAIL_QUERY`).
    Extender los tipos GraphQL locales (los `interface` de nodo, ~L55-100) para incluir
    `lastCommit.nodes[].commit.oid?: string`. En `mapSearchNode` y `mapDetailNode` mapear
    `headSha: node.lastCommit?.nodes?.[0]?.commit?.oid ?? ''`.
  (d) `src/main/github/fixtures.ts`: cada PR fixture gana un `headSha` estable y realista
    (40 hex chars, distinto por PR; p. ej. derivar algo determinista y legible como
    `'a1b2c3d4e5f6...'` — NO usar backticks). `mock-service.ts`: propagar ese `headSha` en
    lo que devuelven summary/detail (revisar cómo arma los `PrRecord`/summaries; si el
    fixture ya se spreadea, con añadir el campo al fixture basta, pero VERIFICAR que el
    summary construido lo incluye).
  (e) Ajustar TODOS los sitios que construyen `PullRequestSummary`/`PullRequestDetail` de
    prueba (fixtures de tests, helpers de smoke si aplican) para incluir `headSha` — el
    typecheck de tests dirá cuáles.
  Gotchas: sin backticks en strings largos de main (fixtures — usar comillas simples/dobles
  concatenadas); `import.meta.dirname` si tocaras rutas (no debería). NO tocar el pipeline
  de streaming ni `stream-parser`/`section-mapper`.
  _Aceptación (orquestador):_ typecheck (node+web)/lint/`npm test` verdes; con `MINERVA_MOCK=1`
  el detalle de un PR mock trae `headSha` no vacío (verificable por CDP:
  `window.minerva.github.getPullRequestDetail`); no hay cambio visible en el panel todavía.

- [x] **T40. Sellado en el handler + persistencia a disco del análisis**
  _Hecha y verificada (2026-07-07, subagente `a3351e226a110f125`). `analysis-store.ts` nuevo
  (persistencia atómica `analyses.json` en userData, patrón de settings/store: filePath
  perezoso, load tolerante, writeAtomic tmp+rename; forma `{version:1, entries:[{key,analysis}]}`,
  cap 20 aplicado en saveEntries y defensivamente en load, valida cada entry completa y
  descarta inválidas). `AnalysisCache` disk-backed: hidrata perezoso en 1er acceso, write-
  through en set/invalidate serializando el Map (orden LRU) — evict reflejado en disco.
  Store inyectado por constructor (interfaz `AnalysisStoreLike`) para test con fake en
  memoria. Handler completa el sellado de T39: fetch `getPullRequestDetail(req)` en try/catch
  propio (cae a `''` si falla) → headSha real. Verificado por el orquestador: typecheck/lint,
  468 tests. **E2E REAL (mock AI, provider openrouter forzado)**: analizar shopwave/api#482 →
  headSha sellado `a482f001…`, generatedWith `{openrouter, glm-5.2}`, cached; `analyses.json`
  escrito en userData con esos datos; **MATAR app → RELANZAR → `getAnalysisState` da `cached`
  hidratado de disco SIN re-analizar**, headSha+generatedWith persistidos. Provider restaurado
  a claude-code. Smoke reusable: `scripts/smoke-persistence.mjs` (modos provider-openrouter/
  analyze/check/restore)._
  Contexto: `AnalysisCache` (`src/main/ai/analysis-cache.ts`) es SOLO en memoria (Map,
  cap 20, LRU) — se pierde al cerrar la app. El handler `ai:analyzePullRequest`
  (`src/main/ipc/handlers.ts`) hoy cachea el `GeneratedAnalysis` tal cual. Esta tarea:
  (1) sella `headSha`+`generatedWith` al generar, (2) persiste el análisis a disco para que
  sobreviva reinicios. Depende de T39.
  Entregables:
  (a) `src/main/ai/analysis-store.ts` (NUEVO): persistencia atómica en disco, MISMO patrón
    que `src/main/settings/store.ts` (leelo de referencia):
    - `analyses.json` en `join(app.getPath('userData'), 'analyses.json')` — `filePath()`
      perezoso, NUNCA en construcción (app puede no estar ready; igual que settings store).
    - Forma en disco: `{ version: 1, entries: Array<{ key: string; analysis: DidacticAnalysis }> }`,
      orden del array = recencia (menos reciente primero, más reciente último), cap 20.
    - `load()`: readFileSync tolerante (archivo ausente → vacío sin log; corrupto/forma
      inválida → vacío + `console.warn`). VALIDAR cada entry: `key` string no vacío +
      `analysis` con la forma completa de `DidacticAnalysis` (incluidos `headSha` string y
      `generatedWith` con provider/model/options) — entries que no validan se DESCARTAN
      (no crashear). Cachear en memoria como settings store (`loaded`/`cache`).
    - `writeAtomic(entries)`: tmp + rename, igual que settings.
    - API mínima: `loadEntries(): Array<{ key, analysis }>` y `saveEntries(entries)`.
  (b) `src/main/ai/analysis-cache.ts`: `AnalysisCache` disk-backed:
    - Hidrata de disco perezosamente en el PRIMER acceso (`get`/`set`/`invalidate`): un flag
      `hydrated`; al hidratar, `analysisStore.loadEntries()` puebla el `Map` en orden.
    - `set` e `invalidate` hacen write-through: tras mutar el `Map`, serializar sus entries
      (`[...this.entries.entries()].map(([key, analysis]) => ({ key, analysis }))`) y
      `analysisStore.saveEntries(...)`. El LRU/evict ya existente se refleja en disco.
    - Mantener la API pública actual (`get`/`set`/`invalidate`/`size`) intacta para no tocar
      el handler más de lo necesario. Inyectar el store como dependencia del constructor con
      default al singleton real (para testear con un store fake en memoria).
    - Cuidado con la CLAVE: hoy `prKey` está DUPLICADA (en cache y en handler). Al serializar
      a disco la key debe ser la MISMA (`owner/name#number`). Mantener `prKey` como está.
  (c) `src/main/ipc/handlers.ts`, `ai:analyzePullRequest` (camino de cache-miss). NOTA: T39
    YA dejó un sellado-PUENTE ahí (`const result: DidacticAnalysis = { ...generated,
    headSha: '', generatedWith: getEffectiveAiSelection() }` antes de `analysisCache.set`).
    T40 COMPLETA ese bloque: reemplazar el `headSha: ''` por el SHA real del PR. NO duplicar
    el bloque, MODIFICARLO:
    - `generatedWith` ya sale de `getEffectiveAiSelection()` (bien — es la selección real).
    - `headSha`: fetchear una vez el detalle del PR para el SHA:
      `const detail = await githubService.getPullRequestDetail(req)` → `detail.headSha`.
      Hacerlo dentro del `try`, cerca de generar (best-effort: si fallara, `headSha: ''` y
      seguir — NO tumbar el análisis por no poder leer el SHA; envolver ese fetch en su
      propio try/catch que caiga a `''`).
    - El objeto `result: DidacticAnalysis` pasa a llevar el `headSha` real. Se sigue
      cacheando/devolviendo `result` (ya es `DidacticAnalysis`). El evento terminal y el
      snapshot NO cambian.
  (d) Tests unit: `analysis-store` (persist→load round-trip; cap 20 y orden LRU en disco;
    archivo ausente → vacío; JSON corrupto → vacío + warn; entry con forma inválida se
    descarta pero las válidas sobreviven; escritura atómica deja el archivo final íntegro).
    `analysis-cache` con store fake (hidratación en primer acceso; write-through en
    set/invalidate; evict del más antiguo se persiste). Handler: que el objeto cacheado y
    devuelto lleve `headSha` y `generatedWith` correctos (mock de `getEffectiveAiSelection`
    y `getPullRequestDetail`).
  Gotchas: sin backticks; `app.getPath` solo perezoso; el mock de IA llama `onProgress`
  síncrono (no romper el registro in-flight ya existente); persistir SOLO en el `set` de
  éxito (ya es el único lugar que llama `set`).
  _Aceptación (orquestador):_ typecheck/lint/`npm test` verdes; e2e: analizar un PR mock,
  MATAR la app, reabrir, seleccionar el MISMO PR → el análisis aparece SIN pulsar "Analizar
  PR" y SIN nueva llamada al LLM (verificable: `ai:getAnalysisState` da `cached` al montar,
  y el `analyses.json` en userData contiene la entrada con `headSha`+`generatedWith`).

- [x] **T41. Banner del panel didáctico sellado con la config de generación (Issue 1)**
  _Hecha y verificada (2026-07-07, subagente `a3ffc31af237a9b90`). `ActiveModelHint` acepta
  `generatedWith?: AnalysisGenerationInfo`; helper `resolveModelHintLabels(catalog, provider,
  model, effortValue)` compartido por ambos caminos (sello del análisis vs config vigente en
  streaming); `DidacticAnalysisArea` pasa `analysis?.generatedWith`. Verificado por el
  orquestador: typecheck/lint/468 tests. **E2E REAL (`scripts/smoke-f9-ui.mjs banner`)**:
  analizar #482 con provider openrouter → banner "vía OpenRouter · z-ai/glm-5.2"; cambiar la
  config VIGENTE a claude-code (persist + reload del renderer) → el banner del análisis YA
  generado SIGUE mostrando "OpenRouter · z-ai/glm-5.2" (leído del DOM real: `span[title*=
  'Proveedor y modelo activos']`), NO claude-code. Bug del Issue 1 confirmado arreglado.
  NOTA: captura de pixeles no posible (hyprlock activo → grim muestra el lockscreen y CDP
  captureScreenshot se cuelga, gotcha conocido); el banner es texto plano sin clipping, así
  que el assert de DOM innerText ES el contenido que ve el usuario._
  Contexto: `src/renderer/src/components/didactic/ActiveModelHint.tsx` lee proveedor/modelo/
  effort de `useSettings()` (config VIGENTE). Debe, cuando hay un análisis mostrado, leerlos
  del `analysis.generatedWith` (sellado en T40). Depende de T39/T40.
  Entregables:
  (a) `ActiveModelHint.tsx`: nueva prop opcional `generatedWith?: AnalysisGenerationInfo`.
    - Si `generatedWith` viene: `provider`/`model`/`options.effort` salen de él. Los LABELS
      (label del proveedor, label del effort) se resuelven contra `useSettings().info.catalog`
      (catálogo ESTÁTICO — los labels no cambian con la selección; `getModelOption(catalog,
      provider, model)` para el descriptor `effort`, buscar la choice con
      `value === generatedWith.options.effort`). Si el modelo ya no está en el catálogo (id
      viejo), mostrar el id crudo sin effort (degradar, no romper).
    - Si NO viene (streaming en curso, aún sin análisis final): comportamiento ACTUAL (config
      vigente). Extraer la lógica de "resolver labels a partir de (provider, model, effort)"
      en un helper local reutilizado por ambos caminos para no duplicar.
    - Sigue devolviendo `null` si `info` (catálogo) aún no cargó.
  (b) `DidacticAnalysisArea.tsx` (L211-213): pasar `generatedWith={analysis?.generatedWith}`
    al `ActiveModelHint`. Cuando se muestra `analysis`, el prop lleva el sello; en streaming
    `analysis` es `null` → `undefined` → banner cae a config vigente (correcto: se está
    generando con esa config AHORA).
  (c) Import del tipo `AnalysisGenerationInfo` desde `shared/types`.
  Gotchas: `ActiveModelHint` NO debe hacer su propio fetch de settings distinto —
  `useSettings` ya comparte el store; solo se usa `info.catalog` para labels. No tocar
  `DidacticWindowApp` (usa el mismo `DidacticAnalysisArea`, hereda el fix).
  _Aceptación (orquestador):_ typecheck/lint/`npm test` verdes; e2e + captura MIRADA:
  analizar un PR con el proveedor/effort A; cambiar en Settings a proveedor/effort B; el
  banner del análisis YA generado sigue mostrando A (no B). Al re-analizar (config B), el
  banner pasa a B.

- [x] **T42. Detección de staleness por SHA + prompt de actualización (Issue 2)**
  _Hecha y verificada (2026-07-07, subagente `af762b9d594c37881`). SOLO renderer: `lib/
  staleness.ts` (`isAnalysisStale` puro + 6 tests), hook `use-pr-head-sha.ts` (fetch único de
  detail al montar, patrón de use-pull-request-detail), y wiring en `DidacticAnalysisArea`
  (prop `currentHeadSha`, `isStale` derivado en render, barra `border-warning/40 bg-warning/10`
  con SHAs cortos `A→B` y botón "Actualizar"→`reanalyze()`), `DidacticPanel` (pasa
  `selectedPr.headSha`) y `DidacticWindowApp` (usa el hook). Verificado por el orquestador:
  typecheck/lint/474 tests. **E2E REAL (`scripts/smoke-f9-ui.mjs stale-check`)**: se editó el
  `analyses.json` persistido poniendo headSha `0000dead…` en #482 (≠ fixture `a482f001…`),
  reinicio → al seleccionar #482 aparece la barra "commits nuevos" (DOM: /commits nuevos/) +
  botón "Actualizar"; pulsar "Actualizar" → reanaliza (mock) → sella el headSha actual →
  barra desaparece. Bug del Issue 2 confirmado resuelto. (Captura de pixeles no posible por
  hyprlock, ídem T41; verificado por contenido del DOM.)_
  Contexto: con T39/T40, `analysis.headSha` guarda el SHA de cuando se generó. Falta
  comparar contra el SHA ACTUAL del PR y avisar. Depende de T39/T40. **SOLO renderer** (más
  un hook nuevo): NO se toca main ni el contrato IPC — la condición de staleness se prueba
  e2e manipulando el `analyses.json` persistido (headSha viejo ≠ el del fixture actual), sin
  ninguna afordance de código de producción (ver Aceptación).
  Entregables:
  (a) `DidacticAnalysisArea.tsx`: nueva prop opcional `currentHeadSha?: string`.
    - `DidacticPanel.tsx` (`src/renderer/src/components/layout/`, L116-120): pasa
      `currentHeadSha={selectedPr.headSha}` (ya tiene el summary con headSha desde T39).
    - Ventana desacoplada (`DidacticWindowApp.tsx`): no tiene el summary → un hook nuevo
      `use-pr-head-sha.ts` que hace `window.minerva.github.getPullRequestDetail({repo,number})`
      UNA vez al montar y devuelve `headSha` (best-effort, `null` mientras carga o si falla).
      `DidacticWindowApp` lo usa y pasa el resultado como `currentHeadSha`. (No sobre-pedir:
      es un fetch liviano, una vez.)
    - `isStale = analysis != null && !!currentHeadSha && !!analysis.headSha && analysis.headSha !== currentHeadSha`.
  (b) Barra de aviso NO destructiva encima del análisis (solo cuando `isStale`, junto al
    toolbar del resultado): estilo de aviso (p. ej. `border-warning/40 bg-warning/10` si
    existe el token; si no, reusar el patrón de `border-danger/40 bg-danger/10` pero en tono
    informativo — revisar tokens en `styles.css`). Texto: "Este PR recibió commits nuevos
    desde que se generó este resumen." + SHAs cortos (`analysis.headSha.slice(0,7)` →
    `currentHeadSha.slice(0,7)`). Botón "Actualizar" que llama `reanalyze()` (ya expuesto por
    `useDidacticAnalysis`). El análisis viejo permanece visible debajo. La barra desaparece
    cuando el re-análisis termina (el nuevo `analysis.headSha` == `currentHeadSha`).
  (c) Tests unit: extraé la comparación en una función pura (p. ej. `isAnalysisStale(analysis,
    currentHeadSha)` o helper local) y testeala (igual→no stale; distinto→stale; headSha
    vacío en cualquiera→no stale; analysis null→no stale). El hook `use-pr-head-sha` si es
    testeable con un mock de `window.minerva`.
  Gotchas: NO resetear estado por efecto (regla del linter) — el `isStale` es derivado en
  render, no estado; la barra reacciona sola cuando cambian `analysis`/`currentHeadSha`. El
  hook `use-pr-head-sha` sigue el patrón de los otros hooks de datos (`use-pull-request-detail.ts`):
  setState solo en callbacks de promesa, cleanup con flag `cancelled`. SOLO renderer.
  _Aceptación (orquestador):_ typecheck/lint/`npm test` verdes; e2e + captura MIRADA (el
  orquestador crea la condición de staleness escribiendo en `analyses.json` de userData una
  entrada del PR con un `headSha` distinto al del fixture, luego lanza la app): al
  seleccionar el PR aparece la barra "commits nuevos" con `A→B`; pulsar "Actualizar" →
  re-analiza (mock) y la barra desaparece (el nuevo análisis sella el headSha del fixture ==
  current). En la ventana desacoplada la barra también aparece (el hook fetchea el headSha
  actual vía `getPullRequestDetail`).

## F10 — Error honesto cuando el proveedor de IA no está disponible — 2026-07-11

Bug de campo (0.2.1 empaquetada en macOS): con el proveedor activo no inicializable
(OpenRouter sin key en esa máquina / CLI no encontrado o sin sesión), `createAiService`
caía SILENCIOSAMENTE a `MockAiService`, y como el mock solo conoce los PRs shopwave,
cualquier análisis de un PR real moría con "Pull request no encontrado: <pr real>" —
culpaba al PR cuando el problema era la configuración de IA de esa máquina.

- [x] **T43. Proveedor no disponible: error accionable en vez de fallback silencioso al mock**
  _Hecha y verificada e2e (2026-07-11, orquestador)._ Cuatro cambios:
  (a) `src/main/ai/index.ts`: `mockFallbackOrThrow` — el fallback a `MockAiService` queda
    SOLO para `MINERVA_MOCK=1` (demo/e2e; mismo criterio que `../github/index.ts`, leído
    del env directo para no arrastrar el grafo de GitHub real a los tests del factory).
    Con GitHub real se LANZA la causa + remedio por proveedor: OpenRouter sin key →
    "Agregala en Settings"; CLI `unavailable` → "No se encontró el CLI «claude|codex»";
    CLI `installed` → "sin sesión iniciada. Corré «<bin> login»".
  (b) `src/main/ai/mock-service.ts`: PR desconocido → "La IA en modo demo solo tiene
    análisis para los PRs de ejemplo..." (defensa: nunca más culpar al PR).
  (c) `src/main/ai/providers/resolve-cli.ts`: + directorios de version managers de Node
    (nvm `versions/node/<v>/bin` con orden semver DESC, volta, asdf shims, fnm XDG y
    legado; respeta `NVM_DIR`/`FNM_DIR`) — un CLI instalado con npm bajo nvm era
    invisible para una app GUI lanzada desde Finder/launcher (causa probable del caso
    macOS).
  (d) `src/renderer/src/hooks/use-didactic-analysis.ts`: `toErrorMessage` limpia el
    prefijo de Electron "Error invoking remote method 'ai:...': Error: " — el canal IPC
    no le dice nada al usuario.
  Verificación (orquestador): typecheck/lint verdes; `npm test` verde (481 tests,
  incluye los nuevos: factory — throw vs fallback por `MINERVA_MOCK`; resolve-cli —
  nvm multi-versión elige la más nueva, `NVM_DIR`, volta, fnm). E2E real reproduciendo el bug de campo: settings a
  `openrouter` + `.env` escondido + GitHub REAL → analizar #70 de clevr-merlin → panel
  muestra "El proveedor de IA activo (OpenRouter) no tiene API key configurada en esta
  máquina. Agregala en Settings..." (captura CDP MIRADA; sin prefijo IPC, sin "Pull
  request no encontrado"). Regresión demo: `MINERVA_MOCK=1` sin key → `smoke-didactic`
  13/13 (fallback al mock intacto, warn en consola de main). Entorno restaurado
  (settings/.env) al terminar.
  Gotcha nuevo: la pantalla puede estar con hyprlock (verificación remota) —
  `scripts/screenshot-app.sh` (grim) captura el lock; usar `scripts/screenshot-cdp.mjs`
  (Page.captureScreenshot) que ve el contenido renderizado igual. Y para lanzar la app
  desde una shell sin sesión gráfica: exportar `WAYLAND_DISPLAY=wayland-1`,
  `XDG_RUNTIME_DIR=/run/user/1000` y `DISPLAY=:0` antes de `npm run dev`.

## F11 — Copiar URL de comentarios de GitHub — 2026-07-11 (v0.2.3)

Pedido de Edilson: cada comentario de un PR debe ofrecer un botón para copiar su URL
permanente de github.com, para poder referenciar el comentario en otros agentes.

- [x] **T44. Botón "copiar URL" por comentario en ThreadCard**
  _Hecha y verificada e2e (2026-07-11, rama `fix/copy-comment-url`)._ Cambios:
  (a) `shared/types.ts`: `PrComment.htmlUrl?` (opcional: sin URL la UI simplemente no
    ofrece el botón — las fixtures no la traen y no hizo falta tocarlas).
  (b) `main/github/real-service.ts`: campo `url` en las dos selecciones GraphQL de
    comentarios (query de hilos + mutation de reply) y `html_url` en el mapeo REST.
  (c) `main/github/mock-service.ts`: `mockCommentUrl` sella la URL al hidratar las
    fixtures y en `postComment`, con el mismo formato de ancla que GitHub real
    (`#discussion_r…` hilos de línea, `#issuecomment-…` generales; al responder por
    `threadId` se mira `thread.isLineThread`, no el request).
  (d) `renderer .../pr-detail/ThreadCard.tsx`: botón por comentario (icono `Link`,
    lucide) con feedback "Copiado" 1.5s, mismo patrón que `CodeSnippet`. Cubre
    Conversación e hilos inline del diff (ThreadCard se reutiliza).
  Verificación: typecheck/lint/`npm test` verdes (481); suite nueva
  `scripts/smoke-copy-url.mjs` 5/5 (presencia, CONTENIDO real del portapapeles vía
  `navigator.clipboard.readText` con match del formato de URL, feedback aparece y
  desaparece, variante inline) + `smoke-comments` 5/5 sin regresión.
  Gotcha nuevo: `navigator.clipboard` (write Y read) exige documento CON FOCO — en un
  e2e la ventana suele estar desenfocada y el `writeText` falla SILENCIOSO (el catch
  del botón se lo traga: no aparece "Copiado"). La suite manda `Page.bringToFront`
  por CDP antes del click. Matiz de F10: con hyprlock activo `Page.captureScreenshot`
  puede COLGARSE (el compositor no produce frames) — no solo grim; la captura visual
  queda pendiente de desbloqueo.

- [x] **T45. Workflow de binarios dev por PR** (`.github/workflows/pr-dev-builds.yml`)
  _Hecha (2026-07-11)._ Mismo matrix de 3 SOs que `release.yml`, pero disparado por
  `pull_request` a main (+`workflow_dispatch`): re-versiona con
  `npm version --no-git-tag-version` a `<version>-dev.pr<N>` (p. ej. `0.2.3-dev.pr6`)
  y sube los binarios como ARTIFACTS del run (retención 14 días), no como release.
  Corre typecheck + `npm test` antes de empaquetar. Concurrency por PR: un push
  nuevo cancela los builds del anterior.
  Verificación (PR #6): primer run linux+mac VERDES; windows rojo — no por el
  empaquetado sino porque `npm test` nunca había corrido en Windows (release.yml
  solo typechequea) y `resolve-cli.test.ts` armaba un PATH multi-entrada con ':'
  hardcodeado, que sobre Node de Windows (`path.delimiter` = ';') queda como UNA
  entrada inválida → `resolveCliPath` devolvía null. Gotcha: en tests que armen
  `process.env.PATH`, SIEMPRE `['a','b'].join(delimiter)` — mockear `node:os` no
  cambia `node:path`, que sigue siendo el de la plataforma real. Segundo run
  (d94bf8b): 3/3 SOs verdes, artifacts `minerva-0.2.3-dev.pr6-{linux,mac,windows}`
  (124/235/100 MB, retención 14 días).

- [x] **T46. Familia GPT-5.6 (Sol/Terra/Luna) en los catálogos + v0.2.4**
  _Hecha y verificada e2e (2026-07-11, rama `fix/codex-gpt-5.6-models`)._ Issue:
  los modelos nuevos de OpenAI no aparecían en Settings. Diagnóstico (RPC
  `model/list` en vivo): el catálogo dinámico de Codex funciona, pero un CLI
  `codex` < 0.144 NO expone la familia 5.6 (0.142.5 devolvía los 4 viejos, 0.144.1
  devuelve `gpt-5.6-sol|terra|luna`) — se actualizó el CLI standalone de la máquina
  con `codex update`. Cambios de código (necesarios igual): (a) los 3 modelos en
  `CODEX_MODELS` estático (`shared/ai-providers.ts`) — CLAVE porque
  `getEffectiveAiSelection` resuelve el `effort` contra el catálogo ESTÁTICO y un
  modelo dinámico fuera de él perdía el effort en silencio; Sol/Terra traen efforts
  nuevos `max|ultra`, Luna hasta `max` (default `medium` los tres, verificado por
  RPC). (b) `ultra` en `EFFORT_CHOICE_LABELS/DESCRIPTIONS` y en
  `KNOWN_EFFORT_LABELS` del catálogo dinámico. (c) `openai/gpt-5.6-{sol,terra,luna}`
  en `OPENROUTER_MODELS` (IDs verificados contra la API pública de OpenRouter).
  (d) versión 0.2.4. Verificación: typecheck/lint/`npm test` verdes (484, con 3
  tests nuevos: effort `ultra` se respeta en Sol, resolución robusta `ultra`→
  `medium` en Luna, labels `max`/`ultra`/desconocido en el catálogo dinámico);
  e2e vía CDP: `ai:getProviderModels` devuelve los 3 en codex (dinámico, con
  max/ultra) y openrouter; visual (screenshot CDP): modal Settings con los 3
  listados y RAZONAMIENTO mostrando Bajo…Máximo/Ultra al seleccionar Sol.
  Gotchas nuevos: (1) `scripts/smoke-settings.mjs` quedó OBSOLETA desde T26:
  valida el campo legacy `aiModel` que `settings:get` ya no devuelve y asume
  OpenRouter activo — falla por estado, no por regresión; ojo: su paso 2 PERSISTE
  un modelo inválido en el settings.json real y si crashea a mitad no lo restaura
  (pendiente re-escribirla). (2) Con hyprlock activo `screenshot-app.sh` captura
  el splash del lock; `screenshot-cdp.mjs` sí funciona (esta vez no se colgó,
  matiz vs. T44).

- [x] **T47. Reescritura de `scripts/smoke-settings.mjs` (multi-proveedor)**
  _Hecha y verificada (2026-07-11, rama `fix/smoke-settings-multiprovider`)._
  Repara la obsolescencia detectada en T46: la suite T12 validaba el campo
  legacy `aiModel` (que `settings:get` no devuelve desde T26), asumía
  OpenRouter como proveedor activo, dejaba un modelo inválido persistido en el
  settings.json REAL si crasheaba a mitad, y dejaba el modal abierto. La nueva
  suite: (1) NO asume proveedor/modelo activo — snapshotea la selección al
  arrancar y la restaura en un `finally` (incluye cerrar el modal); (2) valida
  la forma multi-proveedor de `settings:get` (provider/model/modelSource/
  perProviderModel/catalog) y el catálogo curado al día (regresión T46:
  GPT-5.6 con `ultra` en codex y en openrouter); (3) `setAiProvider`,
  `setProviderModel`, persistencia en disco por proveedor, y `setModelOption`
  (T34, effort high → selectedOptions, luego de vuelta al default); (4) corta
  con exit 2 y mensaje claro si OpenRouter no está `authenticated` (antes un
  "sin key" podía disfrazarse de PASS en el check del modelo inválido); (5)
  conserva los checks de análisis (inválido → error 400 de OpenRouter, válido
  → secciones reales). Verificación: 2 corridas seguidas 9/9 (idempotente) con
  MINERVA_MOCK=1 + IA real, y settings.json del usuario intacto al terminar
  (residuo tolerado y documentado: `modelOptions.openrouter.effort='medium'`,
  el default). lint verde.

- [x] **T48. Fix UX: re-analizar no limpiaba el contenido anterior**
  _Hecha y verificada (2026-07-11)._ Reporte del usuario: al re-analizar un PR
  ya analizado no se entendía cuándo se actualizaba ni cuándo terminaba. Causa:
  `analyze()` en `use-didactic-analysis.ts` limpiaba `error` y
  `streamingSections` pero NO `analysis`, y la precedencia de render de
  `DidacticAnalysisArea` es `error > analysis > streamingSections > loading` —
  el resultado viejo seguía ganando, el streaming nuevo corría invisible detrás
  y al final el contenido se intercambiaba en silencio. Fix: `setAnalysis(null)`
  al arrancar el flujo local (el listener pasivo de attach ya lo hacía en su
  rama de chunk, quedó simétrico). Ahora el re-análisis muestra skeleton
  "Analizando PR con IA…" → secciones en streaming → resultado final con
  "Re-analizar" habilitado. Verificación: typecheck/lint/484 tests verdes,
  `smoke-didactic` 13/13, script CDP ad-hoc muestreando frames a 100ms tras el
  clic (skeleton visible de inmediato, 8/8), y capturas `screenshot-cdp.mjs`
  a mitad del re-análisis (panel limpio con skeleton) y al terminar (análisis
  completo + botón habilitado).

- [x] **T49. Fix layout: split diff sin wrap desbordaba a la derecha + wrap por defecto**
  _Hecha y verificada (2026-07-11)._ Reporte del usuario: en la vista split sin
  word wrap, el diff se desbordaba horizontalmente y el lado nuevo quedaba
  empujado fuera de la vista (gutter verde visible con contenido "vacío" hasta
  scrollear); solo con wrap activado se alineaba bien. Causa: el grid único de
  4 columnas usaba `minmax(max-content, 1fr)` en ambas columnas de contenido —
  cada una crecía hasta su línea más larga y el grid entero excedía el
  contenedor `overflow-auto`. Fix en `SplitDiff.tsx`: sin wrap ahora son dos
  paneles 50/50 con `overflow-x-auto` PROPIO (estilo VS Code); la alineación
  vertical entre paneles sale gratis porque sin wrap toda fila mide una línea
  (`leading-5`), el gutter se fija por dígitos (`calc(Nch + 2.25rem)`) para no
  variar entre paneles/segmentos, y las cards de hilo/composer (ancho completo)
  cortan el segmento de paneles y se intercalan. Con wrap queda el grid único
  de siempre (`minmax(0, 1fr)`); celdas extraídas a `SideCells` compartidas.
  Además `wordWrap: true` por defecto en `app-store.ts` (pedido explícito).
  Verificación: typecheck/lint/484 tests verdes; `smoke-diff` 7/7 y
  `smoke-comments` 5/5; probe CDP ad-hoc 11/11 (defaults split+wrap activos,
  wrap sin scroll horizontal del contenedor, sin wrap: 2 paneles de igual
  ancho, panel derecho visible sin scrollear, scroll interno con líneas de
  98ch, gutters iguales); capturas con `screenshot-app.sh` en ambos modos.
  Gotcha nuevo: los probes CDP heredan el estado que las suites anteriores
  dejaron en el renderer (vista inline, wrap toggled) — un `location.reload()`
  al arrancar resetea el store zustand y devuelve los defaults reales.

## F11 — Panel didáctico como harness agéntico sobre snapshot del PR + proveedor OpenCode (v0.4.0, 2026-07-11)

> Rama `feature/didactic-agentic-harness` (desde `main`; F10/T50–T53 vive en su propia
> rama sin mergear — la numeración no colisiona). Plan completo y decisiones en
> `PLAN.md`. Resumen: snapshot local del commit del PR (tarball por headSha) +
> herramientas read-only para los TRES proveedores; OpenCode reemplaza a OpenRouter
> (patrón T3 Code, repo `pingdotgg/t3code`); sin CLIs instalados → card con enlaces
> oficiales de instalación.

- [x] **T54. `snapshot-store`: copia local del commit del PR + limpieza periódica**
  _Hecha (2026-07-11, subagente Sonnet) y VERIFICADA por el orquestador: revisión de
  código completa, 12/12 unit (create/reuse+touch, dedupe concurrente, sanitización
  `../../evil`, atomicidad, huérfanos `.tmp-*`, LRU por count y bytes, timer), typecheck
  y lint verdes. FIX del orquestador: `tar.extract` ahora filtra SYMLINKS/hardlinks
  (`filter: 'type' in entry && (File|Directory)`) — un repo hostil podía traer un link a
  `~/.ssh` que las herramientas read-only seguirían al leer, escapando el jail sin
  escribir nada; verificado empíricamente con un tarball artesanal (el link se omite,
  archivos y dirs intactos). Gotcha de tipos: el `filter` de node-tar 7 une
  `Stats | ReadEntry` (compartido con `tar.create`) — hace falta el guard `'type' in
  entry`. E2e con tarball real de GitHub queda cubierto en T61. Cableado del cleaner en
  `before-quit`: pendiente de integración junto con T55 (lo hace el orquestador)._
  Contexto: los proveedores agénticos necesitan un directorio con el repo AL COMMIT del
  PR. Fuente real: tarball `GET /repos/{owner}/{repo}/tarball/{sha}` con el Octokit ya
  autenticado (NUNCA git); mock: árbol fixture escrito con fs.
  Entregables:
  (a) `GithubService.writeSnapshot(req: { repo: RepoRef; headSha: string }, destDir)`
  en la interfaz (`github/service.ts`) + real (`real-service.ts`: request tarball,
  abortar si supera 150 MB, extraer con la dep `tar` YA instalada — `tar.extract`
  con `strip: 1`, `cwd: destDir`) + mock (`mock-service.ts`: escribe ~8 archivos
  plausibles del universo shopwave por repo — package.json, un par de rutas/handlers,
  un modelo — en un módulo nuevo `fixtures-snapshot.ts`; SIN backticks en los strings).
  (b) `src/main/github/snapshot-store.ts`: `ensureSnapshot(repo, headSha): Promise<string>`
  → `userData/snapshots/<owner>-<name>-<sha7>/` (sanitizar owner/name/sha a
  `[A-Za-z0-9._-]`; `app.getPath` SIEMPRE perezoso, patrón settings-store); dedupe de
  descargas en vuelo (Map de promesas, patrón inFlightAnalyses T22); escribir a dir
  temporal + rename atómico (nunca dejar snapshots a medias); `touch` mtime al reusar.
  (c) Limpieza: `createSnapshotCleaner({ start, stop, sweep })` — sweep al arrancar y
  cada 30 min: borra por LRU (mtime) lo que exceda 10 snapshots o 2 GB. `stop()` se
  cablea en `before-quit` (`main/index.ts`), junto al resto del teardown.
  Gotchas: `import.meta.dirname`, sin backticks en strings de main, el snapshot es
  contenido NO confiable (jamás ejecutarlo). NO tocar package.json (deps ya
  instaladas por el orquestador).
  _Aceptación:_ typecheck/lint/tests verdes; unit tests con dirs temporales (fake
  service): ensureSnapshot crea/reusa/dedupea, sanitización de paths, LRU expulsa por
  count y por bytes, rename atómico (un fallo a mitad no deja dir final).

- [x] **T55. `opencode-runtime`: server OpenCode gestionado desde main**
  _Hecha (2026-07-11, subagente Sonnet) y VERIFICADA por el orquestador: revisión de
  código completa, 23 unit + typecheck/lint/519 tests verdes. WIRE VERIFICADO contra el
  binario real 1.17.18: ready-line "opencode server listening on http://127.0.0.1:<p>"
  (NO es la primera línea de stdout — la precede un warning de OPENCODE_SERVER_PASSWORD),
  `/global/health` → `{"healthy":true,"version":"1.17.18"}`, `--version` → "1.17.18"
  pelado. Verificación manual del subagente (bundle esbuild del módulo real): version
  gate ok, un solo spawn con llamadas concurrentes, stop sin huérfanos (ps antes/después).
  FIX del orquestador: si el server muere DESPUÉS de estar listo (crash externo), el
  handler de exit ahora resetea el singleton — sin eso todo análisis posterior fallaba
  contra una URL muerta hasta reiniciar la app. Cableado en `main/index.ts` (orquestador):
  `before-quit` → `snapshotCleaner.stop()` (T54) + `stopOpencodeServer()` fire-and-forget
  (el SIGTERM sale sincrónico; la escalada a SIGKILL puede no correr si main muere antes,
  aceptable — opencode termina con SIGTERM). GOTCHAS NUEVOS: (1) el `opencode` de omarchy
  es un wrapper que resuelve vía npx en frío (~3-4s) — el timeout de ready de 10s tiene
  margen real pero no sobra; (2) en tests, aserciones de rechazo disparadas por
  `vi.advanceTimersByTimeAsync` necesitan un `.catch()` no-op ANTES de avanzar el timer
  (si no, PromiseRejectionHandledWarning)._
  Contexto: patrón T3 Code (`opencodeRuntime.ts` del repo `pingdotgg/t3code`). El
  binario `opencode` 1.17.18 ESTÁ instalado en esta máquina (`~/.local/bin/opencode`):
  verificar el wire EMPÍRICAMENTE (lección T29 — nunca adivinar el protocolo; se puede
  spawnear `opencode serve` en un puerto libre y curlear `/global/health`, `/doc`).
  Entregables:
  (a) `resolve-cli.ts`: `CliBinaryName` gana `'opencode'` (mismas ubicaciones).
  (b) `src/main/ai/providers/opencode-runtime.ts`: `getOpencodeServer(): Promise<{ url }>`
  singleton lazy — puerto efímero (net listen(0)), spawn del binario resuelto con
  `serve --hostname=127.0.0.1 --port=N`, `detached: true`, env =
  `buildSanitizedSpawnEnv()` + `OPENCODE_CONFIG_CONTENT` (JSON de permisos read-only:
  `"*"`, `edit`, `bash`, `webfetch`, `websearch`, `question`, `external_directory` →
  `"deny"`; `read`, `grep`, `glob`, `list` → `"allow"`; NUNCA `ask`: en headless
  cuelga). Ready = línea "opencode server listening" en stdout (URL vía regex
  `/on\s+(https?:\/\/[^\s]+)/`, timeout 10s); si el proceso sale antes → error con
  stdout+stderr. `stopOpencodeServer()`: kill de process-group (SIGTERM → 1s →
  SIGKILL), cableado en `before-quit` (`main/index.ts`).
  (c) Gate de versión: `opencode --version` (execFile, timeout corto), mínimo
  `1.14.19` (constante exportada), comparador semver simple local (sin dep nueva).
  Gotchas: NO tocar package.json (`@opencode-ai/sdk` ya instalado y pinneado por el
  orquestador — este módulo NO usa el SDK, solo gestiona el proceso); sin backticks
  en strings de main; sanear env (OpenCode usa su propio auth store, no necesita
  nuestras keys).
  _Aceptación:_ typecheck/lint/tests verdes; unit tests (spawn mockeado): parseo de
  ready-line, timeout, exit-antes-de-ready con detalle, config JSON exacta de
  permisos, semver gate; y UNA verificación manual reportada contra el binario real
  (server arranca, `/global/health` responde `{ healthy: true, version }`, se mata
  limpio sin huérfanos).

- [x] **T56. `OpenCodeAiService` + user message agéntico compartido + timeouts agénticos**
  _(a)+(b) hechos por el orquestador (commit 187a5a6); (c) por subagente Sonnet
  (2026-07-11) y VERIFICADO por el orquestador. SDK: se usa `@opencode-ai/sdk/v2`
  (la raíz v1 NO tiene `message.part.delta` ni `session.idle`; v1 queda para
  provider.list de T57 — conviven). GOTCHA CRÍTICO de wire: las firmas del .d.ts
  genérico (`{path, body}`) MIENTEN — las clases reales del cliente usan params
  FLAT (`promptAsync({ sessionID, model, system, parts })`); la forma anidada hace
  500 con el placeholder sin reemplazar. Filtro de texto real: delta con
  `field==='text'` + rol assistant (message.updated) + parte tipo 'text'
  (message.part.updated solo para bookkeeping de tipos, jamás su .text — bug
  #27966/#26697); las partes reasoning/tool se excluyen. 19 unit tests. Humo real
  del subagente: clase real bundleada + binario real + `opencode/big-pickle` →
  3 secciones con detalles solo visibles leyendo el snapshot. VERIFICACIÓN
  INTEGRAL del orquestador (app real, MINERVA_MOCK=1 + CDP): análisis agéntico de
  shopwave/api#482 con opencode/big-pickle en 54.4s → 4 secciones (summary, setup,
  architecture, endpoint) selladas con generatedWith correcto. Cableado del case
  'opencode' en createAiService por el orquestador (mensajes accionables distintos
  para installed-sin-upstreams vs binario ausente)._
  Contexto: cuarto `AiService` real (patrón `OpenCodeAdapter.ts` de t3code, adaptado a
  nuestra vuelta única). Depende de T54+T55.
  Entregables:
  (a) `analysis-timeouts.ts`: constantes agénticas `AGENTIC_REQUEST_TIMEOUT_MS=300_000`
  / `AGENTIC_INACTIVITY_TIMEOUT_MS=60_000` (los 3 proveedores agentizados las usarán).
  (b) `analysis-prompt.ts`: `buildAgenticUserMessage(detail, files)` — mismo contenido
  que `buildUserMessage` MÁS instrucción: el repo al commit del PR está en el
  directorio de trabajo, explorarlo (grep/read) ANTES de responder, no ejecutar nada;
  `prompts/analyze-pr.ts` gana un párrafo de herramientas (mismo estilo concatenado,
  SIN backticks como delimitador).
  (c) `src/main/ai/providers/opencode-service.ts` (`OpenCodeAiService implements
  AiService`): `ensureSnapshot` → `createOpencodeClient({ baseUrl, directory: snapshot })`
  (`@opencode-ai/sdk` YA instalado; decidir v1 vs `/v2` contra lo que el SDK 1.17.x
  realmente exporte y ANOTAR en el reporte) → suscribirse a eventos ANTES de promptear
  → `session.create` → prompt con `system` = system prompt didáctico, `model` = slug
  `<providerID>/<modelID>` parseado (separador = PRIMER `/`), parts de texto →
  acumular SOLO deltas de texto del asistente de ESE sessionID
  (`message.part.delta`; ignorar partes de tool/razonamiento) → `parser.push` +
  throttle de progreso (patrón claude-code-service) → fin por `session.idle` →
  `parser.finalize`. En abort/timeout: `session.abort` best-effort. Errores
  accionables: sin upstream conectado → "corré «opencode auth login» y conectá un
  proveedor"; CLI ausente → mensaje con https://opencode.ai/docs/ .
  Gotchas: NO confiar en `message.part.updated` (bug #27966/#26697 — deltas +
  session.idle); el filtrado de partes debe verificarse EMPÍRICAMENTE con el binario
  real (una sesión de humo contra un dir de prueba); jamás loguear contenido.
  _Aceptación:_ typecheck/lint/tests verdes; unit tests con cliente/stream mockeados
  (deltas → secciones, idle → finalize, error de sesión → throw accionable, timeout
  inactividad); reporte de UNA corrida de humo real (snapshot pequeño, modelo del
  gateway `opencode/*`) con las secciones parseadas.

- [x] **T57. Proveedor `opencode` en registry/probe/modelos/settings (aditivo)**
  _Hecha (2026-07-11, subagente Sonnet) y VERIFICADA por el orquestador. Forma de
  `provider.list` verificada empíricamente (GET /provider): `{ all, default,
  connected }` — OJO: los tipos con nombre `Provider`/`Model` que exporta el SDK
  v1 son de OTRA forma (sin `variants`), se usan interfaces estructurales locales
  (patrón codex-model-catalog). Probe: authenticated = server + ≥1 upstream en
  `connected` (criterio t3code), `account.plan` describe los upstreams; nunca
  arranca el server si el binario/versión fallan. Catálogo dinámico con cache TTL
  60s generalizada (Map codex+opencode) y fallback curado (gateway free). UI:
  ProviderPicker ya era genérico; CLI_META gana opencode; "Otro (avanzado)" ahora
  también para opencode con placeholder por proveedor. VERIFICADO e2e (CDP):
  status opencode authenticated "3 upstreams: openai, github-copilot, opencode",
  56 modelos dinámicos, selección persiste. NOTA: abrir Settings arranca el server
  de OpenCode en frío para el probe (paridad t3code; singleton T55 + TTL lo
  amortiguan). Captura mirada de Settings HECHA (2026-07-11,
  tras desbloqueo de pantalla, app desde worktree limpio en e385d73): los 4
  proveedores con chips correctos — OpenRouter "No disponible", Claude Code
  "Conectado · max", Codex "Conectado", OpenCode "Conectado · 3 upstreams:
  openai, github-copilot, opencode". VERIFICADA COMPLETA._
  Contexto: cablear `opencode` como proveedor de PRIMERA clase. `openrouter` NO se toca
  acá (se elimina en T59 — orden importa). Depende de T55.
  Entregables: `AiProviderId` gana `'opencode'` (`shared/ai-providers.ts`: catálogo con
  label "OpenCode" y fallback curado mínimo — `opencode/big-pickle` como default +
  2-3 del gateway; `DEFAULT_MODEL_BY_PROVIDER.opencode='opencode/big-pickle'`);
  registry (`authKind:'cli'`, binary `opencode`); `cli-probe.ts`/`provider-status.ts`:
  installed = binario+versión OK; authenticated = server responde y
  `client.provider.list()` (o `GET /provider` crudo) reporta ≥1 upstream en
  `connected` (criterio t3code); `provider-models.ts`: modelos dinámicos vía
  `provider.list()` de providers connected (slug `<provider>/<model>`, variants →
  `ModelOptionDescriptor` patrón T34) con cache TTL 60s + fallback al curado (patrón
  EXACTO `codex-model-catalog.ts` → `opencode-model-catalog.ts`); `createAiService`
  (`ai/index.ts`): case `'opencode'` → `OpenCodeAiService` si authenticated, si no
  `mockFallbackOrThrow` con mensaje accionable; Settings UI: `ProviderPicker` muestra
  la card (via catálogo, verificar que no haya listas hardcodeadas), `ModelPicker`
  con campo libre "Otro" también para opencode; validators de `settings:setAiProvider`
  aceptan el id nuevo.
  _Aceptación:_ typecheck/lint/tests verdes; unit: probe (3 estados), catálogo
  dinámico con fallback, mapping de variants; con la app corriendo (`MINERVA_MOCK=1`),
  Settings muestra OpenCode "Conectado" en esta máquina y el picker lista modelos
  reales del `provider.list()`.

- [x] **T58. Agentizar Claude Code y Codex sobre el snapshot**
  _Hecha (2026-07-11, subagente Sonnet) y VERIFICADA por el orquestador (revisión
  de código + suites). Claude: `cwd` snapshot, `tools`/`allowedTools`
  ['Read','Grep','Glob'] (verificados contra sdk.d.ts; NO existe tool de listado
  aparte de Glob), `permissionMode: 'dontAsk'` (los modos con prompt colgarían un
  headless; bypassPermissions salta TODO, descartado), maxTurns 30, settingSources
  []/persistSession false ahora CRÍTICOS (cwd hostil). PRUEBA DE SEGURIDAD real
  (cuenta Max): snapshot trampa con CLAUDE.md "responde BANANA" → IGNORADO; 16
  tool_use reales (solo Glob/Read/Grep), 9 turnos, 3 secciones que citan el código
  real. Codex: `ThreadStartParams.cwd` verificado con `codex app-server
  generate-json-schema` (0.144.1; `--out`, no `--out-dir`); sandbox read-only
  restringe ESCRITURA no lectura (ReadOnlySandboxPolicy solo tiene networkAccess)
  — humo real: el agente citó contenido del snapshot vía cwd. GOTCHAS: el
  CodexAppServerClient no se puede importar fuera de Electron (constructor toca
  app.on) — para humos, JSON-RPC a mano; scripts de scratchpad que importan SDKs
  necesitan symlink de node_modules (Node resuelve desde el archivo, no cwd)._
  Contexto: igualdad de condiciones día 1 (decisión de Edilson). Depende de T54.
  Entregables:
  (a) `claude-code-service.ts`: `ensureSnapshot` → `query({ options: { cwd: snapshot,
  ... } })` con herramientas READ-ONLY habilitadas (nombres reales contra el .d.ts del
  SDK instalado — se esperan `Read`/`Grep`/`Glob`; NADA de Write/Edit/Bash/WebFetch),
  `maxTurns` alto (30), timeouts agénticos de T56, y MANTENER `settingSources: []` +
  `persistSession: false` (el snapshot puede traer CLAUDE.md/hooks hostiles — verificar
  con un snapshot de prueba que contenga un CLAUDE.md trampa que NO se carga).
  `buildAgenticUserMessage` en vez del clásico. Actualizar el link viejo
  `docs.claude.com/...` → `https://code.claude.com/docs/en/setup`.
  (b) `codex-service.ts`/`codex-app-server-client.ts`: `thread/start` gana el cwd al
  snapshot — VERIFICAR el nombre real del param con `codex app-server
  generate-json-schema` (lección T29: el binario genera su propio esquema; NO
  adivinar); mantener `sandbox:'read-only'` + `approvalPolicy:'never'`; confirmar que
  el sandbox permite LEER el cwd; `buildAgenticUserMessage` + timeouts agénticos.
  Los tres proveedores comparten ahora el mismo user message y los mismos timeouts.
  Gotchas: los deltas de tool-use de Claude (`input_json_delta`) SIGUEN ignorándose
  (solo `text_delta` va al parser); en Codex solo `item/agentMessage/delta`.
  _Aceptación:_ typecheck/lint/tests verdes (tests existentes de ambos servicios
  actualizados); reporte de humo real de AL MENOS Claude Code (cuenta Max de Edilson)
  sobre un snapshot fixture: el análisis usa herramientas (visible en los mensajes del
  stream) y produce secciones; el CLAUDE.md trampa no se carga.

- [x] **T59. Eliminar OpenRouter como proveedor directo + migración de settings**
  _Hecha (2026-07-11, subagente Sonnet) y VERIFICADA por el orquestador: typecheck 0
  errores, lint limpio, 532/532 tests; revisión de la migración y del grep de
  limpieza (solo quedan menciones históricas y el slug `openrouter/<id>` de upstream).
  Borrados: openrouter-service(+test), openrouter-key-store(+test), ai-models.ts,
  OpenRouterKeyForm, use-openrouter-key; los tests de buildUserMessage migraron a
  `analysis-prompt.test.ts` (nunca fueron de OpenRouter). `DEFAULT_AI_PROVIDER =
  'opencode'`; también se eliminó el shim legacy `settings:setAiModel` (cero
  consumidores). MIGRACIÓN (settings/store.ts): corre sobre el JSON CRUDO ANTES de
  los guards de forma (clave: `isAiProviderId('openrouter')` ya es false — después
  de los guards el archivo ENTERO se descartaría), `aiProvider openrouter→opencode`,
  `models.openrouter: X → models.opencode: 'openrouter/X'` (una elección real de
  OpenCode gana), `modelOptions.openrouter` se descarta (efforts no equivalentes),
  se PERSISTE de inmediato y borra best-effort el `openrouter-key.bin` huérfano.
  DECISIONES: loader de .env se mantiene (MINERVA_AI_*; parsea sin mutar process.env)
  y `OPENROUTER_API_KEY` sale de ENV_KEYS_TO_STRIP (Minerva ya no la gestiona; no hay
  fuente propia que sanear, y estriparla rompería la auth por env del propio opencode).
  `MINERVA_AI_PROVIDER` inválido (incl. openrouter) → console.warn + default.
  provider-status.ts simplificado (todos los proveedores son cli). Las suites e2e de
  scripts/ que mencionan OpenRouter se ajustan en T61._
  Contexto: decisión de Edilson — OpenRouter ahora se usa DENTRO de OpenCode. Depende
  de T57. Borrar con confianza; git recuerda.
  Entregables: eliminar `openrouter-service.ts`, `openrouter-key-store.ts`,
  `ai-models.ts` (legacy re-export), slice openrouter del catálogo, resolución de key
  en `env.ts` (`getAiEnv().openRouterApiKey` y el `.env` loader SI ya nadie más lo
  usa), canales `settings:setOpenRouterKey`/`getOpenRouterKeyStatus` (ipc.ts,
  validators, handlers, preload), `OpenRouterKeyForm.tsx`, `use-openrouter-key.ts` y
  sus usos en `SettingsModal`/`ProviderPicker`; `AiProviderId` queda
  `'opencode'|'claude-code'|'codex'`; `DEFAULT_AI_PROVIDER='opencode'`. Migración en
  `settings/store.ts` al hidratar: `provider:'openrouter'` → `'opencode'` y
  `model:'X'` → `'openrouter/X'` (slug de upstream openrouter en OpenCode);
  best-effort borrar el archivo de key cifrada huérfano. `MINERVA_AI_PROVIDER=openrouter`
  en env se trata como inválido (warn + default), documentarlo. Actualizar tests
  afectados y `README.md` (sección proveedores).
  Gotchas: buscar TODOS los usos (`grep -ri openrouter src/`) — incluye
  `ActiveModelHint`, smokes y fixtures de tests; el smoke `smoke-settings` de T47 se
  ajusta en T61 pero no debe romper unit acá.
  _Aceptación:_ typecheck/lint/tests verdes; `grep -ri openrouter src/` solo devuelve
  el slug de modelos `openrouter/...` (upstream de OpenCode) y la migración; arranque
  con settings.json viejo (provider openrouter persistido) migra sin crash y Settings
  muestra OpenCode activo.

- [~] **T60. UI: card "sin CLIs" con enlaces oficiales + CliLoginGuide x3 + fase "explorando"**
  Contexto: decisión de Edilson — sin ningún CLI instalado, guiar con enlaces
  oficiales. Depende de T57 (y de T59 para el copy final sin OpenRouter).
  Entregables:
  (a) `CliLoginGuide.tsx` generalizado a los 3 proveedores con `installUrl` y
  `loginCmd` por proveedor (opencode → `opencode auth login`,
  https://opencode.ai/docs/ ; claude → `claude login`,
  https://code.claude.com/docs/en/setup ; codex → `codex login`,
  https://developers.openai.com/codex/cli/) — enlaces como `<a target="_blank"
  rel="noreferrer">` (el `external-link-guard` ya los abre en el navegador y limita a
  http/https).
  (b) Card "Necesitás al menos un CLI de IA" en el placeholder del panel didáctico
  cuando `use-provider-status` reporta los 3 `unavailable`: explica en una línea el
  porqué, lista los 3 CLIs con su enlace y trae "Volver a comprobar" (re-fetch del
  status). No aparece con `MINERVA_MOCK=1` + mock IA activo.
  (c) Fase "explorando": `AnalysisProgressEvent` (`shared/events.ts`) gana
  `phase?: 'exploring' | 'writing'` (ADITIVO — validators/preload sin romper);
  los servicios agénticos emiten `exploring` al detectar actividad de tools antes de
  la primera sección y `writing` desde el primer delta de texto; el panel pinta
  "Explorando el repositorio…" (spinner) durante `exploring`.
  Gotchas: react-hooks del linter (nada de setState-en-efecto — remount por key);
  copy en español consistente con el resto.
  _Aceptación:_ typecheck/lint/tests verdes; captura MIRADA de: (1) card sin CLIs
  (PATH capado), (2) "Explorando el repositorio…" durante un análisis real, (3)
  CliLoginGuide con enlace de instalación visible; click de un enlace abre el
  navegador del sistema (verificación manual del orquestador).

- [ ] **T61. Verificación integral F11 + revisión de seguridad + docs + v0.4.0**
  Del orquestador (no delegable la verificación): typecheck/lint/tests; suites e2e
  (smoke-didactic + smoke-settings ajustadas al mundo sin OpenRouter; caso nuevo o
  suite nueva para: análisis agéntico mock end-to-end, card sin CLIs si es
  automatizable con PATH capado); regresión del resto de suites; e2e real con
  OpenCode (upstream de Edilson) y Claude Code sobre snapshot fixture; verificación
  de snapshots (creación, LRU, limpieza al arrancar); captura mirada de todos los
  estados nuevos; agente `electron-security-reviewer` sobre el diff completo (jail de
  permisos, secretos, snapshot no confiable, spawn env); README (arquitectura +
  requisitos: al menos un CLI) + CLAUDE.md (sección IA/stack) + version bump 0.4.0 +
  bitácora.

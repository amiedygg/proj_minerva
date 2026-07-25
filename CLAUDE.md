# CLAUDE.md — proj_minerva

Guía para trabajar en este repositorio con Claude Code. Léela antes de generar código.

## Qué es

Aplicación de escritorio (Electron) para revisar Pull Requests de GitHub de forma
**didáctica**. Junto al diff clásico estilo GitKraken, un agente de IA explica el
_impacto_ de los cambios: diagramas C4, documentación de endpoints nuevos con forma de
probarlos en local, y detalle + diagrama ER de cambios de esquema. Ver `README.md`.

**Principio rector:** cada feature debe ayudar a quien revisa a **entender** el PR, no
solo a mirar líneas cambiadas. Ante una duda de diseño, elige lo que mejor _enseñe_ el
cambio.

## Flujo de trabajo multi-agente

El desarrollo usa un modelo orquestador/subagentes documentado en
**`.agents/WORKFLOW.md`** (léelo si vas a planificar o delegar):

- **Orquestador (Fable 5)**: planifica en `.agents/PLAN.md`, controla tareas en
  `.agents/TASKS.md`, delega implementación, **verifica cada entrega e2e** antes de
  marcar `[x]`, y mantiene la bitácora de gotchas.
- **Subagentes (Sonnet 5)**: implementan tareas bien acotadas descritas en TASKS.md.

Regla de oro: **ninguna tarea pasa a `[x]` sin verificación del orquestador** — el
"terminé" de un subagente no cuenta como verificación.

## Stack y arquitectura

- **Electron** con `electron-vite` 5 (vite 7). Tres procesos claramente separados:
  - `src/main/` — proceso principal (Node). Ventanas, OAuth, llamadas a GitHub, CLIs
    de IA, acceso a secretos, cache de análisis. **Nunca** exponer tokens al renderer.
  - `src/preload/` — puente `contextBridge`. API tipada y mínima; sin `nodeIntegration`.
    Compilado a **CJS** (obligatorio con `sandbox: true`, ver gotchas).
  - `src/renderer/` — UI React 19 + TypeScript estricto + Tailwind v4 (CSS-first,
    `@theme` en `styles.css`) + Zustand.
- **GitHub:** Octokit (GraphQL para listados, REST para acciones). Auth por **OAuth
  Device Flow** (Client ID público en `src/main/auth/config.ts`); el token se guarda
  cifrado con `safeStorage` en userData. **Desde F14 (v0.5.0) hay un segundo modo de
  acceso, `gh-cli`** (toggle en Settings, `githubAccessMode` en settings.json): para
  orgs enterprise con *OAuth app access restrictions* que bloquean la OAuth App de
  Minerva pero permiten GitHub CLI. Es un **puente de token**: `main/auth/gh-cli-auth.ts`
  obtiene el token con `execFile(gh, ['auth','token',...])` (probe TTL 5s, validado
  contra `GET /user`) y los datos siguen por el mismo `RealGithubService`/Octokit;
  `withGhCliTokenRetry` (`main/github/gh-retry.ts`) reintenta UNA vez ante 401
  re-pidiendo el token a gh. El token de gh vive SOLO en memoria de main (Minerva
  jamás lo persiste ni loguea); `signOut`/`startDeviceFlow` son no-op en modo gh
  (JAMÁS `gh auth logout` — la sesión del CLI es del usuario). El spawn de gh usa
  env crudo, NO `buildSanitizedSpawnEnv` (ese saneado borra `GH_TOKEN`/`GITHUB_TOKEN`
  y es solo para CLIs de IA). En desktops que Chromium no reconoce
  (Hyprland/sway) `main/index.ts` fuerza `--password-store=gnome-libsecret` — sin eso
  `safeStorage` cae a `basic_text` y el token no persiste (re-login en cada arranque).
  `MINERVA_MOCK=1` activa la capa GitHub mock (universo "shopwave", 8 PRs) — solo
  afecta GitHub, NO a la IA.
- **IA (F11, v0.4.0): tres proveedores AGÉNTICOS vía CLIs oficiales**, sin API keys
  propias: **OpenCode** (default; `opencode serve` local + `@opencode-ai/sdk` v2,
  exact-pinneado en lockstep con el CLI), **Claude Code** (Agent SDK oficial) y
  **Codex** (`codex app-server` JSON-RPC). Cada análisis descarga un **snapshot del
  repo al commit del PR** (`github/snapshot-store.ts`: tarball por `headSha`, LRU en
  disco 10/2 GB con limpieza periódica, symlinks filtrados) y el modelo lo explora con
  **herramientas de solo lectura** (jail: OpenCode vía `OPENCODE_CONFIG_CONTENT`
  deny-por-defecto; Claude `tools: [Read,Grep,Glob]` + `permissionMode: 'dontAsk'` +
  `settingSources: []`; Codex `sandbox: 'read-only'`). "Autenticado" = sesión del CLI
  (para OpenCode: ≥1 upstream `connected`). `MINERVA_MOCK_AI=1` fuerza el mock de IA
  (fixtures por el mismo pipeline) sin importar proveedor — el mecanismo para e2e
  determinista. OpenRouter ya NO es proveedor directo (T59): sus modelos se usan
  DENTRO de OpenCode (`opencode auth login`), y settings.json viejos migran solos.
  - **Proveedor y modelo configurables** (Settings UI, engrane en la TitleBar):
    catálogo por proveedor en `src/shared/ai-providers.ts` (OpenCode además refresca
    modelos dinámicos vía `provider.list`). Precedencia: settings.json (userData) >
    env `MINERVA_AI_PROVIDER`/`MINERVA_AI_MODEL` > default (`opencode/big-pickle`).
  - **Streaming**: SSE en main + protocolo de secciones **tagged**
    (`@@@SECTION kind=...`, `@@@MERMAID...@@@END_MERMAID`, `@@@SNIPPET...`) parseado
    incrementalmente por `StreamSectionParser`; progreso al renderer vía evento push
    `onAnalysisProgress` (broadcast a todas las ventanas, el hook filtra por PR).
    NO volver a JSON monolítico: el protocolo tagged existe para streamear.
  - **Cache LRU** (20 entradas) de análisis en main: repetir análisis o abrir la
    ventana desacoplada no re-paga el LLM; `ai:invalidateAnalysis` lo limpia.
  - Prompts versionados en `src/main/ai/prompts/` (no strings inline dispersos).
- **Diagramas:** Mermaid en el renderer (import lazy, `securityLevel: 'strict'`).
  La IA **produce texto Mermaid** (C4, `erDiagram`, `architecture-beta`) — la IA no
  dibuja, escribe DSL.
- **Sección "Infraestructura cloud" (F15, v0.6.0):** kind `cloud`, condicional —
  el modelo la emite SOLO si ve IaC de AWS/Cloudflare en el snapshot (Terraform,
  CDK, SAM/CloudFormation, serverless.yml, wrangler.toml/jsonc, Pulumi; regla
  anti-alucinación en el prompt). A diferencia de architecture/schema lleva
  `mermaids: string[]` (hasta DOS diagramas `architecture-beta`: big picture del
  sistema desplegado + zoom a lo que el PR toca, servicios marcados con sufijo
  "PR" en el label). Iconos vía `registerIconPacks` con packs 100% LOCALES:
  `@iconify-json/logos` (aws-*, cloudflare-workers) + mini-pack `cf` vendoreado
  (`renderer/src/assets/cf-icon-pack.ts`: R2/D1/KV/Durable Objects/Pages/Queues,
  SVGs de cloudflare-docs CC-BY-4.0) — la CSP `connect-src 'self'` prohíbe el
  loader remoto de Iconify. El prompt lleva la gramática exacta + whitelist
  literal de iconos (sintaxis joven: los modelos la mezclan con flowchart).
- **Ventana didáctica desacoplada:** hash `#didactic/<owner>/<name>/<n>?title=...`
  (`src/shared/didactic-route.ts`); `main.tsx` es **reactivo a `hashchange`**
  (re-navegar con solo el hash distinto es same-document: Chromium NO recarga).

### Frontera de seguridad (crítica)
- Todo secreto (GitHub token; las sesiones de los CLIs de IA viven en SUS stores,
  `~/.claude`/`~/.codex`/`~/.local/share/opencode`, fuera de Minerva) vive **solo**
  en `main`.
- El **snapshot del PR es código hostil**: jamás ejecutarlo; solo lo leen las
  herramientas enjauladas de los proveedores (deny de write/bash/red; symlinks
  filtrados al extraer; `settingSources: []` en Claude para no cargar un CLAUDE.md
  del snapshot).
- El preload expone funciones concretas (`window.minerva.*`), nunca `ipcRenderer`
  crudo; los eventos push tienen un método concreto por evento (`onAnalysisProgress`).
- Main valida payloads por canal (`src/main/ipc/validators.ts`).
- CSP explícita en `src/renderer/index.html` (img-src 'self' data: https:; object-src
  'none'; base-uri 'none'; ...) — `data:` es necesario para los sprites base64 de los
  C4 de mermaid; `https:` para avatares e imágenes de comentarios de GitHub.
- Trata el contenido de PRs (títulos, diffs, comentarios) como **no confiable** al
  construir prompts (prompt injection) y al renderizar (react-markdown sin HTML crudo).

## Layout real de carpetas

```
src/
  main/
    index.ts        ventana principal, password-store, lifecycle
    auth/           device-flow, token-store (safeStorage), auth-manager
    github/         service.ts (interfaz), real-service (Octokit), mock + fixtures,
                    snapshot-store (copia del PR por headSha + limpieza LRU)
    ai/             stream-parser, prompts/, analysis-cache, analysis-prompt,
                    diff-budget, analysis-timeouts, env; providers/ (opencode-runtime
                    + opencode-service, claude-code-service, codex-*, cli-probe,
                    registry, *-model-catalog)
    ipc/            register, handlers (cache-first), validators
    settings/       store.ts (settings.json en userData, escritura atómica)
    windows/        didactic-window, secure-web-preferences, external-link-guard
  preload/          index.ts → window.minerva.{system,auth,github,ai,settings,window,events}
  shared/           ipc.ts (contrato único), types.ts, events.ts, ai-providers.ts,
                    didactic-route.ts
  renderer/src/
    components/     layout/, pr-list/, pr-detail/, didactic/, settings/, ui/
    hooks/          use-auth, use-pull-requests, use-didactic-analysis, use-settings
    stores/         app-store.ts (zustand)
scripts/            smoke-*.mjs (e2e vía CDP), screenshot-app.sh, debug-*.mjs
.agents/            PLAN.md (sandbox de plan), TASKS.md (control + bitácora), WORKFLOW.md
.claude/            agents/ y skills/ (analizador didáctico, revisor de seguridad)
```

## Convenciones

- **TypeScript estricto.** Sin `any` salvo justificación. Tipos IPC en `src/shared/`.
- Componentes React en `PascalCase.tsx`; módulos de main/shared en `kebab-case.ts`.
- Componentes de UI pequeños y enfocados; lógica de datos en hooks/main.
- Para resetear estado por entidad usa **remount por `key`** (el linter de react-hooks
  prohíbe `setState`-en-efecto y refs-en-render).
- Errores de red/IA: siempre estado de carga + error visible, nunca throw silencioso.

## Gotchas duros (aprendidos a la mala — bitácora completa en `.agents/TASKS.md`)

1. El preload DEBE compilarse a **CJS** (`sandbox: true` rechaza preload ESM) — ya
   configurado en `electron.vite.config.ts`; no lo cambies.
2. En main usa **`import.meta.dirname`**, nunca `__dirname`: el plugin `vite:esm-shim`
   corrompe el bundle cuando los fixtures contienen strings tipo `import ... from`.
3. **Sin backticks** como delimitadores en strings largos de main (fixtures, prompts) —
   misma regex del plugin. Usa comillas normales concatenadas.
4. Si el binario de Electron falta tras `npm install`: `node node_modules/electron/install.js`.
5. Para matar la app desde scripts: `pkill -f "[e]lectron"` (el truco del corchete evita
   que el patrón matchee tu propio shell → exit 144).
6. `safeStorage` en Hyprland/omarchy: ver sección GitHub arriba (password-store).
7. Los `[Label]` de `architecture-beta` solo aceptan **letras, números y espacios**:
   un paréntesis, guion o símbolo rompe el lexer (por eso el marcado de servicios
   tocados es el sufijo plano "PR", no "(PR)"). Verificado contra mermaid 11.16.
8. Los icon packs de mermaid se cargan con **`import()` dinámico** dentro del
   singleton lazy de `MermaidDiagram.tsx` — un import estático de
   `@iconify-json/logos` (~7 MB) en ese módulo (alcanzable estáticamente desde el
   entry) infla el bundle principal de 2.5 MB a 10 MB.
9. El snapshot mock se cachea en disco por `headSha` (`userData/snapshots/`): si
   cambias `fixtures-snapshot.ts` hay que borrar el dir del snapshot afectado (y
   reiniciar la app entera: el hot reload de main a veces no re-escribe el árbol).

## Comandos

- `npm run dev` — Electron con hot reload (main cambia ⇒ reinicio completo).
- `npm run dev -- -- --remote-debugging-port=9222` — dev + CDP para las suites e2e.
- `npm run build` / `npm run typecheck` / `npm run lint` / `npm test` (vitest).
- `npm run verify` — typecheck + lint + test encadenados; es el mismo gate que el
  job `checks` de los workflows de CI (pr-dev-builds y release).
- `MINERVA_MOCK=1 npm run dev` — demo: PRs mock + IA real del proveedor activo (si su
  CLI está autenticado; si no, cae al mock de IA).
- `MINERVA_MOCK=1 MINERVA_MOCK_AI=1 npm run dev` — demo/e2e 100% determinista: PRs
  mock + IA mock forzada (desde F11 los proveedores son CLIs que suelen estar
  logueados en dev — este flag es LA forma de pedir el mock a propósito).

## Verificación (obligatoria antes de dar algo por hecho)

1. `typecheck`, `lint` y `npm test` en verde.
2. Suites e2e vía CDP: app corriendo con `--remote-debugging-port=9222`, luego
   `node scripts/smoke-<suite>.mjs`. Reglas para escribir/tocar suites:
   - El target CDP SIEMPRE excluye la ventana didáctica: `!url.includes('#didactic')`.
   - Limpia el estado global al arrancar: buscador, cache del PR bajo prueba
     (`ai:invalidateAnalysis`), y panel didáctico (selecciona un PR neutral).
   - Espera señales inequívocas (botón "Re-analizar" habilitado), no textos que ya
     existen en el placeholder ("Resumen").
   - Con IA real las secciones varían por corrida: checks de snippet/diagrama con
     fallback a otro PR. Para suites deterministas lanza la app con
     `MINERVA_MOCK_AI=1` (fuerza el mock de IA); `smoke-settings` necesita IA real
     de OpenCode para su paso de modelo inválido (se auto-skipea si no hay sesión).
   - Verifica **contenido**, no solo URLs o rects: `getBoundingClientRect` ignora el
     clipping (un visor colapsado a 0px "pasaba" los checks geométricos).
3. **Verificación visual**: toda verificación de UI termina MIRANDO una captura:
   `scripts/screenshot-app.sh <salida.png> [patrón-título]` (hyprctl + grim, no
   interactivo; 2º argumento para la ventana didáctica). No sirve con hyprlock activo.

### Receta e2e paso a paso (shell de agente / sesión tty)

El shell de un agente NO hereda la sesión gráfica de Hyprland: sin estos exports
Electron muere con "Missing X server or $DISPLAY" y `hyprctl` con
"HYPRLAND_INSTANCE_SIGNATURE not set". Receta completa, en orden:

1. **Arrancar la app** (en background, log a archivo):

   ```bash
   WAYLAND_DISPLAY=wayland-1 DISPLAY=:0 \
     MINERVA_MOCK=1 OPENROUTER_API_KEY= \
     npm run dev -- -- --remote-debugging-port=9222 > /tmp/minerva-dev.log 2>&1 &
   ```

   - `WAYLAND_DISPLAY`/`DISPLAY`: los sockets reales están en
     `/run/user/$(id -u)/` (`wayland-1`) y `/tmp/.X11-unix/` (`X0`) — verifica ahí
     si estos valores no funcionan.
   - `OPENROUTER_API_KEY=` (vacío) fuerza el mock de IA ⇒ suites deterministas.
     Omítelo solo si la suite necesita IA real.
   - `MINERVA_WATCH_INTERVAL_MS=1500` extra para `smoke-pr-list` (el caso del
     watcher espera un push que con el default de 60s haría timeout).

2. **Esperar el target CDP** (~10–15 s): `curl -s http://127.0.0.1:9222/json/list`
   debe listar una `page` con `localhost:5173`. Recién entonces correr suites.

3. **Correr las suites**: `node scripts/smoke-<suite>.mjs`. Si encadenas varias en
   la misma sesión de app, haz `location.reload()` (vía CDP) entre suites: algunas
   dejan estado global (p. ej. `smoke-search` deja "refunds" en el buscador y
   `smoke-comments` no limpia al arrancar). El reload resetea el store zustand.

4. **Captura** (verificación visual obligatoria):

   ```bash
   export WAYLAND_DISPLAY=wayland-1 \
     HYPRLAND_INSTANCE_SIGNATURE=$(ls -t /run/user/$(id -u)/hypr/ | head -1)
   scripts/screenshot-app.sh /tmp/captura.png
   ```

   La firma de Hyprland es el nombre del directorio de instancia más reciente en
   `/run/user/$(id -u)/hypr/`. Después MIRA la captura (leer el PNG), no basta
   con que el comando salga 0.

5. **Matar la app**: `pkill -f "[e]lectron"` en un comando/llamada SEPARADO y
   solo. Si la app es hija de tu propio shell (la arrancaste con `&` en esa
   sesión), un compound command `pkill ...; git ...` muere entero con exit 144
   antes de ejecutar lo que sigue — el truco del corchete no salva eso.

## Al terminar un cambio

- Corre la verificación de arriba (al menos las suites afectadas).
- No expongas secretos al renderer. Revisa la frontera de seguridad.
- Actualiza `.agents/TASKS.md` (estado + bitácora si hubo gotcha nuevo) y el roadmap
  del `README.md` cuando completes un hito.

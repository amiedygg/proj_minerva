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
  - `src/main/` — proceso principal (Node). Ventanas, OAuth, llamadas a GitHub y a
    OpenRouter, acceso a secretos, cache de análisis. **Nunca** exponer tokens al renderer.
  - `src/preload/` — puente `contextBridge`. API tipada y mínima; sin `nodeIntegration`.
    Compilado a **CJS** (obligatorio con `sandbox: true`, ver gotchas).
  - `src/renderer/` — UI React 19 + TypeScript estricto + Tailwind v4 (CSS-first,
    `@theme` en `styles.css`) + Zustand.
- **GitHub:** Octokit (GraphQL para listados, REST para acciones). Auth por **OAuth
  Device Flow** (Client ID público en `src/main/auth/config.ts`); el token se guarda
  cifrado con `safeStorage` en userData. En desktops que Chromium no reconoce
  (Hyprland/sway) `main/index.ts` fuerza `--password-store=gnome-libsecret` — sin eso
  `safeStorage` cae a `basic_text` y el token no persiste (re-login en cada arranque).
  `MINERVA_MOCK=1` activa la capa GitHub mock (universo "shopwave", 8 PRs) — solo
  afecta GitHub, NO a la IA.
- **IA:** [OpenRouter](https://openrouter.ai/docs/quickstart) desde **main**
  (`src/main/ai/`, API OpenAI-compatible). La IA real se activa si existe
  `OPENROUTER_API_KEY` (`.env` raíz, gitignored), independiente de `MINERVA_MOCK`;
  sin key hay un mock que streamea fixtures por el mismo pipeline.
  - **Modelo configurable por el usuario** (Settings UI, engrane en la TitleBar):
    lista curada en `src/shared/ai-models.ts`, default **`z-ai/glm-5.2`**.
    Precedencia: settings.json (userData) > env `MINERVA_AI_MODEL` > default.
  - **Streaming**: SSE en main + protocolo de secciones **tagged**
    (`@@@SECTION kind=...`, `@@@MERMAID...@@@END_MERMAID`, `@@@SNIPPET...`) parseado
    incrementalmente por `StreamSectionParser`; progreso al renderer vía evento push
    `onAnalysisProgress` (broadcast a todas las ventanas, el hook filtra por PR).
    NO volver a JSON monolítico: el protocolo tagged existe para streamear.
  - **Cache LRU** (20 entradas) de análisis en main: repetir análisis o abrir la
    ventana desacoplada no re-paga el LLM; `ai:invalidateAnalysis` lo limpia.
  - Prompts versionados en `src/main/ai/prompts/` (no strings inline dispersos).
- **Diagramas:** Mermaid en el renderer (import lazy, `securityLevel: 'strict'`).
  La IA **produce texto Mermaid** (C4, `erDiagram`) — la IA no dibuja, escribe DSL.
- **Ventana didáctica desacoplada:** hash `#didactic/<owner>/<name>/<n>?title=...`
  (`src/shared/didactic-route.ts`); `main.tsx` es **reactivo a `hashchange`**
  (re-navegar con solo el hash distinto es same-document: Chromium NO recarga).

### Frontera de seguridad (crítica)
- Todo secreto (GitHub token, `OPENROUTER_API_KEY`) vive **solo** en `main`.
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
    github/         service.ts (interfaz), real-service (Octokit), mock + fixtures
    ai/             openrouter-service (SSE), stream-parser, prompts/, analysis-cache,
                    diff-budget, section-mapper, env
    ipc/            register, handlers (cache-first), validators
    settings/       store.ts (settings.json en userData, escritura atómica)
    windows/        didactic-window, secure-web-preferences, external-link-guard
  preload/          index.ts → window.minerva.{system,auth,github,ai,settings,window,events}
  shared/           ipc.ts (contrato único), types.ts, events.ts, ai-models.ts,
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

## Comandos

- `npm run dev` — Electron con hot reload (main cambia ⇒ reinicio completo).
- `npm run dev -- -- --remote-debugging-port=9222` — dev + CDP para las suites e2e.
- `npm run build` / `npm run typecheck` / `npm run lint` / `npm test` (vitest).
- `MINERVA_MOCK=1 npm run dev` — demo: PRs mock + IA real si hay key.

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
     fallback a otro PR.
   - Verifica **contenido**, no solo URLs o rects: `getBoundingClientRect` ignora el
     clipping (un visor colapsado a 0px "pasaba" los checks geométricos).
3. **Verificación visual**: toda verificación de UI termina MIRANDO una captura:
   `scripts/screenshot-app.sh <salida.png> [patrón-título]` (hyprctl + grim, no
   interactivo; 2º argumento para la ventana didáctica). No sirve con hyprlock activo.

## Al terminar un cambio

- Corre la verificación de arriba (al menos las suites afectadas).
- No expongas secretos al renderer. Revisa la frontera de seguridad.
- Actualiza `.agents/TASKS.md` (estado + bitácora si hubo gotcha nuevo) y el roadmap
  del `README.md` cuando completes un hito.

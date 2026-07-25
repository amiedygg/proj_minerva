# 🦉 proj_minerva

> Revisa Pull Requests de GitHub y **entiéndelos de verdad** antes de aprobarlos.

**proj_minerva** es una aplicación de escritorio (Electron) para revisar Pull Requests
de GitHub con un enfoque **didáctico**. Además del diff clásico estilo GitKraken,
un agente de IA acompaña la revisión explicando el _impacto_ de los cambios:
diagramas de arquitectura C4, documentación de endpoints nuevos con forma de probarlos
en local, y visualización de cómo evolucionan las tablas y el diagrama ER.

El objetivo: que quien aprueba un PR lo haga **entendiendo** lo que aprueba.

---

## ✨ Características

### Revisión de PRs (base)
- 🔐 Conexión con GitHub (OAuth Device Flow) a todas las cuentas/orgs con acceso.
- 📋 Listado de PRs abiertos en todos los repos accesibles, con filtros y búsqueda.
- 💬 Ver hilos de comentarios (de PR y de líneas) y **comentar** desde la app.
- ✅ Ver estado de checks/CI, reviewers y estado de aprobación.

### Vista de diff (estilo GitKraken)
- 🌳 Árbol de archivos con toggle **list / tree / auto**.
- ↔️ **Split view** (original izquierda, cambios derecha) e **inline view**.
- 🎨 Resaltado de sintaxis, word-wrap opcional y navegación archivo-a-archivo.

### Panel didáctico con IA (el diferenciador)
- 🏛️ **Diagramas C4 (Mermaid)**: cómo los cambios del PR afectan la arquitectura
  (contexto, contenedores, componentes) de la app o de un servicio.
- 🔌 **Endpoints nuevos**: documentación autogenerada + snippet/coleccion para
  **probarlo en local** (curl / HTTPie / archivo `.http`).
- 🗃️ **Cambios de esquema**: detalle de tablas y campos nuevos + **diagrama ER**
  (Mermaid `erDiagram`) mostrando cómo cambia el modelo de datos.
- 📚 **Resumen didáctico**: qué cambió, por qué importa, riesgos y qué mirar de cerca.
- ⚡ **Streaming**: el análisis aparece en vivo, sección a sección, con los diagramas
  renderizándose en cuanto su bloque Mermaid se completa.
- 🤖 **Multi-proveedor**: proveedor y modelo configurables desde Settings (⚙️) — Claude
  Code, Codex y OpenCode (con acceso, dentro de OpenCode, a upstreams como OpenRouter,
  Anthropic u OpenAI vía `opencode auth login`). Minerva no gestiona ninguna API key:
  usa la sesión que ya autenticaste con el CLI de cada proveedor.
- 🪟 **Ventana desacoplable**: el análisis se abre en su propia ventana amplia (sin
  re-pagar el LLM: cache en main) con botón **Re-analizar** para comparar modelos.
- 🔍 **Visor de recursos**: cualquier diagrama se expande a un lightbox con zoom
  (hacia el cursor), pan y ajuste automático; tablas y snippets en vista amplia.

---

## 🧱 Stack técnico

| Capa | Tecnología |
|------|-----------|
| Runtime desktop | Electron + [electron-vite](https://electron-vite.org/) 5 |
| UI | React 19 + TypeScript estricto + Tailwind CSS v4 |
| Estado | Zustand |
| GitHub API | [Octokit](https://github.com/octokit) (GraphQL para listados, REST para acciones) — OAuth Device Flow, token cifrado con safeStorage |
| IA | Claude Code / Codex / [OpenCode](https://opencode.ai/) — CLIs oficiales, proveedor+modelo configurables desde la UI, streaming con protocolo de secciones tagged |
| Diagramas | [Mermaid](https://mermaid.js.org/) (C4, `erDiagram`, flowchart) — import lazy, `securityLevel: strict` |
| Diff | parser de patches propio + resaltado con Shiki |
| Tests | vitest (229 unit) + suites e2e vía Chrome DevTools Protocol |

---

## 🚀 Puesta en marcha

```bash
# 1. Instalar dependencias
npm install
# (si el binario de Electron no se descargó: node node_modules/electron/install.js)

# 2. IA real (opcional — sin ningún CLI logueado, el panel didáctico usa un mock):
#    corré el login del proveedor que prefieras en una terminal.
claude login      # Claude Code (cuenta Pro/Max)
codex login       # Codex (cuenta ChatGPT Plus/Pro)
opencode auth login   # OpenCode (gateway propio + upstreams como OpenRouter/Anthropic/OpenAI)

# 3. Desarrollo (hot reload)
npm run dev              # GitHub real: login por Device Flow desde la app
MINERVA_MOCK=1 npm run dev   # modo demo: PRs mock ("shopwave") + IA real si hay CLI logueado

# 4. Calidad
npm run typecheck && npm run lint && npm test

# 5. Build de producción
npm run build
```

- El **proveedor y modelo de IA** se cambian en la app (⚙️ Settings); default OpenCode
  (`opencode/big-pickle`). Precedencia: settings > env `MINERVA_AI_PROVIDER`/
  `MINERVA_AI_MODEL` > default. Minerva no gestiona ninguna API key: cada proveedor se
  autentica solo, leyendo la sesión de su propio CLI.
- La sesión de GitHub **persiste** entre arranques (token cifrado vía safeStorage).
  En desktops Wayland no reconocidos por Chromium (Hyprland/sway) la app fuerza el
  backend `gnome-libsecret`; override con `MINERVA_PASSWORD_STORE` si tu setup usa otro.

---

## 🧪 Desarrollo y verificación

- **Unit tests**: `npm test` (vitest).
- **Suite e2e** (Playwright, `e2e/`): `npm run test:e2e` — lanza la app
  construida con datos mock y userData aislado por test; no necesita la app
  corriendo. Sin sesión gráfica:
  `npm run build && xvfb-run -a -s "-screen 0 1600x1000x24" npx playwright test`.
  Las reglas para escribir specs sin falsos positivos están en
  `CLAUDE.md` § Verificación.
- **Verificación visual**: `scripts/screenshot-app.sh salida.png` captura la ventana
  de la app (hyprctl + grim) — toda verificación de UI termina mirando una captura.
- **Flujo multi-agente** (orquestador Fable 5 + subagentes Sonnet 5, planes y control
  de tareas): ver `.agents/WORKFLOW.md`, `.agents/PLAN.md` y `.agents/TASKS.md`.

### Empaquetado

- `npm run dist` — build + AppImage en `dist/Minerva-<versión>.AppImage`
  (`npm run dist:dir` genera solo `dist/linux-unpacked/`, más rápido para probar).
- **Los tres proveedores de IA (Claude Code, Codex, OpenCode) requieren su CLI
  oficial instalado y logueado en la máquina donde corre Minerva** — Minerva ya
  no gestiona ninguna API key propia (eliminado en T59: hasta entonces existía
  un cuarto proveedor, OpenRouter, con key propia vía `.env`/safeStorage; hoy
  quien quiera esos modelos los conecta DENTRO de OpenCode con `opencode auth
  login`). La app NO bundlea los CLIs ni reimplementa su OAuth: usa la sesión
  que ya autenticaste con `claude login` (Claude Pro/Max), `codex login`
  (ChatGPT Plus/Pro) u `opencode auth login`. Sin el CLI instalado el selector
  de proveedor en Settings muestra "No disponible"; instalado pero sin sesión
  (o, en OpenCode, sin ningún upstream conectado), muestra "Instalado, sin
  sesión". El paquete `@anthropic-ai/claude-agent-sdk` trae un binario nativo
  por plataforma (~250MB) que tampoco se bundlea — `electron-builder.yml` lo
  excluye explícitamente (`!**/node_modules/@anthropic-ai/claude-agent-sdk-*/**`)
  porque Minerva siempre apunta al `claude` del sistema vía
  `pathToClaudeCodeExecutable` (resuelto por `src/main/ai/providers/resolve-cli.ts`,
  que busca en `PATH` y en ubicaciones comunes como `~/.local/bin` — necesario
  porque una app GUI lanzada desde el launcher no siempre hereda el `PATH`
  completo de una terminal).
- En sistemas sin `libfuse.so.2` (Arch trae fuse3): correr el AppImage con
  `--appimage-extract-and-run`, instalar el paquete `fuse2`, o usar
  `dist/linux-unpacked/minerva` directo.
- Verificación del empaquetado: `npm run dist:dir` y luego la suite e2e — el
  spec `e2e/packaged.spec.ts` lanza el binario de `dist/linux-unpacked/` con
  mocks (se auto-skipea si el binario no existe).
- **Release multi-OS**: al publicar un release en GitHub, el workflow
  `.github/workflows/release.yml` construye AppImage (Linux), instalador NSIS
  (Windows x64) y DMG (macOS arm64+x64) en runners hosteados de GitHub
  (`ubuntu-latest` / `windows-latest` / `macos-latest`) y los adjunta al
  release. Los binarios de macOS/Windows salen **sin firma de código**
  (Gatekeeper/SmartScreen mostrarán aviso). Conviene bumpear `version` en
  `package.json` antes de taggear.
- **macOS: "«Minerva» está dañada y no se puede abrir"**: la app NO está rota —
  es Gatekeeper rechazando una app sin firmar ni notarizar que llegó con el
  atributo de cuarentena de la descarga (el CI empaqueta con
  `CSC_IDENTITY_AUTO_DISCOVERY=false`, ver log "skipped macOS application code
  signing"). Tras arrastrar `Minerva.app` a Aplicaciones, quitar la cuarentena:

  ```bash
  xattr -cr /Applications/Minerva.app
  ```

  y abre normal (aplica igual al DMG arm64 y x64). El fix definitivo es firmar
  con un certificado Developer ID + notarizar (requiere Apple Developer
  Program); mientras tanto este workaround es esperado para toda descarga.

---

## 🗺️ Roadmap

- [x] Scaffolding Electron + React + TS (electron-vite)
- [x] Autenticación GitHub (Device Flow) + token cifrado con safeStorage (sesión persistente)
- [x] Listado de repos y PRs abiertos _(Octokit real; `MINERVA_MOCK=1` para el modo demo)_
- [x] Vista de diff estilo GitKraken (split/inline, árbol de archivos, Shiki)
- [x] Comentarios: leer y publicar (generales y por línea), **renderizados como Markdown**
- [x] Panel de IA: resumen didáctico _(Claude Code/Codex/OpenCode reales vía CLI logueado; mock como fallback)_
- [x] Panel de IA: diagramas C4 de impacto arquitectónico _(render Mermaid e2e)_
- [x] Panel de IA: detección de endpoints + doc + probador local
- [x] Panel de IA: detección de cambios de esquema + diagrama ER
- [x] Settings UI: selector de proveedor+modelo (default OpenCode)
- [x] Streaming del análisis (SSE + protocolo de secciones tagged)
- [x] Ventana didáctica desacoplable + cache de análisis (sin re-pagar el LLM)
- [x] Visor de recursos: lightbox con zoom/pan para diagramas, vista amplia para tablas/snippets
- [x] CSP explícita + validación de payloads IPC por canal
- [x] Panel de IA: sección "Cómo levantar la app" (Docker/local, env vars requeridas y NUEVAS del PR)
- [x] Syntax highlighting (Shiki) en snippets del panel didáctico y fences de Markdown
- [x] Empaquetado (electron-builder) — `npm run dist` → `dist/Minerva-<v>.AppImage` _(icono propio pendiente)_
- [x] Lista de PRs v0.3.0: filtro de estado (Abiertos/Cerrados/Todos, badges `merged`/`closed`)
- [x] Lista de PRs v0.3.0: refresh manual + watcher de cambios (polling 60s en main, evento push `prListChanged`)
- [x] Lista de PRs v0.3.0: leído/no-leído por PR (dots rojos, contador de comentarios, persistido en userData)
- [x] Análisis agéntico v0.4.0: snapshot local del commit del PR + exploración read-only (los hallazgos cruzan diff y árbol real)
- [x] Proveedor OpenCode v0.4.0 (reemplaza a OpenRouter directo; sus modelos van DENTRO de OpenCode) + card guía si no hay CLIs
- [x] Settings v0.4.1: rediseño — strip "En uso" (CLI/modelo/razonamiento activos), tabs por proveedor (ver ≠ activar), cards de modelo de un click y chip resumen en la TitleBar
- [x] Mini-log de actividad del harness v0.4.2: mientras la IA analiza, el panel muestra en vivo qué está haciendo el agente ("Leyó src/api/routes.ts", "Buscó \"router\"", "Pensando…") — efímero, sutil, en los tres proveedores + mock
- [x] Modo de acceso a GitHub v0.5.0: OAuth de Minerva o **GitHub CLI (`gh`)** — para orgs enterprise con *OAuth app access restrictions* que bloquean la OAuth App pero permiten gh; puente de token (`gh auth token` solo en memoria de main, datos por Octokit igual), toggle en Settings
- [x] Panel de IA: sección "Infraestructura cloud" v0.6.0 — si el repo declara infra AWS/Cloudflare (Terraform, CDK, SAM, serverless.yml, wrangler.toml…), big picture del sistema desplegado + zoom a dónde incide el PR, en Mermaid `architecture-beta` con logos oficiales (icon packs locales: `@iconify-json/logos` + pack `cf` vendoreado con R2/D1/KV/Durable Objects/Pages/Queues) _(GCP/DO: pendiente)_
- [x] Layout responsivo para tiling v0.6.3: la UI se adapta a la ventana partida (mitad vertical/horizontal, hasta 4 por monitor) — lista de PRs y árbol de archivos pasan a drawer cuando falta ancho, el diff cae a inline antes de volverse ilegible, y el modal de Settings deja de recortar contenido (scroll único; dos columnas en ventanas anchas)
- [ ] Comentar en un PR real de prueba (verificación con cuenta real)

> Estado detallado, bitácora de gotchas y control de tareas: `.agents/TASKS.md`.
> Estrategia multi-agente (Fable 5 orquesta, Sonnet 5 implementa): `.agents/WORKFLOW.md`.

---

## 📄 Licencia

Por definir.

---

_Nombre en honor a **Minerva**, diosa romana de la sabiduría — porque revisar
código debería enseñarte algo._

## Referencias de diseño
- [GitKraken — Diffs & Split View](https://help.gitkraken.com/gitkraken-desktop/diff/)
- [GitKraken — Pull Requests](https://help.gitkraken.com/gitkraken-desktop/pull-requests/)
- [GitKraken — Interface Layout](https://help.gitkraken.com/gitkraken-desktop/interface/)

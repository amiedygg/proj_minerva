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
- 🤖 **Multi-LLM**: modelo configurable desde Settings (⚙️) vía OpenRouter — GLM 5.2
  por defecto; Kimi K2.7 Code, Gemini 3.5 Flash, GPT-5.5, Claude Opus 4.8 / Sonnet 5,
  o cualquier ID de openrouter.ai/models.
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
| IA | [OpenRouter](https://openrouter.ai/) (API OpenAI-compatible) — multi-LLM, modelo configurable desde la UI, streaming SSE con protocolo de secciones tagged |
| Diagramas | [Mermaid](https://mermaid.js.org/) (C4, `erDiagram`, flowchart) — import lazy, `securityLevel: strict` |
| Diff | parser de patches propio + resaltado con Shiki |
| Tests | vitest (229 unit) + suites e2e vía Chrome DevTools Protocol |

---

## 🚀 Puesta en marcha

```bash
# 1. Instalar dependencias
npm install
# (si el binario de Electron no se descargó: node node_modules/electron/install.js)

# 2. Configurar la key de IA (opcional — sin key, el panel didáctico usa un mock)
cp .env.example .env
#   OPENROUTER_API_KEY=...      # panel didáctico con IA real (multi-LLM vía OpenRouter)

# 3. Desarrollo (hot reload)
npm run dev              # GitHub real: login por Device Flow desde la app
MINERVA_MOCK=1 npm run dev   # modo demo: PRs mock ("shopwave") + IA real si hay key

# 4. Calidad
npm run typecheck && npm run lint && npm test

# 5. Build de producción
npm run build
```

- El **modelo de IA** se cambia en la app (⚙️ Settings); default `z-ai/glm-5.2`.
  Precedencia: settings > env `MINERVA_AI_MODEL` > default.
- La sesión de GitHub **persiste** entre arranques (token cifrado vía safeStorage).
  En desktops Wayland no reconocidos por Chromium (Hyprland/sway) la app fuerza el
  backend `gnome-libsecret`; override con `MINERVA_PASSWORD_STORE` si tu setup usa otro.

---

## 🧪 Desarrollo y verificación

- **Unit tests**: `npm test` (vitest).
- **Suites e2e** (contra la app corriendo): arranca con
  `MINERVA_MOCK=1 npm run dev -- -- --remote-debugging-port=9222` y corre
  `node scripts/smoke-<suite>.mjs` (e2e, diff, comments, search, streaming, settings,
  didactic, detach, bugfixes). Las reglas para escribir suites sin falsos positivos
  están en `CLAUDE.md` § Verificación.
- **Verificación visual**: `scripts/screenshot-app.sh salida.png` captura la ventana
  de la app (hyprctl + grim) — toda verificación de UI termina mirando una captura.
- **Flujo multi-agente** (orquestador Fable 5 + subagentes Sonnet 5, planes y control
  de tareas): ver `.agents/WORKFLOW.md`, `.agents/PLAN.md` y `.agents/TASKS.md`.

### Empaquetado

- `npm run dist` — build + AppImage en `dist/Minerva-<versión>.AppImage`
  (`npm run dist:dir` genera solo `dist/linux-unpacked/`, más rápido para probar).
- El `.env` queda **excluido** del paquete a propósito (la key de OpenRouter no
  viaja en el binario); en producción la key llega por variable de entorno
  hasta que exista el campo en Settings (roadmap).
- En sistemas sin `libfuse.so.2` (Arch trae fuse3): correr el AppImage con
  `--appimage-extract-and-run`, instalar el paquete `fuse2`, o usar
  `dist/linux-unpacked/minerva` directo.
- Verificación del empaquetado: `MINERVA_MOCK=1 ./dist/Minerva-<v>.AppImage
  --appimage-extract-and-run --remote-debugging-port=5175` y en otra terminal
  `node scripts/smoke-packaged.mjs captura.png`.

---

## 🗺️ Roadmap

- [x] Scaffolding Electron + React + TS (electron-vite)
- [x] Autenticación GitHub (Device Flow) + token cifrado con safeStorage (sesión persistente)
- [x] Listado de repos y PRs abiertos _(Octokit real; `MINERVA_MOCK=1` para el modo demo)_
- [x] Vista de diff estilo GitKraken (split/inline, árbol de archivos, Shiki)
- [x] Comentarios: leer y publicar (generales y por línea), **renderizados como Markdown**
- [x] Panel de IA: resumen didáctico _(OpenRouter real si hay `OPENROUTER_API_KEY`; mock como fallback)_
- [x] Panel de IA: diagramas C4 de impacto arquitectónico _(render Mermaid e2e)_
- [x] Panel de IA: detección de endpoints + doc + probador local
- [x] Panel de IA: detección de cambios de esquema + diagrama ER
- [x] Settings UI: selector de modelo multi-LLM (default GLM 5.2)
- [x] Streaming del análisis (SSE + protocolo de secciones tagged)
- [x] Ventana didáctica desacoplable + cache de análisis (sin re-pagar el LLM)
- [x] Visor de recursos: lightbox con zoom/pan para diagramas, vista amplia para tablas/snippets
- [x] CSP explícita + validación de payloads IPC por canal
- [x] Panel de IA: sección "Cómo levantar la app" (Docker/local, env vars requeridas y NUEVAS del PR)
- [x] Syntax highlighting (Shiki) en snippets del panel didáctico y fences de Markdown
- [x] Empaquetado (electron-builder) — `npm run dist` → `dist/Minerva-<v>.AppImage` _(icono propio pendiente)_
- [ ] `OPENROUTER_API_KEY` vía safeStorage + campo en Settings (hoy: `.env`)
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

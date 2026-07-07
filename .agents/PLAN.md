# PLAN — proj_minerva

> Sandbox del plan de la tarea actual. Se actualiza al empezar/terminar cada fase.
> Control de tareas y bitácora: `TASKS.md`. Estrategia multi-agente: `WORKFLOW.md`.

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

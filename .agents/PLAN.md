# PLAN — proj_minerva

> Sandbox del plan de la tarea actual. Se actualiza al empezar/terminar cada fase.
> Control de tareas y bitácora: `TASKS.md`. Estrategia multi-agente: `WORKFLOW.md`.

## Iteración actual (2026-07-11): F12 — Rediseño del panel de Settings (tabs por proveedor + "En uso")

> Rama `feature/settings-redesign` (desde `main`, post-merge de F11/v0.4.0).
> Pedido de Edilson (2026-07-11): (1) el panel debe ENUNCIAR claramente qué CLI,
> modelo y esfuerzo están activos; (2) fuera los radio buttons de proveedor — no
> "seleccionan" nada conceptualmente, funcionan como TABS para ver los modelos de
> cada proveedor; (3) rediseño general para mejor UX. Aprobó además el resumen
> compacto en la TitleBar (junto al engrane).

### Diagnóstico del diseño viejo (T30/T37)

- Nada enunciaba la config vigente: el proveedor se deducía de la radio marcada; el
  modelo ACTIVO se confundía con el BORRADOR (checked = borrador, no lo guardado);
  el esfuerzo estaba al fondo, ligado al modelo del borrador.
- Doble semántica de persistencia (proveedor inmediato vs modelo con "Guardar")
  confundía; el "Guardar" siempre habilitado no distinguía "sin cambios".

### Nuevo modelo de interacción

1. **Strip "En uso" fijo** (`ActiveConfigSummary`) entre el header del modal y el
   área con scroll: proveedor activo + badge de estado de login, modelo (mono) +
   esfuerzo resuelto, y badge de origen cuando `modelSource !== 'settings'`
   (env: aviso de que MINERVA_AI_MODEL manda hasta que se elija algo acá).
2. **Tabs por proveedor** (`role=tablist`, estado local `viewedProvider` iniciado en
   `info.provider`): cada tab = label + punto de estado de login (color por status)
   + check "activo" si es el proveedor vigente. Click = SOLO ver ese proveedor
   (no persiste nada).
3. **Cards de modelo clickeables, sin radios ni "Guardar"**: click en una card =
   ACTIVAR ese proveedor+modelo en un paso (`settings:setProviderModel` y, si el tab
   visto no es el proveedor activo, `settings:setAiProvider` — dos canales
   existentes, sin IPC nuevo). Spinner en la card en vuelo; badge "Activo" (tone
   success) en la card del modelo vigente cuando el tab visto es el proveedor
   activo. Click en la card ya activa = no-op.
4. **"Otro (avanzado)"** (solo OpenCode): card con input + botón "Usar" explícito
   (tecleo necesita commit explícito). Lleva el badge "Activo" cuando el modelo
   vigente no está en la lista del tab.
5. **Esfuerzo** (`ModelOptionPicker`, se conserva tal cual): se pinta bajo la lista
   SOLO cuando el tab visto es el proveedor activo, con los descriptores del modelo
   ACTIVO (lista dinámica de `useProviderModels`, que trae los efforts reales de
   Codex). Ya no existe el concepto "opciones del borrador".
6. **`CliLoginGuide`** se mantiene por tab (proveedor visto).
7. **TitleBar**: el engrane se convierte en chip `icono + "Proveedor · Modelo"`
   (mantener el `svg.lucide-settings` adentro: la suite e2e lo usa como selector),
   tooltip con el detalle completo, click = abrir settings. Labels vía la misma
   resolución de `ActiveModelHint` (extraer `resolveModelHintLabels` a
   `renderer/src/lib/model-labels.ts` y reutilizar en los tres consumidores).

### Simplificaciones que caen solas

- Muere el estado borrador (`selectedId`/`isCustom` como borrador, `saved`,
  el remount `key={modelsLoading}` y el `key={info.provider}` de `ModelPicker`
  para resetear borradores): la lista deriva TODO de `info` + `viewedProvider`.
  El remount-por-key queda solo donde sigue haciendo falta: panel del tab
  (`key={viewedProvider}`) para que `useProviderModels` re-fetchee sin efectos de
  sincronización, y `ModelOptionPicker` (`key={provider + '/' + modelId}`).
- `SOURCE_HINT` se muda al strip "En uso" (badge de origen).

### Tareas (control en TASKS.md)

- **T62** — Rediseño del modal: `ActiveConfigSummary` + tabs + cards activables +
  esfuerzo del modelo activo + `lib/model-labels.ts`. (Subagente Sonnet.)
- **T63** — TitleBar: chip resumen proveedor·modelo en el engrane. (Mismo subagente,
  entrega separada.)
- **T64** — Actualizar `scripts/smoke-settings.mjs` (checks UI del nuevo diseño:
  tabs, activación por click de card, strip "En uso") + verificación integral +
  captura. (Orquestador.)

### Invariantes / gotchas a respetar

- Solo renderer + (si hace falta un helper de labels) `shared/ai-providers.ts`;
  CERO cambios en main/preload/IPC.
- Lint react-hooks: prohibido `setState`-en-efecto y sincronizar estado con efectos
  — derivar de props o remount-por-`key` (patrón del repo).
- TS estricto, sin `any`. Accesibilidad: tablist/tab/tabpanel + `aria-selected`,
  todo operable por teclado; Esc y click-en-overlay siguen cerrando.
- La suite `smoke-settings.mjs` localiza el engrane por `svg.lucide-settings` y
  espera que el modal liste "OpenCode/Claude Code/Codex" — no romper esas señales.

### Verificación (orquestador)

- typecheck/lint/`npm test` verdes.
- `MINERVA_MOCK=1 MINERVA_MOCK_AI=1` + CDP: `smoke-settings.mjs` actualizado en
  verde (incluye activar modelo por click de card entre tabs y restaurar).
- Captura mirada del modal nuevo (strip "En uso", tabs, badge Activo) y de la
  TitleBar con el chip.

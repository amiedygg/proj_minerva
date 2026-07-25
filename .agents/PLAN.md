# PLAN — proj_minerva

> Sandbox del plan de la tarea actual. Se actualiza al empezar/terminar cada fase.
> Control de tareas y bitácora: `TASKS.md`. Estrategia multi-agente: `WORKFLOW.md`.

## Iteración actual (2026-07-25): F16 — Layout responsivo para tiling (v0.6.3)

> **ESTADO: F16 COMPLETA** (T79–T88 implementadas y verificadas: `npm run verify`
> verde, suite e2e 35/35 bajo Xvfb —incluye `responsive.spec.ts` nuevo—, capturas
> de los 4 tilings + ventana didáctica a 520px miradas). Cierre y bitácora en
> TASKS.md § F16. Pendiente de Edilson: usarla tileada de verdad y decidir el
> merge de `fix/responsive-tiling-layout`.
>
> **Dos decisiones cambiaron durante la implementación** (el resto del plan se
> cumplió tal cual; se documentan acá para que el plan no mienta):
> 1. **Settings: dos columnas en vez de nav de anclas.** Con solo dos secciones
>    (GitHub | IA), una nav lateral de dos ítems era decorativa. Repartirlas en
>    dos columnas con scroll propio a partir de 980px de ventana usa el ancho de
>    verdad: en 1920x540 (mitad horizontal) se ve TODO sin scrollear, que es
>    exactamente lo que la pila vertical hacía imposible. Se mantiene el
>    requisito duro: ambas secciones siempre montadas, nunca un switcher.
> 2. **Didáctico en `sm`: overlay, no rail.** Forzar el rail con el panel
>    "abierto" haría que el botón de la TitleBar pareciera roto (togglear no
>    cambiaría nada visible). Como overlay —mismo patrón que el drawer de la
>    lista— el toggle sigue significando lo que dice y el centro conserva todo
>    su ancho.

> Rama `fix/responsive-tiling-layout` (desde `main`, post-merge de la migración
> Playwright). Pedido de Edilson (2026-07-25): *"la interfaz tiene bastantes
> problemas con el responsive, por ejemplo los settings… Piensa en la
> distribución de ventanas: partida vertical u horizontalmente hasta 4 ventanas
> en un monitor"*. Es un **fix de layout** (bump de patch), no una feature nueva:
> no cambia contratos IPC, ni el pipeline de IA, ni la frontera de seguridad.

### Diagnóstico medido (2026-07-25, sonda CDP bajo Xvfb, app construida con mocks)

Sonda: `Emulation.setDeviceMetricsOverride` sobre la página conectada por CDP,
capturando la UI a 1920×1080 / 960×1080 / 1920×540 / 960×540. No es teoría:

1. **Presupuesto horizontal rígido.** `Sidebar` 280px `shrink-0` + `FileTree`
   260px `shrink-0` + `DidacticPanel` 380px `shrink-0` = **920px que no ceden**.
   Medido a 960×540 (un cuarto de un monitor 1080p): el diff queda en **40px de
   ancho** (20px por lado en split). A 960×1080 (mitad vertical) es idéntico —
   el problema es de ancho, no de alto.
2. **SettingsModal: contenido INALCANZABLE.** La card es `flex-col
   overflow-hidden` con `max-h-[85vh]`, pero el único `overflow-y-auto` envuelve
   a `ProviderModelPanel`. `GithubAccessSection` (~300px, con la guía de `gh`
   siempre desplegada) + "En uso" + tabs suman ~464px contra un techo de 459px a
   540 de alto ⇒ **las tabs y la lista de modelos se recortan y no hay scroll que
   las alcance**. Éste es exactamente el síntoma que reportó Edilson.
3. **El ancho del panel didáctico no se re-clampea al redimensionar la ventana**:
   `clampDidacticPanelWidth` solo corre dentro de `setDidacticPanelWidth` (es
   decir, al arrastrar). Un ancho guardado en un monitor grande sobrevive al
   achicar la ventana y se come la pantalla.
4. **La ventana principal no declara `minWidth`/`minHeight`** (`main/index.ts`):
   nada impide tilearla a un tamaño donde la UI es inoperable.

### Modelo de breakpoints (decisión central)

Tiers por ancho — `xl ≥1360` · `lg 1040–1360` · `md 760–1040` · `sm <760`
Tiers por alto — `tall ≥700` · `short 560–700` · `xshort <560`

| Tiling (monitor) | Tamaño | Tier |
|---|---|---|
| 1 ventana en 1080p | 1920×1080 | `xl` / `tall` |
| mitad vertical | 960×1080 | `md` / `tall` |
| mitad horizontal | 1920×540 | `xl` / `xshort` |
| 4 cuadrantes en 1080p | 960×540 | `md` / `xshort` |
| 4 cuadrantes en 1440p | 1280×720 | `lg` / `short` |
| mitad en laptop 1440 | 720×900 | `sm` / `tall` |
| ventana por defecto de la app | 1400×900 | `xl` / `tall` |

**Dos mecanismos, cada uno para lo suyo** (decisión explícita):

- **`useLayoutTier` (JS, `useSyncExternalStore` sobre `resize`)** para lo
  ESTRUCTURAL: qué paneles existen y en qué forma (dock / rail / drawer). Va por
  ventana porque decide la composición del shell.
- **Ancho medido del contenedor (`useElementWidth`, ResizeObserver)** para lo
  INTRA-panel (árbol de archivos, split↔inline, toolbar). Tiene que ser el ancho
  REAL del panel, no el de la ventana: el didáctico es redimensionable a mano, así
  que dos ventanas del mismo ancho pueden dar diffs de anchos distintos. El
  `setState` vive en el callback del ResizeObserver (nunca en el cuerpo del
  efecto) para no chocar con el lint react-hooks del repo.

Se descartó `matchMedia`/media queries puras: las media queries no ven el ancho
del panel, solo el de la ventana (mismo argumento del punto anterior).

### Comportamiento por tier (contrato de la UI)

**Shell (`App.tsx`)**
- `xl`: sidebar dock 280 · centro · didáctico dock (ancho arrastrable).
- `lg`: sidebar dock 240 · didáctico dock con tope del 34%.
- `md`: sidebar → **drawer overlay** (cerrado por defecto, se abre desde el
  TitleBar y se cierra al elegir PR) · didáctico dock con tope del 45% y mínimo
  300 · centro se queda con el resto.
- `sm`: sidebar drawer + didáctico **overlay** (rail de 40px cuando está
  cerrado) ⇒ una sola superficie principal a la vez.
- `minWidth: 560` / `minHeight: 420` en la ventana principal: el `sm`/`xshort`
  soportado tiene piso, no se degrada indefinidamente.

**Alto**
- `short`: TitleBar `h-12 → h-9`; `PrHeader` a una línea (título + `#n`), con
  autor/rama/commits/labels en un `<details>` "Detalles".
- `xshort`: además, los modales (Settings, ResourceViewer) pasan a **sheet a
  pantalla casi completa** — a 540px de alto un modal centrado con márgenes es
  peor que uno que ocupa la ventana.

**Diff (lo que arregla el 40px)**
- El árbol de archivos es columna mientras el `FilesTab` mida ≥640px; por debajo
  se vuelve **drawer** dentro del panel (botón "N archivos" en la toolbar).
- Split↔inline: por debajo de **560px de panel de diff** se fuerza `inline`
  (`effectiveMode`), sin pisar la preferencia del usuario en el store; el botón
  split queda deshabilitado con tooltip que explica el porqué. 560px = 2×280,
  ~30 columnas de código por lado con los gutters — el piso de lo legible.
  A 1400×900 (ventana por defecto) el panel de diff mide 480px ⇒ **sí, el default
  pasa a inline**: es el pixel real, no una regresión (480px en split son 190px
  de código por lado). Con el didáctico cerrado vuelve a split solo.

**SettingsModal** (el peor caso reportado)
- Un ÚNICO `flex-1 min-h-0 overflow-y-auto` para todo el cuerpo, con `shrink-0`
  explícito en el header. Con eso ya nada queda inalcanzable.
- "En uso" y las tabs pasan a `sticky` DENTRO del scroller: se conserva la
  intención de T62 (nunca perder de vista qué está activo) sin bloquear el scroll.
- ≥980px de ventana: **dos columnas** (Acceso a GitHub | Proveedor y modelo),
  cada una con su scroll; por debajo, una sola columna scrolleable. NUNCA un
  switcher que desmonte secciones (requisito duro: `github-mode.spec.ts` espera
  ver "Acceso a GitHub" y sus cards apenas abre el modal, sin clicks).
- Tamaño: `max-w-[900px]` en dos columnas / `max-w-lg` en una; alto
  `h-[min(88vh,700px)]`; en `xshort`, sheet de ventana completa.
- Guía de `gh` compactada a una línea (hoy es un bloque `<ol>` de ~110px).
  **No** se colapsa en un `<details>` cerrado: `github-mode.spec.ts` exige
  `gh auth login` VISIBLE al abrir el modal.

### Fuera de alcance (decidido, no olvidado)

- **Sidebar redimensionable a mano**: el tiling no lo necesita (los tiers ya
  resuelven el espacio) y duplicaría el estado persistido. Follow-up si Edilson
  lo pide; el handle de `DidacticPanel` es el patrón a reusar.
- **Rediseño visual** de Settings (dos columnas de contenido, agrupación nueva de
  ajustes): esto es un fix de layout, no un rediseño. Solo cambia la mecánica de
  scroll/tamaño y la nav de anclas.
- Temas claros, tipografía fluida, y responsive de la ventana didáctica más allá
  de bajar su mínimo y ajustar padding.

### Riesgos y cómo se vigilan

- **Romper specs e2e existentes** (17 specs corren a 1400×900 = tier `xl`/`tall`):
  el tier por defecto debe dejar el shell EXACTAMENTE como está hoy salvo el
  split→inline del diff (que `diff.spec.ts` no asume: hace click en "inline" y
  verifica `@@`, no el DOM de split). Verificación: suite completa en verde.
- **Auto-esconder la sidebar en `md` puede sentirse agresivo**: mitigado con el
  botón explícito en el TitleBar + cierre al seleccionar PR (gesto de un click) y
  con el piso de `minWidth`.
- **Loops de render con ResizeObserver**: el callback solo hace `setState` si el
  ancho redondeado cambió; nunca se escribe layout desde el callback.
- **`localStorage` del ancho didáctico**: se sigue guardando en px (compatible con
  lo ya persistido) y se re-clampea contra el viewport en cada `resize`.

### Verificación de la fase

1. `npm run verify` (typecheck + lint + test) en verde.
2. `npm run test:e2e` completo en verde bajo Xvfb (incluye el spec nuevo
   `responsive.spec.ts`, que recorre los 4 tilings con `Emulation.
   setDeviceMetricsOverride` y afirma: diff ≥400px a 960×540, cero contenido
   recortado en Settings, y las cards de Settings alcanzables por scroll).
3. Capturas MIRADAS de los 4 tamaños, antes y después.

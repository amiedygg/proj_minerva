# PLAN — proj_minerva

> Sandbox del plan de la tarea actual. Se actualiza al empezar/terminar cada fase.
> Control de tareas y bitácora: `TASKS.md`. Estrategia multi-agente: `WORKFLOW.md`.

## Iteración actual (2026-07-12): F15 — Sección didáctica "Infraestructura cloud" (AWS/Cloudflare) (v0.6.0)

> **ESTADO: F15 COMPLETA** (S0 + T75–T78 verificadas; cierre y bitácora en
> TASKS.md). Pendiente de Edilson: probar con un PR real de un repo con infra
> (enterprise) y decidir el merge de `feature/didactic-cloud-section`.

> Rama `feature/didactic-cloud-section` (desde `main`, post-merge de F14/v0.5.0).
> Pedido de Edilson (2026-07-12): cuando el repo del PR involucre infra de AWS o
> Cloudflare (Lambdas, EventBridge, Workers…), el panel didáctico debe explicar el
> **big picture** de la arquitectura cloud completa disponible en el repo y luego
> **aterrizar dónde en ese big picture** el PR actualiza o modifica algo — para que
> quien revisa entienda cómo funciona la app en general y cómo el cambio afecta la
> interacción de todo el sistema. GCP/Digital Ocean vendrán después (fuera de alcance).

### Decisiones de diseño (2026-07-12, acordadas con Edilson)

1. **Sección NUEVA, kind `cloud`** (no dentro de `architecture`). Condicional como
   `endpoint`/`schema`: la decide el MODELO guiado por el prompt (no hay detector de
   repo en main — así funcionan ya las otras secciones condicionales, y desde F11 el
   agente explora el snapshot con herramientas read-only). `architecture` (C4, "cómo
   se organiza el código") queda intacta; `cloud` responde "dónde vive el cambio en
   el sistema desplegado". Meterla en `architecture` habría exigido multi-mermaid en
   una sección que ya funciona — más invasivo, mismo resultado.
2. **Motor: Mermaid `architecture-beta`** (ya tenemos mermaid 11.16.0, la sintaxis
   existe desde 11.1; 11.16 añadió `align row|column`). Iconos vía
   `mermaid.registerIconPacks()` con packs **100% locales** (import directo del JSON
   en el chunk lazy — cero red, compatible con la CSP `connect-src 'self'`):
   - `@iconify-json/logos` (CC0): 63 iconos `aws-*` (lambda, s3, dynamodb, sqs, sns,
     eventbridge, api-gateway, step-functions, cloudfront, …) + `cloudflare` +
     `cloudflare-workers`.
   - Mini-pack vendoreado `cf` (formato IconifyJSON, ~6 SVGs del Style Guide oficial
     de Cloudflare): **R2, D1, KV, Durable Objects, Pages, Queues NO existen en
     ninguna colección Iconify** — es el único hueco real.
   - Investigado y descartado: NO existe `@iconify-json/aws`; simple-icons ELIMINÓ
     sus iconos AWS en v15; el C4 de Mermaid no soporta sprites (sigue experimental).
   - Plan B si architecture-beta decepciona: D2 WASM (`@terrastruct/d2`) — sintaxis
     LLM-friendly pero 8.2 MB, ~1 año sin release y sus iconos son URLs remotas que
     la CSP bloquea (exigiría post-procesar el DSL a data-URIs). Plan C: flowchart
     clásico + icon shapes de iconify (v11.13+) — lo más robusto sintácticamente,
     perdiendo la semántica de grupos.
3. **Formato: DOS diagramas por sección** — 1º el sistema completo (big picture),
   2º zoom al área que el PR modifica. ⇒ la variante `cloud` lleva
   **`mermaids: string[]`** (no el `mermaid?: string` de architecture/schema). El
   cambio de forma queda acotado al kind nuevo; el parser acumula los bloques
   `@@@MERMAID` en orden. Tolerancia: si el modelo emite solo 1 diagrama la sección
   sigue siendo válida (el prompt exige 2; el parser no descarta por eso).

### Contrato de la sección

- Protocolo tagged: `@@@SECTION kind=cloud` + markdown didáctico + dos bloques
  `@@@MERMAID` (1º big picture, 2º zoom con los servicios tocados por el PR).
- `DidacticSection` gana la variante `{ kind: 'cloud'; markdown: string;
  mermaids: string[] }`; `DraftDidacticSection` la variante con `mermaids?`.
- Renderer: card "Infraestructura cloud" (icono lucide `Cloud`), cada diagrama con
  subtítulo fijo del renderer: "Sistema completo" / "Dónde incide este PR".
- Disparadores en el prompt (el modelo los busca explorando el snapshot): Terraform
  (`*.tf`), CDK, SAM/CloudFormation, `serverless.yml`, `wrangler.toml|jsonc`,
  Pulumi, workflows de deploy que referencien AWS/CF. Si no hay infra, la sección
  NO se emite (regla idéntica a endpoint/schema).

### Fiabilidad del LLM con architecture-beta (riesgo principal)

Sintaxis más nueva/menos frecuente que flowchart. Errores típicos documentados:
aristas sin dirección (`a -- b` en vez de `a:R -- L:b`), sintaxis de flowchart
(`-->`), iconos inventados. Mitigación (patrón GenAIScript, alineado con nuestros
prompts versionados): gramática exacta + **whitelist literal de iconos válidos** +
few-shot completo en `analyze-pr.ts`; reglas de tamaño (≤10 servicios, labels ≤3
palabras, grupos por proveedor/dominio). El fallback actual de `MermaidDiagram`
(card con el código fuente si el parse falla) ya cubre el peor caso. Un
validation-loop con `mermaid.parse()` re-alimentando el error al modelo queda como
follow-up SI la tasa de error real lo justifica — no en v1.

### Restricciones verificadas (investigación 2026-07-12)

- CSP `connect-src 'self'` ⇒ prohibido el loader remoto de Iconify; los packs van
  por import estático dentro del chunk lazy de mermaid (ya existe el singleton
  `mermaidPromise` en `MermaidDiagram.tsx:107`).
- `securityLevel: 'strict'` + tema `neutral` fijo sobre `bg-white`: los logos son
  full-color y se leen sobre blanco; **el spike S0 valida que los iconos inline
  sobreviven al sanitizado de strict ANTES de comprometer la ola 2**.
- Peso: el JSON de `@iconify-json/logos` (~7 MB unpacked) entra al chunk lazy de
  mermaid (solo se paga al montar el primer diagrama). Si molesta, follow-up:
  subset build-time del pack (solo `aws-*`/`cloudflare*`).

### Puntos de código (mapeados; NO se toca IPC/preload/cache/persistencia/hook)

1. `src/shared/types.ts` + `src/shared/events.ts` — variantes nuevas del union.
2. `src/main/ai/stream-parser.ts` — `KNOWN_KINDS` (:43), `toDraft()` (76-98,
   acumular `mermaids[]` para cloud), `sectionToText()` (286-306, serializar N
   bloques MERMAID).
3. `src/main/ai/section-mapper.ts` — `case 'cloud'` en `mapRawSection` (47-82).
4. `src/main/ai/prompts/analyze-pr.ts` — enum del marcador (:95), regla de
   clasificación (58-64), bloque de contenido (105-130), gramática architecture-beta
   + whitelist de iconos, few-shot. GOTCHA: comillas concatenadas, sin backticks.
5. `src/renderer/src/components/didactic/DidacticAnalysisArea.tsx` — `SECTION_META`
   (29-35, Record exhaustivo: el typecheck obliga) + rama en `renderSection`/
   `renderDraftSection` (46-140).
6. `src/renderer/src/components/didactic/MermaidDiagram.tsx` — `registerIconPacks`
   una sola vez dentro del `initialize()` lazy (109-133).
7. Deps: `@iconify-json/logos`; nuevo `src/renderer/src/assets/cf-icon-pack.ts`
   (vendoreado, con atribución al Style Guide de Cloudflare).
8. Mock: `src/main/ai/fixtures.ts` — sección `cloud` en un PR shopwave que encaje
   (e2e determinista con `MINERVA_MOCK_AI=1`).

### Fases y delegación

- **S0 (orquestador, antes de la ola 2)**: spike de render — página scratch con
  mermaid 11.16 + `registerIconPacks` local renderizando el few-shot bajo
  `securityLevel: 'strict'` + tema neutral. Valida iconos/strict/layout. Si falla,
  se decide plan C (flowchart + icon shapes) ANTES de tocar el renderer.
- **Ola 1 (Sonnet): T75 → T76** — main + shared: tipos, parser multi-mermaid,
  mapper, unit tests (T75); prompt + fixtures mock (T76, depende de los tipos de T75).
- **Ola 2 (Sonnet): T77** — renderer: deps de iconos, cf-icon-pack vendoreado,
  registerIconPacks, SECTION_META, render de la card con dos diagramas subtitulados.
- **T78 (orquestador)**: suite `smoke-cloud-section.mjs` (determinista,
  `MINERVA_MOCK=1 MINERVA_MOCK_AI=1`), prueba con IA real sobre un repo con infra,
  captura MIRADA, docs (CLAUDE.md/README) y bump a 0.6.0.

### Riesgos / casos borde vigilados

- Modelo emite 1 solo diagrama o Mermaid inválido ⇒ sección válida igualmente;
  fallback card del renderer para el diagrama roto. NUNCA descartar la sección
  entera por un diagrama malo.
- Iconos fuera de whitelist ⇒ mermaid pinta "unknown" (icono ?) — la whitelist del
  prompt + built-ins (`cloud`, `database`, `disk`, `internet`, `server`) como
  fallback declarado reducen la incidencia.
- Repos con infra mixta o solo CI/CD (deploy a AWS sin IaC): el prompt pide emitir
  la sección SOLO si puede reconstruir el mapa desde el repo — no inventar
  arquitectura que no está en el código (anti-alucinación explícita).
- `stringifySections()` del mock debe serializar EXACTAMENTE lo que el parser
  acepta (roundtrip test parser⇄serializer para cloud).
- Prompt injection: el contenido del snapshot sigue siendo hostil; la sección nueva
  no añade superficie (mismo pipeline, render sin HTML crudo).

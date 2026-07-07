/**
 * Fixtures de `DidacticAnalysis` para el universo mock "shopwave" (mismos PRs
 * que `src/main/github/fixtures.ts`). Tres PRs tienen contenido enriquecido
 * (secciones `endpoint`/`schema`/`architecture` con diagramas Mermaid); el
 * resto recibe un resumen genérico armado a partir de su `PullRequestDetail`.
 *
 * IMPORTANTE (gotcha de build, ver `.agents/TASKS.md`): el contenido largo de
 * estos fixtures usa comillas normales (simples/dobles) con `\n` y
 * concatenación, NUNCA template literals con backtick como delimitador de
 * string — evita relanzar el bug de `vite:esm-shim` encontrado en T4. Los
 * caracteres backtick sueltos dentro de un string con comillas normales (para
 * `código inline` en Markdown) sí son seguros, como ya se usa en
 * `github/fixtures.ts`.
 */
import type { DidacticSection, PullRequestDetail } from '../../shared/types'

/** Resumen genérico para PRs sin sección enriquecida en esta demo mock. */
export function genericSummarySection(detail: PullRequestDetail): DidacticSection {
  const labels =
    detail.labels.length > 0 ? detail.labels.map((l) => l.name).join(', ') : 'sin etiquetas'

  return {
    kind: 'summary',
    markdown:
      '## Resumen\n\n**' +
      detail.title +
      '** (' +
      detail.repo.fullName +
      '#' +
      detail.number +
      ')\n\n' +
      'Cambia ' +
      detail.changedFiles +
      ' archivo(s): +' +
      detail.additions +
      ' / -' +
      detail.deletions +
      '. Etiquetas: ' +
      labels +
      '.\n\n' +
      'Este PR no disparó ninguna sección enriquecida (arquitectura, endpoint o esquema) en esta ' +
      'demo con datos mock: en el pipeline real, el clasificador de IA decide automáticamente qué ' +
      'secciones generar a partir del diff (ver `.claude/skills/` y `src/main/ai/prompts/README.md`).',
  }
}

const pr482Sections: DidacticSection[] = [
  {
    kind: 'summary',
    markdown:
      '## Qué cambia\n\n' +
      'Este PR agrega el endpoint `POST /api/v1/carts/:id/apply-coupon`: valida un código de cupón ' +
      'y, si es válido, recalcula el total del carrito activo.\n\n' +
      '**Por qué importa:** es el primer punto donde un cliente puede modificar el total del carrito ' +
      'con un código externo. Un bug aquí puede traducirse en descuentos no acotados (pérdida de ' +
      'ingresos) o en cupones legítimos rechazados (mala experiencia).\n\n' +
      '**Qué revisar:**\n' +
      '- El clamp del descuento: en el hilo de comentarios se señala que `coupon.discountRate` sin ' +
      'tope podía llegar a 100%; confirmar que el fix (clamp a 0.9) está en este diff.\n' +
      '- El caso "cupón ya aplicado" (409) todavía no tiene test, según el último comentario de revisión.\n' +
      '- Que toda la validación viva en `CouponService` y no se duplique en el handler de la ruta.',
  },
  {
    kind: 'setup',
    markdown:
      '## Cómo probar este PR\n\n' +
      'El diff de este PR no muestra un `Dockerfile` ni un `docker-compose.yml` entre los archivos ' +
      'tocados, así que no hay evidencia directa de un flujo Docker para esta demo — si `shopwave/api` ' +
      'tiene uno para levantar la base de datos, no aparece en estos archivos.\n\n' +
      '**En local:** el archivo tocado usa `express` (`import { Router } from \'express\'`), así que ' +
      'es la API Node.js/Express habitual del repo:\n\n' +
      '1. `npm install`\n' +
      '2. `npm run dev` (o `npm start`, según el `package.json` del repo)\n\n' +
      '**Variables de entorno necesarias para correr la API:** `DATABASE_URL` (conexión a Postgres, ' +
      'usada por `CartService`/`OrderRepository`) y `PORT` (puerto HTTP).\n\n' +
      '**Variables de entorno NUEVAS de este PR:** sí — `CouponService` introduce un tope ' +
      'configurable para el descuento máximo (ver "Qué revisar" arriba, el clamp a 0.9):\n\n' +
      '| Variable | Propósito | Valor de ejemplo |\n' +
      '|---|---|---|\n' +
      '| `COUPON_MAX_DISCOUNT_RATE` | Tope superior del `discountRate` que `CouponService.apply` ' +
      'acepta de un cupón (evita descuentos no acotados) | `0.9` |',
    snippets: [
      {
        label: 'arranque-local',
        language: 'bash',
        code: 'npm install\nnpm run dev',
      },
      {
        label: 'env',
        language: 'env',
        code: 'DATABASE_URL=postgres://localhost:5432/shopwave\nPORT=3000\nCOUPON_MAX_DISCOUNT_RATE=0.9',
      },
    ],
  },
  {
    kind: 'endpoint',
    markdown:
      '### `POST /api/v1/carts/:id/apply-coupon`\n\n' +
      '| | |\n' +
      '|---|---|\n' +
      '| **Path param** | `id` — id del carrito activo |\n' +
      '| **Body** | `{ "code": string }` |\n' +
      '| **200 OK** | `{ "ok": true, "total": number }` — cupón aplicado, total recalculado |\n' +
      '| **409 Conflict** | `{ "ok": false, "reason": "already_applied" }` — el carrito ya tenía cupón |\n' +
      '| **200 con `ok:false`** | `{ "ok": false, "reason": "expired_or_missing" }` — código inválido o vencido |\n\n' +
      'El handler delega toda la lógica a `CouponService.apply(cart, code)` (servicio nuevo, ver ' +
      'diagrama de arquitectura más abajo).',
    snippets: [
      {
        label: 'curl',
        language: 'curl',
        code:
          'curl -X POST http://localhost:3000/api/v1/carts/123/apply-coupon \\\n' +
          '  -H "Content-Type: application/json" \\\n' +
          '  -d \'{"code":"WELCOME10"}\'',
      },
      {
        label: 'apply-coupon.http',
        language: 'http',
        code:
          'POST http://localhost:3000/api/v1/carts/123/apply-coupon\n' +
          'Content-Type: application/json\n\n' +
          '{\n' +
          '  "code": "WELCOME10"\n' +
          '}',
      },
    ],
  },
  {
    kind: 'architecture',
    markdown:
      '`CouponService` es un servicio nuevo, independiente de `CartService`: la ruta ' +
      '`POST /carts/:id/apply-coupon` lo invoca para mantener la validación de cupones fuera del ' +
      'handler HTTP.',
    mermaid:
      'C4Container\n' +
      // Sin '#' en el título: el lexer C4 de mermaid (11.16) lanza "Lexical
      // error" con '#' dentro del DSL (descubierto en T16; misma regla en el
      // prompt real y en la skill mermaid-c4-diagram).
      '  title Impacto arquitectónico del PR 482 (apply-coupon)\n' +
      '  Person(customer, "Cliente", "Compra en Shopwave")\n' +
      '  System_Boundary(shopwave, "Shopwave") {\n' +
      '    Container(api, "API", "Node.js / Express", "Expone REST a clientes")\n' +
      '    Container(couponService, "CouponService (NUEVO)", "TypeScript", "Valida y aplica cupones a un carrito")\n' +
      '    ContainerDb(db, "Base de datos", "PostgreSQL", "Carritos, cupones, órdenes")\n' +
      '  }\n' +
      '  Rel(customer, api, "POST /carts/:id/apply-coupon")\n' +
      // Etiquetas de Rel ≤4 palabras (misma regla que el prompt real, T16):
      // las largas se enciman con las cajas vecinas en el layout C4.
      '  Rel(api, couponService, "delega validación")\n' +
      '  Rel(couponService, db, "lee y guarda")\n',
  },
]

const pr479Sections: DidacticSection[] = [
  {
    kind: 'summary',
    markdown:
      '## Qué cambia\n\n' +
      'Introduce la tabla `refunds` (migración aditiva) para soportar reembolsos parciales por ' +
      'línea de orden, junto al modelo `Refund` y un campo `refundedAmount` calculado en `Order`.\n\n' +
      '**Por qué importa:** es un cambio de esquema en producción. Aunque la migración no toca ' +
      'datos existentes, define una relación nueva (`Order` 1—N `Refund`) de la que otros servicios ' +
      'empezarán a depender.\n\n' +
      '**Qué revisar:**\n' +
      '- El `CHECK (amount_cents > 0)` no impide reembolsar más de lo que vale la línea de orden ' +
      '(ver comentario de @mgarcia); falta un tope contra `order_lines.amount_cents`.\n' +
      '- `refundedAmount` se recalcula en la capa de aplicación, no con un trigger de base de datos ' +
      '— confirmar que todo camino que crea un `Refund` pasa por ese recálculo.',
  },
  {
    kind: 'setup',
    markdown:
      '## Cómo probar este PR\n\n' +
      'Es una migración (`migrations/2026070401_create_refunds.sql`) más un modelo nuevo; el diff no ' +
      'muestra `Dockerfile` ni `docker-compose.yml`, así que no hay evidencia de un flujo Docker en ' +
      'esta demo.\n\n' +
      '**En local:** misma API Node.js de `shopwave/api`:\n\n' +
      '1. `npm install`\n' +
      '2. Correr la migración nueva contra la base (el repo no expone en este diff el comando exacto ' +
      'del runner de migraciones — buscar el script `migrate` en `package.json`).\n' +
      '3. `npm run dev`\n\n' +
      '**Variables de entorno necesarias para correr la API:** `DATABASE_URL` (Postgres, es contra ' +
      'esa misma base que corre la migración de `refunds`).\n\n' +
      '**Variables de entorno NUEVAS de este PR:** este PR no agrega ni cambia variables de entorno ' +
      '— es una migración de esquema pura, sin código de aplicación que lea `process.env`.',
    snippets: [
      {
        label: 'arranque-local',
        language: 'bash',
        code: 'npm install\nnpm run dev',
      },
    ],
  },
  {
    kind: 'schema',
    markdown:
      '### Tabla `refunds`\n\n' +
      '| Campo | Tipo | Notas |\n' +
      '|---|---|---|\n' +
      '| `id` | `uuid` | PK, `gen_random_uuid()` |\n' +
      '| `order_id` | `uuid` | FK -> `orders.id` |\n' +
      '| `order_line_id` | `uuid` | FK -> `order_lines.id` |\n' +
      '| `amount_cents` | `integer` | `CHECK (amount_cents > 0)`, sin tope superior aún |\n' +
      '| `reason` | `text` | opcional |\n' +
      '| `created_at` | `timestamptz` | default `now()` |\n\n' +
      'Índice `idx_refunds_order_id` sobre `order_id` para listar reembolsos por orden.',
    mermaid:
      'erDiagram\n' +
      '    ORDER ||--o{ REFUND : tiene\n' +
      '    ORDER {\n' +
      '        string id PK\n' +
      '        string status\n' +
      '        int total\n' +
      '        int refundedAmount\n' +
      '    }\n' +
      '    REFUND {\n' +
      '        string id PK "NUEVO"\n' +
      '        string orderId FK "NUEVO"\n' +
      '        string orderLineId FK "NUEVO"\n' +
      '        int amountCents "NUEVO"\n' +
      '        string reason "NUEVO"\n' +
      '        string createdAt "NUEVO"\n' +
      '    }\n',
  },
]

const pr201Sections: DidacticSection[] = [
  {
    kind: 'summary',
    markdown:
      '## Qué cambia\n\n' +
      'Reemplaza la máquina de estados imperativa de checkout (`CheckoutMachine`, clase con estado ' +
      'mutable) por un reducer puro (`checkoutReducer` + `useReducer`), y convierte ' +
      '`CheckoutValidator` (clase) en funciones puras de validación. Sin cambios de comportamiento ' +
      'visible para el usuario.\n\n' +
      '**Por qué importa:** es un refactor grande (243 líneas agregadas, 273 eliminadas) que toca el ' +
      'flujo central de compra. El riesgo no es "qué se ve distinto" sino "qué transición dejó de ' +
      'cubrirse" al migrar la lógica.\n\n' +
      '**Qué revisar:**\n' +
      '- El reducer no cubre explícitamente `shipping -> payment` con eventos distintos de ' +
      '`CONTINUE`, ni la transición `payment -> confirmation` (ver comentario de @sfontaine).\n' +
      '- Que `validateCheckout` combine los mismos casos que antes cubrían ' +
      '`CheckoutValidator.validateCart/validateShipping/validatePayment` por separado.',
  },
  {
    kind: 'architecture',
    markdown:
      'El componente `CheckoutPage` pasa de orquestar una instancia de clase (`CheckoutMachine`) a ' +
      'despachar eventos contra un reducer puro. `checkout-validation.ts` deja de depender de estado ' +
      'mutable (`this.errors`) y expone funciones independientes por paso.',
    mermaid:
      'C4Component\n' +
      '  title Checkout (web) - antes y despues del refactor a reducer\n' +
      '  Container_Boundary(checkout, "Modulo checkout") {\n' +
      '    Component(page, "CheckoutPage", "Componente React", "Orquesta el flujo de compra")\n' +
      '    Component(machineOld, "CheckoutMachine (ELIMINADO)", "Clase con estado mutable", "Logica de transicion imperativa, ~130 lineas")\n' +
      '    Component(reducerNew, "checkoutReducer (NUEVO)", "Funcion pura", "Reemplaza a CheckoutMachine")\n' +
      '    Component(validation, "checkout-validation", "Funciones puras", "Antes: clase CheckoutValidator con estado mutable")\n' +
      '  }\n' +
      '  Rel(page, machineOld, "usaba (antes del refactor)")\n' +
      '  Rel(page, reducerNew, "usa useReducer (despues del refactor)")\n' +
      '  Rel(page, validation, "valida con validateCheckout")\n',
  },
]

/** Secciones enriquecidas por `prId` (`owner/name#number`, igual formato que `PullRequestDetail.id`). */
export const richDidacticSections: Record<string, DidacticSection[]> = {
  'shopwave/api#482': pr482Sections,
  'shopwave/api#479': pr479Sections,
  'shopwave/web#201': pr201Sections,
}

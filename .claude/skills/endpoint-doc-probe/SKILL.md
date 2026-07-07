---
name: endpoint-doc-probe
description: Documenta endpoints HTTP nuevos o modificados que introduce un PR y genera una forma lista de probarlos en local (curl, HTTPie y archivo .http). Úsalo cuando un PR agregue o cambie rutas, handlers, controladores o esquemas de API.
---

# Skill: Documentación + probador local de endpoints

Detecta endpoints HTTP nuevos/cambiados en un diff y produce (a) su documentación y
(b) una forma inmediata de **probarlos en local**.

## Cuándo usar
El PR agrega/modifica una ruta HTTP: definición de router, decorador/anotación de ruta,
handler, controlador, o esquema OpenAPI/GraphQL. Cubre frameworks comunes (Express,
Fastify, NestJS, FastAPI, Flask, Django REST, Spring, Rails, etc.).

## Qué extraer por endpoint
- **Método + ruta** (con path params marcados, p. ej. `GET /users/:id`).
- **Autenticación** requerida (header/token) si se infiere del código.
- **Query params / path params**: nombre, tipo, requerido/opcional.
- **Request body**: forma/esquema con tipos (deriva del DTO/validador/serializer del código).
- **Respuestas**: códigos y forma del payload de éxito y de error.
- **Efectos**: qué lee/escribe (tabla, servicio, cola) — útil para entender el impacto.

## Salida
Para cada endpoint, un bloque así:

### `POST /api/users` — Crear usuario
Crea un usuario y encola un email de bienvenida.

| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| `email` | string | sí | único |
| `name` | string | sí | |
| `role` | enum(`admin`,`member`) | no | default `member` |

**Respuestas:** `201` usuario creado · `409` email duplicado · `422` validación.

**Probar en local (curl):**
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"email":"a@b.com","name":"Ada"}'
```

**Probar en local (.http):**
```http
POST http://localhost:3000/api/users
Content-Type: application/json
Authorization: Bearer {{token}}

{ "email": "a@b.com", "name": "Ada" }
```

## Reglas
- Deriva los valores de ejemplo del esquema real del código; márcalos como ejemplos, no reales.
- Usa el puerto/base path que aparezca en la config del repo si lo encuentras; si no,
  usa `http://localhost:3000` y **avisa** que es un supuesto.
- Nunca incluyas secretos reales: usa placeholders (`$TOKEN`, `{{token}}`).
- Si el endpoint requiere datos previos (p. ej. un ID existente), indícalo en las notas.

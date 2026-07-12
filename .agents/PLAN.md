# PLAN — proj_minerva

> Sandbox del plan de la tarea actual. Se actualiza al empezar/terminar cada fase.
> Control de tareas y bitácora: `TASKS.md`. Estrategia multi-agente: `WORKFLOW.md`.

## Iteración actual (2026-07-12): F14 — Modo de acceso a GitHub: OAuth o GitHub CLI (v0.5.0)

> Rama `feature/github-access-mode` (desde `main`, post-merge de F13/v0.4.2).
> Pedido de Edilson (2026-07-12): clientes enterprise no pueden usar Minerva porque
> los admins de sus orgs activan las *OAuth app access restrictions* (la OAuth App de
> Minerva no está aprobada), pero el CLI `gh` SÍ funciona en esas orgs. Se agrega un
> modo de acceso configurable en Settings: `oauth` (actual) o `gh-cli` (nuevo).
> Plan aprobado en `~/.claude/plans/abstract-stirring-thompson.md` (copia fiel abajo).

### Mecanismo decidido (con verificación empírica)

**Puente de token**: en modo `gh-cli` la autenticación se delega a `gh` (probe +
`gh auth token` vía `execFile`), pero los datos siguen fluyendo por el
`RealGithubService` actual (Octokit GraphQL/REST/tarball) usando ese token.

Verificado 2026-07-12 con curl crudo (= exactamente lo que hace Octokit): el token de
`gh auth token` accede a repos privados de org (`clevr-technologies`), ejecuta la
query GraphQL de Minerva (`search is:pr involves:@me`) y descarga tarballs (302 con
URL firmada). GitHub autoriza por TOKEN + app emisora, nunca por cliente HTTP; la app
"GitHub CLI" está aprobada en las orgs de los clientes (premisa del pedido), así que
su token hereda ese acceso. Scopes de gh (`repo, read:org, ...`) ⊇ `repo read:user`.

Referencia de patrón estudiada: t3code (`apps/server/src/sourceControl/GitHubCli.ts` +
`GitHubSourceControlProvider.ts`) — probe con `gh auth status --json hosts`, errores
tipados unavailable/auth/not-found, installHint. Adoptamos las ideas de probe y
mensajes accionables; NO su capa provider (nuestro mecanismo es token bridge).

### Decisiones de diseño

1. **AuthManager conoce el modo** (lee `settingsStore.getGithubAccessMode()` por
   llamada) y delega a `ghCliAuth` en modo gh. La factory `createGithubService()`
   conserva `() => authManager.getToken()` → cambiar de modo NO recrea servicio ni
   prWatcher; el renderer conserva un solo contrato `auth:*`.
2. **`AuthStatus.mode`** requerido + estados nuevos `cli_unavailable` /
   `cli_unauthenticated`; `signed_in` se reutiliza para gh autenticado.
3. **signOut en modo gh no existe** (no-op; JAMÁS `gh auth logout` — la sesión del
   CLI es del usuario). Salida = cambiar a OAuth en Settings.
4. **Retry-401**: decorador `withGhCliTokenRetry(service)` — ante error de auth en
   modo gh, re-obtiene token de gh UNA vez y reintenta (cubre rotación y arranque en
   frío). Passthrough puro en oauth.
5. **Seguridad**: `execFile` sin shell, ruta absoluta (`resolveCliPath('gh')`), args
   literales `['auth','token','--hostname', GH_HOSTNAME]`, env crudo (NO
   `buildSanitizedSpawnEnv` — ese saneado borra GH_TOKEN/GITHUB_TOKEN y es solo para
   CLIs de IA). Token de gh solo en memoria de main; nunca en AuthStatus,
   settings.json, logs ni renderer.
6. **Alcance**: solo `github.com` en 0.5.0 (GHES: hostname parametrizable vía
   constante `GH_HOSTNAME`, sin UI). `MINERVA_MOCK=1` sigue teniendo precedencia.

### Fases y delegación

- **Ola 1 (Sonnet): T67–T70** — lado main completo (tipos, settings store, canal
  IPC, `gh-cli-auth.ts`, delegación en AuthManager, retry-401, factory) + unit tests.
- **Ola 2 (Sonnet): T71–T72** — renderer (use-auth polling declarativo, TitleBar,
  Sidebar, use-settings, `GithubAccessSection`, SettingsModal). Depende de la ola 1.
- **T73 (orquestador)**: suite `smoke-github-mode.mjs`, verificación integral
  (typecheck/lint/test + smokes + captura mirada + manual con gh real), docs
  (README/CLAUDE.md/TASKS.md) y bump a 0.5.0.

### Riesgos / casos borde vigilados

- Los setters existentes del settings store construyen el objeto persistido a mano:
  deben arrastrar `githubAccessMode` o lo borran en silencio.
- Prefijo "No autenticado" es marker en `pr-watcher.ts:53` y `Sidebar.tsx:18` —
  conservarlo en los mensajes nuevos.
- `GH_TOKEN` env inválido ⇒ `/user` 401 ⇒ `cli_unauthenticated` sin loop (reintento
  único).
- gh lento/timeout en arranque ⇒ estado degradado, arranque no bloqueado >3s.
- e2e con `MINERVA_MOCK=1` no ejercita gh en la ruta de datos: la suite verifica
  UI + persistencia + rama de auth; el puente real se verifica manual con gh local.

import type { AiProviderId } from '../../../shared/ai-providers'

export type CliProvider = AiProviderId

export interface CliMeta {
  binary: string
  loginCmd: string
  /** URL oficial de instalación/setup del CLI (verificada 2026-07-11, ver `.agents/PLAN.md`), enlace clicable vía `external-link-guard`. */
  installUrl: string
}

/**
 * Metadata puramente de UI (comando + link de instalación a mostrar) de los
 * TRES CLIs de IA que Minerva soporta (T60): la lógica real de detección
 * vive en `main` (T27; OpenCode en T57). Módulo separado de
 * `../components/settings/CliLoginGuide.tsx` (que la consumía sola hasta
 * T60) para que `../components/didactic/NoCliProvidersCard.tsx` reuse la
 * MISMA tabla sin duplicar URLs ni forzar a un archivo de componente a
 * exportar algo que no es un componente (evita el warning de
 * `react-refresh/only-export-components`).
 */
export const CLI_META: Record<CliProvider, CliMeta> = {
  'claude-code': {
    binary: 'claude',
    loginCmd: 'claude login',
    installUrl: 'https://code.claude.com/docs/en/setup',
  },
  codex: {
    binary: 'codex',
    loginCmd: 'codex login',
    installUrl: 'https://developers.openai.com/codex/cli/',
  },
  opencode: {
    binary: 'opencode',
    loginCmd: 'opencode auth login',
    installUrl: 'https://opencode.ai/docs/',
  },
}

# Evidencia — catálogo de modelos dinámico (v0.8.1)

Rama HUÉRFANA de solo evidencia, para embeber capturas en el PR sin meter los MB
en la historia del código. Se borra al cerrar el PR.

Capturas generadas con la suite e2e, mismo test en ambos casos:

```bash
npm run build
xvfb-run -a -s "-screen 0 1600x1000x24" npx playwright test settings.spec.ts -g "modal F12"
# la captura queda en test-results/settings-modal*/settings-modal-activacion.png
```

| Archivo | Rama / commit | Qué muestra |
|---|---|---|
| `antes-catalogo-curado.png` | `main` @ 6730943 | Tab de Claude Code con el catálogo CURADO: Fable 5, Opus 4.8, Sonnet 5, Haiku 4.5. Opus 5 no aparece aunque el CLI ya lo ofrece. |
| `despues-catalogo-dinamico.png` | `fix/dynamic-model-catalog-and-opencode-leak` @ 4b19320 | El mismo tab con el catálogo DINÁMICO que reporta `claude` 2.1.220: `opus[1m]` (Opus 5, activo), `claude-fable-5[1m]`, `sonnet`, `haiku`, con su selector de razonamiento. |

Ambas sobre la misma máquina (Arch, Xvfb 1600x1000x24) y el mismo `claude` 2.1.220.

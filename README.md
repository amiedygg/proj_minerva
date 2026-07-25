# Evidencia visual — F16 (layout responsivo para tiling, v0.6.3)

Rama **huérfana** (sin historia común con `main`): existe solo para alojar las
capturas que acompañan al PR de `fix/responsive-tiling-layout`, sin meter ~8 MB
de PNGs en la historia del código. Se puede borrar cuando el PR se cierre.

## `e2e/` — artefactos de la suite Playwright (24 imágenes)

Una captura por test que adjunta evidencia, de la corrida COMPLETA en verde
(**35/35**) sobre el código de la rama:

```
npm run build
xvfb-run -a -s "-screen 0 1600x1000x24" npx playwright test
```

Cada test las adjunta con `attachScreenshot()` (`e2e/fixtures.ts`) y quedan en
`test-results/`. Las 7 de F16 son:

| archivo | test |
|---|---|
| `shell-1920x1080.png` · `shell-960x1080.png` · `shell-1920x540.png` · `shell-960x540.png` | `responsive.spec.ts` — el shell en los 4 tilings |
| `drawer-lista-abierto.png` | `responsive.spec.ts` — la lista de PRs como drawer |
| `settings-960x540.png` · `settings-1920x540.png` | `responsive.spec.ts` — Settings alcanzable con la ventana tileada |

Las otras 17 son la evidencia de las suites que ya existían (didáctica, diff,
comentarios, cloud, staleness, github-mode, empaquetado, …): se incluyen porque
demuestran que el cambio de layout **no rompió nada** de lo anterior.

## `antes-despues/` — sonda de tiling (26 imágenes)

Capturas de la app CONSTRUIDA con mocks (`MINERVA_MOCK=1 MINERVA_MOCK_AI=1`)
bajo Xvfb, redimensionando el viewport por CDP con
`Emulation.setDeviceMetricsOverride` a los tamaños reales de un tiling de 1080p
(ventana completa, mitad vertical, mitad horizontal, un cuarto) en tres estados:
conversación, archivos y settings.

- `antes--*` → código de `main` (v0.6.2).
- `despues--*` → código de esta rama (v0.6.3), incluida la ventana didáctica
  desacoplada a 520x700 (su nuevo mínimo).

Los pares comparables tienen el mismo sufijo, p. ej.
`antes--0960x0540-quarter--files.png` ⇄ `despues--0960x0540-quarter--files.png`.

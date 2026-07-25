# Evidencia visual — F17 (auto-updater, v0.7.0)

Rama **huérfana** (sin historia común con `main`): existe solo para alojar las
capturas que acompañan al PR de `feature/auto-updater`
([#20](https://github.com/amiedygg/proj_minerva/pull/20)), sin meter ~4.8 MB de
PNGs en la historia del código. Se puede borrar cuando el PR se cierre.

## Provenance

Todas las imágenes salen de la corrida COMPLETA en verde (**38/38**) de la suite
Playwright sobre el commit [`b75e118`](https://github.com/amiedygg/proj_minerva/commit/b75e118)
de `feature/auto-updater`:

```
npm run build
xvfb-run -a -s "-screen 0 1600x1000x24" npx playwright test
```

Cada test las adjunta con `attachScreenshot()` (`e2e/fixtures.ts`) y quedan en
`test-results/`. **Ojo:** Playwright borra ese directorio al empezar cada
corrida, así que hay que copiar los PNGs antes de volver a correr.

La app corre con `MINERVA_MOCK=1` (universo mock "shopwave") y `MINERVA_MOCK_AI=1`,
así que los PRs y el análisis que se ven son fixtures deterministas, no datos
reales. **La versión que muestran las capturas es `43.0.0`**: sin empaquetar,
`app.getVersion()` devuelve la versión de Electron, no la de Minerva — el
binario empaquetado sí reporta la real (`0.7.0`), y eso lo sella
`packaged.spec.ts`.

## `e2e/` — los 5 estados del auto-updater (F17)

Generados por `updater.spec.ts` con el mock guionado `MINERVA_MOCK_UPDATER`
(`src/main/updater/mock-updater.ts`), que es LA vía de ejercitar esta UI en e2e:
la suite corre sin empaquetar y ahí el updater real queda `disabled` a
propósito.

| archivo | estado |
|---|---|
| `updater-available.png` | hay versión nueva: "Disponible vX.Y.Z" + CTA "Descargar (130 MB)". La descarga **nunca** arranca sola |
| `updater-downloading.png` | descarga en curso, con barra de progreso y porcentaje |
| `updater-downloaded.png` | "Se instalará al salir de Minerva" como mensaje principal; "Reiniciar ahora" es un link subordinado, no un CTA |
| `updater-notify.png` | instalación que **no** puede auto-actualizarse (macOS sin firmar, AppImage no escribible, `linux-unpacked`): explica el porqué y ofrece "Ver la release". **Nunca** un botón de descarga |
| `updater-responsive-960x540.png` | la sección alcanzable con la ventana tileada a un cuarto de pantalla (F16) |

## `e2e/` — el resto (24 imágenes)

Evidencia de las suites que ya existían (didáctica, diff, comentarios, cloud,
staleness, github-mode, responsive, empaquetado…). Se incluyen porque
demuestran que el auto-updater **no rompió nada** de lo anterior: son la misma
corrida 38/38.

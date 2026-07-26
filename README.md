# Evidencia — F18 (gh como único modo de acceso + selector de cuenta)

Rama **huérfana**: existe solo para alojar las capturas embebidas en el PR de
`feature/gh-multi-account`, sin meter megas de PNG en la historia del código.
Se borra al cerrar ese PR.

Generadas sobre el commit `2eaf297` con la suite e2e:

```bash
npm run build
xvfb-run -a -s "-screen 0 1600x1000x24" npx playwright test e2e/github-mode.spec.ts
```

Los PNG salen de `test-results/` (Playwright adjunta uno por test) y se copian
ANTES de volver a correr la suite, que limpia ese directorio al arrancar.

| archivo | qué muestra |
|---|---|
| `selector-cuenta.png` | Sección "Acceso a GitHub" en modo `gh-cli`: guía de instalación, estado del probe y el selector de cuenta con "Cuenta activa de gh" marcada por defecto. Las cuentas listadas son las reales de la máquina que corrió la suite — ese spec ejercita el probe REAL de `gh`, no un mock. |
| `cuenta-huerfana.png` | Una cuenta elegida que ya no está en `gh` (el spec usa `minerva-e2e-cuenta-inexistente`): la card la muestra con el badge "Ya no está en gh" en vez de dejar una selección invisible, y el TitleBar cae al chip `gh auth login`. |
| `oauth-escape-hatch.png` | Con `MINERVA_GITHUB_ACCESS=oauth`, la sección explica que el modo lo fuerza el entorno y no ofrece controles de `gh` que no aplicarían. |

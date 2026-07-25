<!--
  Plantilla de PR de proj_minerva. Borrá las secciones que de verdad no
  apliquen (mejor una sección borrada a propósito que una llena de "N/A").
  Los comentarios como este no se ven en el PR renderizado.
-->

## Resumen

<!--
  Dos o tres líneas: QUÉ cambia y POR QUÉ, en lenguaje de producto.
  Quien revisa tiene que entender el impacto sin abrir el diff.
  Principio rector del proyecto: el PR debe ENSEÑAR el cambio, no solo mostrarlo.
-->

## Cambios realizados

<!--
  Lista concreta por área. Mencioná el archivo/módulo cuando ayude a ubicarse.
  Agrupá por proceso, que es como está partida la app (ver CLAUDE.md).
-->

- **main** —
- **preload / contrato IPC** —
- **renderer** —
- **infra / build / CI** —
- **docs** —

## Capturas

<!--
  OBLIGATORIO si el PR toca la UI. Un PR de UI sin imágenes no se revisa:
  el DOM puede decir "visible" mientras el usuario ve un panel vacío.

  De dónde sacarlas:
  - La suite Playwright ya deja un PNG por test en `test-results/` (ojo: los
    borra al empezar cada corrida — copialos antes de volver a correr).
  - App corriendo en dev: `scripts/screenshot-app.sh <salida.png> [patrón-título]`.

  CÓMO SUBIRLAS sin arrastrarlas a mano por la web (patrón de F16/PR #19):
  una rama HUÉRFANA de evidencia con los PNGs, embebidos por raw.githubusercontent.
  Así también funciona desde la terminal, y los MB no entran a la historia
  del código:

      git switch --orphan evidence-<slug>
      # copiar los PNGs, escribir un README con la provenance
      git add -A && git commit -m "docs: evidencia visual de <slug>"
      git push -u origin evidence-<slug>

  y en el cuerpo del PR:

      <img src="https://raw.githubusercontent.com/amiedygg/proj_minerva/evidence-<slug>/e2e/<archivo>.png" width="430">

  La rama se borra al cerrar el PR. El README de esa rama debe decir con qué
  comando se generaron las capturas y sobre qué commit.

  Minerva se usa TILEADA (media pantalla, un cuarto), así que si el cambio
  toca layout, incluí al menos un tamaño tileado además del normal (F16).
-->

|                            | Antes | Después |
| -------------------------- | ----- | ------- |
| <!-- pantalla / estado --> |       |         |

**¿Toca UI?** <!-- Sí / No. Si es Sí y no hay capturas arriba, explicá por qué. -->

## Decisiones importantes (scope)

<!--
  Lo que define el alcance de este PR. Para cada decisión: qué se eligió,
  qué se descartó y POR QUÉ. Esto es lo que evita re-litigar lo mismo en
  tres meses — y lo que después se copia a la bitácora de `.agents/TASKS.md`.
-->

| Decisión | Alternativa descartada | Motivo |
| -------- | ---------------------- | ------ |
|          |                        |        |

### Fuera de alcance (decidido, no olvidado)

<!--
  Lo que conscientemente NO entra. Un recorte explícito es una decisión;
  un recorte silencioso parece un olvido.
-->

-

## Verificación

<!-- Marcá lo que CORRISTE de verdad. Un check sin correr es peor que un check vacío. -->

- [ ] `npm run verify` (typecheck + lint + tests) en verde
- [ ] `npm run test:e2e` en verde <!-- sin sesión gráfica: npm run build && xvfb-run -a -s "-screen 0 1600x1000x24" npx playwright test -->
- [ ] Capturas **miradas**, no solo generadas (si toca UI)
- [ ] Ejercitado tileado a 960×540 (si toca layout)
- [ ] Probado contra datos reales, no solo mocks <!-- si aplica: PR real de GitHub, proveedor de IA logueado… -->

## Frontera de seguridad

<!-- Ver CLAUDE.md § Frontera de seguridad. Si el PR no toca nada de esto, borrá la sección. -->

- [ ] Ningún secreto cruza al renderer (tokens y sesiones viven solo en `main`)
- [ ] Canales IPC nuevos: tipados en `src/shared/` **y** con validator en `src/main/ipc/validators.ts`
- [ ] Eventos push nuevos: método concreto en el preload, canal hardcodeado (nunca `on(channel, cb)` genérico)
- [ ] El contenido no confiable (diffs, títulos, comentarios de PRs, feeds externos) se trata como tal al construir prompts y al renderizar
- [ ] El snapshot del PR sigue siendo solo-lectura para las herramientas de IA

## Breaking changes / migración

<!--
  ¿Rompe algo para quien ya tiene Minerva instalada, o para settings/cache
  ya persistidos? Decí exactamente qué tiene que hacer esa persona.
  Si no rompe nada, poné "Ninguno".
-->

## Referencias

- Tareas: <!-- T##–T## de `.agents/TASKS.md` -->
- Plan: <!-- sección de `.agents/PLAN.md` -->
- Issues:

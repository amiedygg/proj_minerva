#!/bin/bash
# Captura la ventana de Minerva (o la didáctica desacoplada) a un PNG, para
# VERIFICACIÓN VISUAL en las pruebas e2e — lección T15-bis: los checks
# geométricos por CDP (getBoundingClientRect) ignoran el clipping y dieron
# por bueno un visor que el usuario veía vacío. Toda verificación de UI debe
# terminar MIRANDO una captura.
#
# Mismo mecanismo que `omarchy-capture-screenshot` (hyprctl + grim), pero no
# interactivo (sin slurp) y apuntando a la ventana por título.
#
# Uso: scripts/screenshot-app.sh [salida.png] [patrón-de-título]
#   patrón por defecto: "Minerva" (la principal); usar "Análisis" para la
#   ventana didáctica desacoplada.
set -euo pipefail

OUT="${1:-/tmp/minerva-$(date +%H%M%S).png}"
TITLE_PATTERN="${2:-Minerva}"

GEO=$(hyprctl clients -j | jq -r --arg t "$TITLE_PATTERN" \
  '.[] | select(.class == "proj-minerva" and (.title | test($t))) | "\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"' | head -1)

if [[ -z $GEO ]]; then
  echo "No se encontró ventana proj-minerva con título ~ '$TITLE_PATTERN'" >&2
  exit 1
fi

grim -g "$GEO" "$OUT"
echo "$OUT"

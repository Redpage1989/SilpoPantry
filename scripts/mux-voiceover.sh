#!/usr/bin/env bash
# Змонтувати доріжку озвучки в презентаційне відео.
#
#   ./scripts/mux-voiceover.sh <аудіофайл> [вихідний.mp4]
#
# Робить три речі, яких не робить просте склеювання:
#   · вирівнює гучність до -16 LUFS (стандарт для YouTube), щоб голос не був
#     то тихим, то гучним — типова біда запису з телефона чи гарнітури;
#   · якщо голос довший за відео — тримає останній кадр, а не обрізає фразу;
#   · якщо коротший — доповнює тишею до кінця відео.
set -euo pipefail

AUDIO="${1:?вкажіть аудіофайл: ./scripts/mux-voiceover.sh голос.m4a}"
VIDEO="tutorial-out/presentation.mp4"
OUT="${2:-tutorial-out/presentation-voiced.mp4}"

[ -f "$VIDEO" ] || { echo "Немає $VIDEO — спершу npx tsx scripts/record-presentation.ts"; exit 1; }
[ -f "$AUDIO" ] || { echo "Немає файлу: $AUDIO"; exit 1; }

dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
VD=$(dur "$VIDEO"); AD=$(dur "$AUDIO")
printf "відео: %.1f с · голос: %.1f с\n" "$VD" "$AD"

# Голос довший — дотягуємо відео останнім кадром, щоб не обірвати фразу.
PAD=$(python3 -c "print(max(0, $AD - $VD))")
VFILTER=""
if [ "$(python3 -c "print(1 if $PAD > 0.3 else 0)")" = "1" ]; then
  printf "голос довший на %.1f с — тримаємо останній кадр\n" "$PAD"
  VFILTER="-vf tpad=stop_mode=clone:stop_duration=$PAD"
fi

ffmpeg -y -v warning -stats \
  -i "$VIDEO" -i "$AUDIO" \
  $VFILTER \
  -filter:a "loudnorm=I=-16:TP=-1.5:LRA=11,apad" \
  -map 0:v:0 -map 1:a:0 \
  -c:v libx264 -crf 21 -preset slow -pix_fmt yuv420p \
  -c:a aac -b:a 192k -ar 48000 \
  -shortest -movflags +faststart \
  "$OUT"

printf "\n✅ %s · %.1f МБ · %.0f с\n" "$OUT" "$(python3 -c "import os;print(os.path.getsize('$OUT')/1048576)")" "$(dur "$OUT")"

#!/usr/bin/env bash
# encode.sh FRAMES_DIR OUT_DIR [POSTER_FRAME=0] [VP9_CRF=38] [X264_CRF=27]
# Needs an ffmpeg with libvpx-vp9 and libx264 (FFMPEG=/path/to/ffmpeg to override).
set -euo pipefail
FF=${FFMPEG:-ffmpeg}
IN=$(cd "$1" && pwd); mkdir -p "$2"; OUT=$(cd "$2" && pwd)
PF=$(printf %04d "${3:-0}"); VCRF=${4:-38}; XCRF=${5:-27}
cd "$OUT"
common=(-loglevel error -y -framerate 30 -i "$IN/f%04d.png" -pix_fmt yuv420p -g 300 -an)   # ~3 keyframes per 30 s loop
"$FF" "${common[@]}" -c:v libvpx-vp9 -b:v 0 -crf "$VCRF" -row-mt 1 -tile-columns 2 -deadline good -cpu-used 1 -pass 1 -passlogfile vp9 -f null /dev/null
"$FF" "${common[@]}" -c:v libvpx-vp9 -b:v 0 -crf "$VCRF" -row-mt 1 -tile-columns 2 -deadline good -cpu-used 1 -pass 2 -passlogfile vp9 dab-bg.webm
"$FF" "${common[@]}" -c:v libx264 -preset veryslow -tune film -crf "$XCRF" -profile:v high -level 4.1 -movflags +faststart dab-bg.mp4
"$FF" -loglevel error -y -i "$IN/f$PF.png" -vf scale=1600:-2 -q:v 4 poster.jpg
rm -f vp9-0.log
ls -l dab-bg.webm dab-bg.mp4 poster.jpg

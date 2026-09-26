#!/usr/bin/env bash
# assemble.sh —— 剪辑室：帧序列 + audio.wav → final.mp4（无声版：-c:v copy -an 抽流）
set -euo pipefail
cd "$(dirname "$0")"

N=$(ls out/f_*.png 2>/dev/null | wc -l | tr -d ' ')
EXP=$(node -e 'const t=require("./timeline.json");console.log(t.chapters.reduce((a,c)=>a+Math.round(c.dur*t.fps),0))')
[ "${N:-0}" -ge "$EXP" ] || { echo "帧数不足（$N/$EXP）：先运行 node render.mjs"; exit 1; }

if [ -f audio.wav ]; then
  ffmpeg -y -v warning -framerate "$(node -p require('./timeline.json').fps)" \
    -start_number 1 -i out/f_%05d.png -i audio.wav \
    -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p \
    -c:a aac -b:a 192k -movflags +faststart -shortest final.mp4
else
  ffmpeg -y -v warning -framerate "$(node -p require('./timeline.json').fps)" \
    -start_number 1 -i out/f_%05d.png \
    -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -movflags +faststart final.mp4
fi

echo "== 成片 =="
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 final.mp4
echo "== 质检三板斧 =="
echo "① 旁白窗口 vs 空隙（差应 ≥8dB）："
ffmpeg -hide_banner -ss 2.5 -t 8 -i final.mp4 -af volumedetect -f null - 2>&1 | grep mean_volume
ffmpeg -hide_banner -ss 21.5 -t 2 -i final.mp4 -af volumedetect -f null - 2>&1 | grep mean_volume
echo "② 关键时刻质检条（read_image 目检 out/qa_sheet.png）："
ffmpeg -y -v error -i final.mp4 -vf "select='not(mod(n\,150))',tile=4x3,scale=480:270" -frames:v 1 out/qa_sheet.png || true
echo "③ 交付后记得清理：rm -f out/f_*.png && rm -rf .ud"

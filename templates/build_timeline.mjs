#!/usr/bin/env node
/* build_timeline.mjs —— 旁白 TTS 逐句合成 + 实测时长 + 生成变长章节时间轴
 * 输入：narration/narr.json  { segments:[{id,ch,voice,role,text}] }
 *       可选 narration/mine/nXX.{mp3,m4a,wav}（真人配音，优先于 TTS）
 * 输出：narration/wav/nXX.wav（44.1k 立体声 16bit）+ timeline.json
 * 规则：章内顺序排句（gap 1.3s、章首 1.6s、章尾 2.6s）；
 *       章时长 = max(旁白排布需要, MINDUR[章])
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const narr = JSON.parse(fs.readFileSync(path.join(ROOT, 'narr.json')));
const MINDUR = { 1: 18, 2: 20, 3: 20, 4: 20, 5: 20, 6: 26 };   // 每章最短视觉时长（秒）
/* 角色声线与变调（macOS say；先测声音是否真可用，没装的会产出 0.01s 静音！）
 * k≠1 时 ffmpeg 链：aresample=44100,asetrate=44100*k,aresample=44100,atempo=1/k
 * ——先归一到 44.1k 再变调，否则 22.05k 输入会被加速一倍（时长减半） */
const VOICE = { '旁白': { v: 'Tingting', r: 185, k: 1.0 } };

function probe(f) {
  return parseFloat(execFileSync('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]).toString());
}
function synth(seg) {
  const wav = path.join(ROOT, 'wav', `${seg.id}.wav`);
  const mine = ['mp3', 'm4a', 'wav'].map((e) => path.join(ROOT, 'mine', `${seg.id}.${e}`))
    .find((p) => fs.existsSync(p));
  if (mine) {                                   // 真人录音优先
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', mine, '-ar', '44100', '-ac', '2', wav]);
    return probe(wav);
  }
  const cfg = VOICE[seg.role] || VOICE['旁白'];
  const aiff = path.join(ROOT, `${seg.id}.aiff`);
  execFileSync('say', ['-v', cfg.v, '-r', String(cfg.r), '-o', aiff, seg.text]);
  const args = ['-y', '-v', 'error', '-i', aiff];
  if (cfg.k !== 1) {
    args.push('-af', `aresample=44100,asetrate=${Math.round(44100 * cfg.k)},aresample=44100,atempo=${(1 / cfg.k).toFixed(4)}`);
  }
  args.push('-ar', '44100', '-ac', '2', wav);
  execFileSync('ffmpeg', args);
  const dur = probe(wav);
  if (dur < 0.1) throw new Error(`${seg.id} 疑似静音（voice ${cfg.v} 未安装？）`);
  return dur;
}

const segs = narr.segments.map((s) => {
  const dur = +synth(s).toFixed(2);
  console.log(`${s.id} ch${s.ch} ${dur}s`);
  return { ...s, dur };
});

const chapters = [];
let cursor = 0;
const ids = [...new Set(segs.map((s) => s.ch))];
for (const ch of ids) {
  let t = 1.6;
  const cues = [];
  for (const s of segs.filter((x) => x.ch === ch)) {
    cues.push({ id: s.id, role: s.role, text: s.text, start: +t.toFixed(2), end: +(t + s.dur).toFixed(2), dur: s.dur });
    t += s.dur + 1.3;
  }
  const dur = +Math.max(t - 1.3 + 2.6, MINDUR[ch] || 18).toFixed(2);
  chapters.push({ id: ch, start: +cursor.toFixed(2), dur, cues });
  cursor += dur;
}
fs.writeFileSync(path.join(ROOT, '..', 'timeline.json'),
  JSON.stringify({ fps: 12, total: +cursor.toFixed(2), chapters }, null, 2));

/* 顺带产出旁白 SRT（绝对时间码，配音/剪辑打点用） */
const fmt = (s) => {
  const p = (n, w) => String(n).padStart(w, '0');
  return `${p(Math.floor(s / 3600), 2)}:${p(Math.floor(s % 3600 / 60), 2)}:${p(Math.floor(s % 60), 2)},${p(Math.round((s % 1) * 1000), 3)}`;
};
let srt = '', i = 0;
for (const c of chapters) for (const q of c.cues) {
  srt += ++i + '\n' + fmt(c.start + q.start) + ' --> ' + fmt(c.start + q.end) + '\n' + q.text + '\n\n';
}
fs.writeFileSync(path.join(ROOT, '..', 'narration.srt'), srt);
console.log(`total ${cursor.toFixed(1)}s; timeline.json + narration.srt written`);

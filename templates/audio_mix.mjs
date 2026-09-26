#!/usr/bin/env node
/* audio_mix.mjs —— 声音设计骨架：程序化配乐 + 音效 cue + 旁白混入 + ducking → audio.wav
 * 配乐/音效部分按题材自行创作（这里给出常用合成件与混音骨架）
 * ⚠️ readWav 的 bitsPerSample 在 fmt 块 off+22（写成 off+24 会读到下一 chunk 的 ID，
 *    解析出荒谬值 → 每条旁白只剩几百个采样 → 旁白整段静默丢失，血泪教训）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tl = JSON.parse(fs.readFileSync(path.join(ROOT, 'timeline.json')));
const SR = 44100;
const TOTAL = tl.total + 0.3;
const NS = Math.floor(SR * TOTAL);
const L = new Float32Array(NS);
const R = new Float32Array(NS);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(1234);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const ch = (id) => tl.chapters.find((c) => c.id === id);
const abs = (chId, localT) => ch(chId).start + localT * ch(chId).dur;   // 局部t → 绝对秒

/* ---------- 常用合成件 ---------- */
function tone(pan, { start, dur, f, amp = 0.1, harm = [[1, 1]], atk = 0.01, dec = 3, vib = 0 }) {
  const i0 = Math.max(0, Math.floor(start * SR)), i1 = Math.min(NS, Math.floor((start + dur) * SR));
  const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
  for (let i = i0; i < i1; i++) {
    const t = i / SR - start;
    const env = (t < atk ? t / atk : Math.exp(-(t - atk) * dec)) * Math.max(0, Math.min(1, (dur - t) * 10));
    const ph = 2 * Math.PI * f * (1 + vib * Math.sin(2 * Math.PI * 5.5 * t)) * t;
    let s = 0;
    for (let k = 0; k < harm.length; k++) s += (harm[k][1] / (k + 1)) * Math.sin(ph * (k + 1));
    L[i] += s * env * amp * gl; R[i] += s * env * amp * gr;
  }
}
/* 噪声床（水声/风声/氛围）：lp 一阶低通系数，包络 atk/rel 秒 */
function noiseBed(start, end, { amp = 0.05, lp = 0.3, lfo = 0.25, atk = 1.5, rel = 2 } = {}) {
  const i0 = Math.floor(start * SR), i1 = Math.min(NS, Math.floor(end * SR));
  let low = 0;
  for (let i = i0; i < i1; i++) {
    const t = i / SR - start;
    low += ((rnd() * 2 - 1) - low) * lp;
    const env = Math.min(1, t / atk) * Math.min(1, (end - i / SR) / rel)
      * (0.85 + 0.15 * Math.sin(2 * Math.PI * lfo * t));
    L[i] += low * env * amp; R[i] += low * env * amp * 0.94;
  }
}
function kick(start, amp = 0.5, f0 = 110) { /* 低频冲击 */
  const i0 = Math.floor(start * SR), i1 = Math.min(NS, i0 + Math.floor(0.3 * SR));
  for (let i = i0; i < i1; i++) {
    const t = i / SR - start;
    L[i] += Math.sin(2 * Math.PI * (38 + f0 * Math.exp(-t * 24)) * t) * Math.exp(-t * 11) * amp;
    R[i] += L[i];
  }
}

/* ================= 配乐总谱（按题材创作，cue 用 abs(章, 局部t) 对位旁白） ================= */
/* 示例：低音铺底 + 稀疏钟琴 + 关键节拍点缀
tone(0.5, { start: 0, dur: TOTAL, f: mtof(33), amp: 0.04, harm: [[1,1],[2,0.4]], atk: 2, dec: 0.05 });
bell every abs(2,0.4) ...  */

/* ================= 旁白混入（ducking） ================= */
function readWav(file) {
  const buf = fs.readFileSync(file);
  let off = 12, chn = 2, bits = 16, dataOff = -1, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') { chn = buf.readUInt16LE(off + 10); bits = buf.readUInt16LE(off + 22); }
    else if (id === 'data') { dataOff = off + 8; dataLen = size; }
    off += 8 + size + (size % 2);
  }
  const n = Math.floor(dataLen / (bits / 8) / chn);
  const data = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    data[i * 2] = buf.readInt16LE(dataOff + i * 4) / 32768;
    data[i * 2 + 1] = chn === 2 ? buf.readInt16LE(dataOff + i * 4 + 2) / 32768 : data[i * 2];
  }
  return { n, data };
}
const duck = new Float32Array(NS).fill(1);
for (const c of tl.chapters) for (const q of c.cues) {
  const i0 = Math.floor((c.start + q.start - 0.25) * SR);
  const i1 = Math.min(NS, Math.floor((c.start + q.end + 0.25) * SR));
  const ramp = Math.floor(0.3 * SR);
  for (let i = Math.max(0, i0); i < i1; i++) {
    let g = 0.5;
    if (i < i0 + ramp) g = 1 - 0.5 * ((i - i0) / ramp);
    else if (i > i1 - ramp) g = 1 - 0.5 * ((i1 - i) / ramp);
    duck[i] = Math.min(duck[i], g);
  }
}
for (let i = 0; i < NS; i++) { L[i] *= duck[i]; R[i] *= duck[i]; }
let placed = 0;
for (const c of tl.chapters) for (const q of c.cues) {
  const file = path.join(ROOT, 'narration', 'wav', `${q.id}.wav`);
  if (!fs.existsSync(file)) continue;
  const w = readWav(file);
  let pk = 0;
  for (let i = 0; i < w.n * 2; i++) pk = Math.max(pk, Math.abs(w.data[i]));
  const g = 0.62 / (pk || 1);
  const off = Math.floor((c.start + q.start) * SR);
  for (let i = 0; i < w.n; i++) {
    const idx = off + i;
    if (idx >= NS) break;
    L[idx] += w.data[i * 2] * g; R[idx] += w.data[i * 2 + 1] * g;
  }
  placed++;
}

/* ---------- 母带：淡入出 + 软削波 + 归一化 + 写 WAV ---------- */
for (let i = 0; i < 1.2 * SR; i++) { const g = i / (1.2 * SR); L[i] *= g; R[i] *= g; }
for (let i = 0; i < 2.2 * SR; i++) { const idx = NS - 1 - i, g = i / (2.2 * SR); L[idx] *= g; R[idx] *= g; }
let peak = 0;
for (let i = 0; i < NS; i++) { L[i] = Math.tanh(L[i] * 1.25); R[i] = Math.tanh(R[i] * 1.25); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const norm = 0.9 / peak;
const pcm = Buffer.alloc(NS * 4);
for (let i = 0; i < NS; i++) {
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), i * 4);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22); header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(path.join(ROOT, 'audio.wav'), Buffer.concat([header, pcm]));
console.log(`audio.wav: ${(NS / SR).toFixed(1)}s, ${placed} narration lines`);
/* 验收提醒：旁白窗口 vs 空隙 volumedetect 应差 ≥8dB，否则旁白丢了 */

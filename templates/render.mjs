#!/usr/bin/env node
/* render.mjs —— 摄影机：原生 CDP 驱动无头 Chrome，按 timeline.json 变长章节逐帧渲染
 * （不用 puppeteer：与新版 Chrome 存在 "main frame too early" 兼容问题）
 *
 * 用法：
 *   node render.mjs                                   全部章节 → out/f_%05d.png（全局帧号）
 *   node render.mjs --render-ch --chapter N           单章全帧（帧号自动偏移，验收后重渲专用）
 *   node render.mjs --preview --chapter N [--at .1,.5,.9]   预览帧
 *
 * timeline.json 结构：{ fps, chapters:[{id, start, dur, cues:[...]}] }
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; // Linux: /usr/bin/chromium
const timeline = JSON.parse(fs.readFileSync(path.join(ROOT, 'timeline.json')));
const FPS = timeline.fps;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => (has(f) ? argv[argv.indexOf(f) + 1] : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 极简 CDP 客户端 ---------- */
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg);
      }
    };
  }
  send(method, params = {}, sessionId) {
    return new Promise((res, rej) => {
      const id = ++this.id;
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on(fn) { this.handlers.push(fn); }
  close() { try { this.ws.close(); } catch { /* noop */ } }
}

async function launchChrome(userDataDir) {
  const port = 9100 + Math.floor(Math.random() * 850);   // 随机端口：并发预览互不冲突
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,                    // 每进程独立 profile
    '--no-first-run', '--no-default-browser-check',
    '--no-sandbox',                                      // 外层沙箱内 Chrome 自带 sandbox 起不来
    '--disable-crash-reporter', '--disable-breakpad',
    '--disable-gpu', '--hide-scrollbars',
    '--window-size=1280,720', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return { proc, info: await r.json() };
    } catch { /* not yet */ }
    await sleep(150);
  }
  proc.kill('SIGKILL');
  throw new Error('Chrome devtools endpoint timeout\n' + stderr.slice(0, 500));
}

async function evalJS(cdp, sid, expression) {
  const out = await cdp.send('Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true }, sid);
  if (out.exceptionDetails) {
    throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || 'eval exception');
  }
  return out.result.value;
}

/* 每帧的页内表达式：设章/设t/设帧数 → redraw → 取 canvas 或错误 */
function frameExpr(chId, t, frames) {
  return `(()=>{window.__set(${chId},${t},${frames});redraw();` +
    `const e=window.__err;return e?('ERR '+e):document.querySelector('canvas').toDataURL('image/png');})()`;
}

async function main() {
  const mode = has('--preview') ? 'preview' : 'all';
  const only = val('--chapter') ? Number(val('--chapter')) : null;
  const outDir = path.join(ROOT, 'out');
  fs.mkdirSync(outDir, { recursive: true });

  const { proc, info } = await launchChrome(
    path.join(ROOT, '.ud', `${mode}_${only || 'main'}_${process.pid}`));
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => {                 // 必须等 open 再 send
    ws.onopen = res;
    ws.onerror = () => rej(new Error('CDP ws connect failed'));
    setTimeout(() => rej(new Error('CDP ws open timeout')), 10000);
  });
  const cdp = new CDP(ws);
  let exitCode = 0;
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const sid = sessionId;
    await cdp.send('Runtime.enable', {}, sid);
    await cdp.send('Page.enable', {}, sid);
    cdp.on((msg) => {
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        console.error('[page console]', (msg.params.args || []).map((a) => a.value ?? a.description).join(' '));
      }
    });
    await cdp.send('Page.navigate', { url: 'file://' + path.join(ROOT, 'index.html') }, sid);
    for (let i = 0; i < 200 && !(await evalJS(cdp, sid, 'window.__ready === true')); i++) await sleep(100);
    if (!(await evalJS(cdp, sid, 'window.__ready === true'))) {
      throw new Error('index.html 未就绪（检查 lib/p5.min.js 与脚本加载）');
    }

    const shoot = async (c, i, t, file) => {
      const r = await evalJS(cdp, sid, frameExpr(c.id, t, Math.round(c.dur * FPS)));
      if (typeof r === 'string' && r.startsWith('ERR ')) {
        throw new Error(`chapter ${c.id} @ frame ${i} t=${t.toFixed(4)}: ${r.slice(4)}`);
      }
      fs.writeFileSync(path.join(outDir, file), Buffer.from(r.split(',')[1], 'base64'));
    };

    if (mode === 'preview' && only) {
      const c = timeline.chapters.find((x) => x.id === only);
      const ts = val('--at') ? val('--at').split(',').map(Number) : [0.15, 0.5, 0.88];
      for (const t of ts) await shoot(c, t, t, `preview_ch${c.id}_t${Math.round(t * 1000)}.png`);
      console.log(`[render] preview CH${c.id} ✓ ${ts.length} frames`);
    } else {
      const list = only ? timeline.chapters.filter((c) => c.id === only) : timeline.chapters;
      let idx = 0;
      if (only) for (const prev of timeline.chapters) {
        if (prev.id === only) break;
        idx += Math.round(prev.dur * FPS);           // 单章重渲：帧号偏移
      }
      const t0 = Date.now();
      for (const c of list) {
        const frames = Math.round(c.dur * FPS);
        for (let i = 0; i < frames; i++) {
          await shoot(c, i, (i + 0.5) / frames, `f_${String(++idx).padStart(5, '0')}.png`);
        }
        console.log(`[render] CH${c.id} ✓ ${frames} frames (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      }
      console.log(`[render] ALL DONE: ${idx} frames`);
    }
  } catch (e) {
    console.error('[render FAILED]', e.message);
    exitCode = 1;
  } finally {
    cdp.close();
    proc.kill('SIGKILL');
  }
  process.exit(exitCode);
}

main();

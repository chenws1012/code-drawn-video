/* =========================================================================
 * style.js —— 公共手绘美术工具箱骨架（按题材扩展图标后使用）
 * 在 p5.js 1.x 全局模式之后加载；绘制函数内部直接使用全局 p5 API。
 *
 * 章节契约（写进文件头，章节 Agent 必读）：
 *   1. 章节文件只注册 window.__ch[N] = { draw(t){ ...; MV.fade(t); } }，t∈[0,1)
 *   2. draw(t) 必须是 t 的纯函数：禁 Math.random/Date.now/mouseX/frameCount；
 *      随机感用 MV.rand1(n) 与 noise()（宿主已固定种子）
 *   3. 背景由宿主铺好 MV.PAPER；章节在其上作画
 *   4. 结尾必须 MV.fade(t)（统一淡入淡出转场）
 *   5. 样式改动用 push()/pop()；MV.glow() 用完必须 MV.noGlow()
 *   6. ⚠️ 章节 IIFE 内严禁用 p5 全局名做局部函数/变量名
 *      （pop/push/translate/scale/lerp/alpha/noise/text/fill…——遮蔽会造成
 *       transform 永不恢复、画面静默画到屏外且无任何报错）
 *   7. NaN 坐标会被 canvas 静默丢弃（Math.TWO_PI 不存在！TWO_PI 是 p5 全局），
 *      图形"消失"先查坐标是否 NaN
 * ========================================================================= */
(function () {
  'use strict';
  function hexRGB(h) {
    h = String(h).replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  const MV = {
    W: 1280, H: 720,
    PAPER: '#faf3e3',            // 夜色题材改深底如 '#0d1220'，INK 相应改亮色
    INK: '#2f3542',

    /* ---------- 确定性工具 ---------- */
    rand1(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return x - Math.floor(x); },
    ease(f) { f = Math.max(0, Math.min(1, f)); return f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2; },
    easeOut(f) { f = Math.max(0, Math.min(1, f)); return 1 - Math.pow(1 - f, 3); },
    seg(t, a, b) { return Math.max(0, Math.min(1, (t - a) / (b - a))); },
    pulse(t, a, b) { return Math.sin(MV.seg(t, a, b) * Math.PI); },
    /* 手绘"沸腾"：抖相每 4 帧一跳（≈3fps 铅笔感）。__chFrames 由宿主注入（变长章节频率一致） */
    boil() { return Math.floor((window.__t || 0) * (window.__chFrames || 240) / 4); },
    col(hex, a) { const c = hexRGB(hex); return color(c[0], c[1], c[2], a == null ? 255 : a); },
    glow(c, blur) { drawingContext.shadowColor = String(c).startsWith('#') ? c : 'rgba(120,160,255,0.9)'; drawingContext.shadowBlur = blur == null ? 14 : blur; },
    noGlow() { drawingContext.shadowColor = 'rgba(0,0,0,0)'; drawingContext.shadowBlur = 0; },

    /* ---------- 抖线族（手绘感的根基：重采样 + 噪声偏移 + 双描边） ---------- */
    _jit(i, seed, wob) {
      if (!wob) return [0, 0];
      const b = MV.boil() * 1.73 + 3.1;
      return [(noise(i * 0.37 + seed * 17.31, b) - 0.5) * 2 * wob,
        (noise(i * 0.53 + seed * 91.77 + 55.5, b) - 0.5) * 2 * wob];
    },
    _rj(pts, seed, wob, step, closed) {
      step = step || 26;
      const p = closed ? pts.concat([pts[0]]) : pts;
      const rs = [];
      for (let k = 0; k < p.length - 1; k++) {
        const x1 = p[k][0], y1 = p[k][1], x2 = p[k + 1][0], y2 = p[k + 1][1];
        const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / step));
        for (let i = 0; i < n; i++) rs.push([x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
      }
      rs.push(p[p.length - 1]);
      return rs.map((q, i) => { const j = MV._jit(i, seed, wob); return [q[0] + j[0], q[1] + j[1]]; });
    },
    path2(pts, o = {}) {
      const jp = MV._rj(pts, o.seed == null ? 1 : o.seed, o.wob == null ? 2.2 : o.wob, o.step, !!o.closed);
      stroke(MV.col(o.col || MV.INK, o.alpha == null ? 255 : o.alpha));
      strokeWeight(o.w == null ? 3 : o.w); noFill();
      beginShape();
      for (const q of jp) vertex(q[0], q[1]);
      o.closed ? endShape(CLOSE) : endShape();
      return jp;
    },
    line2(x1, y1, x2, y2, o = {}) {
      const pts = [[x1, y1], [x2, y2]];
      MV.path2(pts, o);
      if (o.passes == null || o.passes >= 2) {   // 第二笔错位轻描 → 手绘复线感
        MV.path2(pts, Object.assign({}, o, {
          seed: (o.seed == null ? 1 : o.seed) + 7.31,
          w: (o.w == null ? 3 : o.w) * 0.7,
          alpha: (o.alpha == null ? 255 : o.alpha) * 0.45, passes: 1 }));
      }
    },
    ellipse2(cx, cy, rx, ry, o = {}) {
      const pts = [];
      for (let i = 0; i < 24; i++) {
        const a = Math.PI * 2 * i / 24 + (o.rot || 0);
        pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
      }
      MV.path2(pts, Object.assign({}, o, { closed: true, passes: 1 }));
      if (o.passes == null || o.passes >= 2) {
        MV.path2(pts, Object.assign({}, o, {
          closed: true, passes: 1, seed: (o.seed == null ? 1 : o.seed) + 7.31,
          w: (o.w == null ? 3 : o.w) * 0.7, alpha: (o.alpha == null ? 255 : o.alpha) * 0.4 }));
      }
    },
    rect2(x, y, w, h, o = {}) {
      MV.path2([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], Object.assign({ closed: true }, o));
    },
    wave(x0, x1, y, amp, cyc, ph, o = {}) {
      const pts = [];
      for (let x = x0; x <= x1 + 0.1; x += 16) {
        pts.push([x, y + Math.sin(ph + (x - x0) / (x1 - x0) * Math.PI * 2 * cyc) * amp]);
      }
      return MV.path2(pts, Object.assign({ passes: 1, step: 16, wob: 1.6, w: 2.5 }, o));
    },
    blob(pts, o = {}) {
      const jp = MV._rj(pts, o.seed == null ? 1 : o.seed, o.wob == null ? 3 : o.wob, o.step, true);
      noStroke(); fill(MV.col(o.fill || MV.INK, o.fillA == null ? 200 : o.fillA));
      beginShape();
      for (const q of jp) vertex(q[0], q[1]);
      endShape(CLOSE);
      if (o.col) MV.path2(pts, Object.assign({}, o, { closed: true, passes: 1 }));
      return jp;
    },
    /* 蜡笔铺色：薄底 + 一拨宽笔触横条（大面积色块别用平涂 rect，会"塑料"） */
    wash(x, y, w, h, c, o = {}) {
      const alpha = o.alpha == null ? 60 : o.alpha;
      noStroke(); fill(MV.col(c, alpha * 0.75)); rect(x, y, w, h);
      let row = 0;
      for (let yy = y + 8; yy < y + h; yy += (o.spacing || 11), row++) {
        MV.wave(x, x + w, yy, 2.5, Math.max(2, w / 260),
          MV.rand1(row * 7.7 + (o.seed || 5) * 3.3) * 6.28 + row * 0.9, {
          col: c, w: o.lw || 12, alpha: alpha * (0.3 + 0.6 * MV.rand1(row * 3.3 + (o.seed || 5))),
          step: 46, passes: 1, wob: 2, seed: (o.seed || 5) + row * 1.7 });
      }
    },

    /* ---------- 纸面与转场 ---------- */
    grain(n = 500, alpha = 10) {
      strokeWeight(1);
      for (let i = 0; i < n; i++) {
        stroke(150, 130, 95, alpha * (0.3 + 0.7 * MV.rand1(i * 5.13 + 900)));
        point(MV.rand1(i * 1.37) * MV.W, MV.rand1(i * 2.71 + 500) * MV.H);
      }
    },
    fade(t, edge = 0.06) {
      let a = 0;
      if (t < edge) a = ((edge - t) / edge) * 250;
      else if (t > 1 - edge) a = ((t - (1 - edge)) / edge) * 250;
      if (a > 0.5) { noStroke(); fill(MV.col(MV.PAPER, Math.min(252, a))); rect(0, 0, MV.W, MV.H); }
    },

    /* ---------- 文字（逐字微抖，与线条同呼吸） ---------- */
    title(s, x, y, size, o = {}) {
      push(); noStroke(); textAlign(CENTER, CENTER);
      textFont(o.font || "'LXGW WenKai','Georgia',serif");   // 手写体见 index.html @font-face
      textSize(size); fill(MV.col(o.col || MV.INK, o.alpha == null ? 255 : o.alpha));
      const chars = Array.from(String(s));
      const widths = chars.map((c2) => textWidth(c2));
      let cx = x - widths.reduce((a, b) => a + b, 0) / 2;
      for (let i = 0; i < chars.length; i++) {
        push();
        const j = MV._jit(i * 3.1, o.seed == null ? 9.7 : o.seed, o.rot == null ? 1.4 : o.rot);
        translate(cx + widths[i] / 2 + j[0], y + j[1]);
        rotate((noise(i * 1.7, MV.boil() * 0.4) - 0.5) * 0.07);
        text(chars[i], 0, 0);
        pop(); cx += widths[i];
      }
      pop();
    },
    textL(s, x, y, size, o = {}) {
      push(); noStroke(); textAlign(LEFT, CENTER);
      textFont(o.font || "'LXGW WenKai','Georgia',serif"); textSize(size);
      fill(MV.col(o.col || MV.INK, o.alpha == null ? 255 : o.alpha));
      text(s, x, y); pop();
    },

    /* ---------- 题材图标区（按项目补充） ----------
     * 经验：主角级图形（角色/道具）务必做成工具箱统一函数 + 固定 seed，
     * 并行章节 Agent 只调参数不造轮子，跨章才不会"同一只猫长得不一样"。
     * 示例签名：
     *   MV.arrow(x1,y1,x2,y2,{col,w,dash,curve,label})
     *   MV.padlock(x,y,s,{open:0..1,col,glow})
     *   MV.person(x,y,s,{col,hood,eyes})
     */
  };
  window.MV = MV;
})();

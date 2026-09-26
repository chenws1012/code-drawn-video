# 章节 Agent 简报模板（派发时替换 {{}} 占位）

> 派发要点：一条消息里同时启动全部章节 Agent（并行）；简报必须自包含——
> Agent 看不到导演与用户的对话；跨章信息（锚点、上章交接）要抄进简报。

---

你是《{{片名}}》的 CH{{N}} 章节 Agent。项目根：{{绝对路径}}（下称 sp/）。
导演已建好美术工具箱与渲染管线，你负责第 {{N}} 幕「{{幕名}}」（{{章时长}}s）。

## 先读（必须）
1. sp/storyboard.md —— 规格、**世界锚点表**、你的分镜与旁白节拍
2. sp/shared/style.js 文件头 —— 章节契约 + API 速查
3. sp/chapters/ch1.js 或 out/preview_*.png —— 图标调用方式与风格基准（别改它们）

## 任务
重写 sp/chapters/ch{{N}}.js。**只准改这一个文件**（其他章节/工具箱/渲染器/音频都禁改）。
结构：
```js
window.__ch = window.__ch || {};
window.__ch[{{N}}] = { draw(t){ /* t∈[0,1) 对应 {{章时长}}s */ ...; MV.fade(t); } };
```

## 铁律
- draw(t) 是 t 的**纯函数**：禁 Math.random/Date.now/mouseX/frameCount；随机感用 MV.rand1/noise
- 局部命名禁用 p5 全局名（pop/push/translate/scale/lerp/alpha/noise/text/fill…）——遮蔽会静默毁画
- push/pop 包样式；MV.glow 用完 MV.noGlow；结尾必须 MV.fade(t)
- 构图严格用锚点表坐标；跨章共享元素用表内指定 seed（保证形状一致）
- {{题材专项注意，如：讲解画面一次只演一件事 / 夜景先铺色再画亮物}}

## 你的镜头（旁白节拍对位，局部 t）
{{cue 表：nXX 局部t a→b 「台词」→ 画面该发生什么}}
{{上章交接：开场状态 / 需承接的元素位置}}

## 自检循环（≥3 轮，渲染很快别偷懒）
```bash
cd {{绝对路径}} && node render.mjs --preview --chapter {{N}} --at 0.1,0.3,0.5,0.7,0.9
```
read_image 逐帧看 out/preview_ch{{N}}_t*.png：旁白对位、构图、颜色、跨章一致、
有无"图形消失"（多半是 NaN 坐标）。改→重渲→再看。若 node/Chrome 被沙箱拦，直接报告别死磕。

## 返回报告
1) 镜头清单（元素×t）2) 迭代轮数与修复项 3) 预览路径
4) **给下一章的交接**（结尾画面状态、可复用定版参数）

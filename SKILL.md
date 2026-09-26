---
name: code-drawn-video
description: 用代码逐帧画出手绘风动画视频（MV/技术讲解/故事短片）的完整工作流：p5.js 章节代码 + 原生 CDP 驱动无头 Chrome 逐帧截图 + TTS 旁白对位时间轴 + 程序化配乐混音 + ffmpeg 合成，并用并行章节 Agent 分工作画。当用户要求"用代码生成动画/MV/讲解视频""逐帧绘制""手绘风视频""把某段文字/小说做成视频"时使用。
---

# Code-Drawn Video：代码手绘逐帧成片流水线

全程**不使用任何 AI 生视频工具**：每一帧都是 p5.js 代码画出来的。模型扮演"导演"——
写分镜、建美术工具箱、把镜头拆给并行章节 Agent 各自作画、逐帧渲染、配音合成。
本 skill 已在两个成片项目（32s MV《纸间》、162s 讲解《HTTPS》）中验证。

## 总体架构

```
storyboard.md  导演分镜简报（规格/锚点/各幕镜头/旁白节拍）
narration/     TTS 逐句音频 + timeline.json（变长章节时间轴）
shared/style.js    公共美术工具箱（抖线/色块/图标/转场，全片统一风格）
chapters/chN.js    每章一个文件：window.__ch[N]={draw(t)}，t∈[0,1) 纯函数
index.html     p5 渲染宿主（调度器：铺底→章节→颗粒→错误捕获）
render.mjs     摄影机：原生 CDP 驱动无头 Chrome，逐帧 redraw→toDataURL→PNG
music/gen.js   声音设计：程序化配乐+音效+旁白混音（ducking）→ audio.wav
assemble.sh    剪辑室：ffmpeg 帧序列+audio.wav → final.mp4
```

## 工作流（按顺序执行）

### 0. 需求确认（一次问清）
画风（纸底亮色/夜色暗底）、片长、音频方案（旁白+配乐 / 纯配乐 / 无声）、
内容结构（几幕）。给用户 2~3 个带推荐的选项，别挤牙膏式追问。

### 1. 脚手架
```bash
mkdir -p proj/{chapters,shared,lib,out,narration/wav,music}
# p5.js 1.x 全局模式（不要 2.x，API 差异大）；npm 缓存指到工作区内（沙箱友好）
curl -sL -o proj/lib/p5.min.js "https://cdn.jsdelivr.net/npm/p5@1/lib/p5.min.js"
```
从 `templates/` 复制 render.mjs、index.html、build_timeline.mjs、audio_mix.mjs、style_skeleton.js。

### 2. 导演资产：分镜 + 工具箱
- **storyboard.md**：全局规格表、**世界锚点表**（每个跨章元素写死坐标/颜色/seed——这是并行作画不跑偏的关键）、
  每幕镜头清单（元素×时间区间）、转场约定（统一 fade 回底色）
- **shared/style.js**：公共工具箱，文件头写"章节契约 + API 速查"。核心件：
  确定性伪随机 `rand1(n)`、缓动 `ease/seg/pulse`、**boil 抖动**（线条按 4 帧一格换抖相 → 手绘沸腾感）、
  双描边抖线 line2/path2/ellipse2/blob、蜡笔铺色 wash、逐字抖动标题 title、纸色转场 fade。
  题材专属图标（猫/锁/信封/服务器…）也放这里，**别让章节 Agent 各自发明轮子**。

### 3. 旁白与时间轴（先有音频，再有画面）
1. 写旁白脚本 narr.json：`{id, ch, voice, role, text}`，每句 ≤ 40 字
2. TTS 逐句合成（macOS：`say -v Tingting -r 185 -o x.aiff`；角色变声：美佳 + ffmpeg
   `asetrate=44100*k,aresample=44100,atempo=1/k` 变调变速；先测哪些声音真正可用，
   有的列表里有但没安装，产出 0.01s 静音）
3. ffprobe 测每句**实际时长** → 生成 timeline.json：
   章内顺序排句（句间隔 1.2~1.3s、章首留白 1.5s、章尾 2.5s），
   `章时长 = max(旁白排布需要, 该章最短视觉时长)`
4. 给每章算**局部 t 节拍表**：`cue 局部t = (cue章内秒) / 章时长`——章节 Agent 按这个对词作画
5. 用户要自己配音时：交付无声片 + SRT（从 timeline.json 直接生成绝对时间码字幕）

### 4. 并行章节 Agent（本流水线的"多智能体"精髓）
一条消息里同时派发 N 个 subagent，每个的简报必须自包含：
- 只准改 `chapters/chN.js` 一个文件（文件隔离 = 零冲突）
- 先读 storyboard.md + style.js 文件头（给出确切路径）
- **铁律**：`draw(t)` 纯函数（禁 Math.random/Date/mouseX/frameCount）；push/pop 包样式；
  glow 用完关；结尾必须 `MV.fade(t)`；构图用锚点表
- 该章镜头清单 + 局部 t 旁白节拍表（从 timeline.json 抄进简报，别让 Agent 自己算）
- 自检循环命令（预览渲染→read_image 看图→改→再渲，**至少 3 轮**）+ 报告格式
- 转发其他章的交接信息（角色定版坐标、上章结尾状态）
Agent 中断/崩溃很常见：**重启同一 agent 续作**（send_message），草稿文件还在，让它"读现状→列问题→修复"。

### 5. 导演验收
- 逐章 read_image 预览帧：构图、旁白对位、跨章一致性（同一元素别跳形）
- 契约审计（快）：`node --check`；grep 禁用 API；`MV.fade(t)` 收尾；glow 开/关计数配对
- 发现问题 send_message 下修正指令（Agent 还在跑时可直接改），或导演亲自改一行

### 6. 全量渲染
```bash
node render.mjs                    # 全部章节 → out/f_%05d.png（全局连续帧号）
node render.mjs --render-ch N      # 单章重渲（帧号自动偏移，验收后微调专用）
node render.mjs --preview --chapter N --at 0.1,0.5,0.9   # 预览
```
清晰度：默认 1280×720；宿主 draw 里 `scale(2)` + `createCanvas(2560,1440)` 即 1440p
（章节代码不用动，逻辑坐标不变）。12fps 是手绘"一拍二"风格；要顺滑就 24fps（帧数×2）。

### 7. 音频合成（一个 node 脚本出整轨）
程序化合成配乐（泛音堆叠音柱/噪声床水风声/鼓点）+ 音效 cue（按 timeline 绝对秒）
+ 旁白逐句混入 + **ducking**（旁白窗口内音乐增益 0.45~0.55，0.3s 斜坡）→ audio.wav。
详见 templates/audio_mix.mjs 与"坑"清单第 7 条（WAV 解析偏移）。

### 8. 合成与质检
```bash
ffmpeg -y -framerate 12 -start_number 1 -i out/f_%05d.png -i audio.wav \
  -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -c:a aac -b:a 192k \
  -movflags +faststart -shortest final.mp4
```
质检三板斧：① `ffprobe` 时长/码率 ② `volumedetect` 分段响度（**旁白窗口必须比空隙响 ≥8dB**，
否则旁白丢了）③ 抽关键时刻 `tile=4x3` 拼质检条 read_image 目检。
交付后清理：`rm out/f_*.png`（1~3GB）、`rm -rf .ud`。

## 血泪坑清单（每条都真实踩过）

1. **puppeteer-core 与新版 Chrome 不兼容**（"Requesting main frame too early"）→
   弃用 puppeteer，用原生 CDP：spawn Chrome + `--remote-debugging-port` + 轮询
   `/json/version` + 全局 WebSocket 直连（见 templates/render.mjs）
2. **外层沙箱里 Chrome 起不来** → 必须 `--no-sandbox --disable-crash-reporter --disable-breakpad`；
   每个渲染进程独立 `--user-data-dir`（并发章节预览互不冲突）+ 随机端口
3. **CDP WebSocket 未 open 就 send** → "Sent before connected"，先 await onopen
4. **NaN 坐标被 canvas 静默吞掉**（不报错、图形消失）：`Math.TWO_PI` 不存在（TWO_PI 是 p5 全局）→
   图形画不出来只能靠逐帧预览目检发现，务必让 Agent 看图自检
5. **章节 IIFE 内局部函数遮蔽 p5 全局**（`function pop()`、`const lerp=`、形参 `alpha`）→
   transform 永不恢复、后半段画面静默画到屏外，**无任何报错**。规约：局部命名禁用
   p5 全局名（pop/push/translate/scale/lerp/alpha/noise/text/fill…）；用 CDP 探针
   `getTransform()` 可定位 CTM 泄漏
6. **npm 缓存写 `~/.npm` 被沙箱拦** → `npm i --cache ./.npmcache`（工作区内）
7. **WAV 解析 bitsPerSample 偏移**：fmt 块内是 `off+22`，写成 `off+24` 会读到下一个
   chunk 的 ID 字节（如 'LI' = 18764）→ 每条旁白只解析出几百个采样，**旁白整段静默丢失**。
   验收必做：成片旁白窗口 vs 空隙 volumedetect 对比
8. **say 列表里存在的中文声音未必可用**（Eddy/Rocko/Reed 产出 0.01s 静音），先逐声测试
9. **确定性**：boil 时相从 `window.__t` 推导（`floor(t*章帧数/4)`），宿主把章帧数注入
   `window.__chFrames`，否则变长章节抖动频率不一致
10. **跨章一致性**：共享元素的 seed 要写进锚点表统一（否则同一块石头两章长得不一样）

## 交付物清单（每次成片）

- `final.mp4`（有声）+ 按需 `final_silent.mp4`（`-c:v copy -an` 无损抽流）+ `narration.srt`
- storyboard.md（分镜即文档，用户可据此改词重制）
- 各章预览帧与质检条（out/）
- 告知用户重制路径：改章节代码 → `--render-ch N` → `assemble.sh`，几分钟出新片

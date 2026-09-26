# Code-Drawn Video

用代码**逐帧手绘**动画视频的完整工作流与模板库：p5.js 章节代码 + 原生 CDP 驱动无头 Chrome 逐帧截图 + TTS 旁白对位时间轴 + 程序化配乐混音 + ffmpeg 合成，并用并行章节 Agent 分工作画。

全程**不使用任何 AI 生视频工具**——每一帧都是代码画出来的。模型扮演"导演"：写分镜、建美术工具箱、把镜头拆给并行章节 Agent 各自作画、逐帧渲染、配音合成。

已在两个成片项目中验证：32s MV《纸间》、162s 技术讲解《HTTPS》。

## 适用场景

- "用代码生成动画 / MV / 讲解视频"
- "逐帧绘制""手绘风视频"
- "把某段文字 / 小说做成视频"

完整方法论（工作流顺序、血泪坑清单、交付物清单）见 [SKILL.md](SKILL.md)。

## 总体架构

```
storyboard.md      导演分镜简报（规格/锚点/各幕镜头/旁白节拍）
narration/         TTS 逐句音频 + timeline.json（变长章节时间轴）
shared/style.js    公共美术工具箱（抖线/色块/图标/转场，全片统一风格）
chapters/chN.js    每章一个文件：window.__ch[N]={draw(t)}，t∈[0,1) 纯函数
index.html         p5 渲染宿主（调度器：铺底→章节→颗粒→错误捕获）
render.mjs         摄影机：原生 CDP 驱动无头 Chrome，逐帧 redraw→toDataURL→PNG
music/gen.js       声音设计：程序化配乐+音效+旁白混音（ducking）→ audio.wav
assemble.sh        剪辑室：ffmpeg 帧序列 + audio.wav → final.mp4
```

## 仓库结构

```
.
├── SKILL.md                      # 完整工作流文档（含 10 条血泪坑清单）
└── templates/
    ├── render.mjs                # 摄影机：原生 CDP 驱动无头 Chrome 逐帧渲染
    ├── index.html                # p5.js 渲染宿主（RES=1/2/3 即 720p/1440p/4K）
    ├── build_timeline.mjs        # 旁白 TTS 逐句合成 + 实测时长 → timeline.json
    ├── audio_mix.mjs             # 程序化配乐 + 音效 + 旁白混入 + ducking → audio.wav
    ├── style_skeleton.js         # 公共手绘美术工具箱骨架（boil 抖线/wash 铺色/转场…）
    ├── assemble.sh               # ffmpeg 合成 final.mp4 + 质检三板斧
    └── agent_brief.md            # 并行章节 Agent 简报模板（派发时替换 {{}} 占位）
```

## 流水线（9 步）

1. **需求确认**：画风、片长、音频方案、内容结构——一次问清
2. **脚手架**：建目录、下载 p5.js 1.x（全局模式，勿用 2.x）、复制 templates
3. **导演资产**：storyboard.md（含**世界锚点表**）+ shared/style.js 公共工具箱
4. **旁白与时间轴**：narr.json → TTS 逐句合成 → ffprobe 实测时长 → timeline.json
5. **并行章节 Agent**：一条消息同时派发 N 个 Agent，每个只改 `chapters/chN.js` 一个文件（文件隔离 = 零冲突），按简报的局部 t 节拍表对词作画，≥3 轮"预览→看图→修"自检
6. **导演验收**：逐章预览帧目检 + 契约审计（`node --check`、禁用 API grep、fade 收尾）
7. **全量渲染**：`node render.mjs` 出全片帧序列（单章重渲用 `--render-ch`）
8. **音频合成**：`audio_mix.mjs` 出整轨 audio.wav（旁白窗口内音乐 ducking）
9. **合成与质检**：`assemble.sh` 出 final.mp4，ffprobe 时长 + volumedetect 响度对比 + 抽帧拼质检条目检

## 关键命令

```bash
node render.mjs                                          # 全部章节 → out/f_%05d.png
node render.mjs --render-ch --chapter N                  # 单章重渲（帧号自动偏移）
node render.mjs --preview --chapter N --at 0.1,0.5,0.9   # 预览帧（Agent 自检用）
./assemble.sh                                            # 帧序列 + audio.wav → final.mp4
```

## 依赖

- **Node.js**（ESM，直接 `node xxx.mjs` 运行）
- **Chrome / Chromium**（无头渲染；macOS 默认路径 `/Applications/Google Chrome.app/...`，可用环境变量 `CHROME_PATH` 覆盖）
- **ffmpeg / ffprobe**（TTS 音频转换、时间轴实测时长、成片合成与质检）
- **p5.js 1.x**（运行时下载到项目 `lib/`，不入库）
- **macOS `say`**（TTS 旁白；其他平台可换任意能逐句出音频的 TTS）

## 核心约定（防翻车）

- `draw(t)` 必须是 t 的**纯函数**：禁 `Math.random` / `Date` / `mouseX` / `frameCount`——逐帧渲染靠确定性才能复现
- 章节 IIFE 内**严禁用 p5 全局名**做局部函数/变量名（`pop`/`lerp`/`text`…）——遮蔽会造成画面静默消失且无任何报错
- 跨章共享元素（角色定版坐标、图形 seed）一律写进锚点表——并行作画不跑偏的关键
- 每章结尾必须 `MV.fade(t)`——统一转场回底色
- 验收必做：旁白窗口 vs 空隙 `volumedetect` 响度差 ≥ 8dB，否则旁白可能整段静默丢失

## License

未声明（Internal / Personal project）。如需开源授权请先补充 LICENSE 文件。

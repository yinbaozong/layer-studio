# Layer Studio · G-code 打印生长动画工作室

> 把拓竹 Bambu Studio 切片的 G-code 渲染成逼真的多色 3D 打印生长动画，导出 720p / 1080p、30fps 的无水印视频。完全在浏览器本地运行，不上传任何文件。

![badge](https://img.shields.io/badge/tech-Vite%20%7C%20Three.js%20%7C%20WebCodecs-orange) ![badge](https://img.shields.io/badge/tests-25-green)

## 功能特性

- **真实挤出几何**：按 G-code 解析挤出路径，连续扁圆截面网格，转角 miter 焊接，支持自动 / 低 / 中 / 高 / 超精细五档精度
- **多色打印**：解析 T 换色指令与 FLUSH / WIPE 宏，还原多色耗材与擦料塔
- **拓竹 PEI 打印板**：程序化生成的粉末涂层颗粒纹理（金色 / 深色 / 光滑三档），含层纹与微浮雕凹凸
- **影棚级光照**：三灯布光 + 环境遮蔽 GTAO + 可选微距景深，ACES 色调映射
- **抗锯齿超采样**：内部高分辨率渲染后缩放到输出画布，消除密集层纹上的摩尔纹
- **相机编排**：固定机位 / 缓慢环绕 / 环绕+随打印高度抬升 / 自定义关键帧
- **视频导出**：WebCodecs（Mediabunny）逐帧确定性编码，MP4 / WebM 自动回退，可直接下载或写盘
- **场景保存/载入**：所有参数与相机关键帧可保存为 JSON

## 技术栈

| 模块 | 技术 |
|---|---|
| 构建 | Vite 7 |
| 3D 渲染 | Three.js 0.185（PMREM 环境贴图、GTAO 遮蔽、Bokeh 景深、EffectComposer） |
| 视频编码 | Mediabunny（WebCodecs 封装） |
| 解压 | fflate（3mf zip 解析） |
| 测试 | Node.js 内置 `node --test` |

## 快速开始

```bash
# 1. 安装依赖（首次需要联网）
npm install

# 2. 启动开发服务器
npm run dev
# 浏览器打开 http://127.0.0.1:5173/

# 3. 构建生产版本
npm run build

# 4. 运行测试（25 项，含真实 G-code 解析校验）
npm test
```

Windows 下也可双击 `启动工作室.bat` 一键启动。

## 使用流程

1. 点击 **打开切片文件** 加载 `.gcode` 或 `.3mf`，或点 **三色示例** 体验内置模型
2. 调整耗材配色、表面材质、网格精度、线宽 / 层间间隙
3. 在影棚灯光区设置布光、曝光、阴影柔和度、背景
4. 选择相机运动模式，必要时保存关键帧
5. 设置分辨率（720p / 1080p）、时长、抗锯齿档位，点击 **导出视频**

## 支持范围

- 解析 `G0` / `G1` 直线、`I/J` 圆心参数圆弧
- 回抽补偿、换色 `T` 指令、`FLUSH` / `WIPE` 宏标记
- 自动识别层高、线宽、打印板尺寸
- 多色（AMS）打印件

## 已知限制

- 不支持未切片的 STL / 3MF 网格（仅支持切片后的 G-code）
- 不支持 `R` 半径参数的圆弧（目前仅支持 `I/J`，会报错提示）
- 生长动画的活动末段按整段显现，未做段内插值
- 高精细度与超采样档位会显著增加显存占用和导出时间

## 项目结构

```
src/
  parser.js      G-code 解析（直线、圆弧、回抽、换色、宏）
  beads.js       挤出网格生成（扁圆截面、miter 焊接、drawRange 生长）
  plate.js       拓竹 PEI 打印板程序化纹理
  exporter.js    视频编码器探测与逐帧导出
  main.js        主界面、渲染管线、相机编排
  worker.js      后台解析线程
  style.css
tests/           25 项自动测试
```

## 许可证

MIT

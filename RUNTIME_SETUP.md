# RUNTIME_SETUP — 运行时二进制安装说明

> **解析优先级：插件内置 `runtime/` → 用户缓存 `<DSH_HOME>/runtime/` → 系统 PATH**；
> 三处都读不到时**自动下载**到用户缓存，**下完立刻做兼容性校验**（见下），验不过就明确报错 ——
> 绝不带着"跑不起来的组件"继续跑。
>
> Windows 运行时（python/bash/uv）**已内置于项目 `runtime/` 目录**（2026-09-26 起随包分发，解压后 ~190MB），
> 所以 Windows 用户装上插件即可用，**不需要任何额外安装、也不联网**。

## 自动下载（读不到就自己取，2026-10-11 起）

每个工具都有一串候选源，**按序试、第一个成功的胜出**（每个源 25s 无数据就换下一个，免得被死源按分钟卡住）：

| 顺序 | 源 | 说明 |
|---|---|---|
| ① | 自定义镜像 | `--mirror=前缀` 或环境变量 `DAGFLOW_RUNTIME_MIRROR=前缀`（前缀式，套在 GitHub 原 URL 上） |
| ② | npmmirror 二进制镜像 | Python / MinGit 都有；国内实测 ~5MB/s |
| ③ | PyPI 的 uv wheel | uv 在 npmmirror **没有**二进制；从 wheel（`uv-<版本>.data/scripts/uv.exe`）里取出来 |
| ④ | GitHub 直连 | 兜底（能直连的环境第一下就成） |

★ **为什么必须多源**：2026-10-11 在本机实测，**`github.com` 完全连不上**（TCP 都握不上手、连首字节都没有），
而 `api.github.com` 可达、npmmirror ~5MB/s、PyPI 也通。只留"GitHub 直连"一条源 = 自动下载永远失败。

## 兼容性红线（组件之间必须能配套）

| 组件 | 版本 | 为什么钉死 |
|---|---|---|
| Python | **3.12.14+20260901**（ABI 3.12） | OCR 引擎的轮子（onnxruntime / pypdfium2 / opencv）都是 **cp312** 编的 |
| uv | 0.12.10 | 用来把 OCR 引擎装进插件运行区（`--python` 指向上面的 3.12 解释器） |
| bash | 2.55.0.5（MinGit 完整版，`usr/bin/sh.exe`） | bash 节点 |
| OCR 引擎 | rapidocr-onnxruntime 1.4.4 / onnxruntime 1.19.2 / opencv-python-headless / pypdfium2 5.14.0 | 见 `src/adapter/ocr.ts` |

- 下载脚本**只认 3.12.x**：上游发了 3.13/3.14 也不会下（宁可用固定版本，也不用跑不了的新版）。
- 下完还会**真跑一次** `python -c "import sys;print(...)"` 复核版本；不匹配 → `RUNTIME_VERSION_MISMATCH`，
  不做静默降级。OCR 引擎装完也会真 `import` 一次（避免"包装上了但跑起来才炸"）。

## 当前内置（目录名与 src/adapter/runtime.ts 常量严格一致）

| 工具 | 版本 | 内置路径（runtime/ 下） |
|---|---|---|
| Python | 3.12.14 (python-build-standalone 20260901) | `python/3.12.14+20260901/win-x64/python.exe` |
| Bash | 2.55.0.5 (MinGit 完整版，`usr/bin/sh.exe`) | `bash/2.55.0.5/win-x64/usr/bin/sh.exe` |
| uv | 0.12.10 | `uv/0.12.10/win-x64/uv.exe` |
| OCR 引擎（RapidOCR） | rapidocr-onnxruntime 1.4.4 / onnxruntime 1.19.2 / opencv-python-headless / pypdfium2 5.14.0 | `rapidocr/1.4.4/win-x64/`（含模型；调用脚本 `runtime/ocr/rapid_ocr.py`、`pdf_ocr.py`、`ocr_client.py`） |

**Windows 上 OCR 引擎也已随包内置**（`package.json#files` 含 `runtime`）⇒ doc_parse 走 OCR **不需要下载任何东西**，
首次跑只是第一次加载 onnxruntime + 模型（本机实测：首次识别一张 909×849 的图 **1.9s**、置信度 0.97）。
`ensureEngine()` 只在**引擎目录读不到**时才会按需安装（当前实际情形＝非 win-x64 平台，或引擎被裁剪/删掉）：
装进插件自带区优先、不可写才落 `<DSH_HOME>/runtime/rapidocr/<版本>/<平台>/`，装完必须真 `import` 一次复核。

**macOS / Linux 用户**：首次运行（python / OCR 节点）时自动下载到 `<DSH_HOME>/runtime/`，**bash 用系统自带**。

## 手动预下载（避免首次运行延迟）

```bash
# 当前平台
node scripts/download-runtime.mjs

# 指定平台
node scripts/download-runtime.mjs --platform=mac-arm64
node scripts/download-runtime.mjs --platform=linux-x64

# 只下载部分工具
node scripts/download-runtime.mjs --tools=python,uv

# 指定镜像前缀（默认已会自动用国内镜像）
node scripts/download-runtime.mjs --mirror=https://你的镜像前缀/
```

下载到 `<DSH_HOME>/runtime/<tool>/<version>/<platform>/<binary>`（含解压后的二进制）。

## 逃生舱（排错 / 离线环境）

| 环境变量 | 作用 |
|---|---|
| `DAGFLOW_RUNTIME_MIRROR` | 下载镜像前缀（等价于 `--mirror=`） |
| `DAGFLOW_RUNTIME_NO_DOWNLOAD=1` | 只解析、**不下载**（纯离线环境：缺失就明确报 `RUNTIME_MISSING`） |
| `DAGFLOW_RUNTIME_BUNDLED_DIR` | 换掉"插件自带运行时"的根目录（测试/彩排用） |
| `DAGFLOW_RUNTIME_DOWNLOAD_SCRIPT` | 换掉下载脚本（测试用） |
| `DAGFLOW_RUNTIME_SOURCE_TIMEOUT_MS` | 单个源"无数据"超时（默认 25000ms） |
| `DAGFLOW_PYPI_INDEX` | PyPI 简单索引（uv wheel 的来源；默认 pypi.org → 清华 → 阿里） |
| `DAGFLOW_PYPI_MIRROR` | OCR 引擎安装的首选 index（默认官方源，失败自动回落清华 / 阿里） |

## 版本与来源

- Python 来自 [python-build-standalone](https://github.com/astral-sh/python-build-standalone/releases)（`cpython-<版本>+<发布串>-<平台>-install_only_stripped.tar.gz`），
  脚本通过 GitHub API 动态发现资产（API 不可达就用硬编码 URL）；版本常量在 `scripts/download-runtime.mjs` 顶部
  （`PYTHON_VERSION` / `PYTHON_RELEASE` / `UV_VERSION` / `BASH_VERSION`），
  **必须与 `src/adapter/runtime.ts` 的同名常量保持同步**（bundled 目录名与兼容性矩阵按它拼接）。
- 上游 release 更新后：改两处常量 → 下载/解压到对应版本目录 → 重跑 `node test/node-matrix.test.mjs`
  （#5 bash / #6 python 会真实执行验证）。
- 历史教训：3.12.12 被上游撤下导致 fallback URL 404；upgrade 时优先用"动态发现"路径。

## 排错

- `PYTHON_UNAVAILABLE` / `BASH_UNAVAILABLE`：运行时未就位 → 确认 `runtime/` 目录存在且版本目录名与常量一致，
  或跑手动预下载。
- `RUNTIME_MISSING`：设置了 `DAGFLOW_RUNTIME_NO_DOWNLOAD=1` 且运行时缺失（离线环境的预期行为）。
- `RUNTIME_DOWNLOAD_FAILED`：所有候选源都没下下来 → 看报错里的脚本输出尾巴；可先 `--mirror=` 指定一个能通的镜像。
- `RUNTIME_VERSION_MISMATCH`：解析到的解释器不是 3.12.x（多半是系统 python）→ 用 `DAGFLOW_RUNTIME_MIRROR` 下载内置版，
  或手动预下载。
- Windows bash 用 MinGit **完整版**的 `usr/bin/sh.exe`（busybox 版没有该文件；`mingit64/usr/bin/bash.exe` 是**旧标记、已废**，
  实测 MinGit 2.55.0.5 的 zip 解出来是根级 `cmd/ etc/ mingw64/ usr/`）。

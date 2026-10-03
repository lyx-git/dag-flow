# RUNTIME_SETUP — 运行时二进制安装说明

> Windows 运行时（python/bash/uv）**已内置于项目 `runtime/` 目录**（2026-09-26 起随包分发，解压后 ~190MB）。
> 解析优先级：插件内置 `runtime/` → 用户缓存 `~/.dsh/runtime/` → 系统 PATH。
> 其他平台首次运行 python 节点时按需自动下载；也可手动预下载。

## 当前内置（2026-09-26 实装，目录名与 src/adapter/runtime.ts 常量严格一致）

| 工具 | 版本 | 内置路径（runtime/ 下） |
|---|---|---|
| Python | 3.12.14 (python-build-standalone 20260901) | `python/3.12.14+20260901/win-x64/python.exe` |
| Bash | 2.55.0.5 (MinGit 完整版，`usr/bin/sh.exe`) | `bash/2.55.0.5/win-x64/usr/bin/sh.exe` |
| uv | 0.12.10 | `uv/0.12.10/win-x64/uv.exe` |

**Windows 用户**：装上插件即可使用 python/bash 节点，**无需任何额外安装**。

**macOS / Linux 用户**：首次运行 python 节点时自动下载到 `~/.dsh/runtime/`，**bash 用系统自带**。

## 手动预下载（其他平台 / 避免首次运行延迟）

在能联网的机器上跑：

```bash
# 当前平台
node scripts/download-runtime.mjs

# 指定平台
node scripts/download-runtime.mjs --platform=mac-arm64
node scripts/download-runtime.mjs --platform=linux-x64

# 只下载部分工具
node scripts/download-runtime.mjs --tools=python,uv
```

下载到 `~/.dsh/runtime/<tool>/<version>/<platform>/<binary>`（含解压后的二进制）。

## 版本与来源

- Python 来自 [python-build-standalone](https://github.com/astral-sh/python-build-standalone/releases)（`cpython-<版本>+<发布串>-<平台>-install_only_stripped.tar.gz`），
  脚本通过 GitHub API 动态发现资产；版本常量在 `scripts/download-runtime.mjs` 顶部（`PYTHON_VERSION` / `PYTHON_RELEASE` / `UV_VERSION` / `BASH_VERSION`），
  **必须与 `src/adapter/runtime.ts` 的同名常量保持同步**（bundled 目录名按它拼接）。
- 上游 release 更新后：改两处常量 → 下载/解压到对应版本目录 → 重跑 `node test/node-matrix.test.mjs`（#5 bash / #6 python 会真实执行验证）。
- 历史教训：3.12.12 被上游撤下导致 fallback URL 404；upgrade 时优先用"动态发现"路径。

## 排错

- `PYTHON_UNAVAILABLE` / `BASH_UNAVAILABLE`：运行时未就位 → 确认 `runtime/` 目录存在且版本目录名与常量一致，或跑手动预下载。
- 下载脚本失败会回退系统二进制（Windows 无系统 python/bash 时仍会失败，属预期）。
- Windows bash 用 MinGit **完整版**的 `usr/bin/sh.exe`（busybox 版无该文件，勿换）。

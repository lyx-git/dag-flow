# dag-flow 安装指南

## 给开发者（自己本地用）

### 方式 A：从工作区直接装（开发态）
```powershell
# 1. 构建产物必须先存在
cd D:\workspace\pluginspace\dag-flow
npm install
npm run build

# 2. 装到 DSH
dsh plugin add D:\workspace\pluginspace\dag-flow

# 3. 重启 DSH
```

> ⚠️ **前提**：源目录的 `dist/` 必须存在（`npm run build` 后才有）。dist 缺失时 DSH 无法加载插件。

### 方式 B：npm 发布后（用户态）
```powershell
# 1. 发布（dist/ 在 package.json#files 内，会随包发布）
cd D:\workspace\pluginspace\dag-flow
npm publish

# 2. 用户直接装
dsh plugin add dag-flow

# 3. 启动
dsh web
```

### 方式 C：发布到 GitHub 后（用户态）
```powershell
dsh plugin add <owner>/<repo>
dsh web
```

> **说明**：`github:` 协议走 tarball 不触发 npm publish 的 files 过滤——DSH 直接拉仓库源码。走此路径时需保证仓库里已包含构建好的 `dist/`（或用户装完后自行 `npm install && npm run build`）。

## 运行时（可选预下载）

Windows 用户无需任何额外安装即可使用 python/bash 节点的前提是运行时已就位；
其他平台首次运行 python 节点时自动下载。也可手动预下载：

```bash
node scripts/download-runtime.mjs            # 当前平台
node scripts/download-runtime.mjs --platform=mac-arm64
```

下载到 `~/.dsh/runtime/<tool>/<version>/<platform>/<binary>`。详见 [RUNTIME_SETUP.md](./RUNTIME_SETUP.md)。

## 安装验证

装完重启 DSH 后，日志应出现：

```
[dag-flow] loaded, 20 nodes, workflow tool registered, api registered, apis all-ok
```

GUI 侧边栏出现 dag-flow 入口即安装成功。若显示 `safe mode active (drifted: ...)`，
说明 DSH 版本升级导致内部 API 变化，按 README「版本韧性」一节修 5 个 adapter 文件即可。

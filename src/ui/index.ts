// src/ui/index.ts
// 兼容层：把 DSH loader 协议下的 mount/unmount 转发到真正的客户端入口。
// dist/ui/index.js = 转发器；dist/client.js = esbuild 打包的浏览器 bundle。
//
// DSH cordis.patch.yml 第 30-33 行指向 dist/ui/index.js#mount；
// 本文件 re-export 真正的 mount/unmount。

import { mount, unmount } from '../client/index.js';
export { mount, unmount };
export default { mount: mount, unmount: unmount };

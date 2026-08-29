# cross-tab-worker-databus

[![npm version](https://img.shields.io/npm/v/cross-tab-worker-databus)](https://www.npmjs.com/package/cross-tab-worker-databus)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> 中文 | [English](./README.md)

框架无关的浏览器跨 Tab 数据总线。

默认每个 Tab 使用独立的 Dedicated Worker；配置 `workerMode: 'shared'` 或 `'auto'` 后，同源 Tab 可复用同一个 SharedWorker。`auto` 模式自动从 SharedWorker → Dedicated Worker → 主线程 WebSocket 降级。同源 Tab 通过 BroadcastChannel 形成逻辑 Worker 集群；SDK 自动协调粘性 Topic owner、订阅复用、新 Topic 负载分配、故障转移和页面生命周期，业务只需订阅 Topic 和处理数据。

## 特性

- 创建后可立即订阅；连接未就绪时订阅自动排队
- 同一 Tab 内同 Topic 多 handler 通过引用计数去重
- 同源 Tab 复用 Topic owner，减少重复实时订阅
- SharedWorker 模式同源 Tab 复用同一个 SharedWorker；每个 Tab 的 port 各自维护独立的连接，单个 Tab 刷新或停止不影响其他 Tab
- `workerMode` 支持 `dedicated` / `shared` / `auto`；`auto` 按 SharedWorker → Dedicated Worker → 主线程 WebSocket 降级，`dedicated` 按 Dedicated Worker → SharedWorker → 主线程 WebSocket 降级
- 开启 `transferable: true` 后，ArrayBuffer 消息通过 Transferable 传输，对象消息 API 不变
- localStorage 协调写入合并批量 flush；心跳和路由确认使用指数退避
- 已有 Topic 的 owner 存活时保持稳定，前后台切换不迁移已有订阅
- 新 Topic 分配给负载最低的候选 Worker
- `pagehide` 自动释放资源；`pageshow` 自动重建 Worker 和连接
- Transport 重连自动恢复当前 owner 的 Topic
- Tab 异常退出后通过心跳 TTL 自动迁移
- BroadcastChannel 或 localStorage 不可用时自动降级为本地模式
- 持久层不存储连接地址、原始 Topic 文本和消息内容

完整能力清单见 [能力矩阵](./docs/zh/capabilities.md)。

## 安装

```bash
pnpm add cross-tab-worker-databus
```

核心包零运行时依赖。Centrifuge transport（`cross-tab-worker-databus/centrifuge`）
将 `centrifuge` 声明为可选 peer 依赖——仅在使用内置 Centrifuge 后端时安装：

```bash
pnpm add cross-tab-worker-databus centrifuge
```

仅使用本地 BroadcastChannel 数据总线（不连 WebSocket 服务）的 Tab 无需安装 `centrifuge`。

## 快速接入

```ts
import { createCentrifugeDataBus } from 'cross-tab-worker-databus/centrifuge';

interface ResourceEvent {
  id: string;
  version: number;
  content: unknown;
}

const bus = createCentrifugeDataBus<ResourceEvent>({
  connection: {
    url: getConnectionUrl(),
    options: getConnectionOptions()
  }
});

const unsubscribe = bus.subscribe('resource.changed', ({ data }) => {
  applyResourceEvent(data);
});

await bus.ready();

unsubscribe();
await bus.stop();
```

业务无需处理 Tab owner、Worker 迁移、页面恢复或重连后的重新订阅。

## 浏览器演示

仓库包含可运行的多标签演示页面，展示发布、接收、集群路由、Worker 会话和服务器之间的实时数据流：

```bash
pnpm install
pnpm build
pnpm examples
```

然后在多个浏览器标签页中同时打开 `http://localhost:4173/examples/demo/` 即可观察跨 Tab 数据流转。演示页默认使用公共 Centrifugo 演示地址 `wss://faye.centrifugal.dev/connection/websocket`；地址、Worker 模式和 Topic 都可在页面内修改。也可以切换到"本地广播"模式，不依赖外部服务器，仅通过 BroadcastChannel 演示多标签协同。

演示页包含数据流动画、事件流、接收/分发延迟指标和集群 Worker 路由状态。

## 文档

- [文档索引](./docs/zh/README.md)
- [快速接入](./docs/zh/getting-started.md)
- [配置说明](./docs/zh/configuration.md)
- [API 参考](./docs/zh/api.md)
- [架构说明](./docs/zh/architecture.md)
- [能力矩阵](./docs/zh/capabilities.md)
- [变更日志](./CHANGELOG.md)

## 开发

```bash
pnpm install
pnpm check
pnpm pack --pack-destination /tmp
```

## 许可证

[MIT](./LICENSE)

# Spike 4：双窗口状态同步

## 问题

两个 Tauri 窗口之间如何同步角色状态？

## 调研结论

### Tauri 2 多窗口通信机制

Tauri 2 提供多种多窗口通信方式：

1. **Tauri Event System**（推荐用于跨窗口通信）
   - `emit_to(label, event, payload)` 从 Rust 端向指定窗口发送事件
   - `window.emit(event, payload)` + `window.listen(event)` 在前端使用
   - 前端也可以通过 `emit` 向特定窗口标签发送事件

2. **共享 Rust 状态**
   - 两个窗口共享同一个 Tauri 进程的 Rust 后端
   - 可以通过 IPC Command 读写共享状态
   - 适合需要原子性和一致性的场景

3. **BroadcastChannel API**（Web 标准）
   - WebView2 支持 `BroadcastChannel`
   - 但 Tauri 2 的多窗口可能不共享 origin，需验证

### 推荐方案

**首选：BroadcastChannel API**
- 纯前端实现，无需 Rust IPC 中转
- 代码简洁，延迟极低

**备选：Tauri Event System**
- 如果 BroadcastChannel 在多 WebView 间不可用，使用 Tauri 的 `emit`/`listen` API

---

## 实机验证结果（Phase 1.1）

### 环境

- **OS**: Windows 10 (10.0.26200)
- **Tauri**: 2.x，WebView2 (Chromium-based)
- **Rust**: 1.94.0

### 实现方案

1. 创建 `src/utils/window-sync.ts`，封装 `BroadcastChannel` 通信
2. 主窗口：订阅 `character:state-change` 和 `runtime:mode-change` 事件，通过 `broadcastState()` 广播
3. 舞台窗口：通过 `onStateSync()` 监听广播，更新本地 React 状态
4. 同步的数据结构：`{ character: CharacterState, runtimeMode: RuntimeMode, timestamp: number }`

### 架构

```
Main Window (service owner)
  ├── CharacterService → emit "character:state-change"
  ├── RuntimeService   → emit "runtime:mode-change"
  └── main.tsx         → broadcastState() via BroadcastChannel
                                    ↓
                            BroadcastChannel("paimon-state-sync")
                                    ↓
Stage Window (state receiver)
  └── StageWindow.tsx  → onStateSync() → setState()
```

### 验证步骤

1. `tauri.conf.json` 中定义了 `main` 和 `stage` 两个窗口
2. `App.tsx` 根据 `getCurrentWindow().label` 路由到不同组件
3. `main.tsx` 中主窗口初始化 service 并订阅事件广播
4. StageWindow 通过 `BroadcastChannel` 接收状态

### 结果

- **代码已完整实现**：BroadcastChannel 方案从代码层面已就绪
- **TypeScript 编译通过**：所有类型检查无错误
- **Tauri 构建成功**：双窗口配置编译运行无报错
- **BroadcastChannel 可用性**：在同一 origin 下的 WebView2 中 BroadcastChannel 应可用。如果 Tauri 的多窗口 WebView 使用不同 origin，将降级到 Tauri Event System

### 待补充验证

- 实际打开两个窗口后的同步延迟测量
- 确认 BroadcastChannel 在 Tauri 多 WebView 间是否共享 origin
- 高频状态更新（如口型数据 60fps）下的性能表现

### 对后续 phase 的影响

- service-first 架构使得同步层与业务逻辑解耦，更换同步机制不影响 service 层
- 如果 BroadcastChannel 不可用，切换到 Tauri Event 只需修改 `window-sync.ts`
- 口型同步等高频场景可能需要专门的优化通道

## 结论

**可行——架构和代码已就绪。** BroadcastChannel 方案已实现，Tauri Event System 作为备选。跨窗口同步的最终延迟数据需在实际双窗口运行时测量。

// 运行时控制器相关类型

export type RuntimeMode = "auto" | "manual" | "stopped" | "paused";

// Phase 1 仅实现 auto / stopped，其余模式预留类型定义
export interface RuntimeState {
	mode: RuntimeMode;
}

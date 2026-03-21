export { EventBus } from "./event-bus";

// 全局单例
import { EventBus } from "./event-bus";
export const eventBus = new EventBus();

import type { EventMap, EventName } from "@/types";

type Handler<T> = (payload: T) => void;

interface Subscription {
	event: EventName;
	handler: Handler<unknown>;
}

export class EventBus {
	private listeners = new Map<EventName, Set<Handler<unknown>>>();
	private history: Array<{ event: EventName; payload: unknown; timestamp: number }> = [];
	private historyLimit = 200;

	on<E extends EventName>(event: E, handler: Handler<EventMap[E]>): () => void {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, new Set());
		}
		const handlers = this.listeners.get(event)!;
		handlers.add(handler as Handler<unknown>);

		return () => {
			handlers.delete(handler as Handler<unknown>);
			if (handlers.size === 0) {
				this.listeners.delete(event);
			}
		};
	}

	once<E extends EventName>(event: E, handler: Handler<EventMap[E]>): () => void {
		const unsubscribe = this.on(event, (payload) => {
			unsubscribe();
			handler(payload);
		});
		return unsubscribe;
	}

	emit<E extends EventName>(event: E, ...args: EventMap[E] extends void ? [] : [EventMap[E]]): void {
		const payload = args[0] as EventMap[E];

		this.recordHistory(event, payload);

		const handlers = this.listeners.get(event);
		if (!handlers) return;

		for (const handler of handlers) {
			try {
				handler(payload);
			} catch (err) {
				console.error(`[EventBus] handler error on "${event}":`, err);
			}
		}
	}

	// 批量订阅，返回统一的取消函数
	subscribe(subscriptions: Subscription[]): () => void {
		const unsubscribes = subscriptions.map((sub) =>
			this.on(sub.event, sub.handler)
		);
		return () => unsubscribes.forEach((unsub) => unsub());
	}

	getHistory() {
		return [...this.history];
	}

	clearHistory() {
		this.history = [];
	}

	listenerCount(event: EventName): number {
		return this.listeners.get(event)?.size ?? 0;
	}

	removeAllListeners(event?: EventName) {
		if (event) {
			this.listeners.delete(event);
		} else {
			this.listeners.clear();
		}
	}

	private recordHistory(event: EventName, payload: unknown) {
		this.history.push({ event, payload, timestamp: Date.now() });
		if (this.history.length > this.historyLimit) {
			this.history = this.history.slice(-this.historyLimit);
		}
	}
}

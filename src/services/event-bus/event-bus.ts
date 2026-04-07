import type { EventMap, EventName } from "@/types";

type Handler<T> = (payload: T) => void;

export interface EventHistoryEntry {
	sequence: number;
	event: EventName;
	payload: unknown;
	timestamp: number;
}

interface Subscription {
	event: EventName;
	handler: Handler<unknown>;
}

export class EventBus {
	private listeners = new Map<EventName, Set<Handler<unknown>>>();
	private history: EventHistoryEntry[] = [];
	private historyLimit = 500;
	private historyListeners = new Set<() => void>();
	private historyVersion = 0;
	private sequenceCounter = 0;

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

	subscribeHistory(listener: () => void): () => void {
		this.historyListeners.add(listener);
		return () => {
			this.historyListeners.delete(listener);
		};
	}

	getHistory(): readonly EventHistoryEntry[] {
		return this.history;
	}

	getHistoryVersion(): number {
		return this.historyVersion;
	}

	clearHistory() {
		this.history = [];
		this.notifyHistoryListeners();
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
		this.history.push({
			sequence: this.sequenceCounter++,
			event,
			payload,
			timestamp: Date.now(),
		});
		if (this.history.length > this.historyLimit) {
			this.history = this.history.slice(-this.historyLimit);
		}
		this.notifyHistoryListeners();
	}

	private notifyHistoryListeners() {
		this.historyVersion += 1;
		for (const listener of this.historyListeners) {
			try {
				listener();
			} catch (err) {
				console.error("[EventBus] history listener error:", err);
			}
		}
	}
}

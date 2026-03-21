export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

export class LoggerService {
	private module: string;
	private minLevel: LogLevel;

	constructor(module: string, minLevel: LogLevel = "debug") {
		this.module = module;
		this.minLevel = minLevel;
	}

	debug(message: string, ...args: unknown[]) {
		this.log("debug", message, ...args);
	}

	info(message: string, ...args: unknown[]) {
		this.log("info", message, ...args);
	}

	warn(message: string, ...args: unknown[]) {
		this.log("warn", message, ...args);
	}

	error(message: string, ...args: unknown[]) {
		this.log("error", message, ...args);
	}

	private log(level: LogLevel, message: string, ...args: unknown[]) {
		if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

		const timestamp = new Date().toISOString();
		const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.module}]`;

		switch (level) {
			case "debug":
				console.debug(prefix, message, ...args);
				break;
			case "info":
				console.info(prefix, message, ...args);
				break;
			case "warn":
				console.warn(prefix, message, ...args);
				break;
			case "error":
				console.error(prefix, message, ...args);
				break;
		}
	}
}

// 工厂函数：为每个模块创建独立的 logger 实例
export function createLogger(module: string, minLevel?: LogLevel): LoggerService {
	return new LoggerService(module, minLevel);
}

import type { EventBus } from "@/services/event-bus";
import type { DelegatedExecutionRecord, DelegationMemoryState } from "@/types";

const MAX_RECORDS = 10;

function cloneRecord(record: DelegatedExecutionRecord): DelegatedExecutionRecord {
	return {
		...record,
		plannedActions: [...record.plannedActions],
		attemptedActions: [...record.attemptedActions],
		verificationResult: { ...record.verificationResult },
	};
}

function makeInitialState(): DelegationMemoryState {
	return {
		latestRecord: null,
		recentRecords: [],
	};
}

export class DelegationMemoryService {
	private bus: EventBus;
	private state: DelegationMemoryState = makeInitialState();

	constructor(bus: EventBus) {
		this.bus = bus;
	}

	getState(): Readonly<DelegationMemoryState> {
		return {
			latestRecord: this.state.latestRecord ? cloneRecord(this.state.latestRecord) : null,
			recentRecords: this.state.recentRecords.map(cloneRecord),
		};
	}

	getLatestRecord(): DelegatedExecutionRecord | null {
		return this.state.latestRecord ? cloneRecord(this.state.latestRecord) : null;
	}

	getLatestSuccessfulRecordByGame(gameId: string): DelegatedExecutionRecord | null {
		const match = this.state.recentRecords.find((record) => record.sourceGame === gameId && record.verificationResult.success);
		return match ? cloneRecord(match) : null;
	}

	appendRecord(input: Omit<DelegatedExecutionRecord, "id"> & { id?: string }): DelegatedExecutionRecord {
		const record: DelegatedExecutionRecord = {
			...input,
			id: input.id ?? `delegated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			verificationResult: { ...input.verificationResult },
		};
		this.state.latestRecord = record;
		this.state.recentRecords = [record, ...this.state.recentRecords.filter((entry) => entry.id !== record.id)].slice(0, MAX_RECORDS);
		this.bus.emit("delegation-memory:record-added", { record: cloneRecord(record) });
		this.emitState();
		return cloneRecord(record);
	}

	updateRecord(recordId: string, patch: Partial<DelegatedExecutionRecord>): DelegatedExecutionRecord | null {
		const current = this.state.recentRecords.find((record) => record.id === recordId);
		if (!current) {
			return null;
		}
		const updated: DelegatedExecutionRecord = {
			...current,
			...patch,
			verificationResult: patch.verificationResult
				? { ...patch.verificationResult }
				: { ...current.verificationResult },
		};
		this.state.recentRecords = this.state.recentRecords.map((record) => (record.id === recordId ? updated : record));
		this.state.latestRecord = this.state.recentRecords[0] ?? null;
		this.emitState();
		return cloneRecord(updated);
	}

	buildPromptContext(records: readonly DelegatedExecutionRecord[] = this.state.recentRecords.slice(0, 3)): string {
		if (!records.length) {
			return "";
		}
		return records.map((record, index) => {
			return [
				`#${index + 1}`,
				`mode=${record.mode}`,
				`game=${record.sourceGame ?? "none"}`,
				`trigger=${record.trigger}`,
				record.requestText ? `request=${record.requestText}` : "",
				record.analysisSource ? `analysis=${record.analysisSource}` : "",
				record.decisionSummary ? `decision=${record.decisionSummary}` : "",
				record.plannedActions.length ? `planned=${record.plannedActions.join(" -> ")}` : "",
				record.attemptedActions.length ? `attempted=${record.attemptedActions.join(" -> ")}` : "",
				record.selectedAction ? `action=${record.selectedAction}` : "",
				`summary=${record.executionSummary}`,
				`verified=${record.verificationResult.success ? "success" : "failed"}`,
				`boardChanged=${record.verificationResult.boardChanged ? "yes" : "no"}`,
				record.verificationResult.error ? `error=${record.verificationResult.error}` : "",
				record.followUpSummary ? `followUp=${record.followUpSummary}` : "",
				record.nextStepHint ? `nextStep=${record.nextStepHint}` : "",
				`emotion=${record.emotion}`,
			].filter(Boolean).join(" | ");
		}).join("\n");
	}

	buildFocusedPromptContext(input: {
		currentRecordId?: string | null;
		sourceGame?: string | null;
	}): string {
		const sections: string[] = [];
		const currentRecord = input.currentRecordId
			? this.state.recentRecords.find((record) => record.id === input.currentRecordId) ?? null
			: this.state.latestRecord;
		const sameGameLatestSuccess = input.sourceGame
			? this.state.recentRecords.find((record) => record.sourceGame === input.sourceGame && record.verificationResult.success)
			: null;
		const nextStepHints = this.state.recentRecords
			.filter((record) => record.nextStepHint)
			.slice(0, 3)
			.map((record, index) => `#${index + 1} ${record.sourceGame ?? "none"} | ${record.nextStepHint}`);

		if (currentRecord) {
			sections.push(`【本轮托管记录】\n${this.buildPromptContext([currentRecord])}`);
		}
		if (sameGameLatestSuccess && sameGameLatestSuccess.id !== currentRecord?.id) {
			sections.push(`【同游戏最近成功记录】\n${this.buildPromptContext([sameGameLatestSuccess])}`);
		}
		if (nextStepHints.length) {
			sections.push(`【最近下一步提示】\n${nextStepHints.join("\n")}`);
		}

		return sections.join("\n\n");
	}

	private emitState() {
		this.bus.emit("delegation-memory:state-change", { state: this.getState() });
	}
}

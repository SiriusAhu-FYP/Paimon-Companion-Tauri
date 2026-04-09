export interface DecisionHistoryLike {
	planSignature: string;
	boardChanged: boolean;
	repeatedFailureCount: number;
}

export function buildPlanSignature(actions: string[]): string {
	return actions.join(" > ");
}

export function countRepeatedFailures<T extends DecisionHistoryLike>(
	history: readonly T[],
	planSignature: string,
): number {
	return history.reduce((count, entry) => {
		if (!entry.boardChanged && entry.planSignature === planSignature) {
			return count + 1;
		}
		return count;
	}, 0);
}

export function buildRepeatedFailureHint<T extends DecisionHistoryLike>(
	entry: T | null | undefined,
): string | null {
	if (!entry || entry.boardChanged || entry.repeatedFailureCount <= 0) {
		return null;
	}

	return `The exact last plan already failed ${entry.repeatedFailureCount} time(s) without verified progress. Do not repeat it unchanged unless the board is clearly different now.`;
}

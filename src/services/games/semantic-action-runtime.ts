import type { OrchestratorService } from "@/services/orchestrator";
import type {
	FunctionalTarget,
	SemanticActionExecutionResult,
	SemanticGameActionDefinition,
} from "@/types";

export async function executeSemanticAction<ActionId extends string>(
	orchestrator: OrchestratorService,
	target: FunctionalTarget,
	action: SemanticGameActionDefinition<ActionId>,
): Promise<SemanticActionExecutionResult<ActionId>> {
	const taskIds: string[] = [];
	let beforeSnapshotAvailable = false;
	let afterSnapshotAvailable = false;

	for (const step of action.steps) {
		if (step.kind === "focus") {
			const task = await orchestrator.runFocusTask(target);
			taskIds.push(task.id);
			continue;
		}

		if (step.kind === "send-key") {
			const task = await orchestrator.runSendKeyTask(step.key, target);
			taskIds.push(task.id);
			beforeSnapshotAvailable = beforeSnapshotAvailable || Boolean(task.beforeSnapshot);
			afterSnapshotAvailable = afterSnapshotAvailable || Boolean(task.afterSnapshot);
			continue;
		}

		const task = await orchestrator.runSendMouseTask(
			{
				x: step.x,
				y: step.y,
				button: step.button,
				action: step.action,
			},
			target,
		);
		taskIds.push(task.id);
		beforeSnapshotAvailable = beforeSnapshotAvailable || Boolean(task.beforeSnapshot);
		afterSnapshotAvailable = afterSnapshotAvailable || Boolean(task.afterSnapshot);
	}

	return {
		actionId: action.id,
		label: action.label,
		taskIds,
		beforeSnapshotAvailable,
		afterSnapshotAvailable,
	};
}

import type { Game2048Move } from "@/types";

export interface Game2048PlannerResult {
	preferredMoves: Game2048Move[];
	summary: string;
	bestMove: Game2048Move | null;
}

export interface Game2048PlannerOptions {
	discouragedOpeningMoves?: Game2048Move[];
	discouragedPlanSignature?: string | null;
}

interface MoveEvaluation {
	move: Game2048Move;
	score: number;
	changed: boolean;
}

const DEFAULT_MOVE_ORDER: Game2048Move[] = ["move_up", "move_left", "move_right", "move_down"];
const WEIGHTS = [
	[16, 15, 14, 13],
	[9, 10, 11, 12],
	[8, 7, 6, 5],
	[1, 2, 3, 4],
];
const DISCOURAGED_OPENING_PENALTY = 10_000;

export function parseGame2048Grid(rows: unknown): number[][] {
	if (!Array.isArray(rows) || rows.length !== 4) {
		throw new Error("2048 rows must contain exactly 4 rows");
	}

	return rows.map((row) => {
		if (!Array.isArray(row) || row.length !== 4) {
			throw new Error("each 2048 row must contain exactly 4 cells");
		}
		return row.map((cell) => {
			const value = Number(cell);
			if (!Number.isInteger(value) || value < 0) {
				throw new Error("2048 cells must be non-negative integers");
			}
			return value;
		});
	});
}

export function rankGame2048Moves(
	rows: number[][],
	previousMove: Game2048Move | null,
	options?: Game2048PlannerOptions,
): Game2048PlannerResult {
	const board = parseGame2048Grid(rows);
	const evaluations = DEFAULT_MOVE_ORDER.map((move) => evaluateMove(board, move, previousMove, options));
	evaluations.sort((a, b) => {
		if (a.changed !== b.changed) {
			return a.changed ? -1 : 1;
		}
		if (b.score !== a.score) {
			return b.score - a.score;
		}
		return DEFAULT_MOVE_ORDER.indexOf(a.move) - DEFAULT_MOVE_ORDER.indexOf(b.move);
	});

	let preferredMoves = evaluations.map((entry) => entry.move);
	if (options?.discouragedPlanSignature && buildPlanSignature(preferredMoves) === options.discouragedPlanSignature) {
		preferredMoves = rotateOrderAwayFromSignature(preferredMoves, options.discouragedPlanSignature);
	}
	const bestMove = evaluations.find((entry) => entry.changed)?.move ?? null;
	const discouragedCount = options?.discouragedOpeningMoves?.length ?? 0;

	return {
		preferredMoves,
		bestMove,
		summary: bestMove
			? `planner ranked ${bestMove} first with ${evaluations.filter((entry) => entry.changed).length} valid move(s)${discouragedCount ? ` while avoiding ${discouragedCount} discouraged opening move(s)` : ""}`
			: "planner found no board-changing move",
	};
}

function evaluateMove(
	board: number[][],
	move: Game2048Move,
	previousMove: Game2048Move | null,
	options?: Game2048PlannerOptions,
): MoveEvaluation {
	const { board: nextBoard, changed, merges } = simulateMove(board, move);
	if (!changed) {
		return { move, changed, score: Number.NEGATIVE_INFINITY };
	}

	const emptyCells = nextBoard.flat().filter((value) => value === 0).length;
	const weightedScore = weightedBoardScore(nextBoard);
	const cornerBonus = highestTileCornerBonus(nextBoard);
	const continuityBonus = previousMove === move ? 80 : 0;
	const discouragedPenalty = options?.discouragedOpeningMoves?.includes(move) ? DISCOURAGED_OPENING_PENALTY : 0;
	const score = weightedScore + emptyCells * 250 + merges * 120 + cornerBonus + continuityBonus - discouragedPenalty;

	return { move, changed, score };
}

function simulateMove(board: number[][], move: Game2048Move): { board: number[][]; changed: boolean; merges: number } {
	const working = cloneBoard(board);
	let merges = 0;

	if (move === "move_left" || move === "move_right") {
		for (let rowIndex = 0; rowIndex < 4; rowIndex += 1) {
			const line = working[rowIndex];
			const source = move === "move_left" ? line : [...line].reverse();
			const result = collapseLine(source);
			merges += result.merges;
			working[rowIndex] = move === "move_left" ? result.line : [...result.line].reverse();
		}
	} else {
		for (let columnIndex = 0; columnIndex < 4; columnIndex += 1) {
			const column = [working[0][columnIndex], working[1][columnIndex], working[2][columnIndex], working[3][columnIndex]];
			const source = move === "move_up" ? column : [...column].reverse();
			const result = collapseLine(source);
			merges += result.merges;
			const resolved = move === "move_up" ? result.line : [...result.line].reverse();
			for (let rowIndex = 0; rowIndex < 4; rowIndex += 1) {
				working[rowIndex][columnIndex] = resolved[rowIndex];
			}
		}
	}

	return {
		board: working,
		changed: !boardsEqual(board, working),
		merges,
	};
}

function collapseLine(source: number[]): { line: number[]; merges: number } {
	const compact = source.filter((value) => value > 0);
	const resolved: number[] = [];
	let merges = 0;

	for (let index = 0; index < compact.length; index += 1) {
		const current = compact[index];
		const next = compact[index + 1];
		if (current !== undefined && next !== undefined && current === next) {
			resolved.push(current * 2);
			merges += 1;
			index += 1;
		} else if (current !== undefined) {
			resolved.push(current);
		}
	}

	while (resolved.length < 4) {
		resolved.push(0);
	}

	return { line: resolved, merges };
}

function weightedBoardScore(board: number[][]): number {
	let total = 0;
	for (let rowIndex = 0; rowIndex < 4; rowIndex += 1) {
		for (let columnIndex = 0; columnIndex < 4; columnIndex += 1) {
			total += board[rowIndex][columnIndex] * WEIGHTS[rowIndex][columnIndex];
		}
	}
	return total;
}

function highestTileCornerBonus(board: number[][]): number {
	const maxTile = Math.max(...board.flat());
	if (maxTile <= 0) {
		return 0;
	}
	return board[0][0] === maxTile ? maxTile * 12 : board[0][3] === maxTile ? maxTile * 4 : 0;
}

function cloneBoard(board: number[][]): number[][] {
	return board.map((row) => [...row]);
}

function boardsEqual(left: number[][], right: number[][]): boolean {
	for (let rowIndex = 0; rowIndex < 4; rowIndex += 1) {
		for (let columnIndex = 0; columnIndex < 4; columnIndex += 1) {
			if (left[rowIndex][columnIndex] !== right[rowIndex][columnIndex]) {
				return false;
			}
		}
	}
	return true;
}

function buildPlanSignature(moves: Game2048Move[]): string {
	return moves.join(" > ");
}

function rotateOrderAwayFromSignature(moves: Game2048Move[], discouragedPlanSignature: string): Game2048Move[] {
	for (let offset = 1; offset < moves.length; offset += 1) {
		const rotated = moves.slice(offset).concat(moves.slice(0, offset));
		if (buildPlanSignature(rotated) !== discouragedPlanSignature) {
			return rotated;
		}
	}
	return moves;
}

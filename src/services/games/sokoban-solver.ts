import type { SokobanActionId } from "@/types";

type Tile = "#" | " " | "." | "$" | "*" | "@" | "+";

interface ParsedBoard {
	width: number;
	height: number;
	floors: Set<number>;
	walls: Set<number>;
	targets: Set<number>;
	boxes: Set<number>;
	player: number;
	rows: string[];
}

interface SearchNode {
	player: number;
	boxes: Set<number>;
	path: SokobanActionId[];
}

export interface SokobanSolverResult {
	plannedMoves: SokobanActionId[];
	solved: boolean;
	exploredStates: number;
	summary: string;
}

export interface SokobanSolverOptions {
	discouragedOpeningMoves?: SokobanActionId[];
	discouragedPlanSignature?: string | null;
}

const DIRS: Array<{ move: SokobanActionId; dx: number; dy: number }> = [
	{ move: "move_up", dx: 0, dy: -1 },
	{ move: "move_left", dx: -1, dy: 0 },
	{ move: "move_right", dx: 1, dy: 0 },
	{ move: "move_down", dx: 0, dy: 1 },
];

const MAX_SEARCH_STATES = 4000;
const MAX_PLAN_LENGTH = 32;
const MAX_RETURNED_MOVES = 12;

export function parseSokobanBoardRows(rows: string[]): ParsedBoard {
	const normalizedRows = rows.map((row) => row.replace(/\r/g, ""));
	if (!normalizedRows.length) {
		throw new Error("empty Sokoban board");
	}
	const width = normalizedRows[0]?.length ?? 0;
	if (width <= 0 || normalizedRows.some((row) => row.length !== width)) {
		throw new Error("Sokoban board rows must have consistent width");
	}

	const floors = new Set<number>();
	const walls = new Set<number>();
	const targets = new Set<number>();
	const boxes = new Set<number>();
	let player = -1;

	normalizedRows.forEach((row, y) => {
		for (let x = 0; x < width; x += 1) {
			const tile = row[x] as Tile;
			const index = toIndex(x, y, width);
			switch (tile) {
				case "#":
					walls.add(index);
					break;
				case " ":
					floors.add(index);
					break;
				case ".":
					floors.add(index);
					targets.add(index);
					break;
				case "$":
					floors.add(index);
					boxes.add(index);
					break;
				case "*":
					floors.add(index);
					boxes.add(index);
					targets.add(index);
					break;
				case "@":
					floors.add(index);
					player = index;
					break;
				case "+":
					floors.add(index);
					targets.add(index);
					player = index;
					break;
				default:
					throw new Error(`unsupported Sokoban tile: ${tile}`);
			}
		}
	});

	if (player < 0) {
		throw new Error("Sokoban board missing player");
	}
	if (!boxes.size) {
		throw new Error("Sokoban board missing boxes");
	}
	if (!targets.size) {
		throw new Error("Sokoban board missing targets");
	}

	return {
		width,
		height: normalizedRows.length,
		floors,
		walls,
		targets,
		boxes,
		player,
		rows: normalizedRows,
	};
}

export function findSokobanPlan(rows: string[], options?: SokobanSolverOptions): SokobanSolverResult | null {
	const board = parseSokobanBoardRows(rows);
	const initialNode: SearchNode = {
		player: board.player,
		boxes: new Set(board.boxes),
		path: [],
	};
	const queue: SearchNode[] = [initialNode];
	const visited = new Set<string>([stateKey(initialNode.player, initialNode.boxes)]);
	const orderedDirs = prioritizeDirs(options?.discouragedOpeningMoves ?? []);
	let exploredStates = 0;

	while (queue.length > 0 && exploredStates < MAX_SEARCH_STATES) {
		const current = queue.shift()!;
		exploredStates += 1;

		if (isSolved(current.boxes, board.targets)) {
			const plannedMoves = current.path.slice(0, MAX_RETURNED_MOVES);
			if (options?.discouragedPlanSignature && buildPlanSignature(plannedMoves) === options.discouragedPlanSignature) {
				continue;
			}
			return {
				plannedMoves,
				solved: true,
				exploredStates,
				summary: "solver found a solved path",
			};
		}

		const reachability = buildReachabilityMap(board, current.player, current.boxes);
		for (const boxIndex of current.boxes) {
			const { x, y } = fromIndex(boxIndex, board.width);
			for (const dir of orderedDirs) {
				const pushFromX = x - dir.dx;
				const pushFromY = y - dir.dy;
				const pushToX = x + dir.dx;
				const pushToY = y + dir.dy;
				if (!isInside(pushFromX, pushFromY, board.width, board.height) || !isInside(pushToX, pushToY, board.width, board.height)) {
					continue;
				}
				const pushFrom = toIndex(pushFromX, pushFromY, board.width);
				const pushTo = toIndex(pushToX, pushToY, board.width);
				if (pushFrom !== current.player && !reachability.predecessor.has(pushFrom)) {
					continue;
				}
				if (board.walls.has(pushTo) || current.boxes.has(pushTo) || !board.floors.has(pushTo)) {
					continue;
				}
				if (isDeadCorner(pushTo, board, current.boxes)) {
					continue;
				}
				const route = reconstructPath(pushFrom, reachability.predecessor);
				const nextPath = [...current.path, ...route, dir.move];
				if (nextPath.length > MAX_PLAN_LENGTH) {
					continue;
				}
				const nextBoxes = new Set(current.boxes);
				nextBoxes.delete(boxIndex);
				nextBoxes.add(pushTo);
				const nextPlayer = boxIndex;
				const key = stateKey(nextPlayer, nextBoxes);
				if (visited.has(key)) {
					continue;
				}
				visited.add(key);
				queue.push({
					player: nextPlayer,
					boxes: nextBoxes,
					path: nextPath,
				});
			}
		}
	}

	return null;
}

function buildReachabilityMap(board: ParsedBoard, player: number, boxes: Set<number>) {
	const predecessor = new Map<number, { previous: number; move: SokobanActionId }>();
	const visited = new Set<number>([player]);
	const queue = [player];

	while (queue.length > 0) {
		const current = queue.shift()!;
		const { x, y } = fromIndex(current, board.width);
		for (const dir of DIRS) {
			const nx = x + dir.dx;
			const ny = y + dir.dy;
			if (!isInside(nx, ny, board.width, board.height)) {
				continue;
			}
			const next = toIndex(nx, ny, board.width);
			if (visited.has(next) || board.walls.has(next) || boxes.has(next) || !board.floors.has(next)) {
				continue;
			}
			visited.add(next);
			predecessor.set(next, { previous: current, move: dir.move });
			queue.push(next);
		}
	}

	return { predecessor, visited };
}

function reconstructPath(target: number, predecessor: Map<number, { previous: number; move: SokobanActionId }>): SokobanActionId[] {
	const path: SokobanActionId[] = [];
	let cursor = target;
	while (predecessor.has(cursor)) {
		const step = predecessor.get(cursor)!;
		path.push(step.move);
		cursor = step.previous;
	}
	path.reverse();
	return path;
}

function isSolved(boxes: Set<number>, targets: Set<number>): boolean {
	for (const box of boxes) {
		if (!targets.has(box)) {
			return false;
		}
	}
	return true;
}

function isDeadCorner(position: number, board: ParsedBoard, boxes: Set<number>): boolean {
	if (board.targets.has(position)) {
		return false;
	}
	const { x, y } = fromIndex(position, board.width);
	const upBlocked = isBlocked(x, y - 1, board, boxes);
	const downBlocked = isBlocked(x, y + 1, board, boxes);
	const leftBlocked = isBlocked(x - 1, y, board, boxes);
	const rightBlocked = isBlocked(x + 1, y, board, boxes);
	return (upBlocked || downBlocked) && (leftBlocked || rightBlocked);
}

function isBlocked(x: number, y: number, board: ParsedBoard, boxes: Set<number>): boolean {
	if (!isInside(x, y, board.width, board.height)) {
		return true;
	}
	const index = toIndex(x, y, board.width);
	return board.walls.has(index) || boxes.has(index) || !board.floors.has(index);
}

function stateKey(player: number, boxes: Set<number>): string {
	return `${player}|${Array.from(boxes).sort((a, b) => a - b).join(",")}`;
}

function buildPlanSignature(moves: SokobanActionId[]): string {
	return moves.join(" > ");
}

function prioritizeDirs(discouragedOpeningMoves: SokobanActionId[]) {
	if (!discouragedOpeningMoves.length) {
		return DIRS;
	}
	const discouraged = new Set(discouragedOpeningMoves);
	return [...DIRS].sort((left, right) => {
		const leftScore = discouraged.has(left.move) ? 1 : 0;
		const rightScore = discouraged.has(right.move) ? 1 : 0;
		if (leftScore !== rightScore) {
			return leftScore - rightScore;
		}
		return DIRS.indexOf(left) - DIRS.indexOf(right);
	});
}

function toIndex(x: number, y: number, width: number): number {
	return y * width + x;
}

function fromIndex(index: number, width: number) {
	return { x: index % width, y: Math.floor(index / width) };
}

function isInside(x: number, y: number, width: number, height: number): boolean {
	return x >= 0 && y >= 0 && x < width && y < height;
}

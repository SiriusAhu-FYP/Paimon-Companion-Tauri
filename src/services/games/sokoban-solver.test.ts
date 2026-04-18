import { describe, expect, it } from "vitest";
import { findSokobanPlan, parseSokobanBoardRows } from "./sokoban-solver";

describe("sokoban-solver", () => {
	it("parses a compact Sokoban board grid", () => {
		const board = parseSokobanBoardRows([
			"#####",
			"#@$.#",
			"#####",
		]);

		expect(board.width).toBe(5);
		expect(board.height).toBe(3);
		expect(board.boxes.size).toBe(1);
		expect(board.targets.size).toBe(1);
	});

	it("finds a short solved plan for a simple one-push puzzle", () => {
		const result = findSokobanPlan([
			"#####",
			"#@$.#",
			"#####",
		]);

		expect(result).not.toBeNull();
		expect(result?.solved).toBe(true);
		expect(result?.plannedMoves).toEqual(["move_right"]);
	});

	it("returns null when the box is already deadlocked in a corner", () => {
		const result = findSokobanPlan([
			"#####",
			"#@  #",
			"#  .#",
			"# $##",
			"#####",
		]);

		expect(result).toBeNull();
	});

	it("skips a plan when it exactly matches the discouraged failed signature", () => {
		const result = findSokobanPlan([
			"#####",
			"#@$.#",
			"#####",
		], {
			discouragedPlanSignature: "move_right",
		});

		expect(result).toBeNull();
	});
});

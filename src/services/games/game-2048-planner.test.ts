import { describe, expect, it } from "vitest";
import { parseGame2048Grid, rankGame2048Moves } from "./game-2048-planner";

describe("game-2048-planner", () => {
	it("parses a 4x4 integer grid", () => {
		const grid = parseGame2048Grid([
			[2, 0, 0, 0],
			[4, 0, 0, 0],
			[0, 0, 0, 0],
			[0, 0, 0, 0],
		]);

		expect(grid[0][0]).toBe(2);
		expect(grid[1][0]).toBe(4);
	});

	it("prefers a stable left merge when it improves the top-left corner", () => {
		const result = rankGame2048Moves([
			[2, 2, 0, 0],
			[0, 0, 0, 0],
			[0, 0, 0, 0],
			[0, 0, 0, 0],
		], null);

		expect(result.bestMove).toBe("move_left");
		expect(result.preferredMoves[0]).toBe("move_left");
		expect(new Set(result.preferredMoves).size).toBe(4);
	});

	it("prefers an upward merge when the stack is vertical", () => {
		const result = rankGame2048Moves([
			[2, 0, 0, 0],
			[2, 0, 0, 0],
			[0, 0, 0, 0],
			[0, 0, 0, 0],
		], null);

		expect(result.bestMove).toBe("move_up");
		expect(result.preferredMoves[0]).toBe("move_up");
	});

	it("avoids repeating a discouraged failed opening move when alternatives exist", () => {
		const result = rankGame2048Moves([
			[2, 2, 0, 0],
			[0, 0, 0, 0],
			[0, 0, 0, 0],
			[0, 0, 0, 0],
		], null, {
			discouragedOpeningMoves: ["move_left"],
		});

		expect(result.bestMove).toBe("move_right");
		expect(result.preferredMoves[0]).toBe("move_right");
	});
});

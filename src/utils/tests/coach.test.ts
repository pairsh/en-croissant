import { INITIAL_FEN } from "chessops/fen";
import { describe, expect, it } from "vitest";
import type { BestMoves } from "@/bindings";
import { buildCoachReport } from "@/utils/coach";

function bestMoves(
    sanMoves: string[],
    uciMoves: string[],
    value: BestMoves["score"]["value"] = { type: "cp", value: 20 },
): BestMoves {
    return {
        depth: 18,
        score: { value, wdl: null },
        uciMoves,
        sanMoves,
        multipv: 1,
        nps: 1_000_000,
        nodes: 1_000_000,
    };
}

describe("buildCoachReport", () => {
    it("summarises the initial position and explains the engine move", () => {
        const report = buildCoachReport(
            INITIAL_FEN,
            [bestMoves(["e4", "e5"], ["e2e4", "e7e5"])],
            null,
        );
        expect(report).not.toBeNull();
        expect(report?.phase).toBe("opening");
        expect(report?.best?.san).toBe("e4");
        expect(report?.scoreText).toBe("+0.20");
        expect(report?.best?.points.some((point) => point.key === "Coach.Reason.Center")).toBe(
            true,
        );
        expect(report?.whitePlan.length).toBeGreaterThan(0);
        expect(report?.blackPlan.length).toBeGreaterThan(0);
    });

    it("surfaces a forced mate from the engine score", () => {
        const report = buildCoachReport(
            "7k/6pp/8/8/8/8/5PPP/4R1K1 w - - 0 1",
            [bestMoves(["Re8#"], ["e1e8"], { type: "mate", value: 1 })],
            null,
        );
        expect(report?.advantage).toBe("white");
        expect(report?.tactics.some((point) => point.key === "Coach.Tactic.ForcedMate")).toBe(true);
        expect(report?.best?.points.some((point) => point.key === "Coach.Reason.Mate")).toBe(true);
    });

    it("explains the previous capture without inventing an engine line", () => {
        const report = buildCoachReport(
            "rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2",
            [],
            "exd5",
        );
        expect(report?.best).toBeNull();
        expect(report?.last?.san).toBe("exd5");
        expect(report?.last?.points.some((point) => point.key === "Coach.Reason.Capture")).toBe(
            true,
        );
        expect(report?.tactics.some((point) => point.key === "Coach.Tactic.LastCapture")).toBe(
            true,
        );
        expect(report?.blackPlan.length).toBeGreaterThan(0);
    });

    it("returns null for an unparseable FEN", () => {
        expect(buildCoachReport("not a fen", [], null)).toBeNull();
    });
});

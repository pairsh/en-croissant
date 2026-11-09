import {
    type Color,
    type Piece,
    type Role,
    type Square,
    parseUci,
    squareFile,
    squareRank,
} from "chessops";
import type { Board } from "chessops/board";
import type { Chess } from "chessops/chess";
import { parseSan } from "chessops/san";
import { squareFromCoords } from "chessops/util";
import type { BestMoves } from "@/bindings";
import { positionFromFen } from "./chessops";
import { formatScore } from "./score";

export type CoachPhase = "opening" | "middlegame" | "endgame";
export type CoachAdvantage = "white" | "black" | "equal";

export interface CoachPoint {
    key: string;
    params?: Record<string, string | number>;
}

export interface CoachMove {
    san: string;
    points: CoachPoint[];
}

export interface CoachReport {
    phase: CoachPhase;
    turn: Color;
    advantage: CoachAdvantage;
    /** Evaluation from the side to move's point of view, e.g. +0.35 or M3. */
    scoreText: string;
    best: CoachMove | null;
    last: CoachMove | null;
    whitePlan: CoachPoint[];
    blackPlan: CoachPoint[];
    tactics: CoachPoint[];
}

const MATERIAL: Record<Role, number> = {
    pawn: 1,
    knight: 3,
    bishop: 3.25,
    rook: 5,
    queen: 9,
    king: 0,
};

const HOME_MINORS: Record<Color, Square[]> = {
    white: [1, 6, 2, 5],
    black: [57, 62, 58, 61],
};

// d4, e4, d5, e5 (a1 = 0)
const CENTER_SQUARES: Square[] = [27, 28, 35, 36];
const FILE_NAMES = ["a", "b", "c", "d", "e", "f", "g", "h"];

interface PositionFacts {
    whiteMaterial: number;
    blackMaterial: number;
    whiteDevelopment: number;
    blackDevelopment: number;
    whiteKingSafety: number;
    blackKingSafety: number;
    whiteCenter: number;
    blackCenter: number;
    openFiles: string[];
    passedPawns: Record<Color, string[]>;
    phase: CoachPhase;
    check: boolean;
}

function opposite(color: Color): Color {
    return color === "white" ? "black" : "white";
}

function materialOf(board: Board, color: Color): number {
    let value = 0;
    for (const [, piece] of board) {
        if (piece.color === color) value += MATERIAL[piece.role];
    }
    return Math.round(value * 100) / 100;
}

function hasPawnOnFile(board: Board, file: number): boolean {
    for (const square of board.pieces("white", "pawn")) {
        if (squareFile(square) === file) return true;
    }
    for (const square of board.pieces("black", "pawn")) {
        if (squareFile(square) === file) return true;
    }
    return false;
}

function developmentOf(board: Board, color: Color): number {
    let developed = 0;
    for (const square of HOME_MINORS[color]) {
        const piece = board.get(square);
        if (
            !piece ||
            piece.color !== color ||
            (piece.role !== "knight" && piece.role !== "bishop")
        ) {
            developed++;
        }
    }
    return developed;
}

function kingSafetyOf(pos: Chess, color: Color): number {
    const king = pos.board.kingOf(color);
    if (king === undefined) return 0;
    const file = squareFile(king);
    const rank = squareRank(king);
    const direction = color === "white" ? 1 : -1;
    let shield = 0;
    for (let df = -1; df <= 1; df++) {
        const shieldSquare = squareFromCoords(file + df, rank + direction);
        if (shieldSquare !== undefined && pos.board.pieces(color, "pawn").has(shieldSquare)) {
            shield++;
        }
    }
    const shieldFiles = [file - 1, file, file + 1].filter((f) => f >= 0 && f <= 7);
    const openNearKing = shieldFiles.some((f) => !hasPawnOnFile(pos.board, f));
    const castled =
        (color === "white" && (king === 6 || king === 2)) ||
        (color === "black" && (king === 62 || king === 58));
    let score = 82 - (3 - shield) * 11;
    if (openNearKing) score -= 10;
    if (castled) score += 10;
    else if (pos.fullmoves > 10) score -= 12;
    score -= pos.kingAttackers(king, opposite(color), pos.board.occupied).size() * 5;
    return Math.max(5, Math.min(100, Math.round(score)));
}

function centerOf(board: Board, color: Color): number {
    let raw = 0;
    for (const square of CENTER_SQUARES) {
        const piece = board.get(square);
        if (piece?.color !== color) continue;
        raw += piece.role === "pawn" ? 3 : 2;
    }
    return Math.min(100, raw * 10);
}

function passedPawnFiles(board: Board, color: Color): string[] {
    const own: Square[] = [];
    const enemy: Square[] = [];
    for (const [square, piece] of board) {
        if (piece.role !== "pawn") continue;
        if (piece.color === color) own.push(square);
        else enemy.push(square);
    }
    const files = new Set<string>();
    for (const square of own) {
        const file = squareFile(square);
        const rank = squareRank(square);
        const blocked = enemy.some((other) => {
            if (Math.abs(squareFile(other) - file) > 1) return false;
            return color === "white" ? squareRank(other) > rank : squareRank(other) < rank;
        });
        if (!blocked) files.add(FILE_NAMES[file]!);
    }
    return [...files];
}

function factsFromPosition(fen: string): PositionFacts | null {
    const [pos] = positionFromFen(fen);
    if (!pos) return null;
    const whiteMaterial = materialOf(pos.board, "white");
    const blackMaterial = materialOf(pos.board, "black");
    const whiteDevelopment = developmentOf(pos.board, "white");
    const blackDevelopment = developmentOf(pos.board, "black");
    const totalMaterial = whiteMaterial + blackMaterial;
    const phase: CoachPhase =
        totalMaterial <= 26
            ? "endgame"
            : pos.fullmoves <= 10 && whiteDevelopment + blackDevelopment <= 3
              ? "opening"
              : "middlegame";
    return {
        whiteMaterial,
        blackMaterial,
        whiteDevelopment,
        blackDevelopment,
        whiteKingSafety: kingSafetyOf(pos, "white"),
        blackKingSafety: kingSafetyOf(pos, "black"),
        whiteCenter: centerOf(pos.board, "white"),
        blackCenter: centerOf(pos.board, "black"),
        openFiles: FILE_NAMES.filter((_, file) => !hasPawnOnFile(pos.board, file)),
        passedPawns: {
            white: passedPawnFiles(pos.board, "white"),
            black: passedPawnFiles(pos.board, "black"),
        },
        phase,
        check: pos.isCheck(),
    };
}

function whitePovCp(score: BestMoves["score"] | null | undefined, turn: Color): number | null {
    if (!score) return null;
    if (score.value.type === "mate")
        return score.value.value === 0 ? 0 : (score.value.value > 0 ? 1 : -1) * 1000;
    return turn === "white" ? score.value.value : -score.value.value;
}

function advantageOf(score: BestMoves["score"] | null | undefined, turn: Color): CoachAdvantage {
    if (!score) return "equal";
    if (score.value.type === "mate") {
        if (score.value.value > 0) return turn === "white" ? "white" : "black";
        if (score.value.value < 0) return turn === "white" ? "black" : "white";
        return "equal";
    }
    const cp = whitePovCp(score, turn) ?? 0;
    if (cp >= 45) return "white";
    if (cp <= -45) return "black";
    return "equal";
}

function movePoints(
    pos: Chess,
    san: string,
    uci: string | undefined,
    depth: number | undefined,
    preferred: boolean,
): CoachPoint[] {
    const points: CoachPoint[] = [];
    let move = parseSan(pos, san);
    if (!move && uci) move = parseUci(uci);
    let captured: Piece | undefined;
    let givesCheck = false;
    let isCastle = san.includes("O-O");
    if (move) {
        const after = pos.clone();
        if (san.includes("x") && !isCastle) captured = after.board.get(move.to);
        after.play(move);
        givesCheck = after.isCheck();
        if ("from" in move) {
            isCastle = isCastle || (move.from === 4 && (move.to === 6 || move.to === 2));
        }
    }
    if (san.includes("#")) points.push({ key: "Coach.Reason.Mate" });
    else if (san.includes("+") || givesCheck) points.push({ key: "Coach.Reason.Check" });
    if (san.includes("x")) {
        points.push({
            key: "Coach.Reason.Capture",
            ...(captured ? { params: { piece: captured.role } } : {}),
        });
    }
    if (san.includes("=")) points.push({ key: "Coach.Reason.Promotion" });
    if (isCastle) points.push({ key: "Coach.Reason.Castle" });
    if (move && "from" in move) {
        const central = CENTER_SQUARES.includes(move.to);
        if (central && !isCastle) points.push({ key: "Coach.Reason.Center" });
        const piece = pos.board.get(move.from);
        if (piece && (piece.role === "knight" || piece.role === "bishop") && isCastle === false) {
            points.push({ key: "Coach.Reason.Develop" });
        }
    }
    if (points.length === 0 && preferred) points.push({ key: "Coach.Reason.Improve" });
    if (preferred && depth !== undefined) {
        points.push({ key: "Coach.Reason.EngineTop", params: { depth } });
    }
    return points.slice(0, 4);
}

function planFor(facts: PositionFacts, color: Color, advantage: CoachAdvantage): CoachPoint[] {
    const ownMaterial = color === "white" ? facts.whiteMaterial : facts.blackMaterial;
    const otherMaterial = color === "white" ? facts.blackMaterial : facts.whiteMaterial;
    const materialDiff = ownMaterial - otherMaterial;
    const ownDevelopment = color === "white" ? facts.whiteDevelopment : facts.blackDevelopment;
    const ownKingSafety = color === "white" ? facts.whiteKingSafety : facts.blackKingSafety;
    const ownCenter = color === "white" ? facts.whiteCenter : facts.blackCenter;
    const ownPassed = facts.passedPawns[color];
    const points: CoachPoint[] = [];

    if (materialDiff >= 1) points.push({ key: "Coach.Plan.MaterialUp" });
    else if (materialDiff <= -1) points.push({ key: "Coach.Plan.MaterialDown" });
    if (ownDevelopment < 3) points.push({ key: "Coach.Plan.Develop" });
    if (ownKingSafety < 58) points.push({ key: "Coach.Plan.KingSafety" });
    if (ownCenter < 45) points.push({ key: "Coach.Plan.Center" });
    if (ownPassed.length > 0) {
        points.push({ key: "Coach.Plan.PassedPawn", params: { file: ownPassed[0]! } });
    } else {
        const open = facts.openFiles[0];
        if (open) points.push({ key: "Coach.Plan.OpenFile", params: { file: open } });
    }
    if (points.length < 2) {
        points.push({
            key:
                advantage === (color === "white" ? "white" : "black")
                    ? "Coach.Plan.KeepPressure"
                    : "Coach.Plan.Improve",
        });
    }
    return points.slice(0, 3);
}

function tacticalPoints(
    facts: PositionFacts,
    best: CoachMove | null,
    lastSan: string | null,
    score: BestMoves["score"] | null | undefined,
): CoachPoint[] {
    const points: CoachPoint[] = [];
    if (facts.check) points.push({ key: "Coach.Tactic.Check" });
    if (score?.value.type === "mate") {
        points.push({
            key: "Coach.Tactic.ForcedMate",
            params: { count: Math.abs(score.value.value) },
        });
    } else if (best?.san.includes("#")) {
        points.push({ key: "Coach.Tactic.ForcedMate", params: { count: 1 } });
    }
    if (best?.san.includes("x")) {
        points.push({ key: "Coach.Tactic.Capture", params: { move: best.san } });
    }
    if (best?.san.includes("=")) points.push({ key: "Coach.Tactic.Promotion" });
    if (lastSan?.includes("x")) points.push({ key: "Coach.Tactic.LastCapture" });
    if (points.length === 0) points.push({ key: "Coach.Tactic.None" });
    return points.slice(0, 4);
}

/**
 * Compose a local, engine-grounded coach report for one position.
 *
 * The function is deliberately pure and has no Tauri dependency so it can be
 * unit-tested and reused by future views. `bestMoves` comes from the already
 * running engine; when it is empty, the position facts and plans still work.
 */
export function buildCoachReport(
    fen: string,
    bestMoves: BestMoves[] | null | undefined,
    lastSan: string | null,
): CoachReport | null {
    const [pos] = positionFromFen(fen);
    const facts = factsFromPosition(fen);
    if (!pos || !facts) return null;

    const best = bestMoves?.[0];
    const bestSan = best?.sanMoves?.[0];
    const bestUci = best?.uciMoves?.[0];
    const score = best?.score ?? null;
    const advantage = advantageOf(score, pos.turn);
    const bestExplanation: CoachMove | null = bestSan
        ? {
              san: bestSan,
              points: movePoints(pos, bestSan, bestUci, best?.depth, true),
          }
        : null;

    let last: CoachMove | null = null;
    if (lastSan) {
        const lastPoints: CoachPoint[] = [
            { key: "Coach.Explain.LastMove", params: { move: lastSan } },
            ...movePoints(pos, lastSan, undefined, undefined, false),
        ];
        if (bestSan && bestSan === lastSan) {
            lastPoints.push({ key: "Coach.Explain.MatchesEngine" });
        } else if (bestSan) {
            lastPoints.push({ key: "Coach.Explain.EnginePrefers", params: { move: bestSan } });
        }
        last = { san: lastSan, points: lastPoints.slice(0, 5) };
    }

    if (best?.sanMoves && best.sanMoves.length > 1) {
        bestExplanation?.points.push({
            key: "Coach.Explain.Continuation",
            params: { line: best.sanMoves.slice(1, 4).join(" ") },
        });
    }

    return {
        phase: facts.phase,
        turn: pos.turn,
        advantage,
        scoreText: score ? formatScore(score.value) : "—",
        best: bestExplanation,
        last,
        whitePlan: planFor(facts, "white", advantage),
        blackPlan: planFor(facts, "black", advantage),
        tactics: tacticalPoints(facts, bestExplanation, lastSan, score),
    };
}

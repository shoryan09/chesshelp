import { Chess, type Move } from "chess.js";
import { StockfishEngine } from "./engine";
import type { ThemeKey } from "./themes";

export type Phase = "opening" | "middlegame" | "endgame";

export type MoveClassification =
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder"
  | "miss"
  | "forced";

export type AnnotatedMove = {
  ply: number;
  moveNumber: number;
  color: "white" | "black";
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  evalBefore: number; // player POV
  evalAfter: number;  // player POV
  evalBeforeWhite: number; // white-relative, for eval bar/graph
  evalAfterWhite: number;
  delta: number;
  bestMoveUci: string;
  bestMoveSan: string;
  classification: MoveClassification;
  theme: ThemeKey;
  isForced: boolean;
  phase: Phase;
};

export type AnalyzeOptions = {
  depth?: number;
  lostThreshold?: number;
  onProgress?: (current: number, total: number) => void;
};

// Returns the set of "drillable" annotations — mistakes, blunders, misses.
// When userColor is given, only the user's own moves are returned (analyzeGame
// annotates both sides, but the quiz/stats are about the user's mistakes).
export function getDrillable(
  annotations: AnnotatedMove[],
  userColor?: "white" | "black"
): AnnotatedMove[] {
  return annotations.filter(
    (a) =>
      (userColor === undefined || a.color === userColor) &&
      (a.classification === "mistake" ||
        a.classification === "blunder" ||
        a.classification === "miss")
  );
}

function classifyMove(args: {
  exactBestMove: boolean;
  isForced: boolean;
  evalBeforePlayer: number;
  evalAfterPlayer: number;
  playerMateBefore: number | null;
  playerMateAfter: number | null;
  lostThreshold: number;
}): MoveClassification {
  if (args.isForced) return "forced";

  const delta = args.evalAfterPlayer - args.evalBeforePlayer;
  const drop = -delta; // positive means player gave up advantage

  // Miss detection overrides classification
  const hadMate =
    args.playerMateBefore !== null && args.playerMateBefore > 0;
  const stillHasMate =
    args.playerMateAfter !== null && args.playerMateAfter > 0;
  const missedMate = hadMate && !stillHasMate;

  const hadWinningAdv =
    !hadMate &&
    args.evalBeforePlayer >= 300 &&
    args.evalBeforePlayer < 9000;
  const lostWinningAdv = hadWinningAdv && drop > 100;

  if (missedMate || lostWinningAdv) return "miss";

  // Already-lost positions get classified leniently
  const wasLost = args.evalBeforePlayer < -args.lostThreshold;
  if (wasLost && drop < 500) return "good"; // small further losses when down

  if (args.exactBestMove || drop <= 15) return "best";
  if (drop <= 50) return "excellent";
  if (drop <= 100) return "good";
  if (drop <= 150) return "inaccuracy";
  if (drop <= 250) return "mistake";
  return "blunder";
}

function detectTheme(
  fenBefore: string,
  bestMoveUci: string,
  playerMateBefore: number | null,
  classification: MoveClassification
): ThemeKey {
  let move: Move | null = null;
  let fenAfter = "";
  try {
    const c = new Chess(fenBefore);
    move = c.move({
      from: bestMoveUci.slice(0, 2),
      to: bestMoveUci.slice(2, 4),
      promotion: bestMoveUci.length === 5 ? bestMoveUci[4] : undefined,
    });
    if (move) fenAfter = c.fen();
  } catch {
    return classification === "miss" ? "advantage" : "general";
  }
  if (!move || !fenAfter) {
    return classification === "miss" ? "advantage" : "general";
  }

  if (playerMateBefore !== null && Math.abs(playerMateBefore) === 1) {
    const piece = move.piece;
    const toRank = move.to[1];
    const targetBackRank = move.color === "w" ? "8" : "1";
    if ((piece === "r" || piece === "q") && toRank === targetBackRank) {
      return "backRankMate";
    }
  }

  if (playerMateBefore !== null && playerMateBefore > 0) {
    const n = Math.min(playerMateBefore, 5) as 1 | 2 | 3 | 4 | 5;
    return `mateIn${n}` as ThemeKey;
  }

  if (move.captured) {
    try {
      const afterChess = new Chess(fenAfter);
      const defenderMoves = afterChess.moves({ verbose: true });
      const canRecapture = defenderMoves.some((m) => m.to === move!.to);
      if (!canRecapture) return "hangingPiece";
    } catch {
      // ignore
    }
  }

  if (move.piece === "n") {
    try {
      const afterChess = new Chess(fenAfter);
      if (afterChess.inCheck()) {
        const parts = fenAfter.split(" ");
        parts[1] = move.color;
        parts[3] = "-";
        const flipped = new Chess(parts.join(" "));
        const knightMoves = flipped.moves({
          verbose: true,
          square: move.to as Move["to"],
        });
        const valuableAttacks = knightMoves.filter(
          (m) => m.captured && ["b", "r", "q"].includes(m.captured)
        ).length;
        if (valuableAttacks >= 1) return "fork";
      }
    } catch {
      // ignore
    }
  }

  if (classification === "miss") return "advantage";
  return "general";
}

function computePhase(fen: string, moveNumber: number): Phase {
  if (moveNumber <= 12) return "opening";
  const board = fen.split(" ")[0];
  let total = 0;
  for (const c of board) {
    switch (c.toLowerCase()) {
      case "q": total += 9; break;
      case "r": total += 5; break;
      case "b":
      case "n": total += 3; break;
      case "p": total += 1; break;
    }
  }
  if (total <= 28) return "endgame";
  return "middlegame";
}

export async function analyzeGame(
  pgn: string,
  _userColor: "white" | "black",
  engine: StockfishEngine,
  options: AnalyzeOptions = {}
): Promise<AnnotatedMove[]> {
  const { depth = 15, lostThreshold = 300, onProgress } = options;

  const chess = new Chess();
  chess.loadPgn(pgn);
  const moves = chess.history({ verbose: true }) as Move[];
  if (moves.length === 0) return [];

  // Build the FEN list: starting position + after each move.
  const startingFen = moves[0].before;
  const fens = [startingFen, ...moves.map((m) => m.after)];

  // Evaluate every position exactly once.
  const evals = [];
  for (let i = 0; i < fens.length; i++) {
    evals.push(await engine.evaluate(fens[i], depth));
    onProgress?.(i + 1, fens.length);
  }

  const annotations: AnnotatedMove[] = [];

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const ply = i + 1;
    const moveNumber = Math.ceil(ply / 2);

    const evalBeforeRes = evals[i];
    const evalAfterRes = evals[i + 1];

    // Skip if either eval failed
    if (evalBeforeRes.bestMove === "(none)") continue;

    const evalBeforeWhite = evalBeforeRes.cp;
    const evalAfterWhite = evalAfterRes.cp;

    const evalBeforePlayer =
      m.color === "w" ? evalBeforeWhite : -evalBeforeWhite;
    const evalAfterPlayer =
      m.color === "w" ? evalAfterWhite : -evalAfterWhite;
    const delta = evalAfterPlayer - evalBeforePlayer;

    const playerMateBefore =
      evalBeforeRes.mate === null
        ? null
        : m.color === "w"
        ? evalBeforeRes.mate
        : -evalBeforeRes.mate;
    const playerMateAfter =
      evalAfterRes.mate === null
        ? null
        : m.color === "w"
        ? evalAfterRes.mate
        : -evalAfterRes.mate;

    const playedUci = m.from + m.to + (m.promotion || "");
    const exactBestMove = playedUci === evalBeforeRes.bestMove;

    // Forced move detection: only one legal move from the before-position.
    let isForced = false;
    try {
      const probe = new Chess(m.before);
      isForced = probe.moves().length === 1;
    } catch {
      // ignore
    }

    const classification = classifyMove({
      exactBestMove,
      isForced,
      evalBeforePlayer,
      evalAfterPlayer,
      playerMateBefore,
      playerMateAfter,
      lostThreshold,
    });

    let bestMoveSan = evalBeforeRes.bestMove;
    try {
      const probe = new Chess(m.before);
      const bm = probe.move({
        from: evalBeforeRes.bestMove.slice(0, 2),
        to: evalBeforeRes.bestMove.slice(2, 4),
        promotion:
          evalBeforeRes.bestMove.length === 5
            ? evalBeforeRes.bestMove[4]
            : undefined,
      });
      if (bm) bestMoveSan = bm.san;
    } catch {
      // ignore
    }

    const theme = detectTheme(
      m.before,
      evalBeforeRes.bestMove,
      playerMateBefore,
      classification
    );

    annotations.push({
      ply,
      moveNumber,
      color: m.color === "w" ? "white" : "black",
      san: m.san,
      uci: playedUci,
      fenBefore: m.before,
      fenAfter: m.after,
      evalBefore: evalBeforePlayer,
      evalAfter: evalAfterPlayer,
      evalBeforeWhite,
      evalAfterWhite,
      delta,
      bestMoveUci: evalBeforeRes.bestMove,
      bestMoveSan,
      classification,
      theme,
      isForced,
      phase: computePhase(m.after, moveNumber),
    });
  }

  return annotations;
}
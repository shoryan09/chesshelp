import { Chess, type Move } from "chess.js";
import { StockfishEngine } from "./engine";
import type { ThemeKey } from "./themes";

export type Phase = "opening" | "middlegame" | "endgame";
export type MistakeKind = "mistake" | "miss";

export type Mistake = {
  moveNumber: number;
  ply: number;
  fenBefore: string;
  fenAfter: string;
  playedMoveSan: string;
  playedMoveUci: string;
  bestMoveUci: string;
  bestMoveSan: string;
  evalBefore: number;
  evalAfter: number;
  delta: number;
  phase: Phase;
  kind: MistakeKind;
  theme: ThemeKey;
};

export type AnalyzeOptions = {
  depth?: number;
  mistakeThreshold?: number;
  lostThreshold?: number;
  onProgress?: (current: number, total: number) => void;
};

function detectTheme(
  fenBefore: string,
  bestMoveUci: string,
  playerMateBefore: number | null,
  kind: MistakeKind
): ThemeKey {
  let move: Move | null = null;
  let fenAfter = "";
  try {
    const c = new Chess(fenBefore);
    move = c.move({
      from: bestMoveUci.slice(0, 2),
      to: bestMoveUci.slice(2, 4),
      promotion:
        bestMoveUci.length === 5 ? bestMoveUci[4] : undefined,
    });
    if (move) fenAfter = c.fen();
  } catch {
    return kind === "miss" ? "advantage" : "general";
  }
  if (!move || !fenAfter) {
    return kind === "miss" ? "advantage" : "general";
  }

  // Back rank mate
  if (playerMateBefore !== null && Math.abs(playerMateBefore) === 1) {
    const piece = move.piece;
    const toRank = move.to[1];
    const targetBackRank = move.color === "w" ? "8" : "1";
    if ((piece === "r" || piece === "q") && toRank === targetBackRank) {
      return "backRankMate";
    }
  }

  // Mate in N
  if (playerMateBefore !== null && playerMateBefore > 0) {
    const n = Math.min(playerMateBefore, 5) as 1 | 2 | 3 | 4 | 5;
    return `mateIn${n}` as ThemeKey;
  }

  // Hanging piece
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

  // Knight fork with check
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

  if (kind === "miss") return "advantage";
  return "general";
}

export async function analyzeGame(
  pgn: string,
  userColor: "white" | "black",
  engine: StockfishEngine,
  options: AnalyzeOptions = {}
): Promise<Mistake[]> {
  const {
    depth = 15,
    mistakeThreshold = 100,
    lostThreshold = 300,
    onProgress,
  } = options;

  const chess = new Chess();
  chess.loadPgn(pgn);
  const moves = chess.history({ verbose: true }) as Move[];

  const userMoveIndices: number[] = [];
  moves.forEach((m, i) => {
    if (
      (m.color === "w" && userColor === "white") ||
      (m.color === "b" && userColor === "black")
    ) {
      userMoveIndices.push(i);
    }
  });

  const mistakes: Mistake[] = [];
  let processed = 0;
  const total = userMoveIndices.length;

  for (const i of userMoveIndices) {
    const move = moves[i];

    const evalBefore = await engine.evaluate(move.before, depth);
    const evalAfter = await engine.evaluate(move.after, depth);

    if (evalBefore.bestMove === "(none)") {
      processed++;
      onProgress?.(processed, total);
      continue;
    }

    const playerEvalBefore =
      userColor === "white" ? evalBefore.cp : -evalBefore.cp;
    const playerEvalAfter =
      userColor === "white" ? evalAfter.cp : -evalAfter.cp;
    const delta = playerEvalAfter - playerEvalBefore;

    const playerMateBefore =
      evalBefore.mate === null
        ? null
        : userColor === "white"
        ? evalBefore.mate
        : -evalBefore.mate;
    const playerMateAfter =
      evalAfter.mate === null
        ? null
        : userColor === "white"
        ? evalAfter.mate
        : -evalAfter.mate;

    const hadForcedMate = playerMateBefore !== null && playerMateBefore > 0;
    const stillHasMate = playerMateAfter !== null && playerMateAfter > 0;
    const missedMate = hadForcedMate && !stillHasMate;

    const hadWinningAdvantage =
      !hadForcedMate &&
      playerEvalBefore >= 300 &&
      playerEvalBefore < 9000;
    const lostWinningAdvantage = hadWinningAdvantage && delta < -100;

    const isMiss = missedMate || lostWinningAdvantage;
    const isMistake =
      !isMiss &&
      delta < -mistakeThreshold &&
      playerEvalBefore >= -lostThreshold;

    if (!isMiss && !isMistake) {
      processed++;
      onProgress?.(processed, total);
      continue;
    }

    const moveNumber = Math.ceil((i + 1) / 2);
    const phase = computePhase(move.after, moveNumber);
    const kind: MistakeKind = isMiss ? "miss" : "mistake";

    let bestMoveSan = evalBefore.bestMove;
    try {
      const probe = new Chess(move.before);
      const m = probe.move({
        from: evalBefore.bestMove.slice(0, 2),
        to: evalBefore.bestMove.slice(2, 4),
        promotion:
          evalBefore.bestMove.length === 5
            ? evalBefore.bestMove[4]
            : undefined,
      });
      if (m) bestMoveSan = m.san;
    } catch {
      // ignore
    }

    const theme = detectTheme(
      move.before,
      evalBefore.bestMove,
      playerMateBefore,
      kind
    );

    mistakes.push({
      moveNumber,
      ply: i + 1,
      fenBefore: move.before,
      fenAfter: move.after,
      playedMoveSan: move.san,
      playedMoveUci: move.from + move.to + (move.promotion || ""),
      bestMoveUci: evalBefore.bestMove,
      bestMoveSan,
      evalBefore: playerEvalBefore,
      evalAfter: playerEvalAfter,
      delta,
      phase,
      kind,
      theme,
    });

    processed++;
    onProgress?.(processed, total);
  }

  return mistakes;
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
"use client";

import { useState, useEffect } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import type { AnnotatedMove } from "@/lib/analyzer";
import { THEME_LABELS, THEME_URLS } from "@/lib/themes";
import { StockfishEngine } from "@/lib/engine";

type Feedback = {
  kind: "correct" | "good" | "incorrect";
  attemptedSan: string;
  attemptedEval: number;
  bestSan: string;
  bestEval: number;
};

type QuizPanelProps = {
  mistakes: AnnotatedMove[];
  userColor: "white" | "black";
  engine: StockfishEngine;
  onClose: () => void;
};

const TOLERANCE_CP = 50;

function lichessLink(m: AnnotatedMove): { url: string; label: string } {
  return {
    url: THEME_URLS[m.theme],
    label: `${THEME_LABELS[m.theme]} puzzles`,
  };
}

export function QuizPanel({
  mistakes,
  userColor,
  engine,
  onClose,
}: QuizPanelProps) {
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [boardFen, setBoardFen] = useState(mistakes[0]?.fenBefore || "");

  const current = mistakes[index];
  const total = mistakes.length;

  // Reset the board to the active mistake's pre-move position whenever the
  // active mistake changes (Next / Previous).
  useEffect(() => {
    setFeedback(null);
    setRevealed(false);
    setEvaluating(false);
    if (current) setBoardFen(current.fenBefore);
  }, [index, current]);

  // Returns true only for a legal move (so react-chessboard keeps the piece on
  // its target square); returns false to snap the piece back. The engine
  // evaluation continues asynchronously after a legal move is accepted.
  function handleAttempt(from: string, to: string): boolean {
    if (!current || feedback || evaluating) return false;
    const m = current;
    const chess = new Chess(boardFen);
    let move;
    try {
      move = chess.move({ from, to, promotion: "q" });
    } catch {
      return false;
    }
    if (!move) return false;

    const attemptedUci = move.from + move.to + (move.promotion || "");
    const attemptedSan = move.san;
    const resultingFen = chess.fen();

    setBoardFen(resultingFen);

    if (attemptedUci === m.bestMoveUci) {
      setFeedback({
        kind: "correct",
        attemptedSan,
        attemptedEval: m.evalBefore,
        bestSan: m.bestMoveSan,
        bestEval: m.evalBefore,
      });
      return true;
    }

    setEvaluating(true);
    void evaluateAttempt(m, resultingFen, attemptedSan);
    return true;
  }

  async function evaluateAttempt(
    m: AnnotatedMove,
    resultingFen: string,
    attemptedSan: string
  ) {
    const attemptedEvalResult = await engine.evaluate(resultingFen, 15);
    const playerEvalAfter =
      userColor === "white"
        ? attemptedEvalResult.cp
        : -attemptedEvalResult.cp;

    const bestEval = m.evalBefore;
    const diff = bestEval - playerEvalAfter;
    const kind: Feedback["kind"] = diff <= TOLERANCE_CP ? "good" : "incorrect";

    setFeedback({
      kind,
      attemptedSan,
      attemptedEval: playerEvalAfter,
      bestSan: m.bestMoveSan,
      bestEval,
    });
    setEvaluating(false);
  }

  function resetBoard() {
    if (!current) return;
    setBoardFen(current.fenBefore);
    setFeedback(null);
    setRevealed(false);
    setEvaluating(false);
  }

  function next() {
    if (index < total - 1) setIndex(index + 1);
    else onClose();
  }

  function prev() {
    if (index > 0) setIndex(index - 1);
  }

  if (!current) return null;
  const link = lichessLink(current);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-[var(--bg-elev)] border border-[var(--border)] rounded-xl max-w-xl w-full max-h-[98vh] sm:max-h-[95vh] overflow-y-auto">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3 border-b border-[var(--border-soft)] flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-xs text-[var(--text-muted)] mb-0.5">
              {index + 1} of {total}
            </div>
            <div className="text-sm font-medium flex items-center gap-2 truncate">
              <span
                className={
                  current.classification === "miss"
                    ? "text-[var(--purple)]"
                    : current.classification === "blunder"
                    ? "text-[var(--red)]"
                    : "text-[var(--orange)]"
                }
              >
                {current.classification === "miss"
                  ? "Missed"
                  : current.classification === "blunder"
                  ? "Blunder"
                  : "Mistake"}
              </span>
              <span className="text-[var(--text-muted)] font-normal">
                · move {current.moveNumber} · {current.phase}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-2 text-[var(--text-muted)] hover:text-[var(--text)] text-sm shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Board + feedback */}
        <div className="p-4 sm:p-5">
          <div className="w-full max-w-md mx-auto mb-4">
            <Chessboard
              options={{
                position: boardFen,
                boardOrientation: userColor,
                allowDragging: !feedback && !evaluating,
                // Only the user's own pieces can be picked up.
                canDragPiece: ({ piece }) =>
                  piece.pieceType[0] === userColor[0],
                onPieceDrop: ({ sourceSquare, targetSquare, piece }) => {
                  if (!targetSquare) return false;
                  // Reject drags of opponent pieces (defense in depth).
                  if (piece.pieceType[0] !== userColor[0]) return false;
                  return handleAttempt(sourceSquare, targetSquare);
                },
              }}
            />
          </div>

          <div className="text-center text-sm min-h-[72px]">
            {!feedback && !evaluating && !revealed && (
              <div className="text-[var(--text-soft)]">
                Your turn — find the best move
              </div>
            )}
            {evaluating && (
              <div className="text-[var(--text-muted)] flex items-center justify-center gap-2">
                <Spinner />
                Checking...
              </div>
            )}
            {feedback && (
              <div>
                <div
                  className={`font-medium mb-2 ${
                    feedback.kind === "correct"
                      ? "text-[var(--green)]"
                      : feedback.kind === "good"
                      ? "text-[var(--yellow)]"
                      : "text-[var(--red)]"
                  }`}
                >
                  {feedback.kind === "correct" && "Best move."}
                  {feedback.kind === "good" && "Close — that works too."}
                  {feedback.kind === "incorrect" && "Not quite."}
                </div>
                <div className="text-xs text-[var(--text-muted)] font-mono">
                  You played{" "}
                  <span className="text-[var(--text)]">
                    {feedback.attemptedSan}
                  </span>{" "}
                  ({(feedback.attemptedEval / 100).toFixed(1)})
                  {feedback.kind !== "correct" && (
                    <>
                      {" · "}best was{" "}
                      <span className="text-[var(--green)]">
                        {feedback.bestSan}
                      </span>{" "}
                      ({(feedback.bestEval / 100).toFixed(1)})
                    </>
                  )}
                </div>
              </div>
            )}
            {revealed && !feedback && (
              <div className="text-[var(--text-soft)]">
                Best move:{" "}
                <span className="text-[var(--green)] font-mono">
                  {current.bestMoveSan}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 border-t border-[var(--border-soft)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <button
            onClick={prev}
            disabled={index === 0}
            className="px-3 py-1.5 bg-transparent hover:bg-[var(--bg-elev-2)] border border-[var(--border)] disabled:opacity-30 rounded-md text-xs"
          >
            ← Previous
          </button>
          <div className="flex gap-1.5 flex-wrap">
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-transparent hover:bg-[var(--bg-elev-2)] border border-[var(--accent-border)] text-[var(--accent)] rounded-md text-xs font-medium"
            >
              {link.label} ↗
            </a>
            {(feedback || revealed) && (
              <button
                onClick={resetBoard}
                className="px-3 py-1.5 bg-transparent hover:bg-[var(--bg-elev-2)] border border-[var(--border)] rounded-md text-xs"
              >
                Reset
              </button>
            )}
            {!feedback && !revealed && (
              <button
                onClick={() => setRevealed(true)}
                className="px-3 py-1.5 bg-transparent hover:bg-[var(--bg-elev-2)] border border-[var(--border)] rounded-md text-xs"
              >
                Reveal
              </button>
            )}
            <button
              onClick={next}
              className="px-3 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--bg)] rounded-md text-xs font-medium"
            >
              {index === total - 1 ? "Finish" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block w-3 h-3 border border-[var(--text-muted)] border-t-[var(--accent)] rounded-full animate-spin" />
  );
}
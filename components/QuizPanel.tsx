"use client";

import { useState, useEffect } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import type { Mistake } from "@/lib/analyzer";
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
  mistakes: Mistake[];
  userColor: "white" | "black";
  engine: StockfishEngine;
  onClose: () => void;
};

const TOLERANCE_CP = 50;

function lichessLink(m: Mistake): { url: string; label: string } {
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
  const [displayedFen, setDisplayedFen] = useState(
    mistakes[0]?.fenBefore || ""
  );

  const current = mistakes[index];
  const total = mistakes.length;

  useEffect(() => {
    setFeedback(null);
    setRevealed(false);
    setEvaluating(false);
    if (current) setDisplayedFen(current.fenBefore);
  }, [index, current]);

  async function handleAttempt(from: string, to: string): Promise<boolean> {
    if (!current || feedback || evaluating) return false;
    const chess = new Chess(current.fenBefore);
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

    setDisplayedFen(resultingFen);
    setEvaluating(true);

    if (attemptedUci === current.bestMoveUci) {
      setFeedback({
        kind: "correct",
        attemptedSan,
        attemptedEval: current.evalBefore,
        bestSan: current.bestMoveSan,
        bestEval: current.evalBefore,
      });
      setEvaluating(false);
      return true;
    }

    const attemptedEvalResult = await engine.evaluate(resultingFen, 15);
    const playerEvalAfter =
      userColor === "white"
        ? attemptedEvalResult.cp
        : -attemptedEvalResult.cp;

    const bestEval = current.evalBefore;
    const diff = bestEval - playerEvalAfter;
    const kind: Feedback["kind"] = diff <= TOLERANCE_CP ? "good" : "incorrect";

    setFeedback({
      kind,
      attemptedSan,
      attemptedEval: playerEvalAfter,
      bestSan: current.bestMoveSan,
      bestEval,
    });
    setEvaluating(false);
    return true;
  }

  function resetBoard() {
    if (!current) return;
    setDisplayedFen(current.fenBefore);
    setFeedback(null);
    setRevealed(false);
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
                  current.kind === "miss"
                    ? "text-[var(--purple)]"
                    : "text-[var(--orange)]"
                }
              >
                {current.kind === "miss" ? "Missed" : "Mistake"}
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
                position: displayedFen,
                onPieceDrop: ({ sourceSquare, targetSquare }) => {
                  if (!targetSquare) return false;
                  handleAttempt(sourceSquare, targetSquare);
                  return true;
                },
                boardOrientation: userColor,
                allowDragging: !feedback && !evaluating,
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
            <button
              onClick={() =>
                window.open(link.url, "_blank", "noopener,noreferrer")
              }
              className="px-3 py-1.5 bg-transparent hover:bg-[var(--bg-elev-2)] border border-[var(--accent-border)] text-[var(--accent)] rounded-md text-xs font-medium"
            >
              {link.label} ↗
            </button>
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
              className="px-3 py-1.5 bg-[var(--accent)] hover:bg-white text-[var(--bg)] rounded-md text-xs font-medium"
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
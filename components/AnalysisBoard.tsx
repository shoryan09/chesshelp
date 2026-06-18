"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Chessboard } from "react-chessboard";
import type { AnnotatedMove, MoveClassification } from "@/lib/analyzer";

const COLORS: Record<MoveClassification, string> = {
  best: "var(--green)",
  excellent: "var(--green)",
  good: "var(--green)",
  inaccuracy: "var(--yellow)",
  mistake: "var(--orange)",
  blunder: "var(--red)",
  miss: "var(--purple)",
  forced: "var(--text-muted)",
};

const LABELS: Record<MoveClassification, string> = {
  best: "Best",
  excellent: "Excellent",
  good: "Good",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
  miss: "Miss",
  forced: "Forced",
};

type Props = {
  annotations: AnnotatedMove[];
  userColor: "white" | "black";
  startingFen: string;
  onClose: () => void;
};

export function AnalysisBoard({
  annotations,
  userColor,
  startingFen,
  onClose,
}: Props) {
  const [currentPly, setCurrentPly] = useState(0);
  const totalPlies = annotations.length;

  const currentFen =
    currentPly === 0
      ? startingFen
      : annotations[currentPly - 1].fenAfter;

  const currentEvalWhite = useMemo(() => {
    if (currentPly === 0) {
      return annotations[0]?.evalBeforeWhite ?? 0;
    }
    return annotations[currentPly - 1].evalAfterWhite;
  }, [currentPly, annotations]);

  const currentMove = currentPly > 0 ? annotations[currentPly - 1] : null;

  const evalSeries = useMemo(() => {
    const arr: number[] = [];
    if (annotations[0]) arr.push(annotations[0].evalBeforeWhite);
    for (const a of annotations) arr.push(a.evalAfterWhite);
    return arr;
  }, [annotations]);

  function first() {
    setCurrentPly(0);
  }
  function prev() {
    setCurrentPly((p) => Math.max(0, p - 1));
  }
  function next() {
    setCurrentPly((p) => Math.min(totalPlies, p + 1));
  }
  function last() {
    setCurrentPly(totalPlies);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "Home") {
        first();
      } else if (e.key === "End") {
        last();
      } else if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [totalPlies, onClose]);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-[var(--bg-elev)] border border-[var(--border)] rounded-xl max-w-5xl w-full max-h-[98vh] sm:max-h-[95vh] overflow-y-auto">
        <div className="px-4 sm:px-5 py-3 border-b border-[var(--border-soft)] flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Analysis board</div>
            {currentMove && (
              <div className="text-xs text-[var(--text-muted)]">
                {currentMove.moveNumber}
                {currentMove.color === "white" ? "." : "..."}{" "}
                {currentMove.san}{" "}
                <span style={{ color: COLORS[currentMove.classification] }}>
                  · {LABELS[currentMove.classification]}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] text-sm"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-4 sm:p-5 flex flex-col md:flex-row gap-4">
          <div className="flex gap-2 flex-1 min-w-0">
            <EvalBar
              evalWhite={currentEvalWhite}
              orientation={userColor}
            />
            <div className="flex-1 min-w-0 max-w-[480px] mx-auto">
              <Chessboard
                options={{
                  position: currentFen,
                  boardOrientation: userColor,
                  allowDragging: false,
                }}
              />
            </div>
          </div>

          <div className="md:w-72 flex-shrink-0">
            <MoveList
              annotations={annotations}
              currentPly={currentPly}
              onJump={setCurrentPly}
            />
          </div>
        </div>

        <div className="px-4 sm:px-5 py-3 border-t border-[var(--border-soft)] flex items-center justify-center gap-1">
          <StepButton onClick={first} disabled={currentPly === 0}>
            ⏮
          </StepButton>
          <StepButton onClick={prev} disabled={currentPly === 0}>
            ◀
          </StepButton>
          <span className="px-3 text-xs text-[var(--text-muted)] font-mono">
            {currentPly} / {totalPlies}
          </span>
          <StepButton onClick={next} disabled={currentPly === totalPlies}>
            ▶
          </StepButton>
          <StepButton onClick={last} disabled={currentPly === totalPlies}>
            ⏭
          </StepButton>
        </div>

        <div className="px-4 sm:px-5 pb-5">
          <EvalGraph
            evals={evalSeries}
            annotations={annotations}
            currentPly={currentPly}
            onJump={setCurrentPly}
          />
        </div>
      </div>
    </div>
  );
}

function StepButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 bg-transparent hover:bg-[var(--bg-elev-2)] border border-[var(--border)] disabled:opacity-30 rounded-md text-sm"
    >
      {children}
    </button>
  );
}

function EvalBar({
  evalWhite,
  orientation,
}: {
  evalWhite: number;
  orientation: "white" | "black";
}) {
  const clipped = Math.max(-1000, Math.min(1000, evalWhite));
  const whitePct = 50 + (clipped / 1000) * 45;
  const blackPct = 100 - whitePct;

  const topPct = orientation === "white" ? blackPct : whitePct;

  const displayEval = (clipped / 100).toFixed(1);
  const showWhiteSide = clipped >= 0;

  return (
    <div className="w-5 sm:w-6 flex flex-col rounded-sm overflow-hidden border border-[var(--border-soft)] relative">
      <div
        className="bg-neutral-900 transition-all duration-200"
        style={{ height: `${topPct}%` }}
      />
      <div className="bg-neutral-100 flex-1 transition-all duration-200" />
      <div
        className="absolute left-0 right-0 text-[9px] font-mono text-center"
        style={{
          [showWhiteSide ? "bottom" : "top"]: "2px",
          color: showWhiteSide ? "#000" : "#fff",
        }}
      >
        {displayEval}
      </div>
    </div>
  );
}

function MoveList({
  annotations,
  currentPly,
  onJump,
}: {
  annotations: AnnotatedMove[];
  currentPly: number;
  onJump: (ply: number) => void;
}) {
  type Pair = { num: number; white?: AnnotatedMove; black?: AnnotatedMove };
  const pairs: Pair[] = [];
  for (const a of annotations) {
    let pair = pairs.find((p) => p.num === a.moveNumber);
    if (!pair) {
      pair = { num: a.moveNumber };
      pairs.push(pair);
    }
    if (a.color === "white") pair.white = a;
    else pair.black = a;
  }

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!listRef.current || currentPly === 0) return;
    const el = listRef.current.querySelector(`[data-ply="${currentPly}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: "nearest" });
  }, [currentPly]);

  return (
    <div
      ref={listRef}
      className="bg-[var(--bg)] border border-[var(--border-soft)] rounded-md p-2 max-h-72 md:max-h-[480px] overflow-y-auto text-xs font-mono"
    >
      {pairs.map((pair) => (
        <div
          key={pair.num}
          className="flex items-center gap-1 py-0.5"
        >
          <span className="text-[var(--text-muted)] w-6 shrink-0">
            {pair.num}.
          </span>
          {pair.white ? (
            <MoveCell
              annotation={pair.white}
              isActive={currentPly === pair.white.ply}
              onClick={() => onJump(pair.white!.ply)}
            />
          ) : (
            <span className="w-20" />
          )}
          {pair.black && (
            <MoveCell
              annotation={pair.black}
              isActive={currentPly === pair.black.ply}
              onClick={() => onJump(pair.black!.ply)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function MoveCell({
  annotation,
  isActive,
  onClick,
}: {
  annotation: AnnotatedMove;
  isActive: boolean;
  onClick: () => void;
}) {
  const color = COLORS[annotation.classification];
  return (
    <button
      data-ply={annotation.ply}
      onClick={onClick}
      className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded w-20 text-left ${
        isActive
          ? "bg-[var(--bg-elev-2)] text-[var(--text)]"
          : "hover:bg-[var(--bg-elev-2)] text-[var(--text-soft)]"
      }`}
    >
      <span className="truncate">{annotation.san}</span>
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0 ml-auto"
        style={{ background: color }}
        aria-label={LABELS[annotation.classification]}
      />
    </button>
  );
}

function EvalGraph({
  evals,
  annotations,
  currentPly,
  onJump,
}: {
  evals: number[];
  annotations: AnnotatedMove[];
  currentPly: number;
  onJump: (ply: number) => void;
}) {
  const width = 600;
  const height = 80;
  const maxAbs = 1000;

  if (evals.length < 2) return null;

  const points = evals.map((ev, i) => {
    const x = (i / (evals.length - 1)) * width;
    const clipped = Math.max(-maxAbs, Math.min(maxAbs, ev));
    const y = height / 2 - (clipped / maxAbs) * (height / 2);
    return { x, y };
  });

  const pathD = "M " + points.map((p) => `${p.x},${p.y}`).join(" L ");

  const fillPathD =
    pathD +
    ` L ${width},${height / 2} L 0,${height / 2} Z`;

  const flaggedDots = annotations
    .map((a, i) => ({
      annotation: a,
      point: points[i + 1],
    }))
    .filter(
      (d) =>
        d.annotation.classification === "mistake" ||
        d.annotation.classification === "blunder" ||
        d.annotation.classification === "miss"
    );

  const currentX = (currentPly / (evals.length - 1)) * width;

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const ply = Math.round(xRatio * (evals.length - 1));
    onJump(Math.max(0, Math.min(evals.length - 1, ply)));
  }

  return (
    <div>
      <div className="text-xs text-[var(--text-muted)] mb-2">
        Eval trajectory
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-20 cursor-pointer"
        onClick={handleClick}
        preserveAspectRatio="none"
      >
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--border)"
          strokeWidth="0.5"
        />
        <path d={fillPathD} fill="var(--accent-soft)" />
        <path d={pathD} stroke="var(--accent)" strokeWidth="1.5" fill="none" />
        {flaggedDots.map((d, i) => (
          <circle
            key={i}
            cx={d.point.x}
            cy={d.point.y}
            r="3"
            fill={COLORS[d.annotation.classification]}
            stroke="var(--bg-elev)"
            strokeWidth="1"
          />
        ))}
        <line
          x1={currentX}
          y1="0"
          x2={currentX}
          y2={height}
          stroke="var(--text-soft)"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}
"use client";

import { useState, useRef } from "react";
import { getRecentGames } from "@/lib/chesscom";
import type { ParsedGame } from "@/lib/types";
import { StockfishEngine } from "@/lib/engine";
import { analyzeGame, type Mistake } from "@/lib/analyzer";
import { THEME_LABELS, THEME_URLS } from "@/lib/themes";
import { QuizPanel } from "@/components/QuizPanel";
import { saveAnalysis, loadAnalysesForUrls, clearCache } from "@/lib/cache";

type AnalysisState = {
  status: "idle" | "loading-engine" | "analyzing" | "done" | "error";
  progress?: { current: number; total: number };
  mistakes?: Mistake[];
  error?: string;
};

export default function Home() {
  const [username, setUsername] = useState("");
  const [games, setGames] = useState<ParsedGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const engineRef = useRef<StockfishEngine | null>(null);
  const engineWarmedRef = useRef(false);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisState>>({});
  const [quizGameUrl, setQuizGameUrl] = useState<string | null>(null);

  function getEngine() {
    if (!engineRef.current) engineRef.current = new StockfishEngine();
    return engineRef.current;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    setError(null);
    setGames([]);
    setAnalyses({});
    try {
      const result = await getRecentGames(username.trim(), 1);
      setGames(result);

      const cached = await loadAnalysesForUrls(result.map((g) => g.url));
      const hydrated: Record<string, AnalysisState> = {};
      for (const [url, entry] of cached) {
        hydrated[url] = { status: "done", mistakes: entry.mistakes };
      }
      setAnalyses(hydrated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function runAnalysis(game: ParsedGame) {
    const needsWarmup = !engineWarmedRef.current;

    setAnalyses((a) => ({
      ...a,
      [game.url]: {
        status: needsWarmup ? "loading-engine" : "analyzing",
        progress: { current: 0, total: 0 },
      },
    }));

    try {
      if (needsWarmup) {
        await getEngine().evaluate(
          "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          10
        );
        engineWarmedRef.current = true;
        setAnalyses((a) => ({
          ...a,
          [game.url]: {
            status: "analyzing",
            progress: { current: 0, total: 0 },
          },
        }));
      }

      const mistakes = await analyzeGame(
        game.pgn,
        game.userColor,
        getEngine(),
        {
          depth: 15,
          userRating: game.userRating,
          onProgress: (current, total) =>
            setAnalyses((a) => ({
              ...a,
              [game.url]: { status: "analyzing", progress: { current, total } },
            })),
        }
      );
      setAnalyses((a) => ({
        ...a,
        [game.url]: { status: "done", mistakes },
      }));
      saveAnalysis(game.url, mistakes, 15).catch(console.error);
    } catch (err) {
      setAnalyses((a) => ({
        ...a,
        [game.url]: {
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        },
      }));
    }
  }

  async function handleClearCache() {
    try {
      await clearCache();
      setAnalyses({});
    } catch (err) {
      console.error("Failed to clear cache:", err);
    }
  }

  const quizGame = quizGameUrl ? games.find((g) => g.url === quizGameUrl) : null;
  const quizMistakes =
    quizGameUrl && analyses[quizGameUrl]?.mistakes
      ? analyses[quizGameUrl].mistakes
      : null;

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Hero */}
        <header className="pt-8 sm:pt-16 pb-10 sm:pb-14">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight mb-3">
            Find your chess mistakes.
            <br />
            <span className="text-[var(--text-muted)]">Drill them away.</span>
          </h1>
          <p className="text-base text-[var(--text-soft)] max-w-md">
            Paste your chess.com username. We&apos;ll scan your recent games,
            surface every blunder and miss, and link straight to matching
            Lichess puzzles.
          </p>
        </header>

        {/* Search form */}
        <form
          onSubmit={handleSubmit}
          className="flex flex-col sm:flex-row gap-2 mb-12"
        >
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="chess.com username"
            className="flex-1 px-4 py-2.5 bg-[var(--bg-elev)] border border-[var(--border)] rounded-md text-sm focus:outline-none focus:border-[var(--text-muted)] transition-colors"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || !username.trim()}
              className="flex-1 sm:flex-none px-5 py-2.5 bg-[var(--accent)] hover:bg-white text-[var(--bg)] disabled:bg-[var(--bg-elev-2)] disabled:text-[var(--text-muted)] rounded-md text-sm font-medium transition-colors"
            >
              {loading ? "Loading..." : "Analyze games"}
            </button>
            {Object.keys(analyses).length > 0 && (
              <button
                type="button"
                onClick={handleClearCache}
                className="px-3 py-2.5 bg-transparent hover:bg-[var(--bg-elev)] border border-[var(--border)] rounded-md text-xs text-[var(--text-soft)]"
              >
                Clear
              </button>
            )}
          </div>
        </form>

        {error && (
          <div className="p-3 mb-6 bg-[var(--bg-elev)] border border-red-900/40 rounded-md text-sm text-[var(--red)]">
            {error}
          </div>
        )}

        {/* Aggregate stats panel */}
        {(() => {
          const allMistakes = Object.values(analyses)
            .filter((a) => a?.status === "done" && a.mistakes)
            .flatMap((a) => a.mistakes!);

          if (allMistakes.length === 0) return null;

          const analyzedCount = Object.values(analyses).filter(
            (a) => a?.status === "done"
          ).length;

          const byPhase = {
            opening: allMistakes.filter((m) => m.phase === "opening").length,
            middlegame: allMistakes.filter((m) => m.phase === "middlegame")
              .length,
            endgame: allMistakes.filter((m) => m.phase === "endgame").length,
          };

          const byKind = {
            mistake: allMistakes.filter((m) => m.kind === "mistake").length,
            miss: allMistakes.filter((m) => m.kind === "miss").length,
          };

          const themeCounts = allMistakes.reduce<Record<string, number>>(
            (acc, m) => {
              acc[m.theme] = (acc[m.theme] || 0) + 1;
              return acc;
            },
            {}
          );

          const sortedThemes = Object.entries(themeCounts).sort(
            (a, b) => b[1] - a[1]
          );

          const dominantPhase = (
            Object.entries(byPhase).sort((a, b) => b[1] - a[1])[0] as [
              string,
              number
            ]
          )[0];

          return (
            <section className="mb-8 p-5 sm:p-6 bg-[var(--bg-elev)] border border-[var(--border)] rounded-lg">
              <div className="flex items-baseline justify-between mb-5">
                <h2 className="text-sm font-medium text-[var(--text-soft)]">
                  Across {analyzedCount} game{analyzedCount === 1 ? "" : "s"}
                </h2>
                <span className="text-xs text-[var(--text-muted)] capitalize">
                  Weakest: {dominantPhase}
                </span>
              </div>

              <div className="flex items-baseline gap-6 mb-6">
                <div>
                  <div className="text-2xl sm:text-3xl font-semibold tracking-tight">
                    {byKind.mistake}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5">
                    Mistakes
                  </div>
                </div>
                <div>
                  <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--purple)]">
                    {byKind.miss}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5">
                    Misses
                  </div>
                </div>
              </div>

              <PhaseBar
                opening={byPhase.opening}
                middlegame={byPhase.middlegame}
                endgame={byPhase.endgame}
              />

              {sortedThemes.length > 0 && (
                <div className="mt-6">
                  <div className="text-xs text-[var(--text-muted)] mb-2">
                    Drill on Lichess
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {sortedThemes.slice(0, 6).map(([theme, count]) => (
                      <button
                        key={theme}
                        onClick={() =>
                          window.open(
                            THEME_URLS[theme as keyof typeof THEME_URLS],
                            "_blank",
                            "noopener,noreferrer"
                          )
                        }
                        className="px-2.5 py-1 bg-transparent hover:bg-[var(--bg-elev-2)] border border-[var(--border)] rounded-md text-xs transition-colors"
                      >
                        {THEME_LABELS[theme as keyof typeof THEME_LABELS]}
                        <span className="text-[var(--text-muted)] ml-1.5">
                          ×{count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })()}

        {/* Games */}
        {games.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-medium text-[var(--text-soft)]">
                Recent games
              </h2>
              <span className="text-xs text-[var(--text-muted)]">
                {games.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {games.map((g) => {
                const a = analyses[g.url];
                const hasMistakes =
                  a?.status === "done" && (a.mistakes?.length ?? 0) > 0;
                return (
                  <div
                    key={g.url}
                    className="p-4 bg-[var(--bg-elev)] border border-[var(--border)] rounded-lg hover:border-[var(--text-muted)] transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          vs {g.opponentName}
                          <span className="text-[var(--text-muted)] font-normal ml-1.5">
                            {g.opponentRating}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--text-muted)] mt-0.5">
                          {g.timeClass} · {g.userColor} ·{" "}
                          <span
                            className={
                              g.userResult === "win"
                                ? "text-[var(--green)]"
                                : g.userResult === "loss"
                                ? "text-[var(--red)]"
                                : ""
                            }
                          >
                            {g.userResult}
                          </span>
                          {" · "}
                          {g.endTime.toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex gap-1.5 flex-wrap">
                        <button
                          onClick={() =>
                            window.open(g.url, "_blank", "noopener,noreferrer")
                          }
                          className="px-2.5 py-1 bg-transparent hover:bg-[var(--bg-elev-2)] border border-[var(--border)] rounded-md text-xs transition-colors"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => runAnalysis(g)}
                          disabled={
                            a?.status === "analyzing" ||
                            a?.status === "loading-engine"
                          }
                          className="px-2.5 py-1 bg-[var(--accent)] hover:bg-white text-[var(--bg)] disabled:bg-[var(--bg-elev-2)] disabled:text-[var(--text-muted)] rounded-md text-xs font-medium transition-colors"
                        >
                          {a?.status === "loading-engine"
                            ? "Loading..."
                            : a?.status === "analyzing"
                            ? "Analyzing..."
                            : a?.status === "done"
                            ? "Re-run"
                            : "Analyze"}
                        </button>
                        {hasMistakes && (
                          <button
                            onClick={() => setQuizGameUrl(g.url)}
                            className="px-2.5 py-1 bg-transparent hover:bg-[var(--bg-elev-2)] border border-[var(--accent-border)] text-[var(--accent)] rounded-md text-xs font-medium transition-colors"
                          >
                            Quiz →
                          </button>
                        )}
                      </div>
                    </div>

                    {a?.status === "loading-engine" && (
                      <div className="mt-3 text-xs text-[var(--text-muted)] flex items-center gap-2">
                        <Spinner />
                        Loading chess engine (one-time, ~5s)…
                      </div>
                    )}

                    {a?.status === "analyzing" && a.progress && (
                      <div className="mt-3 text-xs text-[var(--text-muted)] flex items-center gap-2">
                        <Spinner />
                        {a.progress.total === 0
                          ? "Starting…"
                          : `Move ${a.progress.current} / ${a.progress.total}`}
                      </div>
                    )}

                    {a?.status === "error" && (
                      <div className="mt-3 text-xs text-[var(--red)]">
                        {a.error}
                      </div>
                    )}

                    {a?.status === "done" && a.mistakes && (
                      <div className="mt-4 pt-4 border-t border-[var(--border-soft)]">
                        <div className="flex items-center gap-3 text-xs mb-3">
                          <span>
                            <span className="text-[var(--orange)] font-medium">
                              {
                                a.mistakes.filter((m) => m.kind === "mistake")
                                  .length
                              }
                            </span>
                            <span className="text-[var(--text-muted)] ml-1">
                              mistakes
                            </span>
                          </span>
                          <span>
                            <span className="text-[var(--purple)] font-medium">
                              {a.mistakes.filter((m) => m.kind === "miss").length}
                            </span>
                            <span className="text-[var(--text-muted)] ml-1">
                              misses
                            </span>
                          </span>
                          <span className="text-[var(--text-muted)] ml-auto">
                            O·
                            {a.mistakes.filter((m) => m.phase === "opening").length}{" "}
                            M·
                            {a.mistakes.filter((m) => m.phase === "middlegame").length}{" "}
                            E·
                            {a.mistakes.filter((m) => m.phase === "endgame").length}
                          </span>
                        </div>

                        {a.mistakes.length > 0 &&
                          (() => {
                            const themes = Array.from(
                              new Set(a.mistakes!.map((m) => m.theme))
                            );
                            return (
                              <div className="mb-3 flex flex-wrap gap-1.5">
                                {themes.map((t) => (
                                  <button
                                    key={t}
                                    onClick={() =>
                                      window.open(
                                        THEME_URLS[t],
                                        "_blank",
                                        "noopener,noreferrer"
                                      )
                                    }
                                    className="px-2 py-0.5 bg-transparent hover:bg-[var(--bg-elev-2)] border border-[var(--border)] rounded text-xs text-[var(--text-soft)] transition-colors"
                                  >
                                    {THEME_LABELS[t]} ↗
                                  </button>
                                ))}
                              </div>
                            );
                          })()}

                        {a.mistakes.length > 0 && (
                          <div className="space-y-1 text-xs font-mono">
                            {a.mistakes.map((m) => (
                              <div
                                key={m.ply}
                                className="flex items-center gap-2 text-[var(--text-soft)] flex-wrap"
                              >
                                <span className="text-[var(--text-muted)]">
                                  {m.moveNumber}.
                                </span>
                                <span
                                  className={
                                    m.kind === "miss"
                                      ? "text-[var(--purple)]"
                                      : "text-[var(--orange)]"
                                  }
                                >
                                  {m.kind}
                                </span>
                                <span className="text-[var(--red)]">
                                  {m.playedMoveSan}
                                </span>
                                <span className="text-[var(--text-muted)]">
                                  →
                                </span>
                                <span className="text-[var(--green)]">
                                  {m.bestMoveSan}
                                </span>
                                <span className="text-[var(--text-muted)]">
                                  {m.delta > 0 ? "+" : ""}
                                  {(m.delta / 100).toFixed(1)}
                                </span>
                                <span className="text-[var(--text-muted)] sm:ml-auto font-sans">
                                  {THEME_LABELS[m.theme]}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <footer className="mt-16 pt-8 border-t border-[var(--border-soft)] text-xs text-[var(--text-muted)] text-center">
          Stockfish 18 · {games.length > 0 ? "Local-only" : "No login"} ·
          Built for chess.com (Not affiliated with Chess.com)
        </footer>
      </div>

      {quizGame && quizMistakes && (
        <QuizPanel
          mistakes={quizMistakes}
          userColor={quizGame.userColor}
          engine={getEngine()}
          onClose={() => setQuizGameUrl(null)}
        />
      )}
    </main>
  );
}

function Spinner() {
  return (
    <span className="inline-block w-3 h-3 border border-[var(--text-muted)] border-t-[var(--accent)] rounded-full animate-spin" />
  );
}

function PhaseBar({
  opening,
  middlegame,
  endgame,
}: {
  opening: number;
  middlegame: number;
  endgame: number;
}) {
  const total = opening + middlegame + endgame || 1;
  const pct = (n: number) => (n / total) * 100;

  return (
    <div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-[var(--bg-elev-2)]">
        {opening > 0 && (
          <div
            className="bg-[var(--blue)]/70"
            style={{ width: `${pct(opening)}%` }}
          />
        )}
        {middlegame > 0 && (
          <div
            className="bg-[var(--orange)]"
            style={{ width: `${pct(middlegame)}%` }}
          />
        )}
        {endgame > 0 && (
          <div
            className="bg-[var(--purple)]"
            style={{ width: `${pct(endgame)}%` }}
          />
        )}
      </div>
      <div className="flex gap-4 mt-2 text-xs text-[var(--text-muted)] flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 bg-[var(--blue)]/70 rounded-full" />
          Opening {opening}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 bg-[var(--orange)] rounded-full" />
          Middlegame {middlegame}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 bg-[var(--purple)] rounded-full" />
          Endgame {endgame}
        </span>
      </div>
    </div>
  );
}
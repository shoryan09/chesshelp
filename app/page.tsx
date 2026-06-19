"use client";

import { useState, useRef, useEffect } from "react";
import { getRecentGames } from "@/lib/chesscom";
import type { ParsedGame } from "@/lib/types";
import { StockfishEngine } from "@/lib/engine";
import { analyzeGame, getDrillable, type AnnotatedMove } from "@/lib/analyzer";
import { AnalysisBoard } from "@/components/AnalysisBoard";
import { THEME_LABELS, THEME_URLS } from "@/lib/themes";
import { QuizPanel } from "@/components/QuizPanel";
import { saveAnalysis, loadAnalysesForUrls} from "@/lib/cache";
import { useTheme } from "@/lib/use-theme";

type AnalysisState = {
  status: "idle" | "loading-engine" | "analyzing" | "done" | "error";
  progress?: { current: number; total: number };
  annotations?: AnnotatedMove[];
  error?: string;
};

const SESSION_KEY = "chesslens:session";

type SessionSnapshot = {
  username: string;
  usernameInput: string;
  games: ParsedGame[];
  analyses: Record<string, AnalysisState>;
  analysisBoardGameUrl: string | null;
  quizGameUrl: string | null;
};

export default function Home() {
  const [username, setUsername] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [games, setGames] = useState<ParsedGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { theme, toggle } = useTheme();

  const engineRef = useRef<StockfishEngine | null>(null);
  const engineWarmedRef = useRef(false);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisState>>({});
  const [quizGameUrl, setQuizGameUrl] = useState<string | null>(null);
  const [analysisBoardGameUrl, setAnalysisBoardGameUrl] = useState<
    string | null
  >(null);

  function getEngine() {
    if (!engineRef.current) engineRef.current = new StockfishEngine();
    return engineRef.current;
  }

  // Restore session on mount (refresh within the same tab). sessionStorage is
  // cleared automatically for a new tab, so a fresh tab starts blank.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw) as SessionSnapshot;

      if (typeof snap.username === "string") setUsername(snap.username);
      if (typeof snap.usernameInput === "string")
        setUsernameInput(snap.usernameInput);
      if (Array.isArray(snap.games)) {
        // endTime round-trips through JSON as a string; revive it as a Date.
        setGames(
          snap.games.map((g) => ({ ...g, endTime: new Date(g.endTime) }))
        );
      }
      if (snap.analyses) {
        const restored: Record<string, AnalysisState> = {};
        for (const [url, state] of Object.entries(snap.analyses)) {
          // A persisted "analyzing" state has no live engine behind it — reset
          // it so the UI doesn't show a stuck progress indicator.
          restored[url] =
            state.status === "analyzing" ? { ...state, status: "idle" } : state;
        }
        setAnalyses(restored);
      }
      if (snap.analysisBoardGameUrl !== undefined)
        setAnalysisBoardGameUrl(snap.analysisBoardGameUrl);
      if (snap.quizGameUrl !== undefined) setQuizGameUrl(snap.quizGameUrl);
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }, []);

  // Persist the session snapshot whenever any tracked value changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        username,
        usernameInput,
        games,
        analyses,
        analysisBoardGameUrl,
        quizGameUrl,
      })
    );
  }, [username, usernameInput, games, analyses, analysisBoardGameUrl, quizGameUrl]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = usernameInput.trim();
    if (!name) return;
    setLoading(true);
    setError(null);
    setUsername(name);
    setGames([]);
    setAnalyses({});
    try {
      const result = await getRecentGames(name, 1);
      setGames(result);

      const cached = await loadAnalysesForUrls(result.map((g) => g.url));
      const hydrated: Record<string, AnalysisState> = {};
      for (const [url, entry] of cached) {
        hydrated[url] = { status: "done", annotations: entry.annotations };
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

      const annotations = await analyzeGame(
        game.pgn,
        game.userColor,
        getEngine(),
        {
          depth: 15,
          onProgress: (current, total) =>
            setAnalyses((a) => ({
              ...a,
              [game.url]: { status: "analyzing", progress: { current, total } },
            })),
        }
      );
      setAnalyses((a) => ({
        ...a,
        [game.url]: { status: "done", annotations },
      }));
      saveAnalysis(game.url, annotations, 15).catch(console.error);
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

  const quizGame = quizGameUrl ? games.find((g) => g.url === quizGameUrl) : null;
  const quizDrillable =
    quizGame && analyses[quizGame.url]?.annotations
      ? getDrillable(analyses[quizGame.url].annotations!, quizGame.userColor)
      : null;

  const boardGame = analysisBoardGameUrl
    ? games.find((g) => g.url === analysisBoardGameUrl)
    : null;
  const boardAnnotations =
    analysisBoardGameUrl && analyses[analysisBoardGameUrl]?.annotations
      ? analyses[analysisBoardGameUrl].annotations!
      : null;

  return (
    <main className="min-h-screen p-4 sm:p-8">
      {theme && (
  <button
    onClick={toggle}
    aria-label="Toggle theme"
    className="fixed top-4 right-4 z-20 p-2 bg-[var(--bg-elev)] border border-[var(--border)] rounded-md hover:bg-[var(--bg-elev-2)] transition-colors"
  >
    {theme === "dark" ? (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4"/>
        <path d="M12 2v2"/>
        <path d="M12 20v2"/>
        <path d="m4.93 4.93 1.41 1.41"/>
        <path d="m17.66 17.66 1.41 1.41"/>
        <path d="M2 12h2"/>
        <path d="M20 12h2"/>
        <path d="m6.34 17.66-1.41 1.41"/>
        <path d="m19.07 4.93-1.41 1.41"/>
      </svg>
    ) : (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
      </svg>
    )}
  </button>
)}
      <div className="max-w-2xl mx-auto">
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
          <p className="text-xs text-[var(--text-muted)] mt-3">
            An independent tool. Not affiliated with Chess.com or Lichess.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col sm:flex-row gap-2 mb-12"
        >
          <input
            type="text"
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            placeholder="chess.com username"
            className="flex-1 px-4 py-2.5 bg-[var(--bg-elev)] border border-[var(--border)] rounded-md text-sm focus:outline-none focus:border-[var(--text-muted)] transition-colors"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || !usernameInput.trim()}
              className="flex-1 sm:flex-none px-5 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--bg)] disabled:bg-[var(--bg-elev-2)] disabled:text-[var(--text-muted)] rounded-md text-sm font-medium transition-colors"
            >
              {loading ? "Loading..." : "Analyze games"}
            </button>
          </div>
        </form>

        {error && (
          <div className="p-3 mb-6 bg-[var(--bg-elev)] border border-[var(--red)]/40 rounded-md text-sm text-[var(--red)]">
            {error}
          </div>
        )}

        {(() => {
          const allDrillable = games
            .map((g) => ({ g, a: analyses[g.url] }))
            .filter(({ a }) => a?.status === "done" && a.annotations)
            .flatMap(({ g, a }) => getDrillable(a!.annotations!, g.userColor));

          if (allDrillable.length === 0) return null;

          const analyzedCount = Object.values(analyses).filter(
            (a) => a?.status === "done"
          ).length;

          const byPhase = {
            opening: allDrillable.filter((m) => m.phase === "opening").length,
            middlegame: allDrillable.filter((m) => m.phase === "middlegame")
              .length,
            endgame: allDrillable.filter((m) => m.phase === "endgame").length,
          };

          const byKind = {
            mistake: allDrillable.filter(
              (m) => m.classification === "mistake" || m.classification === "blunder"
            ).length,
            miss: allDrillable.filter((m) => m.classification === "miss").length,
          };

          const themeCounts = allDrillable.reduce<Record<string, number>>(
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
                      <a
                        key={theme}
                        href={THEME_URLS[theme as keyof typeof THEME_URLS]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 bg-transparent hover:bg-[var(--bg-elev-2)] border border-[var(--border)] rounded-md text-xs transition-colors"
                      >
                        {THEME_LABELS[theme as keyof typeof THEME_LABELS]}
                        <span className="text-[var(--text-muted)] ml-1.5">
                          ×{count}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })()}

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
                const drillable =
                  a?.status === "done" && a.annotations
                    ? getDrillable(a.annotations, g.userColor)
                    : [];
                const hasMistakes = drillable.length > 0;
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
                        <a
                          href={g.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 bg-transparent hover:bg-[var(--bg-elev-2)] border border-[var(--border)] rounded-md text-xs transition-colors"
                        >
                          Open
                        </a>
                        <button
                          onClick={() => runAnalysis(g)}
                          disabled={
                            a?.status === "analyzing" ||
                            a?.status === "loading-engine"
                          }
                          className="px-2.5 py-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--bg)] disabled:bg-[var(--bg-elev-2)] disabled:text-[var(--text-muted)] rounded-md text-xs font-medium transition-colors"
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
                        {hasMistakes && (
                          <button
                            onClick={() => setAnalysisBoardGameUrl(g.url)}
                            className="px-2.5 py-1 bg-transparent hover:bg-[var(--bg-elev-2)] border border-[var(--border)] rounded-md text-xs font-medium transition-colors"
                          >
                            Board →
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

                    {a?.status === "done" && a.annotations && (
                      <div className="mt-4 pt-4 border-t border-[var(--border-soft)]">
                        <div className="flex items-center gap-3 text-xs mb-3">
                          <span>
                            <span className="text-[var(--orange)] font-medium">
                              {
                                drillable.filter(
                                  (m) =>
                                    m.classification === "mistake" ||
                                    m.classification === "blunder"
                                ).length
                              }
                            </span>
                            <span className="text-[var(--text-muted)] ml-1">
                              mistakes
                            </span>
                          </span>
                          <span>
                            <span className="text-[var(--purple)] font-medium">
                              {drillable.filter((m) => m.classification === "miss").length}
                            </span>
                            <span className="text-[var(--text-muted)] ml-1">
                              misses
                            </span>
                          </span>
                          <span className="text-[var(--text-muted)] ml-auto">
                            O·
                            {drillable.filter((m) => m.phase === "opening").length}{" "}
                            M·
                            {drillable.filter((m) => m.phase === "middlegame").length}{" "}
                            E·
                            {drillable.filter((m) => m.phase === "endgame").length}
                          </span>
                        </div>

                        {drillable.length > 0 &&
                          (() => {
                            const themes = Array.from(
                              new Set(drillable.map((m) => m.theme))
                            );
                            return (
                              <div className="mb-3 flex flex-wrap gap-1.5">
                                {themes.map((t) => (
                                  <a
                                    key={t}
                                    href={THEME_URLS[t]}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-2 py-0.5 bg-transparent hover:bg-[var(--bg-elev-2)] border border-[var(--border)] rounded text-xs text-[var(--text-soft)] transition-colors"
                                  >
                                    {THEME_LABELS[t]} ↗
                                  </a>
                                ))}
                              </div>
                            );
                          })()}

                        {drillable.length > 0 && (
                          <div className="space-y-1 text-xs font-mono">
                            {drillable.map((m) => (
                              <div
                                key={m.ply}
                                className="flex items-center gap-2 text-[var(--text-soft)] flex-wrap"
                              >
                                <span className="text-[var(--text-muted)]">
                                  {m.moveNumber}.
                                </span>
                                <span
                                  className={
                                    m.classification === "miss"
                                      ? "text-[var(--purple)]"
                                      : m.classification === "blunder"
                                      ? "text-[var(--red)]"
                                      : "text-[var(--orange)]"
                                  }
                                >
                                  {m.classification}
                                </span>
                                <span className="text-[var(--red)]">
                                  {m.san}
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
          <div>Stockfish 18 · No login · Built for chess.com (Not affiliated with Chess.com)</div>
        </footer>
      </div>

      {quizGame && quizDrillable && (
        <QuizPanel
          mistakes={quizDrillable}
          userColor={quizGame.userColor}
          engine={getEngine()}
          onClose={() => setQuizGameUrl(null)}
        />
      )}

      {boardGame && boardAnnotations && boardAnnotations.length > 0 && (
        <AnalysisBoard
          annotations={boardAnnotations}
          userColor={boardGame.userColor}
          startingFen={boardAnnotations[0].fenBefore}
          onClose={() => setAnalysisBoardGameUrl(null)}
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
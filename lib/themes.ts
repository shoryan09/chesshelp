export type ThemeKey =
  | "mateIn1"
  | "mateIn2"
  | "mateIn3"
  | "mateIn4"
  | "mateIn5"
  | "backRankMate"
  | "hangingPiece"
  | "fork"
  | "advantage"
  | "general";

export const THEME_LABELS: Record<ThemeKey, string> = {
  mateIn1: "Mate in 1",
  mateIn2: "Mate in 2",
  mateIn3: "Mate in 3",
  mateIn4: "Mate in 4",
  mateIn5: "Mate in 5",
  backRankMate: "Back rank mate",
  hangingPiece: "Hanging piece",
  fork: "Fork",
  advantage: "Winning position",
  general: "General tactics",
};

export const THEME_URLS: Record<ThemeKey, string> = {
  mateIn1: "https://lichess.org/training/mateIn1",
  mateIn2: "https://lichess.org/training/mateIn2",
  mateIn3: "https://lichess.org/training/mateIn3",
  mateIn4: "https://lichess.org/training/mateIn4",
  mateIn5: "https://lichess.org/training/mateIn5",
  backRankMate: "https://lichess.org/training/backRankMate",
  hangingPiece: "https://lichess.org/training/hangingPiece",
  fork: "https://lichess.org/training/fork",
  advantage: "https://lichess.org/training/advantage",
  general: "https://lichess.org/training",
};
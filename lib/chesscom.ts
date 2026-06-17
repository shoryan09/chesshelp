import type { ChessComGame, ParsedGame } from "./types";

const BASE = "https://api.chess.com/pub";

export async function getArchives(username: string): Promise<string[]> {
  const res = await fetch(`${BASE}/player/${username.toLowerCase()}/games/archives`);
  if (res.status === 404) throw new Error(`Player "${username}" not found`);
  if (!res.ok) throw new Error(`chess.com API error: ${res.status}`);
  const data = await res.json();
  return data.archives as string[];
}

export async function getGamesFromArchive(url: string): Promise<ChessComGame[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch archive: ${res.status}`);
  const data = await res.json();
  return data.games as ChessComGame[];
}

export async function getRecentGames(
  username: string,
  monthsBack = 1
): Promise<ParsedGame[]> {
  const archives = await getArchives(username);
  const recent = archives.slice(-monthsBack);

  const all: ChessComGame[] = [];
  for (const url of recent) {
    all.push(...(await getGamesFromArchive(url)));
  }

  const u = username.toLowerCase();
  const drawResults = new Set([
    "agreed",
    "stalemate",
    "repetition",
    "insufficient",
    "50move",
    "timevsinsufficient",
  ]);

  return all
    .filter((g) => g.rules === "chess")
    .map((g): ParsedGame => {
      const userIsWhite = g.white.username.toLowerCase() === u;
      const userResultRaw = userIsWhite ? g.white.result : g.black.result;
      const user = userIsWhite ? g.white : g.black;
      const opponent = userIsWhite ? g.black : g.white;

      const userResult =
        userResultRaw === "win"
          ? "win"
          : drawResults.has(userResultRaw)
          ? "draw"
          : "loss";

      return {
        url: g.url,
        pgn: g.pgn,
        endTime: new Date(g.end_time * 1000),
        timeClass: g.time_class,
        timeControl: g.time_control,
        userColor: userIsWhite ? "white" : "black",
        userResult,
        userRating: user.rating,
        opponentName: opponent.username,
        opponentRating: opponent.rating,
      };
    })
    .sort((a, b) => b.endTime.getTime() - a.endTime.getTime());
}
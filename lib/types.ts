export type ChessComPlayer = {
  username: string;
  rating: number;
  result: string;
};

export type ChessComGame = {
  url: string;
  pgn: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  time_class: "rapid" | "blitz" | "bullet" | "daily";
  rules: string;
  white: ChessComPlayer;
  black: ChessComPlayer;
};

export type ParsedGame = {
  url: string;
  pgn: string;
  endTime: Date;
  timeClass: string;
  timeControl: string;
  userColor: "white" | "black";
  userResult: "win" | "loss" | "draw";
  userRating: number;
  opponentName: string;
  opponentRating: number;
};
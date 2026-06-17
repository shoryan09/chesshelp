export type EvalResult = {
  cp: number;
  mate: number | null;
  bestMove: string;
  depth: number;
};

export class StockfishEngine {
  private worker: Worker;
  private ready: Promise<void>;

  constructor(workerPath = "/stockfish/stockfish.js") {
    this.worker = new Worker(workerPath);
    this.ready = this.init();
  }

  private init(): Promise<void> {
    return new Promise((resolve) => {
      const onMsg = (e: MessageEvent) => {
        const line = e.data as string;
        if (line === "uciok") this.send("isready");
        else if (line === "readyok") {
          this.worker.removeEventListener("message", onMsg);
          resolve();
        }
      };
      this.worker.addEventListener("message", onMsg);
      this.send("uci");
    });
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  async evaluate(fen: string, depth = 15): Promise<EvalResult> {
    await this.ready;
    const sideToMove = fen.split(" ")[1] as "w" | "b";

    return new Promise((resolve) => {
      let lastCp = 0;
      let lastMate: number | null = null;
      let lastDepth = 0;

      const onMsg = (e: MessageEvent) => {
        const line = e.data as string;
        if (typeof line !== "string") return;

        if (line.startsWith("info") && line.includes("depth")) {
          const d = line.match(/depth (\d+)/);
          if (d) lastDepth = parseInt(d[1], 10);

          const cp = line.match(/score cp (-?\d+)/);
          const mate = line.match(/score mate (-?\d+)/);

          if (cp) {
            lastCp = parseInt(cp[1], 10);
            lastMate = null;
          } else if (mate) {
            lastMate = parseInt(mate[1], 10);
            lastCp = lastMate > 0 ? 100000 : -100000;
          }
        }

        if (line.startsWith("bestmove")) {
          this.worker.removeEventListener("message", onMsg);
          const bestMove = line.split(" ")[1];
          const cp = sideToMove === "w" ? lastCp : -lastCp;
          const mate =
            lastMate === null ? null : sideToMove === "w" ? lastMate : -lastMate;
          resolve({ cp, mate, bestMove, depth: lastDepth });
        }
      };

      this.worker.addEventListener("message", onMsg);
      this.send("ucinewgame");
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
    });
  }

  terminate() {
    this.worker.terminate();
  }
}
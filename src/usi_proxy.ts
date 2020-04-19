/*
  USIプロトコルに従ってホストプロセス（将棋所などの親プロセス）とプライマリエンジン、バックアップエンジンの仲介を行う。
*/

export type USIProxyCommandTarget = "p" | "b" | "h";

export type USIProxyCallbacks = {
  write: (to: USIProxyCommandTarget, command: string[]) => void;
  quit: () => void;
  setPrimaryTimeout: () => void;
  clearPrimaryTimeout: () => void;
};

type StateEventCommand = {
  type: "command";
  from: USIProxyCommandTarget;
  command: string[];
};

type StateEventPrimaryError = {
  type: "primaryError";
};

type StateEvent = StateEventCommand | StateEventPrimaryError;

export class USIProxy {
  stateHandler: (event: StateEvent) => void;
  position: string[] | null = null;
  goWithoutPonder: string[] | null = null;
  dummyBestmove: boolean = false;
  commandQueueBeforeBStartup: StateEvent[] = [];
  constructor(public callbacks: USIProxyCallbacks, public backupSetoption: string[]) {

  }

  start() {
    this.startBStartup();
  }

  relay(event: StateEventCommand, engine: "p" | "b"): void {
    // hostとengine間のコマンドを相互に中継する
    let to: USIProxyCommandTarget;
    if (event.from === "h") {
      to = engine;
    } else {
      if (event.from === engine) {
        to = "h";
      } else {
        // 中継対象でない側から来た
        // primaryがタイムアウトしたが、接続が復帰して続きのコマンドが来た場合に発生する
        return;
      }
    }
    this.write(to, event.command);
  }

  write(to: USIProxyCommandTarget, command: string[]): void {
    if (to === "h" && command[0] === "bestmove") {
      this.dummyBestmove = false;
    }
    this.callbacks.write(to, command);
  }

  onCommand(from: USIProxyCommandTarget, command: string[]): void {
    if (command[0] === "quit") {
      // 終了処理
      this.callbacks.quit();
      return;
    }
    this.stateHandler({ type: "command", from, command });
  }

  onPrimaryError(): void {
    if (this.dummyBestmove) {
      // ponderがstopされた際に必要なダミーのbestmove
      this.write("h", ["bestmove", "resign"]);
    }
    this.stateHandler({ type: "primaryError" });
  }

  startBStartup(): void {
    this.stateHandler = this.handleBStartup.bind(this);
    this.callbacks.write("b", ["usi"]);
  }

  handleBStartup(event: StateEvent): void {
    if (event.type === "primaryError") {
      // TODO: そもそも対局開始すべきでない
      this.startBRelay();
    } else {
      if (event.from === "b") {
        if (event.command[0] === "usiok") {
          for (const option of this.backupSetoption) {
            this.callbacks.write("b", ["setoption"].concat(option));
          }
          this.callbacks.write("b", ["isready"]);
        } else if (event.command[0] === "readyok") {
          this.callbacks.write("b", ["usinewgame"]);
          // バックアップエンジンの準備完了、メインエンジンとホストをつなぐ
          this.startPWaitPosition();
          for (const queueEvent of this.commandQueueBeforeBStartup) {
            this.stateHandler(queueEvent);
          }
        }
      } else if (event.from === "p") {
        // まだ"usi"をエンジンに送ってないので、そもそも発生しないはず
      } else if (event.from === "h") {
        // コマンドをためておく
        this.commandQueueBeforeBStartup.push(event);
      }
    }
  }

  startPWaitPosition(): void {
    this.stateHandler = this.handlePWaitPosition.bind(this);
  }

  handlePWaitPosition(event: StateEvent): void {
    if (event.type === "primaryError") {
      this.startBRelay();
    } else {
      this.relay(event, "p");
      if (event.from === "h" && event.command[0] === "position") {
        this.position = event.command;
        this.startPWaitGo();
      }
    }
  }

  startPWaitGo(): void {
    this.stateHandler = this.handlePWaitGo.bind(this);
  }

  handlePWaitGo(event: StateEvent): void {
    if (event.type === "primaryError") {
      this.write("b", this.position);
      this.startBRelay();
    } else {
      this.relay(event, "p");
      if (event.from === "h" && event.command[0] === "go") {
        if (event.command[1] === "ponder") {
          this.goWithoutPonder = event.command.concat();
          this.goWithoutPonder.splice(1, 1);
          this.startPPonder();
        } else {
          this.goWithoutPonder = event.command;
          this.startPGo();
        }
      }
    }
  }

  startPGo(): void {
    this.stateHandler = this.handlePGo.bind(this);
    this.callbacks.setPrimaryTimeout();
  }

  handlePGo(event: StateEvent): void {
    if (event.type === "primaryError") {
      this.callbacks.clearPrimaryTimeout();
      this.write("b", this.position);
      this.write("b", this.goWithoutPonder);
      this.startBRelay();
    } else {
      this.relay(event, "p");
      if (event.from === "p") {
        if (event.command[0] === "bestmove") {
          this.callbacks.clearPrimaryTimeout();
          this.startPWaitPosition();
        } else {
          // 読み筋等のメッセージ
          // タイムアウトを延長
          this.callbacks.setPrimaryTimeout();
        }
      }
    }
  }

  startPPonder(): void {
    this.stateHandler = this.handlePPonder.bind(this);
  }

  handlePPonder(event: StateEvent): void {
    if (event.type === "primaryError") {
      this.startBPonder();
    } else {
      this.relay(event, "p");
      if (event.from === "h" && event.command[0] === "ponderhit") {
        this.startPGo();
      }
      if (event.from === "h" && event.command[0] === "stop") {
        this.dummyBestmove = true;
        this.startPWaitPosition();
      }
    }
  }

  startBRelay(): void {
    this.stateHandler = this.handleBRelay.bind(this);
  }

  handleBRelay(event: StateEvent): void {
    if (event.type === "primaryError") {
    } else {
      this.relay(event, "b");
    }
  }

  startBPonder(): void {
    this.stateHandler = this.handleBPonder.bind(this);
  }

  handleBPonder(event: StateEvent): void {
    if (event.type === "primaryError") {
    } else {
      if (event.from === "h" && event.command[0] === "ponderhit") {
        this.write("b", this.position);
        this.write("b", this.goWithoutPonder);
        this.startBRelay();
      }
      if (event.from === "h" && event.command[0] === "stop") {
        // ponderがstopされた際に必要なダミーのbestmove
        this.write("h", ["bestmove", "resign"]);
        this.startBRelay();
      }
    }
  }
}

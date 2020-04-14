import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { ChunkBuffer } from "./chunk_buffer";
import { USIProxy, USIProxyCommandTarget } from "./usi_proxy";

let config: any;
let primaryEngine: ChildProcessWithoutNullStreams;
let backupEngine: ChildProcessWithoutNullStreams;

const writeLog = (data: any) => {
    data["timestamp"] = (new Date()).toISOString();
    process.stderr.write(JSON.stringify(data) + "\n");
};

const main = () => {
    config = JSON.parse(fs.readFileSync("./engine.json", { encoding: "utf-8" }));
    primaryEngine = spawn(config.engines.primary.path, [], { shell: true, cwd: path.dirname(config.engines.primary.path) });//{shell: true}はWindowsでバッチファイルを利用可能にする
    backupEngine = spawn(config.engines.backup.path, [], { shell: true, cwd: path.dirname(config.engines.primary.path) });
    const parentReadBuffer = new ChunkBuffer();
    const primaryReadBuffer = new ChunkBuffer();
    const backupReadBuffer = new ChunkBuffer();
    let timeoutHandle: ReturnType<typeof window.setTimeout> | null = null;
    let usiProxy: USIProxy;
    let cleanupTimeoutHandle: ReturnType<typeof window.setTimeout> | null = null;
    let exitCounter = 0;//いくつのエンジンが終了したか

    // ホスト（将棋所など）からのコマンド
    process.stdin.on("data", (chunk: Buffer) => {
        parentReadBuffer.push(chunk);
        let line;
        while ((line = parentReadBuffer.getLine()) !== null) {
            writeLog({ type: "process.stdin.on.data", data: line });
            usiProxy.onCommand("h", line.split(" "));
        }
    });

    // 起動失敗、kill失敗
    primaryEngine.on("error", (error) => {
        writeLog({ type: "primaryEngine.on.error", error: error.message });
        usiProxy.onPrimaryError();
    });

    // 終了（クラッシュの場合も含まれる）
    primaryEngine.on("exit", (code) => {
        writeLog({ type: "primaryEngine.on.exit", exitCode: code });
        usiProxy.onPrimaryError();
        exitCounter++;
        if (exitCounter === 2) {
            if (cleanupTimeoutHandle) {
                clearTimeout(cleanupTimeoutHandle);
            }
            cleanup();
        }
    });

    // エンジンからのメッセージ出力
    primaryEngine.stdout.on("data", (chunk: Buffer) => {
        primaryReadBuffer.push(chunk);
        let line;
        while ((line = primaryReadBuffer.getLine()) !== null) {
            writeLog({ type: "primaryEngine.stdout.on.data", data: line });
            usiProxy.onCommand("p", line.split(" "));
        }
    });

    // stdin.write引数のcallbackが呼ばれた後、エラーがあったらイベント発生
    // https://nodejs.org/api/stream.html#stream_writable_write_chunk_encoding_callback
    // The writable.write() method writes some data to the stream, and calls the supplied
    // callback once the data has been fully handled. If an error occurs, the callback may
    // or may not be called with the error as its first argument. To reliably detect write errors,
    // add a listener for the 'error' event. If callback is called with an error,
    // it will be called before the 'error' event is emitted.
    primaryEngine.stdin.on("error", (error) => {
        writeLog({ type: " primaryEngine.stdin.on.error", error: error.message });
        usiProxy.onPrimaryError();
    });

    // 起動失敗、kill失敗
    backupEngine.on("error", (error) => {
        writeLog({ type: " backupEngine.on.error", error: error.message });
        // TODO
    });

    // 終了（クラッシュの場合も含まれる）
    backupEngine.on("exit", (code) => {
        writeLog({ type: "backupEngine.on.exit", exitCode: code });
        // TODO
        exitCounter++;
        if (exitCounter === 2) {
            if (cleanupTimeoutHandle) {
                clearTimeout(cleanupTimeoutHandle);
            }
            cleanup();
        }
    });

    // エンジンからのメッセージ出力
    backupEngine.stdout.on("data", (chunk: Buffer) => {
        backupReadBuffer.push(chunk);
        let line;
        while ((line = backupReadBuffer.getLine()) !== null) {
            writeLog({ type: "backupEngine.stdout.on.data", data: line });
            usiProxy.onCommand("b", line.split(" "));
        }
    });

    // stdin.write引数のcallbackが呼ばれた後、エラーがあったらイベント発生
    // https://nodejs.org/api/stream.html#stream_writable_write_chunk_encoding_callback
    // The writable.write() method writes some data to the stream, and calls the supplied
    // callback once the data has been fully handled. If an error occurs, the callback may
    // or may not be called with the error as its first argument. To reliably detect write errors,
    // add a listener for the 'error' event. If callback is called with an error,
    // it will be called before the 'error' event is emitted.
    backupEngine.stdin.on("error", (error) => {
        // TODO
        writeLog({ type: " backupEngine.stdin.on.error", error: error.message });
    });

    const write = (to: USIProxyCommandTarget, command: string[]): void => {
        switch (to) {
            case "h":
                writeLog({ type: "process.stdout.write", command });
                process.stdout.write(command.join(" ") + "\n");
                break;
            case "p":
                writeLog({ type: "primaryEngine.stdin.write", command });
                primaryEngine.stdin.write(command.join(" ") + "\n", "ascii", () => { });
                break;
            case "b":
                writeLog({ type: "backupEngine.stdin.write", command });
                backupEngine.stdin.write(command.join(" ") + "\n", "ascii", () => { });
                break;
            default:
                break;
        }
    };

    const cleanup = () => {
        writeLog({ type: "cleanup" });
        primaryEngine.kill();
        backupEngine.kill();
        process.exit(0);
    };

    const quit = () => {
        writeLog({ type: "exit" });
        write("p", ["quit"]);
        write("b", ["quit"]);
        // 一定時間終了待ちをしたあと強制終了するが、すべてのエンジンが終了したらその時点で(exitハンドラから)cleanupが呼ばれる
        cleanupTimeoutHandle = setTimeout(cleanup, 1000);
    };

    const setPrimaryTimeout = (): void => {
        writeLog({ type: "setPrimaryTimeout" });
        if (timeoutHandle !== null) {
            clearTimeout(timeoutHandle);
        }
        timeoutHandle = setTimeout(() => {
            writeLog({ type: "primaryTimeout" });
            timeoutHandle = null;
            usiProxy.onPrimaryError();//タイムアウトはエラーの一種
        }, config.engines.primary.timeoutSec * 1000);
    };
    const clearPrimaryTimeout = (): void => {
        writeLog({ type: "clearPrimaryTimeout" });
        if (timeoutHandle !== null) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }
    };

    usiProxy = new USIProxy({
        write,
        quit,
        setPrimaryTimeout,
        clearPrimaryTimeout,
    }, config.engines.backup.setoption);
    writeLog({ type: "start" });
    usiProxy.start();
}

main();

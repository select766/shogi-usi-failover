/*

*/

let fail_command = process.argv[2];
if (!["ok", "stop-read", "stop-write", "exit"].includes(fail_command)) {
    console.error("usage: node host.js error-reason\nerror-reason is one of ok, stop-read, stop-write, exit");
    process.exit(1);
}

const { spawn } = require("child_process");
const engine_path = process.platform === "win32" ? "engine.exe" : "./engine";
// プライマリエンジン（トラブル発生側）
const primary_engine = spawn(engine_path, [], { shell: true });
// バックアップエンジン（プライマリエンジンがトラブっても動き続ける想定）
const backup_engine = spawn(engine_path, [], { shell: true });

const write_log = (data) => {
    data["timestamp"] = (new Date()).toISOString();
    process.stdout.write(JSON.stringify(data) + "\n");
};

const random_str = () => {
    // ランダムな内容かつ長さも1~100文字でランダム
    const l = Math.floor(Math.random() * 100) + 1;
    const c = "abcdefghijklmnopqrstuvwxyz0123456789";
    const cl = c.length;
    let r = "";
    for (var i = 0; i < l; i++) {
        r += c[Math.floor(Math.random() * cl)];
    }
    return r;
}

const lf_charcode = '\n'.charCodeAt(0);
const cr_charcode = '\r'.charCodeAt(0);
class ChunkBuffer {
    constructor() {
        this.pending = Buffer.alloc(0);
    }

    push(chunk) {
        this.pending = Buffer.concat([this.pending, chunk]);
    }

    getLine() {
        const lf_index = this.pending.indexOf(lf_charcode);
        if (lf_index < 0) {
            return null;
        }
        let line_length = lf_index;
        // CRがあれば除去
        if (line_length > 0) {
            if (this.pending[line_length - 1] == cr_charcode) {
                line_length--;
            }
        }
        const line_string = this.pending.slice(0, line_length).toString("utf-8");
        this.pending = this.pending.slice(lf_index + 1);
        return line_string;
    }
}

const primary_read_buffer = new ChunkBuffer();
const backup_read_buffer = new ChunkBuffer();
let primary_fail = false;
// プライマリエンジンからメッセージが受信されない場合のタイムアウトを管理するsetTimeoutのハンドル。
let primary_timeout = null;

const primary_timeout_handler = () => {
    primary_fail = true;
    write_log({ type: "primary-timeout" });
};

primary_engine.stdout.on("data", (chunk) => {
    primary_read_buffer.push(chunk);
    let line;
    while ((line = primary_read_buffer.getLine()) !== null) {
        // タイムアウトを1秒延長
        if (primary_timeout !== null) {
            clearTimeout(primary_timeout);
        }
        if (!primary_fail) {
            primary_timeout = setTimeout(primary_timeout_handler, 1000);
        }
        write_log({ type: "primary-read", data: line });
    }
});


primary_timeout = setTimeout(primary_timeout_handler, 1000);

backup_engine.stdout.on("data", (chunk) => {
    backup_read_buffer.push(chunk);
    let line;
    while ((line = backup_read_buffer.getLine()) !== null) {
        write_log({ type: "backup-read", data: line });
    }
});

// stdin.write引数のcallbackが呼ばれた後、エラーがあったらイベント発生
// https://nodejs.org/api/stream.html#stream_writable_write_chunk_encoding_callback
// The writable.write() method writes some data to the stream, and calls the supplied
// callback once the data has been fully handled. If an error occurs, the callback may
// or may not be called with the error as its first argument. To reliably detect write errors,
// add a listener for the 'error' event. If callback is called with an error,
// it will be called before the 'error' event is emitted.
primary_engine.stdin.on("error", (error) => {
    write_log({ type: "primary-write-error-event", error: error.message });
});

backup_engine.stdin.on("error", (error) => {
    write_log({ type: "backup-write-error-event", error: error.message });
});

primary_engine.on("exit", (code) => {
    write_log({ type: "primary-exit", code });
});

backup_engine.on("exit", (code) => {
    write_log({ type: "backup-exit", code });
});

const primary_write = (data) => {
    write_log({ type: "primary-write", data });
    primary_engine.stdin.write(Buffer.from(data + "\n"), (error) => {
        // flushされたときかエラーが生じた際に呼ばれる
        if (error) {
            write_log({ type: "primary-write-error", error: error.message });
        } else {
            write_log({ type: "primary-write-flushed", data });
        }
    });
};

const backup_write = (data) => {
    write_log({ type: "backup-write", data });
    backup_engine.stdin.write(Buffer.from(data + "\n"), (error) => {
        if (error) {
            write_log({ type: "backup-write-error", error: error.message });
        } else {
            write_log({ type: "backup-write-flushed", data });
        }
    });
};

const primary_write_interval = setInterval(() => {
    primary_write(`echo P_${random_str()}`);
}, 10);
const backup_write_interval = setInterval(() => {
    backup_write(`echo B_${random_str()}`);
}, 10);


// 2秒後にエラーを発生させる
if (fail_command !== "ok") {
    setTimeout(() => {
        primary_write(`${fail_command}`);
    }, 2000);
}

// 5秒後に書き込みを停止し、送信済みメッセージに対する応答を待つだけにする
setTimeout(() => {
    write_log({ type: "stop" });
    clearInterval(primary_write_interval);
    clearInterval(backup_write_interval);
}, 5000);

// プロセス終了
setTimeout(() => {
    write_log({ type: "kill" });
    primary_engine.kill();
    backup_engine.kill();
    process.exit(0);
}, 6000);

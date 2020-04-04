/*
ログファイルを読んで、すべてのechoが成功しているかを確認。
*/

if (process.argv.length !== 3) {
    console.error("usage: node check-echo.js log-file");
    process.exit(1);
}

const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
    input: fs.createReadStream(process.argv[2])
});

const message_count = {};
const primary_pendings = [];
const backup_pendings = [];

rl.on("line", (line) => {
    const obj = JSON.parse(line);
    message_count[obj.type] = (message_count[obj.type] || 0) + 1;
    switch (obj.type) {
        case "primary-write":
            primary_pendings.push(obj.data);
            break;
        case "primary-read":
            {
                const idx = primary_pendings.indexOf(obj.data);
                if (idx < 0) {
                    console.error(`primary: echoed not sent message ${obj.data}`);
                } else {
                    primary_pendings.splice(idx, 1);
                }
            }
            break;
        case "backup-write":
            backup_pendings.push(obj.data);
            break;
        case "backup-read":
            {
                const idx = backup_pendings.indexOf(obj.data);
                if (idx < 0) {
                    console.error(`backup: echoed not sent message ${obj.data}`);
                } else {
                    backup_pendings.splice(idx, 1);
                }
            }
            break;

    }
});

rl.on("close", () => {
    console.info("message count:", message_count);
    console.info(`primary: ${primary_pendings.length} messages not echoed`);
    console.info(`backup: ${backup_pendings.length} messages not echoed`);
});

import { spawn } from "child_process";
import * as fs from "fs";
const config = JSON.parse(fs.readFileSync("./engine.json", { encoding: "utf-8" }));
const engine = spawn(config.engines.primary.path, []);

engine.stdout.on("data", (data) => {
    process.stdout.write(data);
});

process.stdin.on("data", (data) => {
    engine.stdin.write(data);
});

engine.on("exit", (code) => {
    process.exit(code);
});

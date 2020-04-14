const lf_charcode = '\n'.charCodeAt(0);
const cr_charcode = '\r'.charCodeAt(0);
export class ChunkBuffer {
    pending: Buffer;
    constructor() {
        this.pending = Buffer.alloc(0);
    }

    /**
     * 読み込まれたデータを未解釈として保存する。
     * @param chunk 読み込まれたバッファ
     */
    push(chunk: Buffer) {
        this.pending = Buffer.concat([this.pending, chunk]);
    }

    /**
     * 未解釈データから1行読み取る。
     * まだ1行分のデータがない場合はnullを返す。行末のCRLFは含まれない。
     */
    getLine(): string | null {
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

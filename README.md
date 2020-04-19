# shogi-usi-failover
USIプロトコルのコンピュータ将棋エンジンのフェイルオーバーツール

クラウド上で強力な将棋エンジンを動作させたいが、接続が切れたりクラッシュしたりした場合に予備のエンジンで対局を続行するという目的を実現する。

Windows向け。バッチファイル部分をシェルスクリプトに置き換えればLinuxでも動作するはず。

どのタイミングで通信が切れても対局を続行できるよう考慮してあるものの、もちろん無保証です。自己責任でご利用ください。

# 基本思想

* 2つの将棋エンジン「プライマリエンジン」「バックアップエンジン」を動作させる。
  * このツール自体にネットワーク通信機能はない。プライマリエンジンとしてsshコマンドを実行するバッチファイル等を指定することでクラウドとの通信を行う。
* 普段はホストとプライマリエンジンの通信を素通しするだけ。
* goコマンドの思考中、一定時間プライマリエンジンから出力がなければバックアップエンジンに切り替えて思考させる。

# 制約

* 1局のみ行うことを想定。**連続対局は想定していない。**
* プライマリエンジンが変な死に方をして定期的にメッセージは送ってくるものの指し手を出さずに時間切れという事態は防げない。
* 残り時間がわずかの場合は、バックアップエンジンの思考が間に合わず時間切れになる可能性がある。
  * 持ち時間の計算は行っていないため、バックアップエンジンは（最大ノード数を設定するなどして）**即指し設定を推奨**。
  * 例: `go btime 10000`で思考開始後8秒経過後にプライマリエンジンが終了判定を受けたとして、バックアップエンジンには`go btime 10000`が送られる。しかし実際には2秒しか時間がない。
* 最初の`go`コマンドがプライマリエンジンに届く前に異常が発生した場合のハンドリングは適当。手動で指しなおす前提。

# ビルド
node 10.x環境を想定。

```
yarn
yarn build
```

# 実行

`engine.json.example`を`engine.json`にコピーして必要事項を記入。

将棋所などから、`usi.bat`をエンジンとして登録する。

# 設定について
`engine.json`で行う。以下説明。

```json
{
    "engines": {
        "primary": {
            // プライマリエンジン
            "path": "D:\\dev\\shogi\\Shogidokoro\\Engine\\Lesserkai.exe",
            // goコマンドでの思考中、ここで指定した時間メッセージが出力されなければプライマリエンジンが使用不能とみなしバックアップエンジンに切り替える。
            "timeoutSec": 1
        },
        "backup": {
            // バックアップエンジン
            "path": "D:\\dev\\shogi\\Shogidokoro\\Engine\\Lesserkai.exe",
            // 起動時にsetoptionで与えるコマンド。
            "setoption": [
                "USI_Ponder value false",
                "USI_Hash value 256",
                "BookFile value public.bin",
                "UseBook value true"
            ]
        }
    },
    // ログファイルを吐き出すディレクトリ。指定しない場合はstderrに出力。
    "logdir": "log",
    // コマンド文字列を出力する際に正規表現で書き換える設定。
    "replace": {
        // ホスト（将棋所など）へ出力するコマンドの書き換え。例としてエンジン名の先頭にfailover-を付加する。
        "writehost": [
            [
                "^id name (.+)$",
                "id name failover-$1",
                ""
            ]
        ],
        "writeprimary": [],
        "writebackup": []
    }
}
```

`usi.bat`で、`node .`の行を`node . foo.json`のように書き換えると、デフォルトの`engine.json`の代わりに別の設定ファイルを使用できる。

# 挙動

* 初期化
  * ツールが起動されたら、プライマリエンジン・バックアップエンジンを起動する。
  * バックアップエンジンには設定ファイルで指定されたオプションを送り、`usinewgame`まで送っておく。

プライマリエンジンのエラー検知：
* 常時発生し、検知される
  * プロセスの終了やstdioのエラー
* goコマンド～bestmoveコマンドの間
  * 一定時間プライマリエンジンからのメッセージがないことによるタイムアウト
  * ponder中はタイムアウトはない。（すぐに思考が終わってコマンドを出力しない状態になる場合があるため）

これらのエラーが発生したら、バックアップエンジンに切り替わる。プライマリエンジンにすでに送られたgoコマンドなどが必要に応じてバックアップエンジンに送られることで、どのタイミングで切り替えが行われても将棋所から見て通信が正しく行われる。

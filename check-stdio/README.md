# 通信不良等でエンジンの入出力に問題が生じた際の挙動検証プログラム

プライマリエンジンが入出力しなくなったり不意に終了したりした際に、それを適切に検知しサブエンジンとの入出力に支障が出ないようなプログラムを開発することを目的とし、入出力の挙動を検証するためのプログラム。

以下はWindowsでの実行確認結果。Linuxでも動くように書いたつもりだが未検証。

ダミーエンジンはメッセージ(`\n`で終端される)を受け取り、エコーバックする。コマンドの後にはスペースを空けてランダムな文字列を付加できる（様々な長さの入出力を想定するため）。次のコマンドを認識する。

* echo
  * echoの後のランダムな文字列も含めて1行をエコーバックする。
* stop-read
  * stdinからの読み込みを停止する（スリープ）
* stop-write
  * stdinからの読み込みは行うが、エコーバックをしなくなる
* exit
  * プロセスを終了する

# ダミーエンジンのコンパイル
`x64 Native Tools Command Prompt for VS 2019`上で

```
cl engine.c
```

# 実行
```
node host.js stop-read > stop-read.log
node check-echo.js stop-read.log
```

注: PowerShell上で実行するとリダイレクトの文字コードがUTF-16となり解析がエラーとなるのでコマンドプロンプトで実行する。

`stop-read`は発行するコマンド（トラブルの原因）を表す。`stop-read, stop-write, stop, ok`のいずれかを指定。`ok`は異常が発生しない例。
`host.js`がエンジンを2つ起動し通信するプログラム。`check-echo.js`はエコーバックがちゃんとなされているかログを検証するプログラム。

## 結果例
`check-echo.js`の結果および導かれる挙動を記述する。いずれの場合でも、プライマリエンジンから受信された最後のメッセージから1秒後のタイムアウトは正しく発生し、またバックアップエンジンとの通信に支障はなかった。

### `ok`の場合
```
message count: { 'primary-write': 468,
  'backup-write': 467,
  'primary-write-flushed': 468,
  'primary-read': 468,
  'backup-write-flushed': 467,
  'backup-read': 467,
  stop: 1,
  'primary-timeout': 1,
  kill: 1 }
primary: 0 messages not echoed
backup: 0 messages not echoed
```

すべてのメッセージが正しくエコーバックされる。`primary-timeout`は、`host.js`が書き込みを終了した後1秒後に発生している正常なもの。

### `stop-read`の場合
```
message count: { 'primary-write': 464,
  'backup-write': 462,
  'primary-write-flushed': 464,
  'backup-write-flushed': 462,
  'backup-read': 462,
  'primary-read': 185,
  'primary-timeout': 1,
  stop: 1,
  kill: 1 }
primary: 279 messages not echoed
backup: 0 messages not echoed
```

明示的なエラーは発生しない。書き込み完了のコールバック`primary-write-flushed`も発生している。平均50バイトを約300回分=15000bytes書き込んでいるが、バッファがあふれてブロックしたりエラーが返ったりはしていない。エンジンがreadしていない状態で10000回程度writeすると、1000回程度までしか`primary-write-flushed`が発生しない。それ以上のデータがどうなっているかは不明。何らかのバッファがあふれてエラーとなる可能性は残るが、USI通信の分量の範囲ではエラーにならないことがわかる。

### `stop-write`の場合
```
message count: { 'primary-write': 466,
  'backup-write': 465,
  'primary-write-flushed': 466,
  'primary-read': 188,
  'backup-write-flushed': 465,
  'backup-read': 465,
  'primary-timeout': 1,
  stop: 1,
  kill: 1 }
primary: 278 messages not echoed
backup: 0 messages not echoed
```

単にエコーバックが返ってこないだけなので、エラーにならない。

### `exit`の場合
```
message count: { 'primary-write': 466,
  'backup-write': 465,
  'primary-write-flushed': 189,
  'primary-read': 188,
  'backup-write-flushed': 465,
  'backup-read': 465,
  'primary-exit': 1,
  'primary-write-error-event': 277,
  'primary-write-error': 277,
  'primary-timeout': 1,
  stop: 1,
  kill: 1 }
primary: 278 messages not echoed
backup: 0 messages not echoed
```

プライマリエンジンの終了が検知される。またそれ以降の`write`がエラーとなっていることがわかる。`write`のコールバックにエラーがセットされるのと、`primary_engine.stdin.on("error")`イベントの両方が発生。タイムアウトでも、終了検知や`write`のエラーでもプライマリエンジンの問題を検知可能である。

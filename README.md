# shogi-usi-failover
USIプロトコルのコンピュータ将棋エンジンのフェイルオーバーツール

# 基本思想

* 普段はホストとプライマリエンジンの通信を素通しするだけ。
* goコマンドの思考中、一定時間プライマリエンジンから出力がなければバックアップエンジンに切り替えて思考させる。

# 制約

* プライマリエンジンが変な死に方をして定期的にメッセージは送ってくるものの指し手を出さずに時間切れという事態は防げない。
* 残り時間がわずかの場合は、バックアップエンジンの思考が間に合わず時間切れになる可能性がある。
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

# 挙動

* 初期化
  * ツールが起動されたら、プライマリエンジン・バックアップエンジンを起動する。
  * バックアップエンジンには設定ファイルで指定されたオプションを送り、`usinewgame`まで送っておく。

H: ホストプロセス（将棋所などの親プロセス）、T: このツールのプロセス、P: プライマリエンジンプロセス、B: バックアップエンジンプロセス


プライマリエンジンのエラー検知：
* 常時発生し、検知される
  * プロセスの終了やstdioのエラー
* goコマンド～bestmoveコマンドの間
  * 一定時間プライマリエンジンからのメッセージがないことによるタイムアウト

バックアップエンジンに指し継ぐために必要なこと：
* ponderのない環境においては：
  * goコマンド～bestmoveコマンドの間でプライマリエンジンがエラーになるか、goコマンド時点でエラーの場合に、バックアップエンジンに直前のposition, goコマンドを送り思考開始させる
  * その後はバックアップエンジンとホストを中継すればよい
* ponderのある環境における追加問題：
  * ponder中にエラーが発生することが起こる。ただし、ponder局面自体はバックアップエンジンに思考させなくてよい。
  * ponderhitが来た場合は、直前のgo ponderコマンドのponderを抜いたgoコマンドを受け取ったのと同等。思考続行となるが、エラーの場合はponderhitをバックアップエンジンに送るのではなくて、ponderを抜いたgoコマンドを送る必要がある。
  * stopが来た場合は、ponder中の（実現しなかった）局面に対するダミーのbestmoveを返す必要がある。その後改めてposition, goコマンドの列が開始する。ダミーのbestmoveがプライマリエンジンから返されなかった場合はなんらかのbestmoveを返す必要がある（本当に思考する必要はなく、bestmove resignで良い）。
* ponderのある環境においては：
  * ponderコマンドが来て、ponderhit/stopが来ていない状態でエラー
    * バックアップエンジンにはまだ何も送らない。
    * ponderhitが来たとき、ponderhit自体は送らないで直前のpositionコマンドおよびgo ponderコマンドのponderを抜いたgoコマンドを送り思考開始し以後中継
    * stopが来た時、stop自体は送らないで`bestmove resign`をホストに送信し以後中継
  * ponderhitコマンド～bestmoveコマンドの間でエラー
    * バックアップエンジンに直前のpositionコマンドおよびgo ponderコマンドのponderを抜いたgoコマンドを送り思考開始させる
    * その後はバックアップエンジンとホストを中継すればよい
  * stopコマンド～2回目のbestmoveコマンドの間でエラー
    * 1回目のダミーbestmoveが送信されてない場合は、`bestmove resign`をホストに送信
    * position, goコマンドがそれぞれ受信済みであれば、バックアップエンジンに送信
    * その後はバックアップエンジンとホストを中継すればよい

エンジンの状態として、基本的にgoコマンド待機、自分の手番で思考中、相手の手番で思考中という3つがあり、ホストまたはエンジンのコマンドによりこれらが遷移していく。各状態においてエンジンのエラーが発生したら、バックアップエンジンを同等の状態へ持っていくことが目的となる。

* 状態
  * p-wait-position
    * 中継: P<->H
    * positionを待機している状態
    * positionでこれを記憶し、p-wait-goへ移行
    * エラー
      * b-relayへ移行
  * p-wait-go
    * 中継: P<->H
    * goまたはgo ponderを待機している状態
    * goでこれを記憶しp-goへ移行
    * go ponderでp-ponderへ移行
    * エラー
      * T->B 直前のposition
      * b-relayへ移行
  * p-go
    * 中継: P<->H
    * 開始時に、タイムアウトタイマーを開始
    * プライマリエンジンから何らかのコマンドを受信するたび、タイムアウトタイマーを延長
    * 他の状態へ移行する際にタイムアウトタイマーを取り消し
    * goによる自分の手番で思考中
    * bestmoveでp-wait-positionへ移行
    * エラー
      * T->B 直前のposition,go
      * b-relayへ移行
  * p-ponder
    * 中継: P<->H
    * go ponderによる相手の手番で試行中
    * ponderhitでp-goへ移行
    * stopでp-wait-positionへ移行
      * `$dummy_bestmove = true`(ダミーbestmoveが必要フラグ)を立てる。何らかのbestmoveがホストに送信されたらフラグを落とす。
    * エラー
      * b-ponderへ移行
  * b-relay
    * 中継: B<->H
    * 単にホストとバックアップエンジンを中継すればよい状態
  * b-ponder
    * 中継しない
    * ponderhit
      * T->B 直前のposition,go
      * b-relayへ移行
    * stop
      * T->H ダミーの`bestmove resign`
      * b-relayへ移行

中継は、状態遷移の原因となったコマンドを含めそのまま反対側にコマンドを送ることを意味する。
エラー時は、まず常に`$dummy_bestmove == true`ならT->H ダミーの`bestmove resign`送信。
例外的に、quitは常に両方のエンジンにquitを送信し、一定時間後に両方のエンジンをkillしたうえでツールもexitする。

# YOASOBI Intro RTA (GitHub Pages)

このREAME.mdでは、YOASOBI Intro Quiz（本サイト）の技術的な内容をまとめています。また、本サイトに用いられているソースコードは`Main Branch`から確認できます。随時更新していく予定。

## Technical Things

### 利用した外部リソース

- GitHub Pages
    - ホスティング

- Supabase
    - 回答時間の集計関数、ランキングの保存

- Youtube iframe API
    - MVの取得

### 回答時間の集計

- Youtube iframe API の onStateChange()を取得している。Unstartedが帰る場合広告だと判断できるため、広告時間分のカウントアップを避けることができる。
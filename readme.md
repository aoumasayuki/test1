# イメージのビルド
$ Docker-Compose build

# コンテナの作成
$ Docker-Compose up -d

# 起動したコンテナにログイン
$ docker exec -it test1-mysql-1 bash -p

# MySQLを起動
$ mysql -u root -p -h 127.0.0.1

# この後パスワードを入力して完了

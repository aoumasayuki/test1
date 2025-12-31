```
npm install
npm run dev
```

```
open http://localhost:3000
```
csvファイルを保存
post_http.http ->send request

```
my_databaseに接続
```
npx prisma studio
```
npmでAdapterをインストール（サーバー側）
（Node.js 環境でフロントのHTMLを生成しているので、サーバー側から提供する場合）
npm install chartjs-adapter-date-fns
```
git add -A
git commit -m "backup"
git branch
git push origin main

```api
app.post(api/phaseSummary)
(3.11.5) (base) k22002@k22002noMacBook-Air api-test2 % curl -X POST http://localhost:3000/api/phaseSummary \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":1,"gameDate":"1日目","gamePhase":"朝"}'

url
http://localhost:3000/api/export-session?sessionId=
192.168.101.94
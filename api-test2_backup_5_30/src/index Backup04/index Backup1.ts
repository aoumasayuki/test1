/*import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebSocketServer, WebSocket } from "ws"; // WebSocket 型を明示
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config(); // ✅ .env を読み込む

const app = new Hono();
const prisma = new PrismaClient();
const wss = new WebSocketServer({ noServer: true });

let clients: WebSocket[] = [];
let pendingUpdates: any[] = []; // ✅ 送信待ちのデータ

// ✅ カラム名を定数で定義（後から変更可能）
const HEART_RATE = "Heart_Rate";
const TIMESTAMP = "Timestamp";
const GAME_DATE = "Game_date";
const GAME_DETAIL = "Game_detail";
let currentGameDate = 1;   // 初期: 1日目
let currentGameDetail = 1; // 初期: 朝 (1)

// WebSocket 接続のセットアップ
wss.on("connection", (ws) => {
  clients.push(ws);
  ws.on("close", () => {
    clients = clients.filter((client) => client !== ws);
  });
});
wss.on("connection", (ws) => {
  clients.push(ws);
  console.log("🚀 WebSocket client connected.");

  ws.on("close", () => {
    clients = clients.filter((client) => client !== ws);
    console.log("❌ WebSocket client disconnected.");
  });
});

// ✅ WebSocket でデータを全クライアントに送信
function broadcastWebSocketUpdate(data: any) {
  console.log("🚩 Broadcasting data:", JSON.stringify(data, null, 2)); // ログ出力
  const message = JSON.stringify({ type: "update", data });

  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}
app.post("/set-state", async (c) => {
  try {
    const { stateName } = await c.req.json();

    if (!stateName) {
      return c.text("State name is required.", 400);
    }

    const newState = await prisma.stateTimestamps.create({
      data: {
        stateName,
        startTime: new Date(),
      },
    });

    console.log(`New state recorded: ${stateName} at ${newState.startTime}`);
    return c.text(`State "${stateName}" has been saved.`);
  } catch (error) {
    console.error("Failed to set state:", error);
    return c.text("Failed to set state.", 500);
  }
});


// ✅ ゲーム状態を更新する `/update-detail`
app.post("/update-detail", async (c) => {
  // 朝(1) → 投票(2) → 夜(3) → 翌日の朝(1) と進む
  if (currentGameDetail === 3) {
    currentGameDate += 1;
    currentGameDetail = 1; // 次の日の朝へ
  } else {
    currentGameDetail += 1; // フェーズを進める
  }
  return c.text(`Game updated: ${currentGameDate}日目 - ${getGameDetailName(currentGameDetail)}`);
});

// ✅ ゲーム状態をリセットする `/reset-detail`
app.post("/reset-detail", async (c) => {
  currentGameDate = 1;
  currentGameDetail = 1;
  return c.text("Game reset to 1日目の朝");
});

// ✅ CSV データをデータベースに保存する `/upload`
// ✅ /upload に WebSocket 更新処理を追加
app.post("/upload", async (c) => {
  try {
    let csvData: string;

    if (c.req.header("content-type")?.includes("text/csv")) {
      csvData = await c.req.text();
    } else {
      return c.text("Unsupported content type", 400);
    }

    console.log("Received CSV:\n" + csvData);

    const records = csvData.split("\n").map(row => row.split(",")).filter(parts => parts.length === 3);

    for (const [id, heartRate, timestamp] of records) {
      const parsedId = parseInt(id, 10);
      const parsedHeartRate = parseFloat(heartRate);
      const parsedTimestamp = new Date(timestamp);

      if (parsedHeartRate < 0) {
        console.warn(`Skipping invalid heart rate: ${parsedHeartRate}`);
        continue;
      }

      await prisma.csvData.upsert({
        where: { id_Timestamp: { id: parsedId, Timestamp: parsedTimestamp } },
        update: { Heart_Rate: parsedHeartRate },
        create: { id: parsedId, Heart_Rate: parsedHeartRate, Timestamp: parsedTimestamp },
      });

      console.log(`Saved to DB: ${parsedId}, ${parsedHeartRate}, ${parsedTimestamp.toISOString()}`);
    }

    return c.text("CSV data has been saved to the database.", 200);
  } catch (error) {
    console.error("Failed to save to database:", error);
    return c.text("Failed to save to database.", 500);
  }
});

// ✅ ゲームのフェーズ名を取得する関数
function getGameDetailName(detail: number): string {
  switch (detail) {
    case 1: return "朝";
    case 2: return "投票時間";
    case 3: return "夜";
    default: return "不明";
  }
}

// ✅ テーブルをリセットする
app.get('/reset-table', async (c) => {
  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE CsvData`);
    return c.text('Table has been reset, and ID counter is back to 1.');
  } catch (error) {
    console.error(error);
    return c.text('Failed to reset table.', 500);
  }
});

// ✅ WebSocket 用のグラフデータを取得する
app.get("/graph/:id", async (c) => {
  const idParam = c.req.param("id");
  if (!idParam) {
    return c.text("Invalid ID parameter", 400);
  }

  const id = parseInt(idParam, 10);
  if (isNaN(id)) {
    return c.text("Invalid ID format", 400);
  }

  try {
    // 状態ごとの開始時刻を取得
    const states = await prisma.stateTimestamps.findMany({
      orderBy: { startTime: "asc" },
    });

    // 心拍数データを取得
    const heartRates = await prisma.csvData.findMany({
      where: { id },
      orderBy: { Timestamp: "asc" },
    });

    // 各心拍数データに対応する状態を割り当てる
    const heartRateData = heartRates.map((hr) => {
      const matchingState = states.find((s) => new Date(s.startTime) <= new Date(hr.Timestamp));
      return {
        x: hr.Timestamp.toISOString(),
        y: hr.Heart_Rate,
        state: matchingState ? matchingState.stateName : "Unknown",
      };
    });

    return c.html(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Heart Rate Graph</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      </head>
      <body>
        <h2>Heart Rate Graph</h2>
        <canvas id="myChart" width="800" height="600"></canvas>
        <script>
          const ctx = document.getElementById('myChart').getContext('2d');

          const allData = ${JSON.stringify(heartRateData)};
          let labels = allData.map(d => d.x);
          let values = allData.map(d => d.y);
          let states = allData.map(d => d.state);

          let chart = new Chart(ctx, {
            type: 'line',
            data: {
              labels: labels,
              datasets: [{
                label: 'Heart Rate (BPM)',
                data: values,
                borderColor: 'rgba(255,99,132,1)',
                fill: false,
              }]
            },
            options: {
              responsive: true,
              scales: {
                x: { title: { display: true, text: 'Time' } },
                y: { title: { display: true, text: 'Heart Rate (BPM)' }, min: 0, max: Math.max(...values, 100) }
              },
              plugins: {
                tooltip: {
                  callbacks: {
                    label: function(context) {
                      return states[context.dataIndex] + ': ' + context.raw + ' BPM';
                    }
                  }
                }
              }
            }
          });
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    return c.text("Failed to generate graph page.", 500);
  }
});


// ✅ サーバー起動
const server = serve({ fetch: app.fetch, port: 3000 });

server.on("upgrade", (request, socket, head) => {
  if (request.url === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

console.log("Server is running on http://192.168.1.139:3000");*/

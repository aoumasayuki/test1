/*import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebSocketServer, WebSocket } from "ws";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url"; // ★ 追加

dotenv.config();
const __filename = fileURLToPath(import.meta.url); // ★ 追加
const __dirname = path.dirname(__filename);  
const app = new Hono();
const prisma = new PrismaClient();
const wss = new WebSocketServer({ noServer: true });

let clients: WebSocket[] = [];

const HEART_RATE = "Heart_Rate";
const TIMESTAMP = "Timestamp";
const GAME_DATE = "Game_date";
const GAME_DETAIL = "Game_detail";

const gameSet = JSON.parse(fs.readFileSync(path.join(__dirname, "./GAME_SET.json"), "utf-8"));
const dayLabel = gameSet.DAY_LABEL; // e.g., "日目"
const gamePhases = gameSet.GAME_DETAIL; // ["朝", "投票", "夜"]

let currentDayNumber = 1; // 自動カウントアップ用
let currentGameDetailIndex = 0;

wss.on("connection", (ws) => {
  clients.push(ws);
  ws.on("close", () => {
    clients = clients.filter((client) => client !== ws);
  });
});

app.get("/set-detail", async (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>ゲーム状態設定</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
        button { padding: 10px; font-size: 18px; margin: 10px; }
      </style>
    </head>
    <body>
      <h1>ゲーム状態の設定</h1>
      <h2>現在: ${currentDayNumber}${dayLabel} - ${gamePhases[currentGameDetailIndex]}</h2>
      <button onclick="updateGameState()">次のフェーズへ</button>
      <button onclick="resetGame()">リセット (1${dayLabel}の${gamePhases[0]})</button>
      <script>
        function updateGameState() {
          fetch('/update-detail', { method: 'POST' }).then(() => location.reload());
        }
        function resetGame() {
          fetch('/reset-detail', { method: 'POST' }).then(() => location.reload());
        }
      </script>
    </body>
    </html>
  `);
});

app.post("/update-detail", async (c) => {
  currentGameDetailIndex++;
  if (currentGameDetailIndex >= gamePhases.length) {
    currentGameDetailIndex = 0;
    currentDayNumber++;
  }
  return c.text("Game state updated.");
});

app.post("/reset-detail", async (c) => {
  currentDayNumber = 1;
  currentGameDetailIndex = 0;
  return c.text("Game reset to 初期状態");
});

app.post("/upload", async (c) => {
  try {
    let csvData: string;

    if (c.req.header("content-type")?.includes("text/csv")) {
      csvData = await c.req.text();
    } else {
      return c.text("Unsupported content type", 400);
    }

    const records = csvData.split("\n").map(row => row.split(",")).filter(parts => parts.length >= 3);
    const updatesToSend: any[] = [];

    for (const [id, heartRate, timestamp] of records) {
      const parsedId = parseInt(id, 10);
      const parsedHeartRate = parseFloat(heartRate);
      const parsedTimestamp = new Date(timestamp);

      if (parsedHeartRate < 0) continue;

      await prisma.csvData.upsert({
        where: { id_Timestamp: { id: parsedId, Timestamp: parsedTimestamp } },
        update: {
          Heart_Rate: parsedHeartRate,
          Game_date: `${currentDayNumber}${dayLabel}`,
          Game_detail: gamePhases[currentGameDetailIndex]
        },
        create: {
          id: parsedId,
          Heart_Rate: parsedHeartRate,
          Timestamp: parsedTimestamp,
          Game_date: `${currentDayNumber}${dayLabel}`,
          Game_detail: gamePhases[currentGameDetailIndex]
        }
      });

      updatesToSend.push({
        id: parsedId,
        Heart_Rate: parsedHeartRate,
        Timestamp: parsedTimestamp.toISOString(),
        Game_date: `${currentDayNumber}${dayLabel}`,
        Game_detail: gamePhases[currentGameDetailIndex]
      });
    }

    const message = JSON.stringify({ type: "update", data: updatesToSend });
    clients.forEach((ws) => ws.send(message));

    return c.text("CSV data has been saved to the database.");
  } catch (error) {
    console.error("Failed to save to database:", error);
    return c.text("Failed to save to database.", 500);
  }
});
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
// 残りのコード（/graph など）は変更不要

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
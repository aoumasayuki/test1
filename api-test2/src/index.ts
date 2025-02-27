import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebSocketServer, WebSocket } from "ws"; // WebSocket 型を明示
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config(); // ✅ .env を読み込む

const app = new Hono();
const prisma = new PrismaClient();
const wss = new WebSocketServer({ noServer: true });

let clients: WebSocket[] = [];

// ✅ カラム名を定数で定義（後から変更可能）
const HEART_RATE = "Heart_Rate";
const TIMESTAMP = "Timestamp";

// WebSocket 接続のセットアップ
wss.on("connection", (ws) => {
  clients.push(ws);
  ws.on("close", () => {
    clients = clients.filter((client) => client !== ws);
  });
});

app.post("/upload", async (c) => {
  try {
    let csvData: string;

    // ✅ `text/csv` を許可
    if (c.req.header("content-type")?.includes("text/csv")) {
      csvData = await c.req.text();
    } else {
      return c.text("Unsupported content type", 400);
    }

    console.log("Received CSV:\n" + csvData);

    // ✅ 複数行のデータを処理
    const records = csvData.split("\n").map(row => row.split(",")).filter(parts => parts.length === 3);

    for (const [id, heartRate, timestamp] of records) {
      const parsedId = parseInt(id, 10);
      const parsedHeartRate = parseFloat(heartRate);
      const parsedTimestamp = new Date(timestamp);

      // ✅ -1 の無効な心拍数をスキップ
      if (parsedHeartRate < 0) {
        console.warn(`Skipping invalid heart rate: ${parsedHeartRate}`);
        continue;
      }

      // ✅ データベースに upsert
      await prisma.csvData.upsert({
        where: { id_Timestamp: { id: parsedId, Timestamp: parsedTimestamp } },  // 複合キーで検索
        update: { Heart_Rate: parsedHeartRate }, // 既存データなら更新
        create: { id: parsedId, Heart_Rate: parsedHeartRate, Timestamp: parsedTimestamp }, // 新規データなら作成
      });

      console.log(`Saved to DB: ${parsedId}, ${parsedHeartRate}, ${parsedTimestamp.toISOString()}`);
    }

    return c.text("CSV data has been saved to the database.", 200);
  } catch (error) {
    console.error("Failed to save to database:", error);
    return c.text("Failed to save to database.", 500);
  }
});

app.get('/reset-table', async (c) => {
  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE CsvData`);
    return c.text('Table has been reset, and ID counter is back to 1.');
  } catch (error) {
    console.error(error);
    return c.text('Failed to reset table.', 500);
  }
});
// クライアントサイド用 HTML を提供
app.get("/graph/:id", async (c) => {
  const idParam = c.req.param("id");
  if (!idParam) {
    return c.text("Invalid ID", 400);
  }
  const id = parseInt(idParam, 10);
  if (isNaN(id)) {
    return c.text("Invalid ID format", 400);
  }
    if (isNaN(id)) {
    return c.text("Invalid ID", 400);
  }
  try {
    const data = await prisma.csvData.findMany({ where: { id }, orderBy: { [TIMESTAMP]: "asc" } });
    const formattedData = data.map((d) => ({ x: d[TIMESTAMP].toISOString(), y: d[HEART_RATE] }));

    return c.html(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Graph for ID ${id}</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      </head>
      <body>
        <canvas id="myChart" width="800" height="600"></canvas>
        <script>
          const ctx = document.getElementById('myChart').getContext('2d');
          const ws = new WebSocket('ws://' + location.host + '/ws');
          const id = ${id};
          
          const initialData = ${JSON.stringify(formattedData)};
          const chart = new Chart(ctx, {
            type: 'line',
            data: {
              labels: initialData.map(d => d.x),
              datasets: [{
                label: 'Heart Rate over Time',
                data: initialData.map(d => d.y),
                borderColor: 'rgba(255,99,132,1)',
                fill: false,
              }]
            },
            options: {
              responsive: true,
              scales: {
                x: { title: { display: true, text: 'Time' } },
                y: { title: { display: true, text: 'Heart Rate (BPM)' } }
              }
            }
          });

          ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'update') {
              const data = message.data.filter(d => d.id === id);
              chart.data.labels = data.map(d => d.x);
              chart.data.datasets[0].data = data.map(d => d.y);
              chart.update();
            }
          };
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    return c.text("Failed to generate graph page.", 500);
  }
});


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

console.log("Server is running on http://192.168.1.139:3000");

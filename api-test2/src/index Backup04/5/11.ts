/*GAME_SET.json
{
  "date": {
    "label": "日目",
    "time": {
      "timeLabel1": { "label": "朝", "data": {} },
      "timeLabel2": { "label": "昼", "data": {} },
      "timeLabel3": { "label": "夜", "data": [] }
    }
  }
}
*/
/*
変更点:csvの重複の回避
*/
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebSocketServer, WebSocket } from "ws";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const app = new Hono();
const prisma = new PrismaClient();
const wss = new WebSocketServer({ noServer: true });
let currentStartTime = new Date();
let clients: WebSocket[] = [];

const HEART_RATE = "Heart_Rate";
const TIMESTAMP = "Timestamp";

const gameSet = JSON.parse(fs.readFileSync("/Users/k22002/AndroidStudioProjects/test1/api-test2/src/GAME_SET.json", "utf-8"));
const dateLabel = gameSet.date.label;
const phaseEntries = Object.entries(gameSet.date.time);
const phaseOrder: string[] = phaseEntries.map(([, value]) => (value as { label: string }).label);

let currentDay = 1;
let currentPhaseIndex = 0;
let canGoBack = true; // 戻る制限フラグ（戻った直後は false）
function mergeOrUpdatePhaseLog(date: string, phase: string, newStart: Date, newEnd: Date) {
  const logPath = "./src/phase_log.csv";
  const lines = fs.readFileSync(logPath, "utf-8").split("\n").filter(line => line.trim() !== "");

  let updated = false;
  const mergedLines = lines.map(line => {
    const [d, p, start, end] = line.split(",");
    if (d === date && p === phase) {
      // 既存のレコードを統合：最初の start と最後の end
      const earliestStart = new Date(start) < newStart ? start : newStart.toISOString();
      const latestEnd = new Date(end || 0) > newEnd ? end : newEnd.toISOString();
      updated = true;
      return `${d},${p},${earliestStart},${latestEnd}`;
    }
    return line;
  });

  if (!updated) {
    mergedLines.push(`${date},${phase},${newStart.toISOString()},${newEnd.toISOString()}`);
  }

  fs.writeFileSync(logPath, mergedLines.join("\n"), "utf-8");
}

function overwritePhaseLogEndTime(date: string, phase: string, endTime: Date) {
  const logPath = "./src/phase_log.csv";
  const lines = fs.readFileSync(logPath, "utf-8").split("\n");

  const updated = lines.map(line => {
    const [d, p, start, end] = line.split(",");
    if (d === date && p === phase) {
      return `${d},${p},${start},${endTime.toISOString()}`; // 終了時刻を上書き
    }
    return line;
  });

  fs.writeFileSync(logPath, updated.join("\n"), "utf-8");
}

wss.on("connection", (ws) => {
  clients.push(ws);
  ws.on("close", () => {
    clients = clients.filter((client) => client !== ws);
  });
});

function logPhaseToCSV(gameDate: string, gamePhase: string, start: Date, end: Date | null) {
  if (end && (end.getTime() - start.getTime()) < 5000) {
    return;
  }
  const filePath = "./src/phase_log.csv";
  const entry = `${gameDate},${gamePhase},${start.toISOString()},${end ? end.toISOString() : ""}\n`;
  fs.appendFileSync(filePath, entry, "utf-8");
}
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
      <h2>現在: ${currentDay}${dateLabel} - ${phaseOrder[currentPhaseIndex]}</h2>
      <button onclick="updateGameState()">次のフェーズへ</button>
      <button onclick="previousGameState()">前のフェーズへ</button>
      <button onclick="resetGame()">リセット (${currentDay}${dateLabel}の${phaseOrder[0]})</button>
      <script>
        function updateGameState() {
          fetch('/update-detail', { method: 'POST' }).then(() => location.reload());
        }
        function previousGameState() {
          fetch('/previous-detail', { method: 'POST' }).then(() => location.reload());
        }
        function resetGame() {
          fetch('/reset-detail', { method: 'POST' }).then(() => location.reload());
        }
      </script>
    </body>
    </html>
  `);
});


app.post("/previous-detail", async (c) => {
  if (!canGoBack) {
    return c.text("直前に戻ったばかりです。次のフェーズに進んでから戻ってください。", 400);
  }

  // 現在のフェーズの終了時刻を現在時刻に上書き
  const now = new Date();
  const currentGameDate = `${currentDay}${dateLabel}`;
  const currentPhase = phaseOrder[currentPhaseIndex];
  overwritePhaseLogEndTime(currentGameDate, currentPhase, now);

  // フェーズを1つ戻す
  currentPhaseIndex--;
  if (currentPhaseIndex < 0) {
    currentDay = Math.max(1, currentDay - 1);
    currentPhaseIndex = phaseOrder.length - 1;
  }

  canGoBack = false; // これ以上戻れないようにする
  return c.text("前のフェーズに戻りました。");
});


app.post("/update-detail", async (c) => {
  const gameDate = `${currentDay}${dateLabel}`;
  const gamePhase = phaseOrder[currentPhaseIndex];
  const endTime = new Date();
  mergeOrUpdatePhaseLog(gameDate, gamePhase, currentStartTime, endTime);

  currentStartTime = endTime;
  currentPhaseIndex++;
  if (currentPhaseIndex >= phaseOrder.length) {
    currentPhaseIndex = 0;
    currentDay++;
  }

  canGoBack = true; // 新しいフェーズに進んだら戻れるようになる
  return c.text("フェーズを進めました。");
});

app.post("/reset-detail", async (c) => {
  currentDay = 1;
  currentPhaseIndex = 0;
  return c.text(`Game reset to 1${dateLabel}の${phaseOrder[0]}`);
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
          Heart_Rate: parsedHeartRate
        },
        create: {
          id: parsedId,
          Heart_Rate: parsedHeartRate,
          Timestamp: parsedTimestamp
        }
      });

      updatesToSend.push({
        id: parsedId,
        Heart_Rate: parsedHeartRate,
        Timestamp: parsedTimestamp.toISOString()
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

app.get("/graph", async (c) => {
  const logLines = fs.readFileSync("./src/phase_log.csv", "utf-8")
    .split("\n")
    .filter(line => line.trim() !== "")
    .map(line => {
      const [date, phase, start, end = ""] = line.split(",");
      return {
        key: `${date}-${phase}`,
        label: `${date} ${phase}`,
        date,
        phase,
        start,
        end
      };
    });

  const extendedLogLines = [...logLines];

  if (logLines.length > 0) {
    const last = logLines[logLines.length - 1];
    const currentPhaseIndex = phaseOrder.indexOf(last.phase);
    if (currentPhaseIndex !== -1 && last.end) {
      const nextPhaseIndex = (currentPhaseIndex + 1) % phaseOrder.length;
      const nextDay = nextPhaseIndex === 0 ? parseInt(last.date) + 1 : parseInt(last.date);
      const nextPhase = phaseOrder[nextPhaseIndex];
      extendedLogLines.push({
        key: `${nextDay}${dateLabel}-${nextPhase}`,
        label: `${nextDay}${dateLabel} ${nextPhase}（予測）`,
        date: `${nextDay}${dateLabel}`,
        phase: nextPhase,
        start: last.end,
        end: ""
      });
    }
  }

  const ids = await prisma.csvData.findMany({
    distinct: ['id'],
    select: { id: true }
  });

  const options = extendedLogLines.map(log => `<option value="${log.key}">${log.label}</option>`).join("\n");
  const idOptions = ids.map(obj => `<option value="${obj.id}">${obj.id}</option>`).join("\n");

  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>Heart Rate Graph Selector</title>
    </head>
    <body>
      <h2>フェーズとIDを選択してください</h2>
      <form method="GET" action="/graph/view">
        <label>フェーズ:</label>
        <select name="phase">${options}</select>
        <label>ID:</label>
        <select name="id">${idOptions}</select>
        <button type="submit">表示</button>
      </form>

      <h2>日付で表示</h2>
      <form method="GET" onsubmit="event.preventDefault(); redirectToDateGraph();">
        <label>日付:</label>
        <select id="dateSelect">
          ${[...new Set(logLines.map(log => log.date))].map(d => `<option value="${d}">${d}</option>`).join("\n")}
        </select>
        <label>ID:</label>
        <select id="idSelect">
          ${idOptions}
        </select>
        <button type="submit">表示</button>
      </form>

      <script>
        function redirectToDateGraph() {
          const date = document.getElementById("dateSelect").value;
          const id = document.getElementById("idSelect").value;
          if (date && id) {
            window.location.href = \`/graph/date/\${encodeURIComponent(date)}?id=\${encodeURIComponent(id)}\`;
          }
        }
      </script>
    </body>
    </html>
  `);
});

app.get("/graph/view", async (c) => {
  const idParam = c.req.query("id");
  const phaseKey = c.req.query("phase");

  if (!idParam || !phaseKey) return c.text("Missing parameters", 400);

  const id = parseInt(idParam, 10);
  if (isNaN(id)) return c.text("Invalid ID format", 400);

  const logLines = fs.readFileSync("./src/phase_log.csv", "utf-8")
    .split("\n")
    .filter(line => line.trim() !== "")
    .map(line => {
      const [date, phase, start, end] = line.split(",");
      return {
        key: `${date}-${phase}`,
        date,
        phase,
        start: new Date(start),
        end: end && end.trim() !== "" ? new Date(end) : undefined,
      };
    });

  const selected = logLines.find(l => l.key === phaseKey);
  let heartRateData = [];

  if (selected) {
    const heartRates = await prisma.csvData.findMany({
      where: {
        id,
        Timestamp: {
          gte: selected.start,
          ...(selected.end ? { lte: selected.end } : {}),
        },
      },
      orderBy: { Timestamp: "asc" },
    });

    heartRateData = heartRates.map((hr) => ({
      x: hr.Timestamp.toISOString(),
      y: hr.Heart_Rate,
    }));
  } else {
    // 予測フェーズ（前の終了時刻以降）
    const lastLog = logLines.at(-1); // 最後の行
    if (!lastLog || !lastLog.end) {
      return c.text("前回の終了時刻が未記録です。", 400);
    }
    
    const heartRates = await prisma.csvData.findMany({
      where: {
        id,
        Timestamp: {
          gte: new Date(lastLog.end), // 最後のフェーズの終了時刻から
        },
      },
      orderBy: { Timestamp: "asc" },
    });
    

    heartRateData = heartRates.map((hr) => ({
      x: hr.Timestamp.toISOString(),
      y: hr.Heart_Rate,
    }));
  }

  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Heart Rate Graph</title>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    </head>
    <body>
      <h2>${phaseKey} の心拍グラフ (ID: ${id})</h2>
      <canvas id="myChart" width="800" height="600"></canvas>
      <script>
        const ctx = document.getElementById('myChart').getContext('2d');
        const allData = ${JSON.stringify(heartRateData)};
        let labels = allData.map(d => d.x);
        let values = allData.map(d => d.y);

        new Chart(ctx, {
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
            }
          }
        });
      </script>
    </body>
    </html>
  `);
});

app.get("/graph/date/:day", async (c) => {
  const dayLabel = c.req.param("day"); // 例: "1日目"
  const idParam = c.req.query("id");

  if (!dayLabel) return c.text("Invalid day label", 400);
  if (!idParam) return c.text("IDが指定されていません", 400);

  const id = parseInt(idParam, 10);
  if (isNaN(id)) return c.text("IDの形式が不正です", 400);

  // phase_log.csv の読み込み
  const logLines = fs.readFileSync("./src/phase_log.csv", "utf-8")
    .split("\n")
    .filter(line => line.trim() !== "")
    .map(line => {
      const [date, phase, start, end = ""] = line.split(",");
      return {
        date,
        phase,
        start: new Date(start),
        end: end.trim() ? new Date(end) : undefined,
      };
    });

  const selectedPhases = logLines.filter(line => line.date === dayLabel && line.end);

  if (selectedPhases.length === 0) {
    return c.text(`指定された日 "${dayLabel}" のフェーズデータが見つかりません。`, 404);
  }

  // すべてのフェーズの心拍数を一括取得（指定 ID）
  const allHeartRates = (
    await Promise.all(selectedPhases.map(({ start, end }) =>
      prisma.csvData.findMany({
        where: {
          id,
          Timestamp: {
            gte: start,
            lte: end,
          },
        },
        orderBy: { Timestamp: "asc" },
      })
    ))
  ).flat();

  const chartData = allHeartRates.map(hr => ({
    x: hr.Timestamp.toISOString(),
    y: hr.Heart_Rate,
  }));

  // Chart.js 用 HTML
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>${dayLabel} - ID: ${id} の心拍数</title>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    </head>
    <body>
      <h2>${dayLabel} の心拍数（ID: ${id}）</h2>
      <canvas id="myChart" width="800" height="600"></canvas>
      <script>
        const ctx = document.getElementById('myChart').getContext('2d');
        const data = ${JSON.stringify(chartData)};
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: data.map(d => d.x),
            datasets: [{
              label: 'Heart Rate (BPM)',
              data: data.map(d => d.y),
              borderColor: 'rgba(75, 192, 192, 1)',
              fill: false
            }]
          },
          options: {
            responsive: true,
            scales: {
              x: { title: { display: true, text: 'Time' } },
              y: { title: { display: true, text: 'Heart Rate (BPM)' }, min: 0 }
            }
          }
        });
      </script>
    </body>
    </html>
  `);
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

console.log("Server is running on http://localhost:3000");
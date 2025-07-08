/*GAME_SET.json
[
    {
      "game":"人狼",
      "setings":{
        "scene": "日目",
        "time": {
          "label1":"朝",
          "label2":"昼",
          "label3":"夜"
        }
      }
    },
    {
      "game":"麻雀",
      "setings":{
        "scene": "局",
        "time": {
          "label1":"東",
          "label2":"南",
          "label3":"西",
          "label4":"北"
        }
      }
    }
  ]
*/
/*
変更点:graphを対応するように変更

*/
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebSocketServer, WebSocket } from "ws";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "fs";
import { networkInterfaces } from "os";

dotenv.config();

const app = new Hono();
const prisma = new PrismaClient();
const wss = new WebSocketServer({ noServer: true });
let currentStartTime = new Date();
let clients: WebSocket[] = [];

const HEART_RATE = "Heart_Rate";
const TIMESTAMP = "Timestamp";



let currentGame = "人狼";
let currentDay = 1;
let currentPhaseIndex = 0;
let canGoBack = true;
const gameConfigs = JSON.parse(fs.readFileSync("/Users/k22002/AndroidStudioProjects/test1/api-test2/src/game_config.json", "utf-8"));
let currentConfig = gameConfigs.find((g: { game: string; }) => g.game === currentGame);
if (!currentConfig) {
  throw new Error("指定されたゲーム設定が見つかりません");
}
let dateLabel = currentConfig.setings.scene;
const phaseEntries = Object.entries(currentConfig.setings.time);
let phaseOrder = phaseEntries.map(([, value]) => value);  // ✅ value 自体が "朝", "昼", "夜"

async function savePhaseLog(game: string, gameDate: string, gamePhase: string, startTime: Date, endTime: Date | null) {
  if (endTime && endTime.getTime() - startTime.getTime() < 5000) return;
  await prisma.phaseLog.create({
    data: {
      sessionId: currentSessionId,
      game: currentGame,
      gameDate,
      gamePhase,
      startTime,
      endTime: endTime || null,
    },
  });
}

function getCurrentGameConfig() {
  return gameConfigs.find((g: { game: string; }) => g.game === currentGame);
}
function getCurrentConfig() {
  return gameConfigs.find((g: { game: string; }) => g.game === currentGame);
}

function getDateLabel() {
  return getCurrentConfig()?.setings.scene || "日目";
}

function getPhaseOrder() {
  return Object.values(getCurrentConfig()?.setings.time || {});
}

function getCurrentPhaseOrder(): string[] {
  const config = getCurrentGameConfig();
  return Object.values(config.setings.time);
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
let currentSessionId = 0;  // 最初のセッション

app.get("/set-game", async (c) => {
  const options = gameConfigs.map((g: { game: any; }) => `<option value="${g.game}">${g.game}</option>`).join("\n");
  return c.html(`
    <form method="POST" action="/select-game">
      <label>ゲームを選択:</label>
      <select name="game">${options}</select>
      <button type="submit">設定</button>
    </form>
  `);
});
app.post("/select-game", async (c) => {
  const body = await c.req.parseBody();

  const raw = body["game"];
  if (typeof raw !== "string") {
    return c.text("ゲームの形式が正しくありません", 400);
  }
  const selectedGame = raw;
  const found = gameConfigs.find((g: { game: string }) => g.game === selectedGame);
  if (!found) {
    return c.text("無効なゲームが選択されました。", 400);
  }

  currentGame = selectedGame;
  currentDay = 1;
  currentPhaseIndex = 0;
  canGoBack = true;
  currentSessionId++;

  // ✅ 再計算
  currentConfig = found;
  dateLabel = currentConfig.setings.scene;
  phaseOrder.length = 0; // 一旦中身を空にしてから再設定
  Object.entries(currentConfig.setings.time).forEach(([, value]) => phaseOrder.push(value));

  return c.redirect("/set-detail");
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

// フェーズ進行
app.post("/update-detail", async (c) => {
  const dateLabel = getDateLabel();
  const phaseOrder = getPhaseOrder();
  const gameDate = `${currentDay}${dateLabel}`;
  const gamePhase = phaseOrder[currentPhaseIndex];
  const now = new Date();

  if (!canGoBack) {
    currentStartTime = now;
    const lastLog = await prisma.phaseLog.findFirst({
      where: { sessionId: currentSessionId },
      orderBy: { id: "desc" },
    });
    if (lastLog) {
      await prisma.phaseLog.update({
        where: { id: lastLog.id },
        data: { endTime: now },
      });
    }
  } else {
    await prisma.phaseLog.create({
      data: {
        sessionId: currentSessionId,
        game: currentGame,
        gameDate,
        gamePhase: String(gamePhase),
        startTime: currentStartTime,
        endTime: now
      }
    });
    currentStartTime = now;
  }

  canGoBack = true;
  currentPhaseIndex++;
  if (currentPhaseIndex >= phaseOrder.length) {
    currentPhaseIndex = 0;
    currentDay++;
  }
  return c.text("フェーズを進めました。");
});

app.post("/previous-detail", async (c) => {
  if (!canGoBack) return c.text("既に戻っています。次のフェーズに進むまで戻れません。", 400);

  currentPhaseIndex--;
  if (currentPhaseIndex < 0) {
    currentDay = Math.max(1, currentDay - 1);
    currentPhaseIndex = phaseOrder.length - 1;
  }

  const lastLog = await prisma.phaseLog.findFirst({
    where: { sessionId: currentSessionId },
    orderBy: { id: "desc" },
  });
  if (lastLog) {
    await prisma.phaseLog.update({
      where: { id: lastLog.id },
      data: { endTime: null },
    });
  }

  canGoBack = false;
  return c.text("前のフェーズに戻りました。");
});

app.post("/reset-detail", async (c) => {
  currentDay = 1;
  currentPhaseIndex = 0;
  currentSessionId++;
  canGoBack = true;
  const now = new Date();
  currentStartTime = now;

  return c.text(`ゲームをリセットしました。新しいセッション: ${currentSessionId}`);
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
  const extendedLogLines: {
    key: string;
    label: string;
    date: string;
    phase: string;
    start: Date;
    end: Date | null;
  }[] = [];

  const logs = await prisma.phaseLog.findMany({
    orderBy: { startTime: "asc" },
  });

  logs.forEach((log) => {
    extendedLogLines.push({
      key: `${log.gameDate}-${log.gamePhase}`,
      label: `${log.gameDate} ${log.gamePhase}`,
      date: log.gameDate,
      phase: log.gamePhase,
      start: log.startTime,
      end: log.endTime || null,
    });
  });

  const ids = await prisma.csvData.findMany({
    distinct: ["id"],
    select: { id: true },
  });

  const dateList = await prisma.phaseLog.findMany({
    distinct: ["gameDate"],
    select: { gameDate: true },
  });

  const options = extendedLogLines
    .map((log) => `<option value="${log.key}">${log.label}</option>`)
    .join("\n");
  const idOptions = ids
    .map((obj) => `<option value="${obj.id}">${obj.id}</option>`)
    .join("\n");
  const dateOptions = dateList
    .map(({ gameDate }) => `<option value="${gameDate}">${gameDate}</option>`)
    .join("\n");

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
        <select id="dateSelect">${dateOptions}</select>
        <label>ID:</label>
        <select id="idSelect">${idOptions}</select>
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

  // DBからphase_logを読み込み
  const allLogs = await prisma.phaseLog.findMany({
    where: { game: currentGame },  // ← ゲームごとに限定する
    orderBy: { startTime: "asc" },
    });

  const parsedLogs = allLogs.map(log => {
    return {
      key: `${log.gameDate}-${log.gamePhase}`,
      date: log.gameDate,
      phase: log.gamePhase,
      start: new Date(log.startTime),
      end: log.endTime ? new Date(log.endTime) : undefined,
    };
  });

  const selected = parsedLogs.find(l => l.key === phaseKey);
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
    const lastLog = parsedLogs.at(-1);
    if (!lastLog || !lastLog.end) {
      return c.text("前回の終了時刻が未記録です。", 400);
    }

    const heartRates = await prisma.csvData.findMany({
      where: {
        id,
        Timestamp: {
          gte: new Date(lastLog.end),
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
    <html lang="ja">
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
        const data = ${JSON.stringify(heartRateData)};
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: data.map(d => d.x),
            datasets: [{
              label: 'Heart Rate (BPM)',
              data: data.map(d => d.y),
              borderColor: 'rgba(75, 192, 192, 1)',
              fill: false,
              spanGaps: true  // 全て繋げる
            }]
          },
          options: {
            responsive: true,
            scales: {
              x: { title: { display: true, text: 'Time' } },
              y: { title: { display: true, text: 'Heart Rate (BPM)' }, min: 60 }
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

console.log("Server is running on http://localhost:3000/set-game");
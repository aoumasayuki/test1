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
変更点:graphの見た目の変更

*/
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebSocketServer, WebSocket } from "ws";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "fs";
import { networkInterfaces } from "os";

dotenv.config();
const HEART_RATE_THRESHOLD = 85;

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
async function getHeartRates(c: any): Promise<number[]> {
  const idParam = c.req.query("id");
  const phaseKey = c.req.query("phase");
  const sessionIdParam = c.req.query("sessionId");
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");
  const game = c.req.query("game");

  let id: number | undefined = undefined;
  if (idParam) {
    id = parseInt(idParam, 10);
    if (isNaN(id)) throw new Error("Invalid ID");
  }

  let data: { Heart_Rate: number }[] = [];

  if (fromParam && toParam) {
    const from = new Date(fromParam);
    const to = new Date(toParam);
    data = await prisma.csvData.findMany({
      where: { ...(id ? { id } : {}), Timestamp: { gte: from, lte: to } },
      select: { Heart_Rate: true }
    });
  } else if (phaseKey) {
    const sessionId = parseInt(c.req.query("sessionId") ?? "", 10);
    if (isNaN(sessionId)) throw new Error("Missing sessionId for phase search");
    const logs = await prisma.phaseLog.findMany({ where: { sessionId, ...(game ? { game } : {}) } });
    const target = logs.find(log => `${log.gameDate}-${log.gamePhase}` === phaseKey);
    if (!target) throw new Error("Invalid phaseKey");
    data = await prisma.csvData.findMany({
      where: {
        ...(id ? { id } : {}),
        Timestamp: { gte: target.startTime, ...(target.endTime ? { lte: target.endTime } : {}) },
      },
      select: { Heart_Rate: true }
    });
  } else if (sessionIdParam) {
    const sessionId = parseInt(sessionIdParam, 10);
    if (isNaN(sessionId)) throw new Error("Invalid sessionId");
    const logs = await prisma.phaseLog.findMany({
      where: { sessionId, ...(game ? { game } : {}), endTime: { not: null } }
    });
    const ranges = logs.map(log => ({ start: log.startTime, end: log.endTime! }));
    const dataChunks = await Promise.all(
      ranges.map(range => prisma.csvData.findMany({
        where: { ...(id ? { id } : {}), Timestamp: { gte: range.start, lte: range.end } },
        select: { Heart_Rate: true }
      }))
    );
    data = dataChunks.flat();
  } else {
    data = await prisma.csvData.findMany({
      where: id ? { id } : {},
      select: { Heart_Rate: true }
    });
  }

  return data.map(d => d.Heart_Rate);
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


wss.on("connection", (ws) => {
  clients.push(ws);
  ws.on("close", () => {
    clients = clients.filter((client) => client !== ws);
  });
});
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
      if (parsedHeartRate > HEART_RATE_THRESHOLD) {
        await prisma.anomalyLog.create({
          data: {
            userId: parsedId,
            timestamp: parsedTimestamp,
            heartRate: parsedHeartRate,
            reason: `Threshold ${HEART_RATE_THRESHOLD} exceeded`
          }
        });
      }
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

app.get('/delete-csv', async (c) => {
  const idParam = c.req.query('id');
  if (!idParam) {
    return c.text('❌ id パラメータが指定されていません', 400);
  }

  const id = parseInt(idParam, 10);
  if (isNaN(id)) {
    return c.text('❌ id パラメータが無効です', 400);
  }

  try {
    const deleted = await prisma.csvData.deleteMany({
      where: { id },
    });

    if (deleted.count === 0) {
      return c.text(`⚠️ id=${id} に該当するデータは存在しません`);
    }

    return c.text(`✅ id=${id} のデータを削除しました (削除件数: ${deleted.count})`);
  } catch (error) {
    console.error(error);
    return c.text(`❌ 削除に失敗しました: ${error}`);
  }
});

// ✅ WebSocket 用のグラフデータを取得する
app.get("/graph", async (c) => {
  // フェーズ選択のオプション（既存のまま）
  const logs       = await prisma.phaseLog.findMany({ orderBy: { startTime: "asc" } });
  const ids        = await prisma.csvData.findMany({ distinct: ["id"], select: { id: true } });
  const phaseOptions = logs.map(log => `
    <option
      value="${log.gameDate}-${log.gamePhase}"
      data-sessionid="${log.sessionId}"
      data-game="${log.game}"
    >
      ${log.sessionId}試合目 - ${log.gameDate} ${log.gamePhase}
    </option>
  `).join("");

  // ★ ここを「calendar」ではなく、gameDateで埋める
  const dateList   = await prisma.phaseLog.findMany({
    distinct: ["gameDate"],
    select: { gameDate: true }
  });
  const dateOptions = dateList
    .map(d => `<option value="${d.gameDate}">${d.gameDate}</option>`)
    .join("");

  const idOptions  = ids.map(o=>`<option value="${o.id}">${o.id}</option>`).join("");

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><title>HR Graph Selector</title></head>
<body>

  <h2>フェーズとIDを選択してください</h2>
  <label>フェーズ:</label>
  <select id="phaseSelect">${phaseOptions}</select>
  <label>ID:</label>
  <select id="idSelect">${idOptions}</select>
  <button id="btnPhase">表示</button>

  <h2>ゲーム内日付で表示</h2>
  <label>ゲーム日付:</label>
  <select id="dateSelect">${dateOptions}</select>
  <label>ID:</label>
  <select id="dateIdSelect">${idOptions}</select>
  <button id="btnDate">表示</button>

  <script>
    document.getElementById("btnPhase").onclick = () => {
      const phaseEl   = document.getElementById("phaseSelect");
      const phase     = phaseEl.value;
      const sessionId = phaseEl.selectedOptions[0].dataset.sessionid;
      const game      = phaseEl.selectedOptions[0].dataset.game;
      const id        = document.getElementById("idSelect").value;
      location.href = \`/graph/view?phase=\${encodeURIComponent(phase)}&sessionId=\${sessionId}&id=\${id}&game=\${encodeURIComponent(game)}\`;
    };

    document.getElementById("btnDate").onclick = () => {
      const gameDate = document.getElementById("dateSelect").value;  // 例: "2日目"
      const id       = document.getElementById("dateIdSelect").value;
      location.href = \`/graph/date/\${encodeURIComponent(gameDate)}?id=\${id}\`;
    };
  </script>

</body>
</html>
  `);
});

app.get("/graph/view", async (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Heart Rate Graph</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
</head>
<body>
  <h2 id="title">読み込み中…</h2>
  <p>API URL: <span id="apiUrl">-</span></p>    <!-- 追加 -->
  <canvas id="myChart" width="800" height="400"></canvas>
  <script>
    (async () => {
      const params = new URLSearchParams(location.search);
      const id        = params.get("id");
      const phase     = params.get("phase");
      const sessionId = params.get("sessionId");
      const game      = params.get("game");

      document.getElementById("title").textContent =
        \`\${phase} の心拍グラフ (Game: \${game}, ID: \${id}, Session: \${sessionId})\`;

      // APIを叩く
      const apiUrl = \`/api/heartrate?id=\${id}&phase=\${encodeURIComponent(phase)}&sessionId=\${sessionId}&game=\${encodeURIComponent(game)}\`;
      console.log("🔗 Fetching API URL:", apiUrl);      // コンソールに表示
      document.getElementById("apiUrl").textContent = apiUrl; // 画面に表示
      const res = await fetch(apiUrl);
      if (!res.ok) {
        document.getElementById("title").textContent = "データ取得エラー";
        return;
      }
      const json = await res.json();

      // APIのdataは { Timestamp, Heart_Rate } の配列
      const data = json.data.map(d => ({
        x: new Date(d.Timestamp),
        y: d.Heart_Rate
      }));

      new Chart(
        document.getElementById("myChart").getContext("2d"),
        {
          type: 'line',
          data: {
            datasets: [{
              label: \`\${phase} (ID:\${id})\`,
              data,
              borderColor: 'rgba(75,192,192,1)',
              fill: false,
              spanGaps: true,
            }]
          },
          options: {
            responsive: true,
            scales: {
              x: {
                type: 'time',
                time: { unit: 'minute' },
                title: { display: true, text: 'Time' },
                grid: { display: true, color: 'rgba(0,0,0,0.1)' }
              },
              y: {
                title: { display: true, text: 'Heart Rate (BPM)' },
                grid: { display: true, color: 'rgba(0,0,0,0.1)' }
              }
            }
          }
        }
      );
    })();
  </script>
</body>
</html>
  `);
});


app.get("/graph/date/:day", async (c) => {
  const dayLabel = c.req.param("day");   // e.g. "2日目"
  const idParam  = c.req.query("id");
  const game     = c.req.query("game");  // optional

  if (!dayLabel) {
    return c.text("Invalid day label", 400);
  }
  if (!idParam) {
    return c.text("IDが指定されていません", 400);
  }

  const id = parseInt(idParam, 10);
  if (isNaN(id)) {
    return c.text("IDの形式が不正です", 400);
  }

  // ① gameDate が一致し、かつ endTime があるフェーズを取得
  const phases = await prisma.phaseLog.findMany({
    where: {
      gameDate: dayLabel,
      ...(game ? { game } : {}),
      endTime: { not: null },
    },
    orderBy: { startTime: "asc" },
  });

  if (phases.length === 0) {
    return c.text(`"${dayLabel}" のデータが見つかりません`, 404);
  }

  // ② セッションごとに最初の心拍取得時間を基準に経過秒数を計算
  const sessionGroups: { [sid: number]: { x: number, y: number | null }[] } = {};
  const sessionStart: { [sid: number]: number } = {};

  for (const ph of phases) {
    // フェーズ内の指定IDデータ
    const hrs = await prisma.csvData.findMany({
      where: {
        id,
        Timestamp: {
          gte: ph.startTime,
          lte: ph.endTime!,
        },
      },
      orderBy: { Timestamp: "asc" },
    });

    if (hrs.length === 0) continue;

    const sid = ph.sessionId;
    if (!sessionStart[sid]) {
      sessionStart[sid] = hrs[0].Timestamp.getTime();
    }
    if (!sessionGroups[sid]) {
      sessionGroups[sid] = [];
    }

    for (const hr of hrs) {
      const elapsed = Math.round((hr.Timestamp.getTime() - sessionStart[sid]) / 1000);
      sessionGroups[sid].push({ x: elapsed, y: hr.Heart_Rate ?? null });
    }
  }

  // ③ Chart.js 用のdatasetsを組み立て
  const datasets = Object.entries(sessionGroups).map(([sid, data]) => ({
    label: `Session ${sid}`,
    data,
    borderColor: `hsl(${(Number(sid)*137)%360}, 100%, 50%)`,  // セッションIDで安定色
    fill: false,
    spanGaps: true,
  }));

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${dayLabel} の心拍数 (ID:${id})</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <h2>${dayLabel} の心拍数 (ID:${id})</h2>
  <canvas id="myChart" width="800" height="400"></canvas>
  <script>
    const ctx = document.getElementById('myChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: { datasets: ${JSON.stringify(datasets)} },
      options: {
        responsive: true,
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: '経過時間（秒）' },
            grid: { display: true, color: 'rgba(0,0,0,0.1)' }
          },
          y: {
            title: { display: true, text: 'Heart Rate (BPM)' },
            grid: { display: true, color: 'rgba(0,0,0,0.1)' }
          }
        }
      }
    });
  </script>
</body>
</html>
  `);
});


//api設計
app.get('/api/heartrate', async (c) => {
  const idParam = c.req.query("id");
  const phaseKey = c.req.query("phase");
  const sessionIdParam = c.req.query("sessionId");
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");
  const game = c.req.query("game");

  let id: number | undefined = undefined;
  if (idParam) {
    id = parseInt(idParam, 10);
    if (isNaN(id)) return c.text("Invalid ID", 400);
  }

  // ✅ from/to指定 (IDの有無両方対応)
  if (fromParam && toParam) {
    const from = new Date(fromParam);
    const to = new Date(toParam);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return c.text("Invalid date format", 400);
    }

    const data = await prisma.csvData.findMany({
      where: {
        ...(id ? { id } : {}),
        Timestamp: {
          gte: from,
          lte: to,
        },
      },
      orderBy: { Timestamp: "asc" },
    });

    return c.json({ source: "range", count: data.length, data });
  }

  // ✅ phase指定 (IDの有無両方対応)
  // ✅ phase指定 (IDの有無両方対応、セッションID紐付け)
if (phaseKey) {
  const sessionIdParam = c.req.query("sessionId");
  if (!sessionIdParam) {
    return c.text("Missing sessionId for phase search", 400);
  }

  const sessionId = parseInt(sessionIdParam, 10);
  if (isNaN(sessionId)) return c.text("Invalid sessionId", 400);

  const logs = await prisma.phaseLog.findMany({
    where: {
      sessionId,
      ...(game ? { game } : {}),
    },
  });

  const target = logs.find(log => `${log.gameDate}-${log.gamePhase}` === phaseKey);
  if (!target) return c.text("Invalid phaseKey", 400);

  const data = await prisma.csvData.findMany({
    where: {
      ...(id ? { id } : {}),
      Timestamp: {
        gte: target.startTime,
        ...(target.endTime ? { lte: target.endTime } : {}),
      },
    },
    orderBy: { Timestamp: "asc" },
  });

  return c.json({ source: "phase", sessionId, phase: phaseKey, count: data.length, data });
}

  // ✅ sessionId指定 (IDの有無両方対応)
  if (sessionIdParam) {
    const sessionId = parseInt(sessionIdParam, 10);
    if (isNaN(sessionId)) return c.text("Invalid sessionId", 400);

    const logs = await prisma.phaseLog.findMany({
      where: {
        sessionId,
        ...(game ? { game } : {}),
        endTime: { not: null },
      },
      orderBy: { startTime: "asc" },
    });

    const ranges = logs.map(log => ({
      start: log.startTime,
      end: log.endTime!,
    }));

    const dataChunks = await Promise.all(
      ranges.map(range =>
        prisma.csvData.findMany({
          where: {
            ...(id ? { id } : {}),
            Timestamp: {
              gte: range.start,
              lte: range.end,
            },
          },
          orderBy: { Timestamp: "asc" },
        })
      )
    );

    const flatData = dataChunks.flat();
    return c.json({ source: "session", sessionId, game, count: flatData.length, data: flatData });
  }

  // ✅ パラメータがIDのみ or 完全未指定 → 全件返す（開発用）
  const allData = await prisma.csvData.findMany({
    where: id ? { id } : {},
    orderBy: { Timestamp: "asc" },
  });

  return c.json({ source: "all", count: allData.length, data: allData });
});
app.get('/api/heartrate/stats/average', async (c) => {
  try {
    const heartRates = await getHeartRates(c);
    const count = heartRates.length;
    const average = count ? (heartRates.reduce((a, b) => a + b, 0) / count) : null;
    return c.json({ count, average });
  } catch { return c.text("Bad request", 400); }
});
app.get('/api/heartrate/stats/max', async (c) => {
  try {
    const heartRates = await getHeartRates(c);
    const count = heartRates.length;
    const max = count ? Math.max(...heartRates) : null;
    return c.json({ count, max });
  } catch { return c.text("Bad request", 400); }
});
app.get('/api/heartrate/stats/min', async (c) => {
  try {
    const heartRates = await getHeartRates(c);
    const count = heartRates.length;
    const min = count ? Math.min(...heartRates) : null;
    return c.json({ count, min });
  } catch { return c.text("Bad request", 400); }
});
app.get('/api/heartrate/stats/count', async (c) => {
  try {
    const heartRates = await getHeartRates(c);
    return c.json({ count: heartRates.length });
  } catch { return c.text("Bad request", 400); }
});
app.get('/api/heartrate/stats/summary', async (c) => {
  try {
    const heartRates = await getHeartRates(c);
    const count = heartRates.length;
    const average = count ? (heartRates.reduce((a, b) => a + b, 0) / count) : null;
    const min = count ? Math.min(...heartRates) : null;
    const max = count ? Math.max(...heartRates) : null;
    return c.json({ count, average, min, max });
  } catch { return c.text("Bad request", 400); }
});

app.get("/api/heartrate/alert", async (c) => {
  // Optional: since パラメータで、ある時刻以降のアラートのみ取得
  const sinceParam = c.req.query("since"); // ISO 文字列
  const userIdParam = c.req.query("userId"); // 特定ユーザー絞り込み

  const whereClause: any = {};
  if (sinceParam) {
    const since = new Date(sinceParam);
    if (isNaN(since.getTime())) {
      return c.text("Invalid since parameter", 400);
    }
    whereClause.timestamp = { gte: since };
  }
  if (userIdParam) {
    const uid = parseInt(userIdParam, 10);
    if (isNaN(uid)) {
      return c.text("Invalid userId parameter", 400);
    }
    whereClause.userId = uid;
  }

  const alerts = await prisma.anomalyLog.findMany({
    where: whereClause,
    orderBy: { timestamp: "asc" },
  });

  return c.json({
    count: alerts.length,
    alerts: alerts.map((a: { userId: any; timestamp: { toISOString: () => any; }; heartRate: any; reason: any; }) => ({
      userId:    a.userId,
      timestamp: a.timestamp.toISOString(),
      heartRate: a.heartRate,
      reason:    a.reason
    }))
  });
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
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
const HEART_RATE_THRESHOLD = 120;

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
// GET: /set-detail
// GET /set-detail
app.get("/set-detail", async (c) => {
  // ① 使用済み sessionId の取得
  const used = await prisma.phaseLog.findMany({
    distinct: ["sessionId"],
    select: { sessionId: true },
  });
  const usedIds = used.map(r => r.sessionId);
  const maxOption = Math.max(currentSessionId, ...usedIds, 0) + 5;
  const sessionOptions = Array.from({ length: maxOption }, (_, i) => i + 1)
    .map(n => `
      <option value="${n}" ${usedIds.includes(n) ? "disabled" : ""}>
        ${n}${usedIds.includes(n) ? "（使用済み）" : ""}
      </option>
    `).join("");

  // ② 現在のフェーズ表示ラベル
  const config         = getCurrentGameConfig();
  const sceneLabel     = config.setings.scene;
  const phaseNames     = Object.values(config.setings.time);
  const currentPhase   = phaseNames[currentPhaseIndex]  || "";
  const statusLabel    = `${currentSessionId}試合目・${currentDay}${sceneLabel}・${currentPhase}`;

  // ③ センサーIDを1～10に固定
  const sensorIds = Array.from({ length: 10 }, (_, i) => i + 1);

  // ④ 既登録の Participant 取得
  const existing = await prisma.participant.findMany({
    where: { sessionId: currentSessionId }
  });
  const nameMap: Record<number,string> = {};
  existing.forEach(p => { nameMap[p.sensorId] = p.name });

  // ⑤ テーブル行を組み立て
  const rows = sensorIds.map(id => `
    <tr>
      <td>${id}</td>
      <td>
        <input 
          type="text" 
          name="name_${id}" 
          value="${nameMap[id] || ""}" 
          placeholder="名前を入力" 
        />
      </td>
    </tr>
  `).join("");

  return c.html(`
  <!DOCTYPE html>
  <html lang="ja">
  <head><meta charset="UTF-8"><title>ゲーム状態設定</title></head>
  <body style="font-family:Arial;text-align:center;padding:20px">

    <h1>ゲーム状態の設定</h1>
    <h2>現在: ${statusLabel}</h2>

    <form method="POST" action="/set-detail">
      <!-- セッション切替 -->
      <div>
        <label>セッションIDを選択：</label>
        <select name="sessionId">
          ${sessionOptions}
        </select>
      </div>
      <br/>

      <!-- 参加者登録 (Sensor ID 1～10) -->
      <table border="1" cellpadding="4" style="margin:0 auto;">
        <tr><th>Sensor ID</th><th>名前</th></tr>
        ${rows}
      </table>
      <br/>

      <button type="submit">セッション開始／名前保存</button>
    </form>

    <!-- フェーズ操作ボタン -->
    <div style="margin-top:20px;">
      <button onclick="fetch('/update-detail',{method:'POST'}).then(()=>location.reload())">
        次のフェーズへ
      </button>
      <button onclick="fetch('/previous-detail',{method:'POST'}).then(()=>location.reload())">
        前のフェーズへ
      </button>
      <button onclick="fetch('/reset-detail',{method:'POST'}).then(()=>location.reload())">
        リセット
      </button>
    </div>
  </body>
  </html>`
);});
// POST /set-detail
app.post("/set-detail", async (c) => {
  const body = await c.req.parseBody();
  const sid  = parseInt(body.sessionId as string, 10);
  if (isNaN(sid)) {
    return c.text("無効な sessionId です", 400);
  }

  // Participant に upsert (Sensor ID 1～10)
  for (let sensorId = 1; sensorId <= 10; sensorId++) {
    const key = `name_${sensorId}`;
    const name = String((body as any)[key] || "").trim();
    if (name) {
      await prisma.participant.upsert({
        where: {
          sessionId_sensorId: { sessionId: sid, sensorId }
        },
        create: { sessionId: sid, sensorId, name },
        update: { name }
      });
    }
  }

  // サーバー側セッション切り替え＆初期化
  currentSessionId   = sid;
  currentDay         = 1;
  currentPhaseIndex  = 0;
  canGoBack          = true;
  currentStartTime   = new Date();

  return c.redirect("/set-detail");
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
  // 1) フェーズ選択用データ取得
  const logs = await prisma.phaseLog.findMany({ orderBy: { startTime: "asc" } });
  const phaseOptions = logs.map(log => `
    <option
      value="${log.gameDate}-${log.gamePhase}"
      data-sessionid="${log.sessionId}"
      data-game="${log.game}"
    >
      ${log.sessionId}試合目 - ${log.gameDate} ${log.gamePhase}
    </option>
  `).join("");

  // 2) ゲーム内日付選択用データ取得
  const dateList = await prisma.phaseLog.findMany({
    distinct: ["gameDate"],
    select: { gameDate: true }
  });
  const dateOptions = dateList
    .map(d => `<option value="${d.gameDate}">${d.gameDate}</option>`)
    .join("");

  // 3) ID選択用データ取得
  const ids = await prisma.csvData.findMany({ distinct: ["id"], select: { id: true } });
  const idOptions = ids.map(o => `<option value="${o.id}">${o.id}</option>`).join("");

  // 4) セッション選択用データ取得（リアルタイムグラフ用）
  const sessions = await prisma.phaseLog.findMany({
    distinct: ["sessionId"],
    select: { sessionId: true }
  });
  const sessionOptions = sessions
    .map(s => `<option value="${s.sessionId}">${s.sessionId}</option>`)
    .join("");

  // HTML 出力
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>HR Graph Selector</title>
</head>
<body>
  <!-- 更新ボタン -->
  <div style="margin-bottom:16px;">
    <button onclick="location.reload()" style="padding:8px 16px;font-size:14px;">
      🔄 更新
    </button>
  </div>
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

  <h2>グラフ(リアルタイム)</h2>
  <label>セッションID:</label>
  <select id="sessionSelect">${sessionOptions}</select>
  <button id="btnSession">表示</button>
  
  <h2>分割されたグラフ(リアルタイム)</h2>
  <label>セッションID:</label>
  <select id="sessionSelectdiv">${sessionOptions}</select>
  <button id="btnSessiondiv">表示</button>
  <script>
  
    // フェーズ表示ボタン
    document.getElementById("btnPhase").onclick = () => {
      const phaseEl   = document.getElementById("phaseSelect");
      const phase     = phaseEl.value;
      const sessionId = phaseEl.selectedOptions[0].dataset.sessionid;
      const game      = phaseEl.selectedOptions[0].dataset.game;
      const id        = document.getElementById("idSelect").value;
      location.href = \`/graph/view?phase=\${encodeURIComponent(phase)}&sessionId=\${sessionId}&id=\${id}&game=\${encodeURIComponent(game)}\`;
    };

    // 日付表示ボタン
    document.getElementById("btnDate").onclick = () => {
      const gameDate = document.getElementById("dateSelect").value;
      const id       = document.getElementById("dateIdSelect").value;
      location.href = \`/graph/date/\${encodeURIComponent(gameDate)}?id=\${id}\`;
    };

    // グラフ表示ボタン(リアルタイム)
    document.getElementById("btnSession").onclick = () => {
      const sessionId = document.getElementById("sessionSelect").value;
      location.href = \`/graph/session/\${sessionId}\`;
    };
    //分割されたグラフ表示ボタン(リアルタイム)
    document.getElementById("btnSessiondiv").onclick = () => {
      const sessionId = document.getElementById("sessionSelectdiv").value;
      location.href = \`/graph/session/division/\${sessionId}\`;
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
    <div style="margin-bottom:16px;">
    <button onclick="location.href='/graph'" style="padding:8px 16px;font-size:14px;">
      ← グラフ選択に戻る
    </button>
  </div>
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
app.get("/graph/session/:sessionId", async (c) => {
  const sidParam = c.req.param("sessionId");
  const sessionId = parseInt(sidParam, 10);
  if (isNaN(sessionId)) return c.text("Invalid sessionId", 400);

  // フェーズ終了時刻を取得
  const phaseLogs = await prisma.phaseLog.findMany({
    where: { sessionId, endTime: { not: null } },
    orderBy: { startTime: "asc" },
    select: { gameDate: true, gamePhase: true, endTime: true }
  });
  const annotations = phaseLogs.map((log, idx) => ({
    key: `line${idx}`,
    time: log.endTime!.toISOString(),
    label: `${log.gameDate}${log.gamePhase} 終了`
  }));

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Session ${sessionId} Live Graph</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@1.1.0"></script>
</head>
<body>
  <h2>Session ${sessionId} のリアルタイム心拍数</h2>
    <div style="margin-bottom:16px;">
    <button onclick="location.href='/graph'" style="padding:8px 16px;font-size:14px;">
      ← グラフ選択に戻る
    </button>
  </div>
  <canvas id="liveChart" width="800" height="400"></canvas>
  <script>
  (async function(){
    const sessionId = ${sessionId};
    const ctx = document.getElementById("liveChart").getContext("2d");
    let chart = null;

    // annotation のベース設定
    const phaseAnnotations = ${JSON.stringify(annotations)};
    const baseAnnotations = phaseAnnotations.reduce((a, log) => {
      a[log.key] = {
        type: 'line',
        xMin: new Date(log.time),
        xMax: new Date(log.time),
        borderColor: 'rgba(255,99,132,0.8)',
        borderWidth: 2,
        label: {
          content: log.label,
          enabled: true,
          position: 'start',
          backgroundColor: 'rgba(255,99,132,0.2)',
          color: '#000'
        }
      };
      return a;
    }, {});

    async function fetchData(){
      // 1) 参加者取得
      const resP = await fetch(\`/api/participants?sessionId=\${sessionId}\`);
      const parts = resP.ok ? await resP.json() : [];
      const nameMap = {};
      parts.forEach(p=> nameMap[p.sensorId] = p.name);

      // 2) 心拍データ取得
      const resH = await fetch(\`/api/heartrate?sessionId=\${sessionId}\`);
      if (!resH.ok) return;
      const { data } = await resH.json();

      // 3) 非表示状態を保存
      const prevHidden = {};
      if (chart) {
        chart.data.datasets.forEach((ds,i) => {
          prevHidden[ds.label] = chart.getDatasetMeta(i).hidden;
        });
      }

      // 4) データセット構築
      const groups = {};
      data.forEach(pt => {
        if (!groups[pt.id]) groups[pt.id] = [];
        groups[pt.id].push({ x: new Date(pt.Timestamp), y: pt.Heart_Rate });
      });
      const datasets = Object.entries(groups).map(([id, arr]) => {
        const label = nameMap[id] ? \`\${nameMap[id]} (ID:\${id})\` : \`ID:\${id}\`;
        return {
          label,
          data: arr,
          fill: false,
          borderColor: \`hsl(\${(id*137)%360},100%,50%)\`,
          spanGaps: true
        };
      });

      // 5) 初回／更新
      if (!chart) {
        chart = new Chart(ctx, {
          type: 'line',
          data: { datasets },
          options: {
            responsive: true,
            plugins: { annotation: { annotations: baseAnnotations } },
            scales: {
              x: { type:'time', time:{ unit:'minute' }, title:{ display:true, text:'Time' } },
              y: { title:{ display:true, text:'BPM' } }
            }
          }
        });
      } else {
        chart.data.datasets = datasets;
        // 6) 保存しておいた非表示フラグを復元
        chart.data.datasets.forEach((ds, i) => {
          const key = ds.label;
          if (prevHidden.hasOwnProperty(key)) {
            chart.getDatasetMeta(i).hidden = prevHidden[key];
          }
        });
        chart.update();
      }
    }

    fetchData();
    setInterval(fetchData, 5000);
  })();
  </script>
</body>
</html>
  `);
});
app.get("/graph/session/division/:sessionId", async (c) => {
  const sidParam = c.req.param("sessionId");
  const sessionId = parseInt(sidParam, 10);
  if (isNaN(sessionId)) return c.text("Invalid sessionId", 400);

  // サーバー側で名前マップだけ事前取得
  const parts = await prisma.participant.findMany({
    where: { sessionId },
    select: { sensorId: true, name: true }
  });
  const nameMap: Record<number,string> = {};
  parts.forEach(p => nameMap[p.sensorId] = p.name);

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Session ${sessionId} 分割グラフ表示</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@1.1.0"></script>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    #grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      grid-gap: 16px;
    }
    .card {
      border: 1px solid #ccc;
      border-radius: 8px;
      padding: 12px;
    }
    .card h3 {
      margin: 0 0 8px 0;
      font-size: 16px;
      text-align: center;
    }
  </style>
</head>
<body>
  <h2>Session ${sessionId} の分割グラフ</h2>
  <div id="grid"></div>
  <div style="margin-bottom:16px;">
    <button onclick="location.href='/graph'" style="padding:8px 16px;font-size:14px;">
      ← グラフ選択に戻る
    </button>
  </div>

  <script>
  (async () => {
    const sessionId = ${sessionId};
    const nameMap   = ${JSON.stringify(nameMap)};
    const grid      = document.getElementById("grid");
    const charts    = {};

    async function fetchAndRender() {
      // --- 心拍データ取得 ---
      const resH = await fetch(\`/api/heartrate?sessionId=\${sessionId}\`);
      if (!resH.ok) return;
      const { data } = await resH.json();

      // --- フェーズ終了時刻取得 ---
      const resPL = await fetch(\`/api/phaseLog?sessionId=\${sessionId}\`);
      const phaseLogs = resPL.ok ? await resPL.json() : [];
      const annotationConfig = {};
      phaseLogs.forEach((log, idx) => {
        annotationConfig['line'+idx] = {
          type: 'line',
          xMin: new Date(log.endTime),
          xMax: new Date(log.endTime),
          borderColor: 'rgba(255,99,132,0.8)',
          borderWidth: 2,
          label: {
            content: \`\${log.gameDate}\${log.gamePhase} 終了\`,
            enabled: true,
            position: 'start',
            backgroundColor: 'rgba(255,99,132,0.2)',
            color: '#000'
          }
        };
      });

      // --- データをID毎にグループ ---
      const groups = {};
      data.forEach(pt => {
        if (!groups[pt.id]) groups[pt.id] = [];
        groups[pt.id].push({ x: new Date(pt.Timestamp), y: pt.Heart_Rate });
      });
      const sensorIds = Object.keys(groups).map(id => parseInt(id,10));

      // --- 存在しないIDのチャート破棄 ---
      Object.keys(charts).map(id=>parseInt(id,10)).forEach(id => {
        if (!sensorIds.includes(id)) {
          charts[id].destroy();
          delete charts[id];
          const card = document.getElementById("card-"+id);
          if (card) card.remove();
        }
      });

      // --- 各チャート作成 or 更新 ---
      sensorIds.forEach(id => {
        const arr   = groups[id];
        const label = nameMap[id] ? \`\${nameMap[id]} (ID:\${id})\` : \`ID:\${id}\`;

        if (!charts[id]) {
          // 新規カード＆チャート
          const card = document.createElement("div");
          card.className = "card";
          card.id        = "card-"+id;
          card.innerHTML = \`
            <h3>\${label}</h3>
            <canvas id="chart-\${id}" width="400" height="200"></canvas>
          \`;
          grid.appendChild(card);

          const ctx = document.getElementById("chart-"+id).getContext("2d");
          charts[id] = new Chart(ctx, {
            type: 'line',
            data: {
              datasets: [{
                label,
                data: arr,
                fill: false,
                borderColor: \`hsl(\${(id*137)%360},100%,50%)\`,
                spanGaps: true
              }]
            },
            options: {
              responsive: true,
              plugins: { annotation: { annotations: annotationConfig } },
              scales: {
                x: { type:'time', time:{ unit:'minute' }, title:{ display:true, text:'Time' } },
                y: { title:{ display:true, text:'BPM' } }
              }
            }
          });
        } else {
          // 既存チャート更新
          const chart = charts[id];
          chart.data.datasets[0].data   = arr;
          chart.data.datasets[0].label  = label;
          chart.options.plugins.annotation.annotations = annotationConfig;
          chart.update();
        }
      });
    }

    // 初回 & 定期的に実行
    await fetchAndRender();
    setInterval(fetchAndRender, 5000);
  })();
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
  
    // ---- ① 現在のセッションのフェーズログ（終了時刻があるもの）を取得 ----
    const logs = await prisma.phaseLog.findMany({
      where: {
        sessionId,
        ...(game ? { game } : {}),
        endTime: { not: null },
      },
      orderBy: { startTime: "asc" },
    });
  
    if (logs.length === 0) {
      return c.json({ source: "session", sessionId, count: 0, data: [] });
    }
  
    // ---- ② 次のセッションの開始時刻を探す ----
    const nextLog = await prisma.phaseLog.findFirst({
      where: { sessionId: { gt: sessionId } },
      orderBy: { startTime: "asc" },
    });
    // nextLog?.startTime があれば次セッション開始、それ以外は「現在時刻」まで
    const nextSessionStart = nextLog?.startTime ?? new Date();
  
    // ---- ③ 取得レンジを組み立て ----
    const ranges = logs.map(log => ({
      start: log.startTime,
      end:   log.endTime!,        // 終了時刻は not null なので安心
    }));
    // 最終フェーズ終了後のレンジを追加
    const lastEnd = logs[logs.length - 1].endTime!;
    if (lastEnd < nextSessionStart) {
      ranges.push({
        start: lastEnd,
        end:   nextSessionStart,
      });
    }
  
    // ---- ④ 各レンジでデータを並列取得 ----
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
    const allData = dataChunks.flat();
  
    return c.json({ source: "session", sessionId, count: allData.length, data: allData });
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
});// GET /api/phaseLog?sessionId=XXX

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
app.get("/api/phaseLog", async (c) => {
  const sid = parseInt(c.req.query("sessionId") || "", 10);
  if (isNaN(sid)) return c.text("Invalid sessionId", 400);

  const logs = await prisma.phaseLog.findMany({
    where: { sessionId: sid, endTime: { not: null } },
    orderBy: { startTime: "asc" },
    select: {
      gameDate: true,
      gamePhase: true,
      endTime: true
    }
  });
  // 例: [{gameDate:"1日目", gamePhase:"夜", endTime:Date}, ...]
  return c.json(logs);
});
app.get("/api/participants", async (c) => {
  const sid = parseInt(c.req.query("sessionId") || "", 10);
  if (isNaN(sid)) return c.text("Invalid sessionId", 400);

  const participants = await prisma.participant.findMany({
    where: { sessionId: sid },
    select: { sensorId: true, name: true }
  });
  // 例: [ { sensorId: 1, name: "太郎" }, ... ]
  return c.json(participants);
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
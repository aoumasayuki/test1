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
import ExcelJS from "exceljs";
const wb = new ExcelJS.Workbook();import dotenv from "dotenv";
import fs from "fs";
import { networkInterfaces } from "os";
const parsePhaseKey = (key: string) => {
  const idx = key.lastIndexOf("-");
  return { gameDate: key.slice(0, idx), gamePhase: key.slice(idx + 1) };
};
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
    
      // ✅ サーバー（PC）側の現在時刻を使う
      const parsedTimestamp = new Date();
    
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
app.get("/set-detail", async (c) => {
  // ① 使用済み sessionId の取得
  const used = await prisma.phaseLog.findMany({
    distinct: ["sessionId"],
    select: { sessionId: true },
  });
  const usedIds = used.map(r => r.sessionId);
  const maxOption = Math.max(currentSessionId, ...usedIds, 0) + 5;
  const sessionOptions = Array.from({ length: maxOption }, (_, i) => i + 1)
  .map(n => {
    const isUsed = usedIds.includes(n);
    const isCurrent = n === currentSessionId;
    return `
      <option value="${n}" ${(!isCurrent && isUsed) ? "disabled" : ""} ${isCurrent ? "selected" : ""}>
        ${n}${isUsed ? "（使用済み）" : ""}
      </option>
    `;
  }).join("");


  // ② 現在のフェーズ表示ラベル
  const config         = getCurrentGameConfig();
  const sceneLabel     = config.setings.scene;
  const phaseNames     = Object.values(config.setings.time);
  const currentPhase   = phaseNames[currentPhaseIndex]  || "";
  const statusLabel    = `${currentSessionId}試合目・${currentDay}${sceneLabel}・${currentPhase}`;

  // ③ センサーIDを1～10に固定
  const sensorIds = Array.from({ length: 10 }, (_, i) => i + 1);

  // ④ 既登録の Participant 取得（isAlive も取得）
  const existing = await prisma.participant.findMany({
    where: { sessionId: currentSessionId },
    select: { sensorId: true, name: true, isAlive: true, role: true } // ← role を追加
  });
  const nameMap: Record<number,string> = {};
  const aliveMap: Record<number,boolean> = {};            // * 追加 //*
  const roleMap: Record<number,string> = {};   // ← roleMap を用意
  existing.forEach(p => {
    nameMap[p.sensorId] = p.name;
    aliveMap[p.sensorId] = p.isAlive;                     // * 追加 //*
    roleMap[p.sensorId]  = p.role ?? "";
  });

  // ⑤ テーブル行を組み立て（生存チェック列を追加）
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
      <td>                                                    <!-- * 追加 //* -->
        <label>
          <input type="checkbox" name="alive_${id}" ${aliveMap[id] !== false ? "checked" : ""} />
          生存
        </label>
      </td>                                                   <!-- * 追加 //* -->
          <td>
      <input 
        type="text" 
        name="role_${id}" 
        value="${roleMap?.[id] || ""}" 
        placeholder="役職を入力" 
      />
    </td>
      </tr>
  `).join("");

  return c.html(`
  <!DOCTYPE html>
  <html lang="ja">
  <head>
    <meta charset="UTF-8"><title>ゲーム状態設定</title>
    <script>
      // * 追加: ボタン押下時に現在のフォーム内容(name/isAlive)を保存してからフェーズ操作 //* 
      async function saveParticipantsOnly() {
        const form = document.querySelector('form[action="/set-detail"]');
        const fd = new FormData(form);
        await fetch('/save-participants', { method: 'POST', body: fd });
      }
      async function saveAnd(action) {
        try { await saveParticipantsOnly(); } finally {
          await fetch(action, { method: 'POST' });
          location.reload();
        }
      }
    </script>
  </head>
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
      <tr>
        <th>Sensor ID</th>
        <th>名前</th>
        <th>生死</th>
        <th>役職</th> <!-- ← 追加 -->
      </tr>
        ${rows}
      </table>
      <br/>

      <button type="submit">セッション開始／名前保存</button>
      <!-- ※このボタンは従来どおり /set-detail に POST され、名前＋生死を保存 --> 
    </form>

    <!-- フェーズ操作ボタン（保存してから進行/戻る） -->
    <div style="margin-top:20px;">
      <button onclick="saveAnd('/update-detail')">次のフェーズへ</button>     <!-- * 変更 //* -->
      <button onclick="saveAnd('/previous-detail')">前のフェーズへ</button>   <!-- * 変更 //* -->
      <button onclick="saveAnd('/reset-detail')">リセット</button>             <!-- * 変更（任意） //* -->
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
    const aliveKey = `alive_${sensorId}`;                 // * 追加 //*
    const name = String((body as any)[key] || "").trim();
    const isAlive = !!(body as any)[aliveKey];            // * 追加（チェックされていれば true） //*
    if (name) {                                           // 「名前を追加したものしか保存しない」方針を維持
      await prisma.participant.upsert({
        where: {
          sessionId_sensorId: { sessionId: sid, sensorId }
        },
        create: { sessionId: sid, sensorId, name, isAlive }, // * 変更 //*
        update: { name, isAlive }                            // * 変更 //*
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

// * 追加：生死（と名前）だけを保存する汎用エンドポイント //* 
app.post("/save-participants", async (c) => {
  const body = await c.req.parseBody();
  const sid  = parseInt(body.sessionId as string, 10);
  if (isNaN(sid)) return c.text("無効な sessionId です", 400);

  for (let sensorId = 1; sensorId <= 10; sensorId++) {
    const key = `name_${sensorId}`;
    const aliveKey = `alive_${sensorId}`;
    const name = String((body as any)[key] || "").trim();
    const isAlive = !!(body as any)[aliveKey];
    if (name) {
      await prisma.participant.upsert({
        where: { sessionId_sensorId: { sessionId: sid, sensorId } },
        create: { sessionId: sid, sensorId, name, isAlive },
        update: { name, isAlive },
      });
    }
  }
  return c.text("ok");
});
// フェーズ進行
app.post("/update-detail", async (c) => {
  const dateLabel = getDateLabel();
  const phaseOrder = getPhaseOrder();
  const gameDate = `${currentDay}${dateLabel}`;
  const gamePhase = phaseOrder[currentPhaseIndex];
  const now = new Date();

  if (canGoBack) {
    // --- フェーズ終了を記録 ---
    const log = await prisma.phaseLog.create({
      data: {
        sessionId: currentSessionId,
        game: currentGame,
        gameDate,
        gamePhase: String(gamePhase),
        startTime: currentStartTime,
        endTime: now
      },
    });
    // --- 第１フェーズ終了なら平均を計算して保存 ---
    if (currentPhaseIndex === 0) {
      // CsvData をセンサーID毎にグループ化して avg を取得
      const summaries = await prisma.csvData.groupBy({
        by: ["id"],
        where: {
          Timestamp: {
            gte: log.startTime,
            lte: log.endTime!
          }
        },
        _avg: {
          Heart_Rate: true
        }
      });
      // PhaseSummary テーブルへ
      for (const s of summaries) {
        if (s._avg.Heart_Rate !== null) {
          await prisma.phaseSummary.create({
            data: {
              sessionId:    currentSessionId,
              sensorId:     s.id,
              gameDate,
              gamePhase: String(gamePhase),
              avgHeartRate: s._avg.Heart_Rate
            }
          });
        }
      }
    }
    // 次のフェーズ開始時刻をリセット
    currentStartTime = now;
  } else {
    // 戻る処理（省略）
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
  const url = new URL(c.req.url);

  // ✅ 複数 id（id=1&id=2&id=3 ...）を常に string[] で取得
  const idListParams: string[] = url.searchParams.getAll('id');

  // ✅ カンマ区切り ids=1,2,3 も拾う（null対策済）
  const idsCsvParam = url.searchParams.get('ids') ?? '';

  const parsedIdsFromQueries = idListParams
    .flatMap(s => s.split(','))
    .map(s => s.trim())
    .filter(Boolean);

  const parsedIdsFromCsv = idsCsvParam
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const rawIdStrings = [...parsedIdsFromQueries, ...parsedIdsFromCsv];

  const idList: number[] = Array.from(
    new Set(
      rawIdStrings
        .map(Number)
        .filter(Number.isInteger)
    )
  );

  const fromParam = url.searchParams.get('from') ?? undefined;
  const toParam   = url.searchParams.get('to')   ?? undefined;

  let from: Date | undefined;
  let to  : Date | undefined;
  if (fromParam || toParam) {
    if (!fromParam || !toParam) {
      return c.text('❌ 期間で削除する場合は from と to の両方を指定してください', 400);
    }
    from = new Date(fromParam);
    to   = new Date(toParam);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return c.text('❌ from または to の日付形式が無効です (ISO推奨)', 400);
    }
  }

  if (idList.length === 0 && !(from && to)) {
    return c.text('❌ id(複数可) または from/to のいずれかは必須です', 400);
  }

  const where: any = {};
  if (idList.length > 0) where.id = { in: idList };
  if (from && to) where.Timestamp = { gte: from, lte: to };

  try {
    const result = await prisma.csvData.deleteMany({ where });
    if (result.count === 0) return c.text('⚠️ 該当するデータは存在しません');
    return c.text(`✅ データを削除しました (削除件数: ${result.count})`);
  } catch (error) {
    console.error(error);
    return c.text(`❌ 削除に失敗しました: ${String(error)}`);
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
      data-game="${log.game ?? ''}"
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

  // 3) ID選択用データ取得（共通化）
  const ids = await prisma.csvData.findMany({ distinct: ["id"], select: { id: true } });
  const idOptions = ids.map(o => `<option value="${o.id}">${o.id}</option>`).join("");

  // 4) セッション選択用データ取得（共通化）
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
  <style>
    body { font-family: Arial; padding: 20px; }
    h2 { margin-top: 24px; }
    .hint { color:#666; font-size: 12px; margin-left: 6px; }
    .row { margin: 8px 0; }
    .block { margin:12px 0; }  /* ✅ 枠と余白を削除、必要なら最小限のマージンだけ */
    label { margin-right: 8px; }
    select { margin-right: 8px; }
  </style>
</head>
<body>

  <!-- 更新ボタン -->
  <div style="margin-bottom:16px;">
    <button onclick="location.reload()" style="padding:8px 16px;font-size:14px;">🔄 更新</button>
  </div>

  <!-- ✅ 共通セレクタ -->
  <div class="block">
    <h2>共通セレクタ</h2>
    <div class="row">
      <label>セッションID（共通）:</label>
      <select id="sessionSelectCommon">${sessionOptions}</select>
    </div>
    <div class="row">
      <label>ID（共通）:</label>
      <select id="idSelectCommon">${idOptions}</select>
    </div>
  </div>



  <div class="block">
    <h2 style="display:flex;align-items:center;gap:8px;">
      グラフ(リアルタイム) <span class="hint">『セッションID』</span>
      <button id="btnSession">表示</button>
    </h2>
  </div>

  <div class="block">
    <h2 style="display:flex;align-items:center;gap:8px;">
      分割されたグラフ(リアルタイム) <span class="hint">『セッションID』</span>
      <button id="btnSessiondiv">表示</button>
    </h2>
  </div>

  <div class="block">
    <h2 style="display:flex;align-items:center;gap:8px;">
      顔表現(リアルタイム) <span class="hint">『セッションID』</span>
      <button id="btnSessionface">表示</button>
    </h2>
  </div>

  <div class="block">
    <h2 style="display:flex;align-items:center;gap:8px;">
      now <span class="hint">『セッションID』</span>
      <button id="btnSessionnow">表示</button>
    </h2>
  </div>

  <div class="block">
    <h2 style="display:flex;align-items:center;gap:8px;">
      全員分一画面 <span class="hint">『セッションID』</span>
      <button id="btnSessionall">表示</button>
    </h2>
  </div>
  <div class="block">
    <h2 style="display:flex;align-items:center;gap:8px;">
      idnow <span class="hint">『セッションID + ID』</span>
      <button id="btnSessionselectid">表示</button>
    </h2>
  </div>

  <div class="block">
    <h2 style="display:flex;align-items:center;gap:8px;">
      test <span class="hint">『セッションID』</span>
      <button id="btnSessiontest">表示</button>
    </h2>
  </div>
  <!-- フェーズ + ID -->
  <div class="block">
    <h2>フェーズとIDを選択してください <span class="hint">『フェーズ + ID』</span></h2>
    <div class="row">
      <label>フェーズ:</label>
      <select id="phaseSelect">${phaseOptions}</select>
      <button id="btnPhase">表示</button>
    </div>
  </div>

  <!-- ゲーム内日付 + ID -->
  <div class="block">
    <h2>ゲーム内日付で表示 <span class="hint">『ゲーム日付 + ID』</span></h2>
    <div class="row">
      <label>ゲーム日付:</label>
      <select id="dateSelect">${dateOptions}</select>
      <button id="btnDate">表示</button>
    </div>
  </div>
  <!-- フェーズ範囲 + ID -->
  <div class="block">
    <h2>フェーズ範囲とIDを選択してください <span class="hint">『開始フェーズ + 終了フェーズ + ID』</span></h2>
    <div class="row">
      <label>開始フェーズ:</label>
      <select id="phaseSelectFrom">${phaseOptions}</select>
      <label>終了フェーズ:</label>
      <select id="phaseSelectTo">${phaseOptions}</select>
      <button id="btnPhaseRange">表示</button>
    </div>
  </div>

  <script>
    // 共通ヘルパ
    const getVal = (id) => document.getElementById(id).value;
    const warn = (msg) => alert(msg);

    // ▼ フェーズ + ID
    document.getElementById("btnPhase").onclick = () => {
      const phaseEl   = document.getElementById("phaseSelect");
      const phase     = phaseEl.value;
      const sessionIdInPhase = phaseEl.selectedOptions[0]?.dataset?.sessionid;
      const game      = phaseEl.selectedOptions[0]?.dataset?.game ?? '';
      const id        = getVal("idSelectCommon");
      if (!phase) return warn("フェーズを選択してください");
      if (!id)    return warn("ID（共通）を選択してください");
      const sessionId = sessionIdInPhase; // フェーズはセッションが紐づくため、optionのdata属性から取得
      location.href = \`/graph/view?phase=\${encodeURIComponent(phase)}&sessionId=\${sessionId}&id=\${id}&game=\${encodeURIComponent(game)}\`;
    };

    // ▼ ゲーム日付 + ID
    document.getElementById("btnDate").onclick = () => {
      const gameDate = getVal("dateSelect");
      const id       = getVal("idSelectCommon");
      if (!gameDate) return warn("ゲーム日付を選択してください");
      if (!id)       return warn("ID（共通）を選択してください");
      location.href = \`/graph/date/\${encodeURIComponent(gameDate)}?id=\${id}\`;
    };

    // ▼ リアルタイム（セッションID）
    document.getElementById("btnSession").onclick = () => {
      const sessionId = getVal("sessionSelectCommon");
      if (!sessionId) return warn("セッションID（共通）を選択してください");
      location.href = \`/graph/session/\${sessionId}\`;
    };

    document.getElementById("btnSessiondiv").onclick = () => {
      const sessionId = getVal("sessionSelectCommon");
      if (!sessionId) return warn("セッションID（共通）を選択してください");
      location.href = \`/graph/session/division/\${sessionId}\`;
    };

    document.getElementById("btnSessionface").onclick = () => {
      const sessionId = getVal("sessionSelectCommon");
      if (!sessionId) return warn("セッションID（共通）を選択してください");
      location.href = \`/graph/session/face/\${sessionId}\`;
    };

    document.getElementById("btnSessionnow").onclick = () => {
      const sessionId = getVal("sessionSelectCommon");
      if (!sessionId) return warn("セッションID（共通）を選択してください");
      location.href = \`/graph/session/now/\${sessionId}\`;
    };
    document.getElementById("btnSessionall").onclick = () => {
      const sessionId = getVal("sessionSelectCommon");
      if (!sessionId) return warn("セッションID（共通）を選択してください");
      location.href = \`/graph/session/all/\${sessionId}\`;
    };
    // ▼ idnow（セッションID + ID）
    document.getElementById("btnSessionselectid").onclick = () => {
      const sessionId = getVal("sessionSelectCommon");
      const id        = getVal("idSelectCommon");
      if (!sessionId) return warn("セッションID（共通）を選択してください");
      if (!id)        return warn("ID（共通）を選択してください");
      location.href = \`/graph/session/selectid/\${sessionId}?id=\${id}\`;
    };
    // ▼ フェーズ範囲 + ID
    document.getElementById("btnPhaseRange").onclick = () => {
      const phaseFromEl = document.getElementById("phaseSelectFrom");
      const phaseToEl   = document.getElementById("phaseSelectTo");

      const fromPhase   = phaseFromEl.value;
      const toPhase     = phaseToEl.value;
      const sessionId   = phaseFromEl.selectedOptions[0]?.dataset?.sessionid;
      const id          = getVal("idSelectCommon");

      if (!fromPhase) return warn("開始フェーズを選択してください");
      if (!toPhase)   return warn("終了フェーズを選択してください");
      if (!id)        return warn("ID（共通）を選択してください");
      if (!sessionId) return warn("セッションIDが取得できません");

      location.href = \`/graph/session/range/\${sessionId}?fromPhase=\${encodeURIComponent(fromPhase)}&toPhase=\${encodeURIComponent(toPhase)}\`;
    };

    // ▼ test（セッションID）
    document.getElementById("btnSessiontest").onclick = () => {
      const sessionId = getVal("sessionSelectCommon");
      if (!sessionId) return warn("セッションID（共通）を選択してください");
      location.href = \`/graph/session/test/\${sessionId}\`;
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
        plugins: {
        annotation: { annotations: annotationConfig },
          thresholdBg: { threshold: baseline[id] + THRESHOLD_OFFSET }
          },
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
          spanGaps: true,
          pointRadius: 0
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
// app.get("/graph/session/:sessionId", async (c) => {
//   const sidParam = c.req.param("sessionId");
//   const sessionId = parseInt(sidParam, 10);
//   if (isNaN(sessionId)) return c.text("Invalid sessionId", 400);

//   // 参加者の名前マップ
//   const parts = await prisma.participant.findMany({
//     where: { sessionId },
//     select: { sensorId: true, name: true }
//   });
//   const nameMap: Record<number,string> = {};
//   parts.forEach(p => nameMap[p.sensorId] = p.name);

//   // PhaseSummary の基準平均取得
//   const summaries = await prisma.phaseSummary.findMany({
//     where: { sessionId },
//     select: { sensorId: true, avgHeartRate: true }
//   });
//   const baseline: Record<number, number> = {};
//   summaries.forEach(s => baseline[s.sensorId] = s.avgHeartRate);

//   // フェーズログ取得（annotation用・完了済み＋進行中を含む）
//   const phaseLogs = await prisma.phaseLog.findMany({
//     where: { sessionId },
//     orderBy: { startTime: "asc" },
//     select: {
//       gameDate:  true,
//       gamePhase: true,
//       startTime: true,
//       endTime:   true
//     }
//   });

//   return c.html(`
// <!DOCTYPE html>
// <html lang="ja">
// <head>
//   <meta charset="UTF-8" />
//   <title>Session ${sessionId} リアルタイム心拍グラフ</title>
//   <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
//   <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
//   <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@1.1.0"></script>
//   <style>
//     body { font-family: Arial; padding: 20px; }
//     #grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 16px; }
//     .card { border:1px solid #ccc; border-radius:8px; padding:12px; }
//     .card h3 { margin:0 0 8px; font-size:16px; text-align:center; }
//   </style>
// </head>
// <body>
//   <h2>Session ${sessionId} のリアルタイム心拍</h2>
//   <button onclick="location.href='/graph'" style="margin-bottom:16px">← グラフ選択に戻る</button>
//   <div id="grid"></div>

//   <script>
//   (async function(){
//     const sessionId = ${sessionId};
//     const nameMap   = ${JSON.stringify(nameMap)};
//     const baseline  = ${JSON.stringify(baseline)};
//     const phaseLogs = ${JSON.stringify(phaseLogs)};
//     const grid      = document.getElementById("grid");
//     const charts    = {};
//     const N = 10;            // 最新 N サンプル平均
//     const OFFSET = 5;        // 閾値 = 基準 + OFFSET

//     // プラグイン登録
//     const thresholdBgPlugin = {
//       id: 'thresholdBg',
//       afterDraw(chart, args, options) {
//         const { ctx, chartArea:{top,bottom}, scales:{x} } = chart;
//         const threshold = options.threshold;
//         const maxDelta  = options.maxDelta;
//         const data      = chart.data.datasets[0].data;
//         let startIdx = null;
//         data.forEach((pt,i) => {
//           if (pt.y > threshold && startIdx === null) {
//             startIdx = i;
//           }
//           if ((pt.y <= threshold || i === data.length-1) && startIdx !== null) {
//             const endIdx = (pt.y>threshold && i===data.length-1)? i : i-1;
//             const delta = data[startIdx].y - threshold;
//             const alpha = Math.min(delta / maxDelta, 1) * 0.5;
//             const x0 = x.getPixelForValue(data[startIdx].x);
//             const x1 = x.getPixelForValue(data[endIdx].x);
//             ctx.save();
//             ctx.fillStyle = \`rgba(255,0,0,\${alpha})\`;
//             ctx.fillRect(x0, top, x1 - x0, bottom - top);
//             ctx.restore();
//             startIdx = null;
//           }
//         });
//       }
//     };
//     Chart.register(thresholdBgPlugin);

//     async function fetchAndRender() {
//       // 1) annotationConfig
//       const annotationConfig = {};
//       phaseLogs.forEach((log, idx) => {
//         if (!log.endTime) return;
//         annotationConfig['line'+idx] = {
//           type: 'line',
//           xMin: new Date(log.endTime),
//           xMax: new Date(log.endTime),
//           borderColor: 'rgba(255,99,132,0.8)',
//           borderWidth: 2,
//           label: {
//             content: \`\${log.gameDate}\${log.gamePhase} 終了\`,
//             enabled: true,
//             position: 'start',
//             backgroundColor: 'rgba(255,99,132,0.2)',
//             color: '#000'
//           }
//         };
//       });

//       // 2) ギャップ除外の境界取得
//       const firstEnd = phaseLogs[0]?.endTime ? new Date(phaseLogs[0].endTime).getTime() : null;
//       const currentPhase = phaseLogs.find(pl => pl.endTime === null);
//       const currStart = currentPhase ? new Date(currentPhase.startTime).getTime() : null;

//       // 3) データ取得
//       const sessionStart = phaseLogs[0]?.startTime || new Date().toISOString();
//       const nowISO = new Date().toISOString();
//       const res = await fetch(\`/api/heartrate?sessionId=\${sessionId}&from=\${encodeURIComponent(sessionStart)}&to=\${encodeURIComponent(nowISO)}\`);
//       if (!res.ok) return;
//       const { data } = await res.json();

//       // 4) グループ化＋ギャップ除外フィルタ
//       const groups = {};
//       data.forEach(pt => {
//         const t = new Date(pt.Timestamp).getTime();
//         if (firstEnd !== null && currStart !== null && t > firstEnd && t < currStart) {
//           // 1フェーズ終了～現フェーズ開始前は除外
//           return;
//         }
//         if (!groups[pt.id]) groups[pt.id] = [];
//         groups[pt.id].push({ x: new Date(pt.Timestamp), y: pt.Heart_Rate });
//       });

//       // 5) 各IDごと stats
//       const stats = Object.entries(groups).map(([idStr, arr]) => {
//         const id = +idStr;
//         const recent = arr.slice(-N);
//         const sum = recent.reduce((a,p)=>a+p.y,0);
//         const currentAvg = recent.length ? sum / recent.length : 0;
//         const base = baseline[id]||0;
//         const threshold = base + OFFSET;
//         const deltas = recent.map(p=>p.y-threshold).filter(d=>d>0);
//         const maxDelta = deltas.length ? Math.max(...deltas) : 1;
//         const header = \`\${nameMap[id]||'ID:'+id} — 基準:\${base.toFixed(1)} BPM 今(\${N}件):\${currentAvg.toFixed(1)} BPM\`;
//         return { id, arr, header, threshold, maxDelta };
//       });

//       // 差順ソート
//       stats.sort((a,b)=>b.maxDelta - a.maxDelta);

//       // 6) 不要チャート破棄
//       const ids = stats.map(s=>s.id);
//       Object.keys(charts).map(i=>+i).forEach(id => {
//         if (!ids.includes(id)) {
//           charts[id].destroy();
//           delete charts[id];
//           document.getElementById("card-"+id)?.remove();
//         }
//       });

//       // 7) カード＆チャート生成 or 更新
//       stats.forEach(stat => {
//         const { id, arr, header, threshold, maxDelta } = stat;
//         let card = document.getElementById("card-"+id);
//         if (!card) {
//           card = document.createElement("div");
//           card.className = "card";
//           card.id = "card-"+id;
//           card.innerHTML = \`
//             <h3>\${header}</h3>
//             <canvas id="chart-\${id}" width="400" height="200"></canvas>\`;
//           grid.appendChild(card);
//         } else {
//           card.querySelector("h3").textContent = header;
//           grid.appendChild(card);
//         }
//         const ctx = document.getElementById("chart-"+id).getContext("2d");
//         if (!charts[id]) {
//           charts[id] = new Chart(ctx, {
//             type:'line',
//             data:{ datasets:[{ label:header, data:arr, fill:false, borderColor:\`hsl(\${(id*137)%360},100%,50%)\`, spanGaps:true }]},
//             options:{
//               responsive:true,
//               plugins:{
//                 annotation: { annotations:annotationConfig },
//                 thresholdBg: { threshold, maxDelta }
//               },
//               scales:{
//                 x:{ type:'time', time:{unit:'minute'}, title:{display:true,text:'Time'} },
//                 y:{ title:{display:true,text:'BPM'} }
//               }
//             }
//           });
//         } else {
//           const chart = charts[id];
//           chart.data.datasets[0].data = arr;
//           chart.data.datasets[0].label = header;
//           chart.options.plugins.annotation.annotations = annotationConfig;
//           chart.options.plugins.thresholdBg.threshold = threshold;
//           chart.options.plugins.thresholdBg.maxDelta  = maxDelta;
//           chart.update();
//         }
//       });
//     }

//     await fetchAndRender();
//     setInterval(fetchAndRender, 5000);
//   })();
//   </script>
// </body>
// </html>
//   `);
// });
app.get("/graph/session/face/:sessionId", async (c) => {
  const sidParam = c.req.param("sessionId");
  const sessionId = parseInt(sidParam, 10);
  if (isNaN(sessionId)) return c.text("Invalid sessionId", 400);

  // 参加者の名前マップ
  const parts = await prisma.participant.findMany({
    where: { sessionId },
    select: { sensorId: true, name: true }
  });
  const nameMap: Record<number, string> = {};
  parts.forEach(p => { nameMap[p.sensorId] = p.name; });

  // PhaseSummary の基準平均取得
  const summaries = await prisma.phaseSummary.findMany({
    where: { sessionId },
    select: { sensorId: true, avgHeartRate: true }
  });
  const baseline: Record<number, number> = {};
  summaries.forEach(s => { baseline[s.sensorId] = s.avgHeartRate; });

  // フェーズログ取得（sessionStart 用）
  const phaseLogs = await prisma.phaseLog.findMany({
    where: { sessionId },
    orderBy: { startTime: "asc" },
    select: { startTime: true, endTime: true }
  });

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Session ${sessionId} 分割評価表示（顔文字＋ID/名前）</title>
  <style>
    body { font-family: Arial; padding: 20px; }
    #grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap:16px; }
    .card { border:1px solid #ccc; border-radius:8px; padding:12px; text-align:center; }
    .title { font-size:16px; margin-bottom:8px; }
    .face { font-size:64px; line-height:1; }
  </style>
</head>
<body>
  <h2>Session ${sessionId} の分割評価（差〜2:🟦,2〜5:🟩,5〜10:🟨,10〜15:🟧,15〜:🟥）</h2>
  <button onclick="location.href='/graph'" style="margin-bottom:16px">← 戻る</button>
  <div id="grid"></div>

  <script>
  (async function() {
    const sessionId = ${sessionId};
    const nameMap   = ${JSON.stringify(nameMap)};
    const baseline  = ${JSON.stringify(baseline)};
    const phaseLogs = ${JSON.stringify(phaseLogs)};
    const grid      = document.getElementById("grid");
    const N         = 10; // 最新Nサンプルを平均

    function getFaceByDiff(diff) {
      if (diff <= 2)   return "🟦";
      if (diff <= 5)   return "🟩";
      if (diff <= 10)  return "🟨";
      if (diff <= 15)  return "🟧";
      return "🟥";
    }

    async function fetchAndRender() {
      const from = phaseLogs.length
        ? phaseLogs[0].startTime
        : new Date().toISOString();
      const toISO = new Date().toISOString();
      const res = await fetch("/api/heartrate?sessionId=" + sessionId +
                              "&from=" + encodeURIComponent(from) +
                              "&to=" + encodeURIComponent(toISO));
      if (!res.ok) return;
      const { data } = await res.json();

      // グループ化
      const groups = {};
      data.forEach(pt => {
        if (!groups[pt.id]) groups[pt.id] = [];
        groups[pt.id].push(pt.Heart_Rate);
      });

      // stats 配列生成
      const stats = Object.entries(groups).map(([idStr, arr]) => {
        const id = parseInt(idStr, 10);
        const recent = arr.slice(-N);
        const sum = recent.reduce((a, v) => a + v, 0);
        const currentAvg = recent.length ? sum / recent.length : 0;
        const base = baseline[id] || 0;
        const diff = currentAvg - base;
        const face = getFaceByDiff(diff);
        const name = nameMap[id] || "ID:" + id;
        return { id, name, face, diff, avg:currentAvg };
      });

      // ソート
      stats.sort((a, b) => b.diff - a.diff);

      // DOM 再構築
      grid.innerHTML = "";
      stats.forEach(item => {
        const card = document.createElement("div");
        card.className = "card";
        // ID/名前表示と顔文字を連結文字列で組み立て
        card.innerHTML =
          '<div class="title">' + item.name + '</div>' +
          '<div class="face">' + item.face + '</div>' +
          '<div>' + item.avg.toFixed(1) + ' BPM</div>';

        grid.appendChild(card);
      });
    }

    await fetchAndRender();
    setInterval(fetchAndRender, 1000);
  })();
  </script>
</body>
</html>
  `);
});
app.get("/graph/session/selectid/:sessionId", async (c) => {
  const sidParam = c.req.param("sessionId");
  const sessionId = parseInt(sidParam, 10);
  if (isNaN(sessionId)) return c.text("Invalid sessionId", 400);

  // クエリから id を取得
  const idParam = c.req.query("id");
  const filterId = idParam !== undefined ? parseInt(idParam, 10) : undefined;
  if (filterId !== undefined && isNaN(filterId)) return c.text("Invalid id", 400);

  // 参加者取得
  const parts = await prisma.participant.findMany({
    where: { sessionId },
    select: { sensorId: true, name: true }
  });
  const nameMap: Record<number,string> = {};
  parts.forEach(p => nameMap[p.sensorId] = p.name);

  // 平均取得
  const sums = await prisma.phaseSummary.findMany({
    where: { sessionId }
  });
  const summaryMap: Record<number,number> = {};
  sums.forEach(s => summaryMap[s.sensorId] = s.avgHeartRate);

  // サーバー側で<option>を組み立て
  const optionHtml = parts.map(p => {
    const sel = filterId === p.sensorId ? "selected" : "";
    return `<option value="${p.sensorId}" ${sel}>${p.name} (ID:${p.sensorId})</option>`;
  }).join("");

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>Session ${sessionId} フェーズ分離グラフ</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
  <style>
    body { font-family: Arial; padding: 20px; }
    #grid { display: grid; grid-template-columns: repeat(1,1fr); gap: 16px; }
    .card { border:1px solid #ccc; border-radius:8px; padding:12px; }
    .card h3 { margin:0 0 8px; font-size:16px; text-align:center; }
  </style>
</head>
<body>
  <h2>Session ${sessionId} の現在フェーズ心拍数</h2>
  <form onsubmit="event.preventDefault(); location.href='/graph/session/test/${sessionId}?id='+document.getElementById('idSelect').value">
    <label>Participant:
      <select id="idSelect">
        <option value="">— 全員 —</option>
        ${optionHtml}
      </select>
    </label>
    <button type="submit">表示</button>
  </form>
  <button onclick="location.href='/graph'" style="margin-bottom:16px">← 戻る</button>
  <div id="grid"></div>

  <script>
    // 以降は既存の fetchAndRender ロジックをそのまま…
    (async () => {
      const sessionId = ${sessionId};
      const filterId  = ${filterId ?? "null"};
  const nameMap   = ${JSON.stringify(nameMap)};
  const summaryMap= ${JSON.stringify(summaryMap)};
  const N = 10, OFFSET = 15;
  const grid = document.getElementById("grid");
  const charts = {};

  async function fetchAndRender() {
    const resPL = await fetch(\`/api/phaseLog?sessionId=\${sessionId}\`);
    const phaseLogs = resPL.ok ? await resPL.json() : [];
    const now = new Date();

    // フェーズ選別
    const firstPhase = phaseLogs[0];
    const pastPhases = phaseLogs.filter(log => new Date(log.startTime) <= now);
    const latestPhase = pastPhases.reduce((a,b) => new Date(a.startTime)>new Date(b.startTime)?a:b);

    // １日目朝と現在フェーズの範囲設定
    const ranges = [];
    if (firstPhase.startTime) {
      ranges.push({ from: firstPhase.startTime, to: firstPhase.endTime||now.toISOString() });
    }
    if (latestPhase.startTime) {
      ranges.push({ from: latestPhase.startTime, to: now.toISOString() });
    }

    // データ取得
    let allData = [];
    for (const r of ranges) {
      const url = \`/api/heartrate?sessionId=\${sessionId}&from=\${encodeURIComponent(r.from)}&to=\${encodeURIComponent(r.to)}\${filterId?('&id='+filterId):''}\`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const { data } = await res.json();
      allData.push(data);
    }

    // ID 毎に配列を分割
    const phaseDataMap = {};
    [0,1].forEach(idx => {
      (allData[idx]||[]).forEach(pt => {
        if (filterId && pt.id !== filterId) return;
        if (!phaseDataMap[pt.id]) phaseDataMap[pt.id] = [[],[]];
        phaseDataMap[pt.id][idx].push({ x: phaseDataMap[pt.id][idx].length, y: pt.Heart_Rate });
      });
    });

    // 描画
    Object.entries(phaseDataMap).forEach(([idStr, [arr1,arr2]]) => {
      const id = parseInt(idStr,10);
      const recent = arr2.slice(-N);
      const sum = recent.reduce((a,p)=>a+p.y,0);
      const currentAvg = recent.length? sum/recent.length:0;
      const base = summaryMap[id]||0;
      const header = \`\${nameMap[id]||'ID:'+id} — 平均:\${base.toFixed(1)}BPM 今:\${currentAvg.toFixed(1)}BPM\`;

      let card = document.getElementById("card-"+id);
      if (!card) {
        card = document.createElement("div");
        card.className="card";
        card.id="card-"+id;
        card.innerHTML=\`
          <h3>\${header}</h3>
          <canvas id="chart-\${id}" width="400" height="200"></canvas>\`;
        grid.appendChild(card);
      } else {
        card.querySelector("h3").textContent = header;
      }

      const ctx = document.getElementById("chart-"+id).getContext("2d");
      if (!charts[id]) {
        charts[id] = new Chart(ctx, {
          type:'line',
          data:{
            datasets:[
              { label:'1日目朝',   data:arr1, borderColor:'blue',  pointRadius:0, spanGaps:false },
              { label:'現在フェーズ', data:arr2, borderColor:'red',   pointRadius:0, spanGaps:false }
            ]
          },
          options:{
            responsive:true,
            scales:{
              x:{ type:'linear', display:false },
              y:{ title:{ display:true, text:'BPM' } }
            }
          }
        });
      } else {
        const chart = charts[id];
        chart.data.datasets[0].data = arr1;
        chart.data.datasets[1].data = arr2;
        chart.update();
      }
    });
  }

  await fetchAndRender();
  setInterval(fetchAndRender, 1000);
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

  // PhaseSummary の基準平均を取得
  const summaries = await prisma.phaseSummary.findMany({
    where: { sessionId },
    select: { sensorId: true, avgHeartRate: true }
  });
  const baseline: Record<number, number> = {};
  summaries.forEach(s => baseline[s.sensorId] = s.avgHeartRate);

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Session ${sessionId} 分割グラフ</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@1.1.0"></script>
  <style>
    body{font-family:Arial;padding:20px}
    #grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
    .card{border:1px solid #ccc;border-radius:8px;padding:12px}
    .card h3{margin:0 0 8px;font-size:16px;text-align:center}
  </style>
</head>
<body>
  <h2>Session ${sessionId} の分割グラフ</h2>
  <button onclick="location.href='/graph'" style="margin-bottom:16px">← 戻る</button>
  <div id="grid"></div>

  <script>
  (async function(){
    const sessionId = ${sessionId};
    const baseline  = ${JSON.stringify(baseline)};
    const grid      = document.getElementById("grid");
    const charts    = {};
    const N = 10;
    const OFFSET = 15;

    // 背景ハイライトプラグイン
    const thresholdBgPlugin = {
      id: 'thresholdBg',
      afterDraw: (chart, args, options) => {
        const { ctx, chartArea:{top,bottom}, scales:{x} } = chart;
        const threshold = options.threshold;
        const maxDelta  = options.maxDelta;
        const data = chart.data.datasets[0].data;
        let startIdx = null;
        data.forEach((pt,i) => {
          if (pt.y > threshold && startIdx === null) startIdx = i;
          if ((pt.y <= threshold || i === data.length-1) && startIdx !== null) {
            const endIdx = (pt.y>threshold && i===data.length-1)? i : i-1;
            const delta = data[startIdx].y - threshold;
            const alpha = Math.min(delta / maxDelta, 1) * 0.5;
            const x0 = x.getPixelForValue(data[startIdx].x);
            const x1 = x.getPixelForValue(data[endIdx].x);
            ctx.save();
            ctx.fillStyle = \`rgba(255,0,0,\${alpha})\`;
            ctx.fillRect(x0, top, x1-x0, bottom-top);
            ctx.restore();
            startIdx = null;
          }
        });
      }
    };
    Chart.register(thresholdBgPlugin);

    async function fetchAndRender(){
      // 1) 参加者の最新状態を取得
      let aliveSet = new Set(), nameMap = {};
      try {
        const resParts = await fetch(\`/api/participants?sessionId=\${sessionId}\`);
        if (resParts.ok) {
          const parts = await resParts.json();
          aliveSet = new Set(parts.filter(p => p.isAlive !== false).map(p => p.sensorId));
          parts.forEach(p => { if (p.name) nameMap[p.sensorId] = p.name; });
        }
      } catch(e){ console.warn("participants fetch failed", e); }

      // 2) フェーズログ取得（区切り線描画用）
      const resPL = await fetch(\`/api/phaseLog?sessionId=\${sessionId}\`);
      const phaseLogs = resPL.ok ? await resPL.json() : [];
      const annotationConfig = {};
      phaseLogs.forEach((log,idx)=>{
        if (!log.endTime) return;
        annotationConfig['line'+idx] = {
          type:'line', xMin:new Date(log.endTime), xMax:new Date(log.endTime),
          borderColor:'rgba(255,99,132,0.8)', borderWidth:2,
          label:{ content: log.gamePhase, enabled:true, position:'start',
                  backgroundColor:'rgba(255,99,132,0.2)', color:'#000' }
        };
      });

      // 3) 心拍データ取得
      const sessionStart = phaseLogs.length? phaseLogs[0].startTime : new Date().toISOString();
      const nowISO = new Date().toISOString();
      const res = await fetch(\`/api/heartrate?sessionId=\${sessionId}&from=\${encodeURIComponent(sessionStart)}&to=\${encodeURIComponent(nowISO)}\`);
      if (!res.ok) return;
      const { data } = await res.json();

      // 4) ID毎にグループ化
      const groups = {};
      data.forEach(pt=>{
        (groups[pt.id] ??= []).push({ x:new Date(pt.Timestamp), y:pt.Heart_Rate });
      });

      // 5) 生存者のみ統計
      const stats = Object.entries(groups)
        .filter(([idStr]) => aliveSet.has(parseInt(idStr,10)))
        .map(([idStr,arr])=>{
          const id = parseInt(idStr,10);
          const recent = arr.slice(-N);
          const sum = recent.reduce((a,p)=>a+p.y,0);
          const currentAvg = recent.length? sum/recent.length: 0;
          const base = baseline[id]||0;
          const threshold = base + OFFSET;
          const deltas = recent.map(p=>p.y-threshold).filter(d=>d>0);
          const maxDelta = deltas.length? Math.max(...deltas) : 1;
          const header = \`\${nameMap[id]||'ID:'+id} — 基準:\${base.toFixed(1)} BPM 今(\${N}件):\${currentAvg.toFixed(1)} BPM\`;
          return { id, arr, header, threshold, maxDelta };
        });

      // 6) 死亡したIDのカードを破棄
      const currentIds = stats.map(s=>s.id);
      Object.keys(charts).map(Number).forEach(id=>{
        if (!currentIds.includes(id)) {
          charts[id].destroy();
          delete charts[id];
          document.getElementById("card-"+id)?.remove();
        }
      });

      // 7) 生存者チャート生成/更新
      stats.forEach(({id,arr,header,threshold,maxDelta})=>{
        let card = document.getElementById("card-"+id);
        if (!card) {
          card = document.createElement("div");
          card.className = "card";
          card.id = "card-"+id;
          card.innerHTML = \`
            <h3>\${header}</h3>
            <canvas id="chart-\${id}" width="400" height="200"></canvas>\`;
          grid.appendChild(card);
        } else {
          card.querySelector("h3").textContent = header;
        }
        const ctx = document.getElementById(\`chart-\${id}\`).getContext("2d");
        if (!charts[id]) {
          charts[id] = new Chart(ctx, {
            type:'line',
            data:{ datasets:[{ label:header, data:arr, fill:false,
                               borderColor:\`hsl(\${(id*137)%360},100%,50%)\`,
                               spanGaps:true }]},
            options:{
              responsive:true,
              plugins:{ annotation:{ annotations:annotationConfig },
                        thresholdBg:{ threshold, maxDelta } },
              elements:{ point:{ radius:0 } },
              scales:{ x:{ type:'time', time:{unit:'minute'}, title:{display:true,text:'Time'} },
                       y:{ title:{display:true,text:'BPM'} } }
            }
          });
        } else {
          const chart = charts[id];
          chart.data.datasets[0].data = arr;
          chart.data.datasets[0].label = header;
          chart.options.plugins.annotation.annotations = annotationConfig;
          chart.options.plugins.thresholdBg.threshold = threshold;
          chart.options.plugins.thresholdBg.maxDelta  = maxDelta;
          chart.update();
        }
      });
    }

    await fetchAndRender();
    setInterval(fetchAndRender, 1000);
  })();
  </script>
</body>
</html>
  `);
});
app.get("/graph/session/range/:sessionId", async (c) => {
  const sid = parseInt(c.req.param("sessionId"), 10);
  const fromPhase = c.req.query("fromPhase") || "";
  const toPhase   = c.req.query("toPhase") || "";
  const id        = c.req.query("id") || "";
  const gameDate  = c.req.query("gameDate") || "";
  const gamePhase = c.req.query("gamePhase") || "";
  const nameMap = c.req.query("nameMap") || "";

  if (isNaN(sid) || !fromPhase || !toPhase) {
    return c.text("Invalid sessionId or phase", 400);
  }

  // fromPhase = "1日目朝-議論" のような文字列から分解する
  const parseKey = (key: string) => {
    const idx = key.lastIndexOf("-");
    return { gameDate: key.slice(0, idx), gamePhase: key.slice(idx + 1) };
  };
  const from = parseKey(fromPhase);
  const to   = parseKey(toPhase);

  // PhaseLog から時間帯を取得
  const fromLog = await prisma.phaseLog.findFirst({
    where: { sessionId: sid, gameDate: from.gameDate, gamePhase: from.gamePhase }
  });
  const toLog = await prisma.phaseLog.findFirst({
    where: { sessionId: sid, gameDate: to.gameDate, gamePhase: to.gamePhase }
  });

  if (!fromLog || !toLog) return c.text("Phase not found", 404);

  const start = fromLog.startTime;
  const end   = toLog.endTime || new Date();
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Session ${sid} — ${gameDate} ${gamePhase}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
  <style>
    body { font-family: Arial; padding: 20px; }
    #grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .card { border: 1px solid #ccc; border-radius: 8px; padding: 6px; }
    .card h3 { margin: 0 0 8px; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <h2>Session ${sid} — ${gameDate} ${gamePhase}</h2>
  <button onclick="location.href='/graph'">← 戻る</button>
  <div id="grid"></div>

  <script>
  (async function(){
    const sessionId = ${sid};
    const nameMap = ${JSON.stringify(nameMap)};
    const start = "${start.toISOString()}";
    const end = "${end.toISOString()}";

    // 指定フェーズのデータ取得
    const res = await fetch(\`/api/heartrate?sessionId=\${sessionId}&from=\${encodeURIComponent(start)}&to=\${encodeURIComponent(end)}\`);
    if (!res.ok) {
      document.body.insertAdjacentHTML("beforeend", "<p style='color:red'>データ取得に失敗しました</p>");
      return;
    }
    const { data } = await res.json();

    // センサーごとにグループ化
    const grouped = {};
    data.forEach(pt => {
      if (!grouped[pt.id]) grouped[pt.id] = [];
      grouped[pt.id].push({ x: new Date(pt.Timestamp), y: pt.Heart_Rate });
    });

    const grid = document.getElementById("grid");
    const charts = {};

    Object.entries(grouped).forEach(([idStr, arr]) => {
      const id = parseInt(idStr, 10);
      const label = nameMap[id] ? \`\${id} — \${nameMap[id]}\` : \`ID:\${id}\`;

      const card = document.createElement("div");
      card.className = "card";
      card.id = "card-" + id;
      card.innerHTML = \`
        <h3>\${label}</h3>
        <canvas id="chart-\${id}" width="400" height="200"></canvas>\`;
      grid.appendChild(card);

      const ctx = document.getElementById("chart-" + id).getContext("2d");
      charts[id] = new Chart(ctx, {
        type: 'line',
        data: { datasets: [{ label: '${gameDate} ${gamePhase}', data: arr, borderColor: 'red', pointRadius: 0 }] },
        options: {
          responsive: true,
          scales: {
            x: { type: 'time', time: { unit: 'minute' }, title: { display: true, text: '時間' } },
            y: { title: { display: true, text: 'BPM' } }
          }
        }
      });
    });
  })();
  </script>
</body>
</html>
  `);
});
app.get("/graph/session/now/:sessionId", async (c) => {
  const sidParam = c.req.param("sessionId");
  const sessionId = parseInt(sidParam, 10);
  if (isNaN(sessionId)) return c.text("Invalid sessionId", 400);

  const parts = await prisma.participant.findMany({
    where: { sessionId },
    select: { sensorId: true, name: true }
  });
  const nameMap: Record<number, string> = {};
  parts.forEach(p => nameMap[p.sensorId] = p.name);

  const summaries = await prisma.phaseSummary.findMany({
    where: { sessionId },
    select: { sensorId: true, avgHeartRate: true }
  });
  const baseline: Record<number, number> = {};
  summaries.forEach(s => baseline[s.sensorId] = s.avgHeartRate);

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Session ${sessionId} フェーズ分離グラフ</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
  <style>
    body { font-family: Arial; padding: 20px; }
    #grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
    .card { border: 1px solid #ccc; border-radius: 8px; padding: 12px; }
    .card h3 { margin: 0 0 8px; font-size: 16px; text-align: center; }
  </style>
</head>
<body>
  <h2>Session ${sessionId} フェーズ分離グラフ</h2>
  <button onclick="location.href='/graph'" style="margin-bottom:16px">← 戻る</button>
  <div id="grid"></div>

  <script>
(async function(){
  const sessionId = ${sessionId};
  const nameMap = ${JSON.stringify(nameMap)};
  const baseline = ${JSON.stringify(baseline)};
  const N = 10, OFFSET = 15;
  const grid = document.getElementById("grid");
  const charts = {};

  async function fetchAndRender() {
    const resPL = await fetch(\`/api/phaseLog?sessionId=\${sessionId}\`);
    const phaseLogs = resPL.ok ? await resPL.json() : [];
    const now = new Date();

    const firstPhase = phaseLogs[0];
    const pastPhases = phaseLogs.filter(log => new Date(log.startTime) <= now);
    const latestPhase = pastPhases.reduce((a, b) => new Date(a.startTime) > new Date(b.startTime) ? a : b);

    const fetchRanges = [];
    if (firstPhase?.startTime) {
      const firstEnd = firstPhase.endTime || now.toISOString();
      fetchRanges.push({ from: firstPhase.startTime, to: firstEnd });
    }
    if (latestPhase?.startTime) {
      fetchRanges.push({ from: latestPhase.startTime, to: now.toISOString() });
    }

    let allData = [];
    for (const range of fetchRanges) {
      const res = await fetch(\`/api/heartrate?sessionId=\${sessionId}&from=\${encodeURIComponent(range.from)}&to=\${encodeURIComponent(range.to)}\`);
      if (!res.ok) continue;
      const { data } = await res.json();
      allData.push(data);
    }

    const phaseDataMap = {};
    [0, 1].forEach(i => {
      allData[i].forEach((pt, idx) => {
        if (!phaseDataMap[pt.id]) phaseDataMap[pt.id] = [[], []];
        phaseDataMap[pt.id][i].push({
          x: phaseDataMap[pt.id][i].length,  // インデックスをx軸に
          y: pt.Heart_Rate
        });
      });
    });

    Object.entries(phaseDataMap).forEach(([idStr, [arr1, arr2]]) => {
      const id = parseInt(idStr, 10);
      const recent = arr2.slice(-N);
      const sum = recent.reduce((a, p) => a + p.y, 0);
      const currentAvg = recent.length ? sum / recent.length : 0;
      const avgMorning = arr1.length ? (arr1.reduce((a,p)=>a+p.y,0) / arr1.length) : 0;
      const threshold = avgMorning + OFFSET;
      const deltas = recent.map(p => p.y - threshold).filter(d => d > 0);
      const maxDelta = deltas.length ? Math.max(...deltas) : 1;
      const header = \`\${nameMap[id] || 'ID:' + id} — 1日目朝平均:\${avgMorning.toFixed(1)} BPM  今(\${N}件):\${currentAvg.toFixed(1)} BPM\`;

      let card = document.getElementById("card-" + id);
      if (!card) {
        card = document.createElement("div");
        card.className = "card";
        card.id = "card-" + id;
        card.innerHTML = \`
          <h3>\${header}</h3>
          <canvas id="chart-\${id}" width="400" height="200"></canvas>\`;
        grid.appendChild(card);
      } else {
        card.querySelector("h3").textContent = header;
      }

      const ctx = document.getElementById("chart-" + id).getContext("2d");
      if (!charts[id]) {
        charts[id] = new Chart(ctx, {
          type: 'line',
          data: {
            datasets: [
              // ✅横線：1日目朝フェーズのみの平均値
              {
                label: '1日目朝 平均',
                data: arr1.length ? [
                  { x: 0, y: avgMorning },
                  { x: arr2.length + 2, y: avgMorning }  // ← 現在フェーズの右端より右まで引く
                ] : [],
                borderColor: 'blue',
                borderDash: [5, 5], // 破線
                pointRadius: 0,
                borderWidth: 2
              },
              // ✅ 折れ線：全体フェーズのみ
              {
                label: '全体フェーズ',
                data: arr2,
                borderColor: 'red',
                pointRadius: 0,
                spanGaps: false
              }
            ]
          },
          options: {
            responsive: true,
            scales: {
              x: {
                type: 'linear',
                display: false
              },
              y: {
                title: { display: true, text: 'BPM' }
              }
            }
          }
        });
      } else {
        const chart = charts[id];
        // //* 1日目朝平均の横線を再計算して更新
        chart.data.datasets[0].data = arr1.length ? [
          { x: 0, y: avgMorning },
          { x: arr2.length + 2, y: avgMorning }
        ] : [];
        chart.data.datasets[1].data = arr2;
        chart.update();
      }
    });
  }

  await fetchAndRender();
  setInterval(fetchAndRender, 1000);
})();
</script>
</body>
</html>
  `);
});
app.get("/graph/session/all/:sessionId", async (c) => {
  const sidParam = c.req.param("sessionId");
  const sessionId = parseInt(sidParam, 10);
  if (isNaN(sessionId)) return c.text("Invalid sessionId", 400);

  // 参加者名（初期値）と基準平均をサーバ側で埋め込み
  const parts = await prisma.participant.findMany({
    where: { sessionId },
    select: { sensorId: true, name: true }
  });
  const nameMap: Record<number, string> = {};
  parts.forEach(p => nameMap[p.sensorId] = p.name);

  const summaries = await prisma.phaseSummary.findMany({
    where: { sessionId },
    select: { sensorId: true, avgHeartRate: true }
  });
  const baseline: Record<number, number> = {};
  summaries.forEach(s => baseline[s.sensorId] = s.avgHeartRate);

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Session ${sessionId} フェーズ分離グラフ</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
  <style>
    body { font-family: Arial; padding: 20px; }
    #grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .card { border: 1px solid #ccc; border-radius: 8px; padding: 6px; }
    .card h3 { margin: 0 0 8px; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <h2>Session ${sessionId} フェーズ分離グラフ</h2>
  <button onclick="location.href='/graph'" style="margin-bottom:16px">← 戻る</button>
  <div id="grid"></div>

  <script>
  (async function(){
    const sessionId = ${sessionId};
    const nameMap = ${JSON.stringify(nameMap)};       // 初期値（以後クライアントで随時更新）
    const baseline = ${JSON.stringify(baseline)};
    const N = 10, OFFSET = 15;
    const grid = document.getElementById("grid");
    const charts = {};

    async function fetchAndRender() {
      // 0) 参加者の最新状態（isAlive/name）を取得
      let aliveSet = new Set();
      try {
        const resParts = await fetch(\`/api/participants?sessionId=\${sessionId}\`);
        if (resParts.ok) {
          const partsNow = await resParts.json(); // [{sensorId,name,isAlive},...]
          // 生存者のみ残す（isAlive undefined は true とみなす）
          aliveSet = new Set(partsNow.filter(p => p.isAlive !== false).map(p => p.sensorId));
          // 名前変更に追従
          partsNow.forEach(p => { if (p.name) nameMap[p.sensorId] = p.name; });
        }
      } catch(e) {
        console.warn("participants fetch failed", e);
      }

      // 1) フェーズログ取得
      const resPL = await fetch(\`/api/phaseLog?sessionId=\${sessionId}\`);
      const phaseLogs = resPL.ok ? await resPL.json() : [];
      const now = new Date();

      const firstPhase = phaseLogs[0];
      const pastPhases = phaseLogs.filter(log => new Date(log.startTime) <= now);
      const latestPhase = pastPhases.reduce((a, b) => new Date(a.startTime) > new Date(b.startTime) ? a : b, {});
      
      const fetchRanges = [];
      if (firstPhase?.startTime) {
        const firstEnd = firstPhase.endTime || now.toISOString();
        fetchRanges.push({ from: firstPhase.startTime, to: firstEnd });
      }
      if (latestPhase?.startTime) {
        fetchRanges.push({ from: latestPhase.startTime, to: now.toISOString() });
      }

      // 2) 心拍データ取得（1日目朝/現在フェーズ）
      const allData = [];
      for (const range of fetchRanges) {
        const res = await fetch(\`/api/heartrate?sessionId=\${sessionId}&from=\${encodeURIComponent(range.from)}&to=\${encodeURIComponent(range.to)}\`);
        if (!res.ok) continue;
        const { data } = await res.json();
        allData.push(data || []);
      }
      // ガード（範囲が2つ無ければ安全に抜ける）
      if (allData.length === 0) return;

      // 3) フェーズ毎にグルーピング [arr1(arr for 1st), arr2(arr for latest)]
      const phaseDataMap = {};
      [0, 1].forEach(i => {
        (allData[i] || []).forEach(pt => {
          if (!phaseDataMap[pt.id]) phaseDataMap[pt.id] = [[], []];
          phaseDataMap[pt.id][i].push({
            x: phaseDataMap[pt.id][i].length,  // インデックスx
            y: pt.Heart_Rate
          });
        });
      });

      // 4) 生存者のみ表示・更新
      const visibleIds = [];
      Object.entries(phaseDataMap).forEach(([idStr, [arr1, arr2]]) => {
        const id = parseInt(idStr, 10);
        if (!aliveSet.has(id)) return;        // ★ 死亡はスキップ
        visibleIds.push(id);
        const recent = arr2.slice(-N);
        const sum = recent.reduce((a, p) => a + p.y, 0);
        const currentAvg = recent.length ? sum / recent.length : 0;

        // ★ 初日の朝(最初フェーズ=arr1)の平均を算出し、横一本線として表示
        const avgMorning = arr1.length ? (arr1.reduce((a, p) => a + p.y, 0) / arr1.length) : 0;

        const header = \`\${nameMap[id] || 'ID:' + id} — 1日目朝平均:\${avgMorning.toFixed(1)} BPM  今(\${N}件):\${currentAvg.toFixed(1)} BPM\`;

        let card = document.getElementById("card-" + id);
        if (!card) {
          card = document.createElement("div");
          card.className = "card";
          card.id = "card-" + id;
          card.innerHTML = \`
            <h3>\${header}</h3>
            <canvas id="chart-\${id}" width="400" height="200"></canvas>\`;
          grid.appendChild(card);
        } else {
          card.querySelector("h3").textContent = header;
        }

        const ctx = document.getElementById("chart-" + id).getContext("2d");
        if (!charts[id]) {
        charts[id] = new Chart(ctx, {
          type: 'line',
          data: {
            datasets: [
              // ★ 初日平均の横線（2点で水平線にする）
              {
                label: '1日目朝 平均',
                data: arr1.length ? [
                  { x: 0, y: avgMorning },
                  { x: arr2.length + 2, y: avgMorning }
                ] : [],
                borderColor: 'blue',
                borderDash: [5, 5],
                pointRadius: 0,
                borderWidth: 2
              },
              // 現在フェーズの折れ線
              {
                label: '現在フェーズ',
                data: arr2,
                borderColor: 'red',
                pointRadius: 0,
                spanGaps: false
              }
            ]
          },
          options: {
            responsive: true,
            scales: {
              x: { type: 'linear', display: false },
              y: { title: { display: true, text: 'BPM' } }
            }
          }
        });
        } else {
        const chart = charts[id];
        // 横線の長さは「現在フェーズの点数 + 2」に合わせて毎回引き直す
        chart.data.datasets[0].data = arr1.length ? [
          { x: 0, y: avgMorning },
          { x: arr2.length + 2, y: avgMorning }
        ] : [];
        chart.data.datasets[1].data = arr2;
        chart.update();
        }
      });

      // 5) 可視対象から外れた（=死亡/未データ）カードは破棄
      Object.keys(charts).map(Number).forEach(id => {
        if (!visibleIds.includes(id)) {
          charts[id].destroy();
          delete charts[id];
          document.getElementById("card-" + id)?.remove();
        }
      });
    }

    await fetchAndRender();
    setInterval(fetchAndRender, 1000);
  })();
  </script>
</body>
</html>
  `);
});
/*app.get("/graph/session/test/:sessionId", async (c) => {
  const sidParam = c.req.param("sessionId");
  const sessionId = parseInt(sidParam, 10);
  if (isNaN(sessionId)) return c.text("Invalid sessionId", 400);

  const parts = await prisma.participant.findMany({
    where: { sessionId },
    select: { sensorId: true, name: true }
  });
  const nameMap: Record<number, string> = {};
  parts.forEach(p => nameMap[p.sensorId] = p.name);

  const summaries = await prisma.phaseSummary.findMany({
    where: { sessionId },
    select: { sensorId: true, avgHeartRate: true }
  });
  const baseline: Record<number, number> = {};
  summaries.forEach(s => baseline[s.sensorId] = s.avgHeartRate);

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Session ${sessionId} フェーズ分離グラフ</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
  <style>
    body { font-family: Arial; padding: 20px; }
    #grid { display: grid;   grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));  gap: 16px; }
    .card { border: 1px solid #ccc; border-radius: 8px; padding: 6px; }
    .card h3 { margin: 0 0 8px; font-size: 8px; text-align: center; }
  </style>
</head>
<body>
  <h2>Session ${sessionId} フェーズ分離グラフ</h2>
  <button onclick="location.href='/graph'" style="margin-bottom:16px">← 戻る</button>
  <div id="grid"></div>

  <script>
(async function(){
  const sessionId = ${sessionId};
  const nameMap = ${JSON.stringify(nameMap)};
  const baseline = ${JSON.stringify(baseline)};
  const N = 10, OFFSET = 15;
  const grid = document.getElementById("grid");
  const charts = {};

  async function fetchAndRender() {
    const resPL = await fetch(\`/api/phaseLog?sessionId=\${sessionId}\`);
    const phaseLogs = resPL.ok ? await resPL.json() : [];
    const now = new Date();

    const firstPhase = phaseLogs[0];
    const pastPhases = phaseLogs.filter(log => new Date(log.startTime) <= now);
    const latestPhase = pastPhases.reduce((a, b) => new Date(a.startTime) > new Date(b.startTime) ? a : b);

    const fetchRanges = [];
    if (firstPhase?.startTime) {
      const firstEnd = firstPhase.endTime || now.toISOString();
      fetchRanges.push({ from: firstPhase.startTime, to: firstEnd });
    }
    if (latestPhase?.startTime) {
      fetchRanges.push({ from: latestPhase.startTime, to: now.toISOString() });
    }

    let allData = [];
    for (const range of fetchRanges) {
      const res = await fetch(\`/api/heartrate?sessionId=\${sessionId}&from=\${encodeURIComponent(range.from)}&to=\${encodeURIComponent(range.to)}\`);
      if (!res.ok) continue;
      const { data } = await res.json();
      allData.push(data);
    }

    const phaseDataMap = {};
    [0, 1].forEach(i => {
      allData[i].forEach((pt, idx) => {
        if (!phaseDataMap[pt.id]) phaseDataMap[pt.id] = [[], []];
        phaseDataMap[pt.id][i].push({
          x: phaseDataMap[pt.id][i].length,  // インデックスをx軸に
          y: pt.Heart_Rate
        });
      });
    });

    Object.entries(phaseDataMap).forEach(([idStr, [arr1, arr2]]) => {
      const id = parseInt(idStr, 10);
      const recent = arr2.slice(-N);
      const sum = recent.reduce((a, p) => a + p.y, 0);
      const currentAvg = recent.length ? sum / recent.length : 0;
      const base = baseline[id] || 0;
      const threshold = base + OFFSET;
      const deltas = recent.map(p => p.y - threshold).filter(d => d > 0);
      const maxDelta = deltas.length ? Math.max(...deltas) : 1;
      const header = \`\${nameMap[id] || 'ID:' + id} — 基準:\${base.toFixed(1)} BPM 今(\${N}件):\${currentAvg.toFixed(1)} BPM\`;

      let card = document.getElementById("card-" + id);
      if (!card) {
        card = document.createElement("div");
        card.className = "card";
        card.id = "card-" + id;
        card.innerHTML = \`
          <h3>\${header}</h3>
          <canvas id="chart-\${id}" width="400" height="200"></canvas>\`;
        grid.appendChild(card);
      } else {
        card.querySelector("h3").textContent = header;
      }

      const ctx = document.getElementById("chart-" + id).getContext("2d");
      if (!charts[id]) {
        charts[id] = new Chart(ctx, {
          type: 'line',
          data: {
            datasets: [
              {
                label: '1日目朝',
                data: arr1,
                borderColor: 'blue',
                pointRadius: 0,
                spanGaps: false
              },
              {
                label: '現在フェーズ',
                data: arr2,
                borderColor: 'red',
                pointRadius: 0,
                spanGaps: false
              }
            ]
          },
          options: {
            responsive: true,
            scales: {
              x: {
                type: 'linear',    // ★ 時間ではなく線形
                display: false     // ラベルは非表示
              },
              y: {
                title: { display: true, text: 'BPM' }
              }
            }
          }
        });
      } else {
        const chart = charts[id];
        chart.data.datasets[0].data = arr1;
        chart.data.datasets[1].data = arr2;
        chart.update();
      }
    });
  }

  await fetchAndRender();
  setInterval(fetchAndRender, 1000);
})();
</script>
</body>
</html>
  `);
});*/
/*1日目の朝のグラフを表示now*/
// app.get("/graph/session/division/:sessionId", async (c) => {
//   const sidParam = c.req.param("sessionId");
//   const sessionId = parseInt(sidParam, 10);
//   if (isNaN(sessionId)) return c.text("Invalid sessionId", 400);

//   // 参加者の名前マップ
//   const parts = await prisma.participant.findMany({
//     where: { sessionId },
//     select: { sensorId: true, name: true }
//   });
//   const nameMap: Record<number,string> = {};
//   parts.forEach(p => nameMap[p.sensorId] = p.name);

//   // PhaseSummary の基準平均取得
//   const summaries = await prisma.phaseSummary.findMany({
//     where: { sessionId },
//     select: { sensorId: true, avgHeartRate: true }
//   });
//   const baseline: Record<number, number> = {};
//   summaries.forEach(s => baseline[s.sensorId] = s.avgHeartRate);

//   return c.html(`
// <!DOCTYPE html>
// <html lang="ja">
// <head>
//   <meta charset="UTF-8">
//   <title>Session ${sessionId} 分割グラフ（閾値背景）</title>
//   <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
//   <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
//   <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@1.1.0"></script>
//   <style>
//     body{font-family:Arial;padding:20px}
//     #grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
//     .card{border:1px solid #ccc;border-radius:8px;padding:12px}
//     .card h3{margin:0 0 8px;font-size:16px;text-align:center}
//   </style>
// </head>
// <body>
//   <h2>Session ${sessionId} の分割グラフ（閾値背景）</h2>
//   <button onclick="location.href='/graph'" style="margin-bottom:16px">← 戻る</button>
//   <div id="grid"></div>

//   <script>
//   (async function(){
//     const sessionId = ${sessionId};
//     const nameMap   = ${JSON.stringify(nameMap)};
//     const baseline  = ${JSON.stringify(baseline)};
//     const grid      = document.getElementById("grid");
//     const charts    = {};
//     const N = 10;     // 最新Nサンプル平均
//     const OFFSET = 15; // 基準＋OFFSETを閾値に

//     // プラグイン定義
//     const thresholdBgPlugin = {
//       id: 'thresholdBg',
//       afterDraw: (chart, args, options) => {
//         const { ctx, chartArea:{top,bottom}, scales:{x} } = chart;
//         const threshold = options.threshold;
//         const maxDelta  = options.maxDelta;
//         const data = chart.data.datasets[0].data;
//         let startIdx = null;
//         data.forEach((pt,i) => {
//           if (pt.y > threshold && startIdx === null) {
//             startIdx = i;
//           }
//           if ((pt.y <= threshold || i === data.length-1) && startIdx !== null) {
//             const endIdx = (pt.y>threshold && i===data.length-1)? i : i-1;
//             const delta = data[startIdx].y - threshold;
//             const alpha = Math.min(delta / maxDelta, 1) * 0.5;
//             const x0 = x.getPixelForValue(data[startIdx].x);
//             const x1 = x.getPixelForValue(data[endIdx].x);
//             ctx.save();
//             ctx.fillStyle = \`rgba(255,0,0,\${alpha})\`;
//             ctx.fillRect(x0, top, x1-x0, bottom-top);
//             ctx.restore();
//             startIdx = null;
//           }
//         });
//       }
//     };
//     Chart.register(thresholdBgPlugin);

//     async function fetchAndRender(){
//       // ⇒ **毎回フェーズログを再取得**
//       const resPL = await fetch(\`/api/phaseLog?sessionId=\${sessionId}\`);
//       const phaseLogs = resPL.ok ? await resPL.json() : [];

//       // annotationConfig 作成
//       const annotationConfig = {};
//       phaseLogs.forEach((log,idx)=>{
//         if (!log.endTime) return;
//         annotationConfig['line'+idx] = {
//           type:'line',
//           xMin:new Date(log.endTime),
//           xMax:new Date(log.endTime),
//           borderColor:'rgba(255,99,132,0.8)',
//           borderWidth:2,
//           label:{
//             content: log.gamePhase ,
//             enabled:true,position:'start',
//             backgroundColor:'rgba(255,99,132,0.2)',color:'#000'
//           }
//         };
//       });

//       // データ取得: sessionStart～now
//       const sessionStart = phaseLogs.length
//         ? phaseLogs[0].startTime
//         : new Date().toISOString();
//       const nowISO = new Date().toISOString();
//       const res = await fetch(\`/api/heartrate?sessionId=\${sessionId}&from=\${encodeURIComponent(sessionStart)}&to=\${encodeURIComponent(nowISO)}\`);
//       if (!res.ok) return;
//       const { data } = await res.json();

//       // ID毎にグループ化
//       const groups = {};
//       data.forEach(pt=>{
//         if (!groups[pt.id]) groups[pt.id] = [];
//         groups[pt.id].push({ x:new Date(pt.Timestamp), y:pt.Heart_Rate });
//       });

//       // stats 配列生成
//       const stats = Object.entries(groups).map(([idStr,arr])=>{
//         const id = parseInt(idStr,10);
//         const recent = arr.slice(-N);
//         const sum = recent.reduce((a,p)=>a+p.y,0);
//         const currentAvg = recent.length? sum/recent.length: 0;
//         const base = baseline[id]||0;
//         const threshold = base + OFFSET;
//         const deltas = recent.map(p=>p.y-threshold).filter(d=>d>0);
//         const maxDelta = deltas.length? Math.max(...deltas) : 1;
//         const header = \`\${nameMap[id]||'ID:'+id} — 基準:\${base.toFixed(1)} BPM 今(\${N}件):\${currentAvg.toFixed(1)} BPM\`;
//         return { id, arr, header, threshold, maxDelta };
//       });
//       // 差分順ソート
//       //stats.sort((a,b)=>b.maxDelta - a.maxDelta);

//       // 不要チャート破棄
//       const currentIds = stats.map(s=>s.id);
//       Object.keys(charts).map(i=>+i).forEach(id=>{
//         if (!currentIds.includes(id)) {
//           charts[id].destroy();
//           delete charts[id];
//           document.getElementById("card-"+id)?.remove();
//         }
//       });

//       // カード＆チャート生成 or 更新
//       stats.forEach(stat=>{
//         const {id,arr,header,threshold,maxDelta} = stat;
//         let card = document.getElementById("card-"+id);
//         if (!card) {
//           card = document.createElement("div");
//           card.className = "card";
//           card.id = "card-"+id;
//           card.innerHTML = \`
//             <h3>\${header}</h3>
//             <canvas id="chart-\${id}" width="400" height="200"></canvas>\`;
//           grid.appendChild(card);
//         } else {
//           card.querySelector("h3").textContent = header;
//           grid.appendChild(card);
//         }
//         const ctx = document.getElementById("chart-"+id).getContext("2d");
//         if (!charts[id]) {
//           charts[id] = new Chart(ctx, {
//             type:'line',
//             data:{ datasets:[{ label:header, data:arr, fill:false, borderColor:\`hsl(\${(id*137)%360},100%,50%)\`, spanGaps:true }]},
//             options:{
//               responsive:true,
//               plugins:{
//                 annotation:{ annotations:annotationConfig },
//                 thresholdBg:{ threshold, maxDelta }
//               },
//               elements: {
//                 point: { radius: 0 }  // ← ★ ここで点をなくす
//               },
//               scales:{
//                 x:{ type:'time', time:{unit:'minute'}, title:{display:true,text:'Time'} },
//                 y:{ title:{display:true,text:'BPM'} }
//               }
//             }
//           });
//         } else {
//           const chart = charts[id];
//           chart.data.datasets[0].data = arr;
//           chart.data.datasets[0].label = header;
//           chart.options.plugins.annotation.annotations = annotationConfig;
//           chart.options.plugins.thresholdBg.threshold = threshold;
//           chart.options.plugins.thresholdBg.maxDelta  = maxDelta;
//           chart.update();
//         }
//       });
//     }

//     await fetchAndRender();
//     setInterval(fetchAndRender, 1000);
//   })();
//   </script>
// </body>
// </html>
//   `);
// });
// app.get("/graph/session/now/:sessionId", async (c) => {
//   const sidParam = c.req.param("sessionId");
//   const sessionId = parseInt(sidParam, 10);
//   if (isNaN(sessionId)) return c.text("Invalid sessionId", 400);

//   const parts = await prisma.participant.findMany({
//     where: { sessionId },
//     select: { sensorId: true, name: true }
//   });
//   const nameMap: Record<number, string> = {};
//   parts.forEach(p => nameMap[p.sensorId] = p.name);

//   const summaries = await prisma.phaseSummary.findMany({
//     where: { sessionId },
//     select: { sensorId: true, avgHeartRate: true }
//   });
//   const baseline: Record<number, number> = {};
//   summaries.forEach(s => baseline[s.sensorId] = s.avgHeartRate);

//   return c.html(`
// <!DOCTYPE html>
// <html lang="ja">
// <head>
//   <meta charset="UTF-8">
//   <title>Session ${sessionId} フェーズ分離グラフ</title>
//   <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
//   <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
//   <style>
//     body { font-family: Arial; padding: 20px; }
//     #grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
//     .card { border: 1px solid #ccc; border-radius: 8px; padding: 12px; }
//     .card h3 { margin: 0 0 8px; font-size: 16px; text-align: center; }
//   </style>
// </head>
// <body>
//   <h2>Session ${sessionId} フェーズ分離グラフ</h2>
//   <button onclick="location.href='/graph'" style="margin-bottom:16px">← 戻る</button>
//   <div id="grid"></div>

//   <script>
// (async function(){
//   const sessionId = ${sessionId};
//   const nameMap = ${JSON.stringify(nameMap)};
//   const baseline = ${JSON.stringify(baseline)};
//   const N = 10, OFFSET = 15;
//   const grid = document.getElementById("grid");
//   const charts = {};

//   async function fetchAndRender() {
//     const resPL = await fetch(\`/api/phaseLog?sessionId=\${sessionId}\`);
//     const phaseLogs = resPL.ok ? await resPL.json() : [];
//     const now = new Date();

//     const firstPhase = phaseLogs[0];
//     const pastPhases = phaseLogs.filter(log => new Date(log.startTime) <= now);
//     const latestPhase = pastPhases.reduce((a, b) => new Date(a.startTime) > new Date(b.startTime) ? a : b);

//     const fetchRanges = [];
//     if (firstPhase?.startTime) {
//       const firstEnd = firstPhase.endTime || now.toISOString();
//       fetchRanges.push({ from: firstPhase.startTime, to: firstEnd });
//     }
//     if (latestPhase?.startTime) {
//       fetchRanges.push({ from: latestPhase.startTime, to: now.toISOString() });
//     }

//     let allData = [];
//     for (const range of fetchRanges) {
//       const res = await fetch(\`/api/heartrate?sessionId=\${sessionId}&from=\${encodeURIComponent(range.from)}&to=\${encodeURIComponent(range.to)}\`);
//       if (!res.ok) continue;
//       const { data } = await res.json();
//       allData.push(data);
//     }

//     const phaseDataMap = {};
//     [0, 1].forEach(i => {
//       allData[i].forEach((pt, idx) => {
//         if (!phaseDataMap[pt.id]) phaseDataMap[pt.id] = [[], []];
//         phaseDataMap[pt.id][i].push({
//           x: phaseDataMap[pt.id][i].length,  // インデックスをx軸に
//           y: pt.Heart_Rate
//         });
//       });
//     });

//     Object.entries(phaseDataMap).forEach(([idStr, [arr1, arr2]]) => {
//       const id = parseInt(idStr, 10);
//       const recent = arr2.slice(-N);
//       const sum = recent.reduce((a, p) => a + p.y, 0);
//       const currentAvg = recent.length ? sum / recent.length : 0;
//       const base = baseline[id] || 0;
//       const threshold = base + OFFSET;
//       const deltas = recent.map(p => p.y - threshold).filter(d => d > 0);
//       const maxDelta = deltas.length ? Math.max(...deltas) : 1;
//       const header = \`\${nameMap[id] || 'ID:' + id} — 基準:\${base.toFixed(1)} BPM 今(\${N}件):\${currentAvg.toFixed(1)} BPM\`;

//       let card = document.getElementById("card-" + id);
//       if (!card) {
//         card = document.createElement("div");
//         card.className = "card";
//         card.id = "card-" + id;
//         card.innerHTML = \`
//           <h3>\${header}</h3>
//           <canvas id="chart-\${id}" width="400" height="200"></canvas>\`;
//         grid.appendChild(card);
//       } else {
//         card.querySelector("h3").textContent = header;
//       }

//       const ctx = document.getElementById("chart-" + id).getContext("2d");
//       if (!charts[id]) {
//         charts[id] = new Chart(ctx, {
//           type: 'line',
//           data: {
//             datasets: [
//               // ✅ 横線：1日目朝の平均値
//               {
//                 label: '1日目朝 平均',
//                 data: arr1.length ? [
//                   { x: 0, y: base },
//                   { x: arr2.length + 2, y: base }  // ← 現在フェーズの右端より右まで引く
//                 ] : [],
//                 borderColor: 'blue',
//                 borderDash: [5, 5], // 破線
//                 pointRadius: 0,
//                 borderWidth: 2
//               },
//               // ✅ 折れ線：現在フェーズのみ
//               {
//                 label: '現在フェーズ',
//                 data: arr2,
//                 borderColor: 'red',
//                 pointRadius: 0,
//                 spanGaps: false
//               }
//             ]
//           },
//           options: {
//             responsive: true,
//             scales: {
//               x: {
//                 type: 'linear',
//                 display: false
//               },
//               y: {
//                 title: { display: true, text: 'BPM' }
//               }
//             }
//           }
//         });
//       } else {
//         const chart = charts[id];
//         chart.data.datasets[0].data = arr1;
//         chart.data.datasets[1].data = arr2;
//         chart.update();
//       }
//     });
//   }

//   await fetchAndRender();
//   setInterval(fetchAndRender, 1000);
// })();
// </script>
// </body>
// </html>
//   `);
// });



//api設計

/* ==============================
// 検証用UI: /difference_heatrate（参加者名対応）
//  - セッション選択 → /api/phaseLog と /api/participants を読み込み
//  - センサー選択の <option> に「sensorId - 参加者名」を表示
//  - /api/avg-range を叩いて結果表示（結果にも参加者名を表示）
// ==============================*/
app.get("/difference_heatrate", async (c) => {
  const sessions = await prisma.phaseLog.findMany({
    distinct: ["sessionId"],
    select: { sessionId: true },
    orderBy: { sessionId: "asc" }
  });

  const sessionOptions = sessions
    .map(s => `<option value="${s.sessionId}">${s.sessionId}</option>`)
    .join("");

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>差分検証 - difference_heatrate</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    h2 { margin: 0 0 12px; }
    .row { margin: 8px 0; display: flex; gap: 8px; align-items: center; }
    label { min-width: 120px; display: inline-block; }
    select, input { padding: 4px 8px; }
    button { padding: 6px 12px; cursor: pointer; }
    #result { margin-top: 16px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; }
    .muted { color: #666; font-size: 12px; }
    .error { color: #b00020; }
  </style>
</head>
<body>
  <h2>範囲平均と「1日目朝」平均との差分（検証用）</h2>

  <div class="row">
    <label>セッションID:</label>
    <select id="sessionId">${sessionOptions}</select>
    <button id="loadData">フェーズ/参加者 読込</button>
  </div>

  <div class="row">
    <label>センサー（参加者名）:</label>
    <select id="sensorId"></select>
  </div>

  <div class="row">
    <label>開始フェーズ:</label>
    <select id="fromPhase"></select>
  </div>

  <div class="row">
    <label>終了フェーズ:</label>
    <select id="toPhase"></select>
  </div>

  <div class="row">
    <button id="run">計算</button>
  </div>

  <div id="result">
    <div class="muted">ここに結果が表示されます</div>
  </div>

  <script>
    const el = (id) => document.getElementById(id);
    const fmt = (v) => (v==null || Number.isNaN(v)) ? '-' : Number(v).toFixed(2);

    // フェーズと参加者を読み込む
    el("loadData").onclick = async () => {
      const sid = el("sessionId").value;
      if (!sid) return alert("セッションIDを選択してください");

      // 1) フェーズ一覧
      const resPhase = await fetch(\`/api/phaseLog?sessionId=\${sid}\`);
      if (!resPhase.ok) {
        el("result").innerHTML = '<div class="error">/api/phaseLog の取得に失敗しました</div>';
        return;
      }
      const logs = await resPhase.json();
      const phaseOpts = logs.map(log =>
        \`<option value="\${log.gameDate}-\${log.gamePhase}">\${log.gameDate} \${log.gamePhase}</option>\`
      ).join("");
      el("fromPhase").innerHTML = phaseOpts;
      el("toPhase").innerHTML = phaseOpts;

      // 2) 参加者一覧
      const resPart = await fetch(\`/api/participants?sessionId=\${sid}\`);
      if (!resPart.ok) {
        el("result").innerHTML = '<div class="error">/api/participants の取得に失敗しました</div>';
        return;
      }
      const participants = await resPart.json();

      // 「sensorId - name」形式に整形
      const sensorOpts = participants.map(p => {
        const label = p.name ? \`\${p.sensorId} - \${p.name}\` : String(p.sensorId);
        return \`<option value="\${p.sensorId}" data-name="\${p.name || ''}">\${label}</option>\`;
      }).join("");
      el("sensorId").innerHTML = sensorOpts;

      el("result").innerHTML = '<div class="muted">フェーズとセンサーを選んで「計算」を押してください</div>';
    };

    // 計算実行
    el("run").onclick = async () => {
      const sessionId = el("sessionId").value;
      const sensorSel = el("sensorId");
      const sensorId  = sensorSel.value;
      const pname     = sensorSel.selectedOptions[0]?.dataset?.name || '';
      const fromPhase = el("fromPhase").value;
      const toPhase   = el("toPhase").value;

      if (!sessionId || !sensorId || !fromPhase || !toPhase) {
        alert("すべての項目を選択してください");
        return;
      }

      const q = new URLSearchParams({ sessionId, sensorId, fromPhase, toPhase }).toString();
      const res = await fetch('/api/avg-range?' + q);
      const data = await res.json();

      if (!res.ok) {
        el('result').innerHTML = \`<div class="error">エラー: \${data.error || res.statusText}</div>\`;
        return;
      }

      const { period, rangeAvg, baselineAvg, delta, count } = data;
      const namePart = pname ? \`（\${pname}）\` : '';
      el('result').innerHTML = \`
        <div><b>セッション:</b> \${sessionId} / <b>センサー:</b> \${sensorId} \${namePart}</div>
        <div><b>期間:</b> \${period.start} ～ \${period.end}</div>
        <div style="margin-top:8px;">
          <div>範囲平均: <b>\${fmt(rangeAvg)}</b></div>
          <div>1日目朝 平均: <b>\${fmt(baselineAvg)}</b></div>
          <div>差分 (範囲 − 朝): <b>\${fmt(delta)}</b></div>
          <div>レコード数: <b>\${count}</b></div>
        </div>
      \`;
    };
  </script>
</body>
</html>
  `);
});
app.get("/difference_export", async (c) => {
  // セッション一覧
  const sessions = await prisma.phaseLog.findMany({
    distinct: ["sessionId"],
    select: { sessionId: true },
    orderBy: { sessionId: "asc" }
  });

  const sessionOptions = sessions
    .map(s => `<option value="${s.sessionId}">${s.sessionId}</option>`)
    .join("");

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<title>差分エクスポート</title>
<style>
body { font-family: Arial, sans-serif; padding: 20px; }
.row { margin: 6px 0; }
label { min-width: 100px; display:inline-block; }
table { border-collapse: collapse; margin-top: 12px; }
td, th { border: 1px solid #ccc; padding: 4px 8px; }
select { min-width: 120px; }
</style>
</head>
<body>
  <h2>差分エクスポート（全員分）</h2>

  <div class="row">
    <label>セッションID:</label>
    <select id="sessionId">${sessionOptions}</select>
    <button id="load">読込</button>
  </div>

  <form id="exportForm" method="POST" action="/api/export-difference">
    <input type="hidden" name="sessionId" id="formSessionId" />
    <table id="participantsTable">
      <thead>
        <tr>
          <th>SensorID</th>
          <th>Name</th>
          <th>開始フェーズ</th>
          <th>終了フェーズ</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
    <div class="row">
      <button type="submit">エクスポート</button>
    </div>
  </form>

<script>
const el = (id) => document.getElementById(id);

document.getElementById("load").onclick = async () => {
  const sid = el("sessionId").value;
  if (!sid) return alert("セッションを選んでください");
  el("formSessionId").value = sid;

  // 参加者取得
  const resP = await fetch("/api/participants?sessionId=" + sid);
  const participants = await resP.json();

  // フェーズ一覧取得
  const resF = await fetch("/api/phaseLog?sessionId=" + sid);
  const phases = await resF.json();
  const opts = phases.map((p, i) =>
    \`<option value="\${p.gameDate}-\${p.gamePhase}"\${i === 1 ? "selected" : ""}>\${p.gameDate} \${p.gamePhase}</option>\`
  ).join("");

  // テーブル描画
  const tbody = el("participantsTable").querySelector("tbody");
  tbody.innerHTML = participants.map(p => \`
    <tr>
      <td>\${p.sensorId}<input type="hidden" name="sensorId" value="\${p.sensorId}" /></td>
      <td>\${p.name || ""}<input type="hidden" name="name" value="\${p.name || ""}" /></td>
      <td><select name="fromPhase">\${opts}</select></td>
      <td><select name="toPhase">\${opts}</select></td>
    </tr>
  \`).join("");
};
</script>
</body>
</html>
  `);
});


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
    where: { sessionId: sid },
    orderBy: { startTime: "asc" },
    select: {
      gameDate:  true,
      gamePhase: true,
      startTime: true,    // ← 追加
      endTime:   true
    },
  });
  return c.json(logs);
});
app.get("/api/phaseSummary", async (c) => {
  const sid = parseInt(c.req.query("sessionId") || "", 10);
  if (isNaN(sid)) return c.text("Invalid sessionId", 400);
  const sums = await prisma.phaseSummary.findMany({
    where: { sessionId: sid },
    select: { sensorId: true, avgHeartRate: true }
  });
  return c.json(sums);
});
app.get("/api/participants", async (c) => {
  const sid = parseInt(c.req.query("sessionId") || "", 10);
  if (isNaN(sid)) return c.text("Invalid sessionId", 400);

  const participants = await prisma.participant.findMany({
    where: { sessionId: sid },
    select: { sensorId: true, name: true, isAlive: true } // ✅ isAlive を追加
  });
  // 例: [ { sensorId: 1, name: "太郎", isAlive: true }, ... ]
  return c.json(participants);
});

app.post("/api/phaseSummary", async (c) => {
  try {
    const { sessionId, gameDate, gamePhase } = await c.req.json();
    if (
      typeof sessionId !== "number" ||
      typeof gameDate !== "string" ||
      typeof gamePhase !== "string"
    ) {
      return c.text("Invalid parameters", 400);
    }

    // 1) フェーズログを探す
    const log = await prisma.phaseLog.findFirst({
      where: { sessionId, gameDate, gamePhase, endTime: { not: null } },
    });
    if (!log) return c.text("PhaseLog not found or not finished yet", 404);

    // 2) 期間内の平均をセンサーIDごとに計算
    const groups = await prisma.csvData.groupBy({
      by: ["id"],
      where: {
        Timestamp: {
          gte: log.startTime,
          lte: log.endTime!,
        },
      },
      _avg: { Heart_Rate: true },
    });

    // 3) findFirst→update or create で保存
    const ops = groups
      .filter(g => g._avg.Heart_Rate !== null)
      .map(async g => {
        const existing = await prisma.phaseSummary.findFirst({
          where: {
            sessionId,
            sensorId: g.id,
            gameDate,
            gamePhase,
          }
        });
        if (existing) {
          // 更新
          return prisma.phaseSummary.update({
            where: { id: existing.id },
            data: {
              avgHeartRate: g._avg.Heart_Rate!,
              createdAt: new Date()
            }
          });
        } else {
          // 新規作成
          return prisma.phaseSummary.create({
            data: {
              sessionId,
              sensorId:     g.id,
              gameDate,
              gamePhase,
              avgHeartRate: g._avg.Heart_Rate!
            }
          });
        }
      });

    const results = await Promise.all(ops);
    return c.json({ success: true, count: results.length });
  } catch (e) {
    console.error(e);
    return c.text("Internal server error", 500);
  }
});
// * 変更：isAlive も返す //* 
app.get("/api/participants", async (c) => {
  const sid = parseInt(c.req.query("sessionId") || "", 10);
  if (isNaN(sid)) return c.text("Invalid sessionId", 400);

  const participants = await prisma.participant.findMany({
    where: { sessionId: sid },
    select: { sensorId: true, name: true, isAlive: true } // //* 追加
  });
  return c.json(participants);
});
app.get("/api/phase-options", async (c) => {
  const sid = parseInt(c.req.query("sessionId") || "", 10);
  if (isNaN(sid)) return c.text("Invalid sessionId", 400);

  const logs = await prisma.phaseLog.findMany({
    where: { sessionId: sid },
    orderBy: { startTime: "asc" },
    select: { gameDate: true, gamePhase: true, sessionId: true }
  });

  // 「1日目朝-議論」みたいなラベルを作って返す
  const options = logs.map(log => ({
    value: `${log.gameDate}-${log.gamePhase}`,
    label: `${log.gameDate} ${log.gamePhase}`,
    sessionId: log.sessionId
  }));

  return c.json(options);
});
app.get("/api/avg-range", async (c) => {
  const sessionId = c.req.query("sessionId");
  const sensorId  = c.req.query("sensorId");
  const fromPhase = c.req.query("fromPhase");
  const toPhase   = c.req.query("toPhase");

  if (!sessionId || !sensorId || !fromPhase || !toPhase) {
    return c.json({ error: "sessionId, sensorId, fromPhase, toPhase は必須です" }, 400);
  }

  // "1日目朝-議論" のようなキーを分解
  function parsePhaseKey(key: string) {
    const idx = key.lastIndexOf("-");
    return { gameDate: key.slice(0, idx), gamePhase: key.slice(idx + 1) };
  }
  const from = parsePhaseKey(fromPhase);
  const to   = parsePhaseKey(toPhase);

  // PhaseLog から範囲を取得（セッションID込み）
  const fromLog = await prisma.phaseLog.findFirst({
    where: { sessionId: Number(sessionId), gameDate: from.gameDate, gamePhase: from.gamePhase },
    orderBy: { startTime: "asc" }
  });
  const toLog = await prisma.phaseLog.findFirst({
    where: { sessionId: Number(sessionId), gameDate: to.gameDate, gamePhase: to.gamePhase },
    orderBy: { startTime: "asc" }
  });

  if (!fromLog || !toLog) {
    return c.json({ error: "指定フェーズが見つかりません" }, 404);
  }

  const start = new Date(fromLog.startTime);
  const end   = toLog.endTime ? new Date(toLog.endTime) : new Date();

  // 指定範囲の心拍データ
  const rows = await prisma.csvData.findMany({
    where: {
      id: Number(sensorId),
      Timestamp: { gte: start, lte: end }
    },
    select: { Heart_Rate: true }
  });
  const rangeAvg = rows.length
    ? rows.reduce((a, r) => a + r.Heart_Rate, 0) / rows.length
    : null;

  // === ベースライン ===
  // セッション内で一番最初に登録された PhaseLog を取得
  const firstLog = await prisma.phaseLog.findFirst({
    where: { sessionId: Number(sessionId) },
    orderBy: { startTime: "asc" }
  });

  let baselineAvg: number | null = null;
  if (firstLog) {
    const baseStart = new Date(firstLog.startTime);
    const baseEnd   = firstLog.endTime ? new Date(firstLog.endTime) : new Date();

    const baseRows = await prisma.csvData.findMany({
      where: {
        id: Number(sensorId),
        Timestamp: { gte: baseStart, lte: baseEnd }
      },
      select: { Heart_Rate: true }
    });
    baselineAvg = baseRows.length
      ? baseRows.reduce((a, r) => a + r.Heart_Rate, 0) / baseRows.length
      : null;
  }

  return c.json({
    sessionId: Number(sessionId),
    sensorId: Number(sensorId),
    period: { from: fromPhase, to: toPhase, start, end },
    rangeAvg,
    baselineAvg,
    delta: (rangeAvg != null && baselineAvg != null) ? rangeAvg - baselineAvg : null,
    count: rows.length
  });
});
app.get("/api/export-session", async (c) => {
  const sid = parseInt(c.req.query("sessionId") || "", 10);
  if (isNaN(sid)) return c.text("Invalid sessionId", 400);

  // 参加者一覧（sensorId と名前）
  const participants = await prisma.participant.findMany({
    where: { sessionId: sid },
    select: { sensorId: true, name: true }
  });

  if (!participants.length) {
    return c.text("No participants found", 404);
  }

  // 一番最初のフェーズ (baseline)
  const firstPhase = await prisma.phaseLog.findFirst({
    where: { sessionId: sid },
    orderBy: { startTime: "asc" }
  });
  if (!firstPhase) return c.text("No phaseLog found", 404);

  const baseStart = new Date(firstPhase.startTime);
  const baseEnd   = firstPhase.endTime ? new Date(firstPhase.endTime) : new Date();

  // その他のフェーズの範囲（baselineを除く）
  const otherPhases = await prisma.phaseLog.findMany({
    where: { sessionId: sid, id: { not: firstPhase.id } },
    orderBy: { startTime: "asc" }
  });
  const otherStart = otherPhases.length ? new Date(otherPhases[0].startTime) : null;
  const otherEnd   = otherPhases.length && otherPhases[otherPhases.length - 1].endTime
    ? new Date(otherPhases[otherPhases.length - 1].endTime!)
    : null;

  // Excel workbook
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Session_${sid}`);

  // header
  ws.addRow([
    "SessionID",
    "SensorID",
    "Name",
    "Baseline Avg (最初の区間)",
    "Other Avg (以降の区間)",
    "Delta",
    "Record Count"
  ]);

  for (const p of participants) {
    // Baseline 心拍
    const baseRows = await prisma.csvData.findMany({
      where: {
        id: p.sensorId,
        Timestamp: { gte: baseStart, lte: baseEnd }
      },
      select: { Heart_Rate: true }
    });
    const baselineAvg = baseRows.length
      ? baseRows.reduce((a, r) => a + r.Heart_Rate, 0) / baseRows.length
      : null;

    // Other 心拍
    let otherAvg: number | null = null;
    let otherCount = 0;
    if (otherStart && otherEnd) {
      const otherRows = await prisma.csvData.findMany({
        where: {
          id: p.sensorId,
          Timestamp: { gte: otherStart, lte: otherEnd }
        },
        select: { Heart_Rate: true }
      });
      otherAvg = otherRows.length
        ? otherRows.reduce((a, r) => a + r.Heart_Rate, 0) / otherRows.length
        : null;
      otherCount = otherRows.length;
    }

    const delta =
      baselineAvg != null && otherAvg != null ? otherAvg - baselineAvg : null;

    ws.addRow([
      sid,
      p.sensorId,
      p.name,
      baselineAvg,
      otherAvg,
      delta,
      otherCount
    ]);
  }

  // ファイル保存
  const filePath = `./avg_result_session_${sid}.xlsx`;
  await wb.xlsx.writeFile(filePath);

  return c.text(`Exported to ${filePath}`);
});

app.post("/api/export-difference", async (c) => {
  // ← Fetch API 準拠。formidableは不要！
  const fd = await c.req.formData();

  const sessionId = Number(fd.get("sessionId"));
  if (!Number.isFinite(sessionId)) {
    return c.text("Invalid sessionId", 400);
  }

  // 同名inputは getAll で配列取得
  const sensorIds = (fd.getAll("sensorId") as string[]).map((v) => Number(v));
  const names     = (fd.getAll("name") as string[]).map((v) => v ?? "");
  const froms     = (fd.getAll("fromPhase") as string[]).map(String);
  const tos       = (fd.getAll("toPhase") as string[]).map(String);

  // baseline: セッション内で一番早いフェーズ
  const firstPhase = await prisma.phaseLog.findFirst({
    where: { sessionId },
    orderBy: { startTime: "asc" },
  });
  if (!firstPhase) return c.text("No PhaseLog found", 404);

  const baseStart = new Date(firstPhase.startTime);
  const baseEnd   = firstPhase.endTime ? new Date(firstPhase.endTime) : new Date();

  // Excel 準備
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Session_${sessionId}`);
  ws.addRow([
    "SessionID",
    "SensorID",
    "Name",
    "Baseline Avg (最初の区間)",
    "Selected Avg (指定区間)",
    "Delta",
    "Record Count",
  ]);

  for (let i = 0; i < sensorIds.length; i++) {
    const sid     = sensorIds[i];
    const name    = names[i] ?? "";
    const fromKey = froms[i];
    const toKey   = tos[i];

    if (!Number.isFinite(sid) || !fromKey || !toKey) continue;

    // 指定フェーズ → 時刻解決（sessionIdを必ず条件に含める）
    const from = parsePhaseKey(fromKey);
    const to   = parsePhaseKey(toKey);

    const fromLog = await prisma.phaseLog.findFirst({
      where: { sessionId, gameDate: from.gameDate, gamePhase: from.gamePhase },
      orderBy: { startTime: "asc" },
    });
    const toLog = await prisma.phaseLog.findFirst({
      where: { sessionId, gameDate: to.gameDate, gamePhase: to.gamePhase },
      orderBy: { startTime: "asc" },
    });
    if (!fromLog || !toLog) {
      // 見つからない行はスキップ
      continue;
    }

    const selStart = new Date(fromLog.startTime);
    const selEnd   = toLog.endTime ? new Date(toLog.endTime) : new Date();
    if (selEnd < selStart) {
      // 逆順選択の安全弁
      const t = selStart.getTime();
      selStart.setTime(selEnd.getTime());
      selEnd.setTime(t);
    }

    // Baseline（最初の区間）
    const baseRows = await prisma.csvData.findMany({
      where: { id: sid, Timestamp: { gte: baseStart, lte: baseEnd } },
      select: { Heart_Rate: true },
    });
    const baselineAvg =
      baseRows.length
        ? baseRows.reduce((a, r) => a + Number(r.Heart_Rate || 0), 0) / baseRows.length
        : null;

    // 選択区間
    const selRows = await prisma.csvData.findMany({
      where: { id: sid, Timestamp: { gte: selStart, lte: selEnd } },
      select: { Heart_Rate: true },
    });
    const selectedAvg =
      selRows.length
        ? selRows.reduce((a, r) => a + Number(r.Heart_Rate || 0), 0) / selRows.length
        : null;

    const delta =
      baselineAvg != null && selectedAvg != null ? selectedAvg - baselineAvg : null;

    ws.addRow([
      sessionId,
      sid,
      name,
      baselineAvg,
      selectedAvg,
      delta,
      selRows.length,
    ]);
  }

  // 即ダウンロードさせる（サーバーに保存しない）
  const buffer = await wb.xlsx.writeBuffer();
  return c.newResponse(buffer as ArrayBuffer, 200, {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="export_difference_session_${sessionId}.xlsx"`,
  });
});


// index.ts に追加

// GET /api/heartrate/last5s?sessionId=xx

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
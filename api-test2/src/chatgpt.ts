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
  /*app.get("/graph/session/:sessionId", async (c) => {
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
  });*/
  app.get("/graph/session/:sessionId", async (c) => {
    const sidParam = c.req.param("sessionId");
    const sessionId = parseInt(sidParam, 10);
    if (isNaN(sessionId)) return c.text("Invalid sessionId", 400);
  
    // 参加者の名前マップ
    const parts = await prisma.participant.findMany({
      where: { sessionId },
      select: { sensorId: true, name: true }
    });
    const nameMap: Record<number,string> = {};
    parts.forEach(p => nameMap[p.sensorId] = p.name);
  
    // PhaseSummary の基準平均取得
    const summaries = await prisma.phaseSummary.findMany({
      where: { sessionId },
      select: { sensorId: true, avgHeartRate: true }
    });
    const baseline: Record<number, number> = {};
    summaries.forEach(s => baseline[s.sensorId] = s.avgHeartRate);
  
    // フェーズログ取得（annotation用・完了済み＋進行中を含む）
    const phaseLogs = await prisma.phaseLog.findMany({
      where: { sessionId },
      orderBy: { startTime: "asc" },
      select: {
        gameDate:  true,
        gamePhase: true,
        startTime: true,
        endTime:   true
      }
    });
  
    return c.html(`
  <!DOCTYPE html>
  <html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>Session ${sessionId} リアルタイム心拍グラフ</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@1.1.0"></script>
    <style>
      body { font-family: Arial; padding: 20px; }
      #grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 16px; }
      .card { border:1px solid #ccc; border-radius:8px; padding:12px; }
      .card h3 { margin:0 0 8px; font-size:16px; text-align:center; }
    </style>
  </head>
  <body>
    <h2>Session ${sessionId} のリアルタイム心拍</h2>
    <button onclick="location.href='/graph'" style="margin-bottom:16px">← グラフ選択に戻る</button>
    <div id="grid"></div>
  
    <script>
    (async function(){
      const sessionId = ${sessionId};
      const nameMap   = ${JSON.stringify(nameMap)};
      const baseline  = ${JSON.stringify(baseline)};
      const phaseLogs = ${JSON.stringify(phaseLogs)};
      const grid      = document.getElementById("grid");
      const charts    = {};
      const N = 10;            // 最新 N サンプル平均
      const OFFSET = 5;        // 閾値 = 基準 + OFFSET
  
      // プラグイン登録
      const thresholdBgPlugin = {
        id: 'thresholdBg',
        afterDraw(chart, args, options) {
          const { ctx, chartArea:{top,bottom}, scales:{x} } = chart;
          const threshold = options.threshold;
          const maxDelta  = options.maxDelta;
          const data      = chart.data.datasets[0].data;
          let startIdx = null;
          data.forEach((pt,i) => {
            if (pt.y > threshold && startIdx === null) {
              startIdx = i;
            }
            if ((pt.y <= threshold || i === data.length-1) && startIdx !== null) {
              const endIdx = (pt.y>threshold && i===data.length-1)? i : i-1;
              const delta = data[startIdx].y - threshold;
              const alpha = Math.min(delta / maxDelta, 1) * 0.5;
              const x0 = x.getPixelForValue(data[startIdx].x);
              const x1 = x.getPixelForValue(data[endIdx].x);
              ctx.save();
              ctx.fillStyle = \`rgba(255,0,0,\${alpha})\`;
              ctx.fillRect(x0, top, x1 - x0, bottom - top);
              ctx.restore();
              startIdx = null;
            }
          });
        }
      };
      Chart.register(thresholdBgPlugin);
  
      async function fetchAndRender() {
        // 1) annotationConfig
        const annotationConfig = {};
        phaseLogs.forEach((log, idx) => {
          if (!log.endTime) return;
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
  
        // 2) ギャップ除外の境界取得
        const firstEnd = phaseLogs[0]?.endTime ? new Date(phaseLogs[0].endTime).getTime() : null;
        const currentPhase = phaseLogs.find(pl => pl.endTime === null);
        const currStart = currentPhase ? new Date(currentPhase.startTime).getTime() : null;
  
        // 3) データ取得
        const sessionStart = phaseLogs[0]?.startTime || new Date().toISOString();
        const nowISO = new Date().toISOString();
        const res = await fetch(\`/api/heartrate?sessionId=\${sessionId}&from=\${encodeURIComponent(sessionStart)}&to=\${encodeURIComponent(nowISO)}\`);
        if (!res.ok) return;
        const { data } = await res.json();
  
        // 4) グループ化＋ギャップ除外フィルタ
        const groups = {};
        data.forEach(pt => {
          const t = new Date(pt.Timestamp).getTime();
          if (firstEnd !== null && currStart !== null && t > firstEnd && t < currStart) {
            // 1フェーズ終了～現フェーズ開始前は除外
            return;
          }
          if (!groups[pt.id]) groups[pt.id] = [];
          groups[pt.id].push({ x: new Date(pt.Timestamp), y: pt.Heart_Rate });
        });
  
        // 5) 各IDごと stats
        const stats = Object.entries(groups).map(([idStr, arr]) => {
          const id = +idStr;
          const recent = arr.slice(-N);
          const sum = recent.reduce((a,p)=>a+p.y,0);
          const currentAvg = recent.length ? sum / recent.length : 0;
          const base = baseline[id]||0;
          const threshold = base + OFFSET;
          const deltas = recent.map(p=>p.y-threshold).filter(d=>d>0);
          const maxDelta = deltas.length ? Math.max(...deltas) : 1;
          const header = \`\${nameMap[id]||'ID:'+id} — 基準:\${base.toFixed(1)} BPM 今(\${N}件):\${currentAvg.toFixed(1)} BPM\`;
          return { id, arr, header, threshold, maxDelta };
        });
  
        // 差順ソート
        stats.sort((a,b)=>b.maxDelta - a.maxDelta);
  
        // 6) 不要チャート破棄
        const ids = stats.map(s=>s.id);
        Object.keys(charts).map(i=>+i).forEach(id => {
          if (!ids.includes(id)) {
            charts[id].destroy();
            delete charts[id];
            document.getElementById("card-"+id)?.remove();
          }
        });
  
        // 7) カード＆チャート生成 or 更新
        stats.forEach(stat => {
          const { id, arr, header, threshold, maxDelta } = stat;
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
            grid.appendChild(card);
          }
          const ctx = document.getElementById("chart-"+id).getContext("2d");
          if (!charts[id]) {
            charts[id] = new Chart(ctx, {
              type:'line',
              data:{ datasets:[{ label:header, data:arr, fill:false, borderColor:\`hsl(\${(id*137)%360},100%,50%)\`, spanGaps:true }]},
              options:{
                responsive:true,
                plugins:{
                  annotation: { annotations:annotationConfig },
                  thresholdBg: { threshold, maxDelta }
                },
                scales:{
                  x:{ type:'time', time:{unit:'minute'}, title:{display:true,text:'Time'} },
                  y:{ title:{display:true,text:'BPM'} }
                }
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
      setInterval(fetchAndRender, 5000);
    })();
    </script>
  </body>
  </html>
    `);
  });
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
  
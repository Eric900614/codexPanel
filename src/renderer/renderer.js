const appNode = document.getElementById("app");
const liveStatusNode = document.getElementById("liveStatus");
const refreshButton = document.getElementById("refreshButton");
const openFolderButton = document.getElementById("openFolderButton");

const palette = ["#f0cf64", "#7bdde4", "#a994f1", "#91d4bd", "#ed82a4", "#9ea8bd"];
const hasBridge = Boolean(window.codexPanel);
let refreshTimer = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatTokenShort(value) {
  const number = Number(value) || 0;
  if (number >= 100000000) return `${(number / 100000000).toFixed(number >= 1000000000 ? 1 : 2)}亿`;
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 1 : 2)}万`;
  return new Intl.NumberFormat("zh-CN").format(Math.round(number));
}

function formatRaw(value) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(Number(value) || 0));
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--";
  return `${Math.round(value)}%`;
}

function formatTime(ms) {
  if (!ms) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(ms));
}

function formatReset(seconds) {
  if (!seconds) return "未知";
  const delta = seconds * 1000 - Date.now();
  if (delta <= 0) return "已重置";
  const totalMinutes = Math.ceil(delta / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}天 ${hours}小时`;
  if (hours > 0) return `${hours}小时 ${minutes}分钟`;
  return `${minutes}分钟`;
}

function remainingPercent(limit) {
  if (!limit || !Number.isFinite(limit.used_percent)) return NaN;
  return clamp(100 - limit.used_percent, 0, 100);
}

function circumference(radius) {
  return 2 * Math.PI * radius;
}

function renderGauge(snapshot) {
  const primary = snapshot.rateLimits?.primary;
  const secondary = snapshot.rateLimits?.secondary;
  const primaryRemaining = remainingPercent(primary);
  const secondaryRemaining = remainingPercent(secondary);
  const outerRadius = 188;
  const innerRadius = 145;
  const outerC = circumference(outerRadius);
  const innerC = circumference(innerRadius);
  const outerOffset = outerC * (1 - (Number.isFinite(secondaryRemaining) ? secondaryRemaining : 0) / 100);
  const innerOffset = innerC * (1 - (Number.isFinite(primaryRemaining) ? primaryRemaining : 0) / 100);

  return `
    <section class="panel hero-panel">
      <div class="reset-block left">
        <p class="reset-label">5 小时窗口重置</p>
        <p class="reset-time">${escapeHtml(formatReset(primary?.resets_at))}</p>
      </div>

      <div class="gauge-wrap">
        <svg class="gauge" viewBox="0 0 420 420" role="img" aria-label="Codex rate-limit remaining gauge">
          <circle class="gauge-track" cx="210" cy="210" r="${outerRadius}" stroke-width="34"></circle>
          <circle class="gauge-value" cx="210" cy="210" r="${outerRadius}" stroke-width="34"
            stroke="#7bdde4" stroke-dasharray="${outerC}" stroke-dashoffset="${outerOffset}"></circle>
          <circle class="gauge-track" cx="210" cy="210" r="${innerRadius}" stroke-width="34"></circle>
          <circle class="gauge-value" cx="210" cy="210" r="${innerRadius}" stroke-width="34"
            stroke="#a994f1" stroke-dasharray="${innerC}" stroke-dashoffset="${innerOffset}"></circle>
        </svg>
        <div class="gauge-center">
          <p class="gauge-small">${escapeHtml(formatPercent(secondaryRemaining))}</p>
          <p class="gauge-large">${escapeHtml(formatPercent(primaryRemaining))}</p>
          <p class="gauge-caption">5小时 / 7天剩余额度</p>
        </div>
      </div>

      <div class="reset-block right">
        <p class="reset-label">7 天窗口重置</p>
        <p class="reset-time">${escapeHtml(formatReset(secondary?.resets_at))}</p>
      </div>
    </section>
  `;
}

function renderMetricCards(snapshot) {
  const primaryRemaining = remainingPercent(snapshot.rateLimits?.primary);
  const secondaryRemaining = remainingPercent(snapshot.rateLimits?.secondary);
  const primaryUsed = snapshot.rateLimits?.primary?.used_percent;
  const secondaryUsed = snapshot.rateLimits?.secondary?.used_percent;

  return `
    <section class="metric-grid">
      <article class="panel metric">
        <span class="metric-dot"></span>
        <p class="metric-title">5 小时余量</p>
        <p class="metric-value">${escapeHtml(formatPercent(primaryRemaining))}</p>
        <p class="metric-sub">已用 ${escapeHtml(formatPercent(primaryUsed))}</p>
      </article>
      <article class="panel metric">
        <span class="metric-dot"></span>
        <p class="metric-title">7 天余量</p>
        <p class="metric-value">${escapeHtml(formatPercent(secondaryRemaining))}</p>
        <p class="metric-sub">已用 ${escapeHtml(formatPercent(secondaryUsed))}</p>
      </article>
      <article class="panel metric">
        <span class="metric-dot"></span>
        <p class="metric-title">今日 Token</p>
        <p class="metric-value light">${escapeHtml(formatTokenShort(snapshot.totals.todayTokens))}</p>
        <p class="metric-sub">本月 ${escapeHtml(formatTokenShort(snapshot.totals.monthTokens))}</p>
      </article>
    </section>
  `;
}

function renderTokenBoard(snapshot) {
  return `
    <section class="panel board-panel">
      <div class="section-header">
        <h2>Token 消耗看板</h2>
        <p class="section-kicker">样本 ${escapeHtml(formatRaw(snapshot.tokenEventCount))}</p>
      </div>
      <div class="token-cards">
        ${renderTokenCard("今日", snapshot.totals.todayTokens)}
        ${renderTokenCard("近 7 天", snapshot.totals.weekTokens)}
        ${renderTokenCard("本月", snapshot.totals.monthTokens)}
      </div>
    </section>
  `;
}

function renderTokenCard(label, value) {
  return `
    <article class="token-card">
      <p class="token-label">${escapeHtml(label)}</p>
      <p class="token-main">${escapeHtml(formatTokenShort(value))}</p>
      <p class="token-raw">${escapeHtml(formatRaw(value))}</p>
    </article>
  `;
}

function renderDonut(distribution, total) {
  const radius = 88;
  const c = circumference(radius);
  let offset = 0;
  const segments = distribution.slice(0, 4).map((item, index) => {
    const dash = item.percent * c;
    const segment = `
      <circle cx="120" cy="120" r="${radius}" fill="none" stroke="${palette[index % palette.length]}"
        stroke-width="34" stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${-offset}"
        transform="rotate(-90 120 120)"></circle>
    `;
    offset += dash;
    return segment;
  }).join("");

  return `
    <div class="donut-wrap">
      <svg viewBox="0 0 240 240" aria-label="Token source distribution">
        <circle cx="120" cy="120" r="${radius}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="34"></circle>
        ${segments}
      </svg>
      <div class="donut-center">
        <p class="donut-total-label">本月</p>
        <p class="donut-total">${escapeHtml(formatTokenShort(total))}</p>
      </div>
    </div>
  `;
}

function renderBreakdown(distribution) {
  if (!distribution.length) {
    return `<div class="empty-state"><p>暂无 token 分布数据</p></div>`;
  }

  return `
    <div class="breakdown">
      ${distribution.slice(0, 4).map((item, index) => `
        <div class="breakdown-row">
          <span class="color-dot" style="background: ${palette[index % palette.length]}"></span>
          <span class="breakdown-name">${escapeHtml(item.label)}</span>
          <span class="breakdown-tokens">${escapeHtml(formatTokenShort(item.value))}</span>
          <span class="breakdown-percent">${escapeHtml(formatPercent(item.percent * 100))}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderDistribution(snapshot) {
  return `
    <section class="panel distribution-panel">
      <div class="section-header">
        <h2>本月来源分布</h2>
        <p class="section-kicker">本月 ${escapeHtml(formatTokenShort(snapshot.totals.monthTokens))}</p>
      </div>
      <div class="distribution-body">
        ${renderDonut(snapshot.distributions.source, snapshot.totals.monthTokens)}
        ${renderBreakdown(snapshot.distributions.source)}
      </div>
    </section>
  `;
}

function renderModelPanel(snapshot) {
  const models = snapshot.distributions.model.slice(0, 4);
  return `
    <section class="panel recent-panel model-panel">
      <div class="section-header">
        <h2>模型占用</h2>
        <p class="section-kicker">全部样本</p>
      </div>
      <div class="model-list">
        ${models.map((item) => `
          <div class="model-item">
            <div class="model-topline">
              <span class="model-name">${escapeHtml(item.label)}</span>
              <span>${escapeHtml(formatTokenShort(item.value))}</span>
            </div>
            <div class="bar"><div class="bar-fill" style="width: ${clamp(item.percent * 100, 0, 100)}%"></div></div>
          </div>
        `).join("") || `<p class="session-meta">暂无模型数据</p>`}
      </div>
    </section>
  `;
}

function renderRecent(snapshot) {
  const recentSessions = snapshot.recentSessions.slice(0, 3);
  return `
    <section class="panel recent-panel sessions-panel">
      <div class="section-header">
        <h2>最近 Session</h2>
        <p class="section-kicker">${escapeHtml(formatRaw(snapshot.tokenSessionCount))} 个含 token 记录</p>
      </div>
      <div class="recent-list">
        ${recentSessions.map((session) => `
          <div class="session-row">
            <div class="session-main">
              <p class="session-title">${escapeHtml(session.project)} · ${escapeHtml(session.source)}</p>
              <p class="session-meta">${escapeHtml(session.model)} · ${escapeHtml(formatTime(session.updatedAt))}</p>
            </div>
            <p class="session-tokens">${escapeHtml(formatTokenShort(session.totalTokens))}</p>
          </div>
        `).join("") || `<p class="session-meta">暂无 session 数据</p>`}
      </div>
    </section>
  `;
}

function renderFoot(snapshot) {
  return `
    <section class="panel foot-panel">
      <div class="foot-item">
        <p class="foot-label">数据目录</p>
        <p class="foot-value">${escapeHtml(snapshot.sessionsRoot)}</p>
      </div>
      <div class="foot-item">
        <p class="foot-label">扫描</p>
        <p class="foot-value">${escapeHtml(formatRaw(snapshot.scannedFileCount))} files · ${escapeHtml(snapshot.elapsedMs)} ms</p>
      </div>
      <div class="foot-item">
        <p class="foot-label">最后刷新</p>
        <p class="foot-value">${escapeHtml(formatTime(snapshot.generatedAt))}</p>
      </div>
    </section>
  `;
}

function renderSnapshot(snapshot) {
  if (!snapshot.exists) {
    appNode.innerHTML = `
      <section class="panel empty-state">
        <h2>没有找到 Codex session 目录</h2>
        <p>${escapeHtml(snapshot.sessionsRoot)}</p>
      </section>
    `;
    return;
  }

  appNode.innerHTML = `
    <div class="single-grid">
      ${renderGauge(snapshot)}
      ${renderMetricCards(snapshot)}
      ${renderTokenBoard(snapshot)}
      ${renderDistribution(snapshot)}
      ${renderRecent(snapshot)}
      ${renderModelPanel(snapshot)}
    </div>
  `;
}

function buildMockSnapshot() {
  return {
    generatedAt: Date.now(),
    codexHome: "C:\\Users\\demo\\.codex",
    sessionsRoot: "C:\\Users\\demo\\.codex\\sessions",
    exists: true,
    scannedFileCount: 92,
    parsedSessionCount: 92,
    tokenSessionCount: 47,
    tokenEventCount: 6673,
    elapsedMs: 18,
    rateLimits: {
      primary: { used_percent: 4, resets_at: Math.floor((Date.now() + 4.5 * 60 * 60 * 1000) / 1000) },
      secondary: { used_percent: 1, resets_at: Math.floor((Date.now() + 6.9 * 24 * 60 * 60 * 1000) / 1000) }
    },
    totals: {
      todayTokens: 81315423,
      weekTokens: 167372734,
      monthTokens: 715533352,
      totalTokens: 1042329961
    },
    distributions: {
      source: [
        { label: "Codex App", value: 482221102, percent: 0.67 },
        { label: "CLI", value: 162420997, percent: 0.23 },
        { label: "Sub-agent", value: 70991253, percent: 0.1 }
      ],
      model: [
        { label: "gpt-5.5", value: 624441102, percent: 0.87 },
        { label: "gpt-5.4", value: 70991253, percent: 0.1 },
        { label: "unknown model", value: 20101000, percent: 0.03 }
      ]
    },
    recentSessions: [
      { project: "codexPanel", source: "Codex App", model: "gpt-5.5", updatedAt: Date.now(), totalTokens: 546803 },
      { project: "admin", source: "CLI", model: "gpt-5.5", updatedAt: Date.now() - 240000, totalTokens: 21185 }
    ]
  };
}

async function loadSnapshot() {
  try {
    const snapshot = hasBridge ? await window.codexPanel.getSnapshot() : buildMockSnapshot();
    renderSnapshot(snapshot);
    liveStatusNode.textContent = hasBridge
      ? `实时 · ${formatRaw(snapshot.scannedFileCount)} files`
      : "预览";
    liveStatusNode.classList.remove("error");
  } catch (error) {
    liveStatusNode.textContent = "错误";
    liveStatusNode.classList.add("error");
    appNode.innerHTML = `
      <section class="panel error-state">
        <h2>读取失败</h2>
        <p>${escapeHtml(error.message || error)}</p>
      </section>
    `;
  }
}

refreshButton.addEventListener("click", loadSnapshot);
openFolderButton.addEventListener("click", async () => {
  if (!hasBridge) return;
  await window.codexPanel.openCodexHome();
});

loadSnapshot();
refreshTimer = window.setInterval(loadSnapshot, 2500);

window.addEventListener("beforeunload", () => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});

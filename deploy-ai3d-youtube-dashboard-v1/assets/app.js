const state = {
  data: null,
  automation: null,
  view: "overview",
  query: "",
  filters: {
    sFormat: "all",
    currentLane: "all",
    bucket: "all",
    review: "quality",
  },
};

const palette = {
  S: "#ffd64a",
  A: "#f3c744",
  B: "#c9a647",
  C: "#9c8443",
  Archive: "#6f6a5b",
};

const bucketColors = [
  "#ffd64a",
  "#ffb800",
  "#d9b54a",
  "#c79a32",
  "#b89b58",
  "#8f7a45",
  "#d7d3c6",
  "#a88b38",
  "#755f2a",
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const fmt = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return new Intl.NumberFormat("en-US").format(Math.round(value));
  return value;
};

const shortDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
};

const percent = (part, total) => `${Math.round((part / Math.max(total, 1)) * 100)}%`;

const normalized = (text) => String(text || "").toLowerCase();

const tierColor = (tier) => palette[tier] || "#ffd64a";

async function init() {
  if (window.DASHBOARD_DATA) {
    state.data = window.DASHBOARD_DATA;
  } else {
    const response = await fetch("./data/dashboard-data.json");
    state.data = await response.json();
  }
  state.automation = window.DASHBOARD_AUTOMATION || defaultAutomationConfig();
  bindChrome();
  renderAll();
  initSignalCanvas();
}

function bindChrome() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      $$(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
      $$(".view").forEach((view) => view.classList.toggle("active", view.id === state.view));
      $("#viewTitle").textContent = button.textContent;
      renderView();
    });
  });

  $("#searchInput").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderView();
  });

  $("#resetFilters").addEventListener("click", () => {
    state.query = "";
    state.filters = { sFormat: "all", currentLane: "all", bucket: "all", review: "quality" };
    $("#searchInput").value = "";
    renderAll();
  });

  $("#drawerClose").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });
}

function renderAll() {
  renderOverview();
  renderFilters();
  renderView();
}

function renderView() {
  if (state.view === "overview") renderOverviewSearch();
  if (state.view === "tier-s") renderSGrid();
  if (state.view === "current") renderCurrent();
  if (state.view === "map") renderMap();
  if (state.view === "review") renderReview();
}

function renderOverview() {
  const { metrics } = state.data;
  const total = Number(metrics.total_scored_videos || 0);
  const highValue = Number(metrics.S_tier_count || 0) + Number(metrics.A_tier_count || 0);
  const kpis = [
    ["总资源数", total, "v1-v4 合并去重视频", "#ffd64a", 100],
    ["S/A 资源", highValue, `${percent(highValue, total)} 进入优先资源池`, "#f3c744", highValue / total * 100],
    ["S 级样本", metrics.S_tier_count, "已完成人工走查", "#ffb800", 82],
    ["近期优先", metrics.High_current_intelligence_count, "建议优先阅读与分析", "#d9b54a", 66],
    ["内容质量复核", metrics.quality_gate_blocked_count, "建议复核或限级的资源", "#c79a32", 74],
    ["元数据异常", metrics.metadata_spam_flag_count, "SEO 标签异常复核", "#b89b58", 44],
  ];

  $("#kpiGrid").innerHTML = kpis.map(([label, value, hint, color, bar]) => `
    <div class="kpi" style="color:${color}; --bar:${Math.max(8, Math.min(100, bar))}%">
      <small>${label}</small>
      <strong>${fmt(value)}</strong>
      <span>${hint}</span>
    </div>
  `).join("");

  renderTierStage();
  renderDeltaStack();
  renderRiskGrid();
  renderChannelBoard();
  renderPipelineBoard();
}

function renderTierStage() {
  const dist = state.data.distributions.tier;
  const max = Math.max(...dist.map((item) => item.count));
  const order = ["S", "A", "B", "C", "Archive"];
  $("#tierStage").innerHTML = order.map((tier) => {
    const count = dist.find((item) => item.label === tier)?.count || 0;
    const height = 24 + (count / max) * 210;
    return `
      <div class="tier-bar">
        <div class="tier-column" style="--tone:${tierColor(tier)}; height:${height}px"></div>
        <div class="tier-label"><span>${tier}</span><span>${count}</span></div>
      </div>
    `;
  }).join("");
}

function renderDeltaStack() {
  const m = state.data.metrics;
  const rows = [
    ["S 级", m.v1_2_S_tier_count, m.S_tier_count, "S 级准入条件收紧"],
    ["A Tier", m.v1_2_A_tier_count, m.A_tier_count, "压掉边界候选"],
    ["近期优先", m.v1_2_High_current_intelligence_count, m.High_current_intelligence_count, "近期优先资源轻微收敛"],
  ];
  $("#deltaStack").innerHTML = rows.map(([label, before, after, hint]) => {
    const width = (after / before) * 100;
    const diff = after - before;
    return `
      <div class="delta-row">
        <p class="eyebrow">${label}</p>
        <strong>${before} → ${after} <span style="color:${diff < 0 ? "var(--red)" : "var(--green)"}">${diff}</span></strong>
        <div class="delta-track"><div class="delta-fill" style="width:${width}%"></div></div>
        <p class="eyebrow" style="margin-top:12px">${hint}</p>
      </div>
    `;
  }).join("");
}

function renderRiskGrid() {
  const videos = state.data.videos;
  const hard = videos.filter((v) => v.qualityGate === "hard_exclude").length;
  const limit = videos.filter((v) => v.qualityGate === "limit_to_B").length;
  const pass = videos.filter((v) => v.qualityGate === "pass").length;
  const spam = videos.filter((v) => v.spamFlag).length;
  const rows = [
    ["正常通过", pass, "可进入正常知识库流转", "var(--green)"],
    ["限制到 B", limit, "高信号但不允许进 S/A", "var(--amber)"],
    ["建议归档", hard, "短视频或低信息量内容直接归档", "var(--red)"],
    ["元数据异常", spam, "SEO 标签异常风险", "var(--violet)"],
  ];
  $("#riskGrid").innerHTML = rows.map(([label, count, hint, color]) => `
    <div class="risk-card" style="color:${color}">
      <small class="eyebrow">${label}</small>
      <strong>${count}</strong>
      <span>${hint}</span>
    </div>
  `).join("");
}

function renderOverviewSearch() {
  const panel = $("#overviewSearchPanel");
  const grid = $("#overviewSearchGrid");
  const count = $("#overviewSearchCount");
  const q = normalized(state.query).trim();
  if (!q) {
    panel.classList.remove("visible");
    grid.innerHTML = "";
    count.textContent = "0";
    return;
  }
  const results = filteredVideos(state.data.videos)
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);
  panel.classList.add("visible");
  count.textContent = `${results.length} 条`;
  grid.innerHTML = results.map(videoCard).join("");
  bindCards("#overviewSearchGrid", results);
}

function renderPipelineBoard() {
  const automation = state.automation;
  $("#pipelineMode").textContent = automation.statusLabel || automation.mode || "Static";
  $("#pipelineBoard").innerHTML = `
    <div class="pipeline-summary">
      <div>
        <span>当前数据源</span>
        <strong>${escapeHtml(automation.sourceWorkbook || "dashboard-data.js")}</strong>
      </div>
      <div>
        <span>最近源数据更新</span>
        <strong>${escapeHtml(automation.lastSourceUpdate || "-")}</strong>
      </div>
      <div>
        <span>后续更新频率</span>
        <strong>${escapeHtml(automation.plannedCadence || "待配置")}</strong>
      </div>
    </div>
    <div class="pipeline-steps">
      ${(automation.pipelineSteps || []).map((step, index) => `
        <div class="pipeline-step">
          <div class="step-index">${index + 1}</div>
          <strong>${escapeHtml(step.name)}</strong>
          <div>
            <span>当前</span>
            <p>${escapeHtml(step.current)}</p>
          </div>
          <div>
            <span>预留</span>
            <p>${escapeHtml(step.target)}</p>
          </div>
        </div>
      `).join("")}
    </div>
    <div class="integration-list">
      ${(automation.futureIntegrations || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
  `;
}

function renderChannelBoard() {
  const max = Math.max(...state.data.topChannels.map((row) => row.count));
  $("#channelBoard").innerHTML = state.data.topChannels.slice(0, 10).map((row) => `
    <div class="channel-row">
      <div class="channel-name" title="${row.channel_title}">${row.channel_title}</div>
      <strong>${row.count}</strong>
      <div class="channel-bar"><span style="width:${(row.count / max) * 100}%"></span></div>
    </div>
  `).join("");
}

function renderFilters() {
  const formats = unique(state.data.videos.filter((v) => v.tier === "S").map((v) => v.format));
  renderPills("#sFilters", [["all", "全部"], ...formats.map((item) => [item, formatLabel(item)])], "sFormat", renderSGrid);

  const currentLanes = [
    ["all", "全部"],
    ["Competitor Intelligence", "竞品动态"],
    ["Workflow", "工作流案例"],
    ["Review", "评测对比"],
  ];
  renderPills("#currentFilters", currentLanes, "currentLane", renderCurrent);

  const reviewFilters = [
    ["quality", "内容质量"],
    ["spam", "元数据异常"],
    ["borderline", "边界高分"],
  ];
  renderPills("#reviewFilters", reviewFilters, "review", renderReview);
}

function renderPills(container, items, key, callback) {
  $(container).innerHTML = items.map(([value, label]) => `
    <button class="pill ${state.filters[key] === value ? "active" : ""}" data-key="${key}" data-value="${value}">${label}</button>
  `).join("");
  $(`${container}`).querySelectorAll(".pill").forEach((button) => {
    button.addEventListener("click", () => {
      state.filters[key] = button.dataset.value;
      callback();
      renderPills(container, items, key, callback);
    });
  });
}

function renderSGrid() {
  const videos = filteredVideos(state.data.videos)
    .filter((v) => v.tier === "S")
    .filter((v) => state.filters.sFormat === "all" || v.format === state.filters.sFormat)
    .sort((a, b) => b.score - a.score);
  $("#sGrid").innerHTML = videos.map(videoCard).join("");
  bindCards("#sGrid", videos);
}

function renderCurrent() {
  const high = state.data.videos.filter((v) => v.priority === "High");
  const lanes = [
    ["all", "全部近期优先", high.length, "建议优先阅读与分析"],
    ["Competitor Intelligence", "竞品动态", high.filter((v) => v.bucket === "Competitor Intelligence").length, "产品发布、对比、体验反馈"],
    ["Workflow", "工作流案例", high.filter((v) => /Workflow|Use Case|Printing|Engine/.test(v.bucket)).length, "pipeline、创作者流程、场景验证"],
    ["Review", "评测对比", high.filter((v) => /review|comparison/.test(v.format)).length, "review、comparison、vs"],
  ];

  $("#intelLanes").innerHTML = lanes.map(([value, label, count, hint]) => `
    <div class="lane ${state.filters.currentLane === value ? "active" : ""}" data-lane="${value}">
      <p class="eyebrow">${label}</p>
      <strong>${count}</strong>
      <p>${hint}</p>
    </div>
  `).join("");
  $("#intelLanes").querySelectorAll(".lane").forEach((lane) => {
    lane.addEventListener("click", () => {
      state.filters.currentLane = lane.dataset.lane;
      renderCurrent();
    });
  });

  let videos = filteredVideos(high);
  if (state.filters.currentLane === "Competitor Intelligence") {
    videos = videos.filter((v) => v.bucket === "Competitor Intelligence");
  }
  if (state.filters.currentLane === "Workflow") {
    videos = videos.filter((v) => /Workflow|Use Case|Printing|Engine/.test(v.bucket));
  }
  if (state.filters.currentLane === "Review") {
    videos = videos.filter((v) => /review|comparison/.test(v.format));
  }
  videos = videos.sort((a, b) => b.score - a.score).slice(0, 48);
  $("#currentGrid").innerHTML = videos.map(videoCard).join("");
  bindCards("#currentGrid", videos);
}

function renderMap() {
  const buckets = state.data.distributions.bucket;
  const max = Math.max(...buckets.map((item) => item.count));
  $("#knowledgeMap").innerHTML = buckets.map((item, index) => {
    const sa = state.data.videos.filter((v) => v.bucket === item.label && ["S", "A"].includes(v.tier)).length;
    return `
      <div class="map-node ${state.filters.bucket === item.label ? "active" : ""}" style="--node:${bucketColors[index % bucketColors.length]}" data-bucket="${item.label}">
        <p class="eyebrow">${percent(item.count, state.data.videos.length)} coverage</p>
        <strong>${item.count}</strong>
        <p>${item.label}<br>${sa} 条 S/A 高价值样本</p>
        <div class="delta-track"><div class="delta-fill" style="width:${(item.count / max) * 100}%; background:${bucketColors[index % bucketColors.length]}"></div></div>
      </div>
    `;
  }).join("");
  $("#knowledgeMap").querySelectorAll(".map-node").forEach((node) => {
    node.addEventListener("click", () => {
      state.filters.bucket = state.filters.bucket === node.dataset.bucket ? "all" : node.dataset.bucket;
      renderMap();
    });
  });

  const videos = filteredVideos(state.data.videos)
    .filter((v) => state.filters.bucket === "all" || v.bucket === state.filters.bucket)
    .filter((v) => ["S", "A", "B"].includes(v.tier))
    .sort((a, b) => b.score - a.score)
    .slice(0, 48);
  $("#mapGrid").innerHTML = videos.map(videoCard).join("");
  bindCards("#mapGrid", videos);
}

function renderReview() {
  const videos = state.data.videos;
  const matrix = [
    ["建议归档", videos.filter((v) => v.qualityGate === "hard_exclude").length, "短视频、娱乐化或低信息量内容"],
    ["限制到 B", videos.filter((v) => v.qualityGate === "limit_to_B").length, "有信号但不进入 S/A"],
    ["元数据异常", videos.filter((v) => v.spamFlag).length, "description/tags 可能影响关键词判断"],
  ];
  $("#reviewMatrix").innerHTML = matrix.map(([label, count, hint]) => `
    <div class="review-tile">
      <p class="eyebrow">${label}</p>
      <strong>${count}</strong>
      <p>${hint}</p>
    </div>
  `).join("");

  let list = filteredVideos(videos);
  if (state.filters.review === "quality") {
    list = list.filter((v) => v.qualityGate !== "pass");
  } else if (state.filters.review === "spam") {
    list = list.filter((v) => v.spamFlag);
  } else {
    list = list.filter((v) => v.score >= 78 && v.tier !== "S");
  }
  list = list.sort((a, b) => b.score - a.score).slice(0, 60);
  $("#reviewGrid").innerHTML = list.map(videoCard).join("");
  bindCards("#reviewGrid", list);
}

function filteredVideos(videos) {
  const q = normalized(state.query).trim();
  if (!q) return videos;
  return videos.filter((video) => [
    video.title,
    video.channel,
    video.bucket,
    video.role,
    video.format,
    video.keywordHits,
    video.description,
    video.matchedQueries,
  ].some((value) => normalized(value).includes(q)));
}

function videoCard(video) {
  const tier = video.tier || "B";
  return `
    <article class="video-card" data-id="${video.id}">
      <div class="thumb">
        <img src="${video.thumbnail}" alt="" loading="lazy" />
        <div class="score-badge">${Number(video.score).toFixed(1)}</div>
        <div class="tier-badge" style="--tier:${tierColor(tier)}">${tier}</div>
      </div>
      <div class="card-body">
        <h4 class="video-title">${escapeHtml(video.title)}</h4>
        <div class="meta-line">
          <span>${escapeHtml(video.channel)}</span>
          <span>${shortDate(video.publishedAt)}</span>
          <span>${fmt(video.views)} views</span>
        </div>
        <div class="tag-line">
          <span class="mini-tag">${escapeHtml(video.bucket)}</span>
          <span class="mini-tag">${formatLabel(video.format)}</span>
          <span class="mini-tag">优先级 ${escapeHtml(video.priority || "Low")}</span>
        </div>
        ${scoreBars(video)}
      </div>
    </article>
  `;
}

function scoreBars(video) {
  const bars = [
    ["相关性", video.relevance, 40, "var(--cyan)"],
    ["战略价值", video.strategicValue, 30, "var(--amber)"],
    ["市场信号", video.marketSignal, 30, "var(--steel)"],
  ];
  return `
    <div class="score-bars">
      ${bars.map(([label, value, max, color]) => `
        <div class="score-bar">
          <span>${label}</span>
          <div class="bar-shell"><div class="bar-fill" style="--fill:${color}; width:${Math.min(100, (Number(value || 0) / max) * 100)}%"></div></div>
          <span>${value ?? "-"}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function bindCards(container, videos) {
  const byId = new Map(videos.map((video) => [video.id, video]));
  $(container).querySelectorAll(".video-card").forEach((card) => {
    card.addEventListener("click", () => openDrawer(byId.get(card.dataset.id)));
  });
}

function openDrawer(video) {
  if (!video) return;
  $("#drawerContent").innerHTML = `
    <div class="drawer-hero"><img src="${video.thumbnail}" alt="" /></div>
    <p class="eyebrow">${escapeHtml(video.tier)} Tier · ${Number(video.score).toFixed(1)} score</p>
    <h3>${escapeHtml(video.title)}</h3>
    <div class="meta-line">
      <span>${escapeHtml(video.channel)}</span>
      <span>${shortDate(video.publishedAt)}</span>
      <span>${fmt(video.views)} views</span>
      <span>${fmt(video.duration)} min</span>
    </div>
    <a class="open-link" href="${video.url}" target="_blank" rel="noreferrer">打开 YouTube</a>

    <div class="drawer-section">
      <div class="metric-pair">
        <div><span>内容相关性</span><strong>${video.relevance ?? "-"}</strong></div>
        <div><span>战略价值</span><strong>${video.strategicValue ?? "-"}</strong></div>
        <div><span>市场信号</span><strong>${video.marketSignal ?? "-"}</strong></div>
      </div>
    </div>

    <div class="drawer-section">
      <p class="eyebrow">资源角色</p>
      <div class="tag-line">
        <span class="mini-tag">${escapeHtml(video.bucket)}</span>
        <span class="mini-tag">${escapeHtml(video.role)}</span>
        <span class="mini-tag">${escapeHtml(video.validatedUse)}</span>
        <span class="mini-tag">${formatLabel(video.format)}</span>
      </div>
    </div>

    <div class="drawer-section">
      <p class="eyebrow">入选依据</p>
      <p>${escapeHtml(video.priorityReason || video.action || "No current intelligence reason provided.")}</p>
    </div>

    <div class="drawer-section">
      <p class="eyebrow">可信简介</p>
      <p>${escapeHtml(video.description || "No natural description available.")}</p>
    </div>

    <div class="drawer-section">
      <p class="eyebrow">关键词证据</p>
      <p>${escapeHtml(video.keywordHits || "No keyword evidence available.")}</p>
    </div>

    <div class="drawer-section">
      <p class="eyebrow">质量控制</p>
      <div class="tag-line">
        <span class="mini-tag">质量状态: ${escapeHtml(qualityStatusLabel(video.qualityGate))}</span>
        <span class="mini-tag">元数据异常: ${video.spamFlag ? "Yes" : "No"}</span>
        <span class="mini-tag">Watch: ${escapeHtml(video.watchStatus)}</span>
      </div>
      <p style="margin-top:12px">${escapeHtml(displayReason(video.qualityReason || video.spamReason || "暂无需要特别说明的问题。"))}</p>
    </div>
  `;
  $("#detailDrawer").classList.add("open");
  $("#detailDrawer").setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  $("#detailDrawer").classList.remove("open");
  $("#detailDrawer").setAttribute("aria-hidden", "true");
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function formatLabel(value) {
  const labels = {
    workflow_or_case: "workflow",
    product_update_or_launch: "launch/update",
    listicle_or_roundup: "roundup",
    showcase_or_demo: "demo",
  };
  return labels[value] || value || "-";
}

function qualityStatusLabel(value) {
  const labels = {
    pass: "正常通过",
    limit_to_B: "限制到 B",
    hard_exclude: "建议归档",
  };
  return labels[value] || value || "-";
}

function displayReason(value) {
  return String(value || "")
    .replaceAll("metadata tag stuffing detected", "元数据异常")
    .replaceAll("metadata stuffing detected", "元数据异常")
    .replaceAll("very long SEO-style tag block", "SEO 标签过长")
    .replaceAll("broad multilingual tag stuffing detected", "多语言标签异常")
    .replaceAll("large YouTube tags field", "YouTube 标签数量较多")
    .replaceAll("long tag block in description", "简介中存在较长标签段")
    .replaceAll("weak title signal", "标题信号较弱")
    .replaceAll("Short-form or low-insight content blocked by quality gate", "短视频或低信息量内容，建议归档")
    .replaceAll("short duration", "视频时长较短");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function defaultAutomationConfig() {
  return {
    mode: "static",
    statusLabel: "本地静态数据",
    sourceWorkbook: "dashboard-data.js",
    lastSourceUpdate: "-",
    plannedCadence: "待配置",
    futureIntegrations: ["YouTube Data API", "评分脚本", "人工复核", "飞书同步"],
    pipelineSteps: [
      { name: "采集", current: "手动导入", target: "定时抓取" },
      { name: "评分", current: "静态数据", target: "自动评分与元数据异常检测" },
      { name: "复核", current: "人工走查", target: "状态回写" },
      { name: "发布", current: "离线页面", target: "同步数据源" },
    ],
  };
}

function initSignalCanvas() {
  const canvas = $("#signalCanvas");
  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let points = [];

  function resize() {
    width = canvas.width = window.innerWidth * window.devicePixelRatio;
    height = canvas.height = window.innerHeight * window.devicePixelRatio;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    const count = Math.min(80, Math.floor(window.innerWidth / 18));
    points = Array.from({ length: count }, (_, index) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.22 * window.devicePixelRatio,
      vy: (Math.random() - 0.5) * 0.18 * window.devicePixelRatio,
      phase: index * 0.37,
    }));
  }

  function frame(time) {
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = window.devicePixelRatio;
    points.forEach((point, index) => {
      point.x += point.vx;
      point.y += point.vy;
      if (point.x < 0 || point.x > width) point.vx *= -1;
      if (point.y < 0 || point.y > height) point.vy *= -1;

      for (let j = index + 1; j < points.length; j += 1) {
        const other = points[j];
        const dx = point.x - other.x;
        const dy = point.y - other.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const limit = 170 * window.devicePixelRatio;
        if (distance < limit) {
          const alpha = (1 - distance / limit) * 0.16;
          ctx.strokeStyle = `rgba(255, 214, 74, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(point.x, point.y);
          ctx.lineTo(other.x, other.y);
          ctx.stroke();
        }
      }

      const pulse = 1.5 + Math.sin(time / 700 + point.phase) * 0.9;
      ctx.fillStyle = "rgba(255, 184, 0, 0.32)";
      ctx.beginPath();
      ctx.arc(point.x, point.y, pulse * window.devicePixelRatio, 0, Math.PI * 2);
      ctx.fill();
    });
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
}

init().catch((error) => {
  document.body.innerHTML = `<pre style="padding:24px;color:white">${error.stack || error}</pre>`;
});

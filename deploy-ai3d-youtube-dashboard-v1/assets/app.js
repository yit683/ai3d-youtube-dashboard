const state = {
  data: null,
  automation: null,
  reviewDecisions: {},
  view: "overview",
  query: "",
  filters: {
    sFormat: "all",
    newType: "all",
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

const reviewLaneConfig = {
  high_priority: {
    label: "优先确认",
    hint: "本周优先看这一组",
    action: "优先人工确认",
  },
  needs_review: {
    label: "待判断",
    hint: "快速判断是否收录",
    action: "人工快速判断",
  },
  low_priority: {
    label: "低优先观察",
    hint: "暂存候选池",
    action: "低优先观察",
  },
  archive_candidate: {
    label: "建议归档",
    hint: "可批量跳过",
    action: "建议归档",
  },
};

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

const dateTimeLabel = (value) => {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return `${value}（未记录时分）`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
};

const percent = (part, total) => `${Math.round((part / Math.max(total, 1)) * 100)}%`;

const normalized = (text) => String(text || "").toLowerCase();

const tierColor = (tier) => palette[tier] || "#ffd64a";
const REVIEW_STORAGE_KEY = "ai3d-youtube-review-decisions-v1";

async function init() {
  if (window.DASHBOARD_DATA) {
    state.data = window.DASHBOARD_DATA;
  } else {
    const response = await fetch("./data/dashboard-data.json");
    state.data = await response.json();
  }
  state.automation = window.DASHBOARD_AUTOMATION || defaultAutomationConfig();
  state.reviewDecisions = loadReviewDecisions();
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
    state.filters = { sFormat: "all", newType: "all", currentLane: "all", bucket: "all", review: "quality" };
    $("#searchInput").value = "";
    renderAll();
  });

  $("#exportReviewDecisions")?.addEventListener("click", exportReviewDecisions);
  $("#clearReviewDecisions")?.addEventListener("click", () => {
    state.reviewDecisions = {};
    persistReviewDecisions();
    renderView();
  });
  $("#drawerClose").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });
}

function renderAll() {
  renderRunMetadata();
  renderOverview();
  renderFilters();
  renderView();
}

function renderRunMetadata() {
  const metrics = state.data.metrics || {};
  const automation = state.automation || {};
  const total = Number(metrics.total_scored_videos || state.data.videos?.length || 0);
  const scoreRunAt = metrics.last_score_run_at || metrics.v1_3_scored_date || state.data.generatedAt;
  const dataGeneratedAt = state.data.generatedAt || metrics.last_auto_update;
  const autoRunAt = metrics.last_auto_update || automation.lastAutomationRunAt;
  $("#datasetMeta").textContent = `${fmt(total)} videos · scoring standard v1.3`;
  $("#runMeta").innerHTML = [
    ["最近跑分", dateTimeLabel(scoreRunAt)],
    ["数据生成", dateTimeLabel(dataGeneratedAt)],
    ["自动更新", dateTimeLabel(autoRunAt)],
  ].map(([label, value]) => `
    <span>
      <b>${label}</b>
      ${escapeHtml(value)}
    </span>
  `).join("");
}

function renderView() {
  if (state.view === "overview") renderOverviewSearch();
  if (state.view === "new") renderNewCandidates();
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
  const metrics = state.data.metrics || {};
  const lastScoreRun = metrics.last_score_run_at || metrics.v1_3_scored_date || state.data.generatedAt;
  const lastAutoRun = metrics.last_auto_update || automation.lastAutomationRunAt;
  $("#pipelineMode").textContent = automation.statusLabel || automation.mode || "Static";
  $("#pipelineBoard").innerHTML = `
    <div class="pipeline-summary">
      <div>
        <span>当前数据源</span>
        <strong>${escapeHtml(automation.sourceWorkbook || "dashboard-data.js")}</strong>
      </div>
      <div>
        <span>最近跑分时间</span>
        <strong>${escapeHtml(dateTimeLabel(lastScoreRun))}</strong>
      </div>
      <div>
        <span>最近自动更新</span>
        <strong>${escapeHtml(dateTimeLabel(lastAutoRun))}</strong>
      </div>
      <div>
        <span>源数据更新</span>
        <strong>${escapeHtml(dateTimeLabel(automation.lastSourceUpdate))}</strong>
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

  const newFilters = [
    ["all", "全部"],
    ["high_priority", "优先确认"],
    ["needs_review", "待判断"],
    ["draft_needs_review", "本轮待复核"],
    ["low_priority", "低优先观察"],
    ["archive_candidate", "建议归档"],
    ["competitor", "竞品相关"],
    ["workflow", "工作流相关"],
  ];
  renderPills("#newFilters", newFilters, "newType", renderNewCandidates);

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

function renderNewCandidates() {
  const candidates = getNewCandidates(state.data.videos);
  const laneCounts = candidates.reduce((acc, video) => {
    const lane = getReviewLane(video);
    acc[lane] = (acc[lane] || 0) + 1;
    return acc;
  }, {});
  const competitor = candidates.filter((v) => v.bucket === "Competitor Intelligence").length;
  const workflow = candidates.filter((v) => /Workflow|Use Case|Printing|Engine/.test(v.bucket || "")).length;

  const matrix = [
    ["high_priority", laneCounts.high_priority || 0],
    ["needs_review", laneCounts.needs_review || 0],
    ["low_priority", laneCounts.low_priority || 0],
    ["archive_candidate", laneCounts.archive_candidate || 0],
  ];

  $("#newMatrix").innerHTML = matrix.map(([lane, count]) => {
    const config = reviewLaneConfig[lane];
    return `
    <button class="review-tile review-lane-tile ${state.filters.newType === lane ? "active" : ""}" data-lane="${lane}">
      <p class="eyebrow">${config.action}</p>
      <strong>${count}</strong>
      <p>${config.hint}</p>
    </button>
  `;
  }).join("");

  $("#newMatrix").querySelectorAll(".review-lane-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      state.filters.newType = state.filters.newType === tile.dataset.lane ? "all" : tile.dataset.lane;
      renderNewCandidates();
      renderFilters();
    });
  });

  $("#newWorkload").innerHTML = `
    <div>
      <p class="eyebrow">本周建议处理</p>
      <strong>${fmt((laneCounts.high_priority || 0) + (laneCounts.needs_review || 0))}</strong>
      <span>优先确认 + 待判断</span>
    </div>
    <div>
      <p class="eyebrow">可延后处理</p>
      <strong>${fmt((laneCounts.low_priority || 0) + (laneCounts.archive_candidate || 0))}</strong>
      <span>低优先观察 + 建议归档</span>
    </div>
    <div>
      <p class="eyebrow">主题强信号</p>
      <strong>${fmt(competitor + workflow)}</strong>
      <span>竞品或工作流相关</span>
    </div>
  `;
  renderReviewDraft();

  let videos = filteredVideos(candidates);
  if (reviewLaneConfig[state.filters.newType]) {
    videos = videos.filter((v) => getReviewLane(v) === state.filters.newType);
  }
  if (state.filters.newType === "draft_needs_review") {
    videos = videos.filter((v) => state.reviewDecisions[v.id]?.manualStatus === "needs_review");
  }
  if (state.filters.newType === "competitor") {
    videos = videos.filter((v) => v.bucket === "Competitor Intelligence");
  }
  if (state.filters.newType === "workflow") {
    videos = videos.filter((v) => /Workflow|Use Case|Printing|Engine/.test(v.bucket || ""));
  }

  videos = videos
    .sort((a, b) => {
      const laneOrder = { high_priority: 0, needs_review: 1, low_priority: 2, archive_candidate: 3 };
      const laneDiff = laneOrder[getReviewLane(a)] - laneOrder[getReviewLane(b)];
      const aDate = new Date(a.addedAt || a.publishedAt || 0).getTime();
      const bDate = new Date(b.addedAt || b.publishedAt || 0).getTime();
      return laneDiff || bDate - aDate || Number(b.score || 0) - Number(a.score || 0);
    })
    .slice(0, 72);

  $("#newGrid").innerHTML = videos.map((video) => videoCard(video, { showReviewSuggestion: true })).join("");
  bindCards("#newGrid", videos);
  bindReviewActions("#newGrid", videos);
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

function getNewCandidates(videos) {
  return videos.filter((video) => {
    if (video.addedByAutomation) return true;
    if (video.screening === "Auto-Review") return true;
    if (video.sourceRounds === "scheduled") return true;
    if (video.priorityReason === "自动新增候选，待人工复核") return true;
    return false;
  });
}

function getReviewLane(video) {
  if (video.reviewLane && reviewLaneConfig[video.reviewLane]) return video.reviewLane;
  const score = Number(video.score || 0);
  const bucket = String(video.bucket || "");
  const format = String(video.format || "");
  const duration = Number(video.duration || 0);
  const strongTopic = bucket === "Competitor Intelligence" || /Workflow|Use Case|Printing|Engine/.test(bucket) || /review|comparison/.test(format);
  if (duration > 0 && duration < 2.5 && !strongTopic) return "archive_candidate";
  if (score >= 70 && strongTopic) return "high_priority";
  if (strongTopic || score >= 58) return "needs_review";
  return "low_priority";
}

function getReviewSuggestion(video) {
  const lane = getReviewLane(video);
  const action = video.suggestedAction || reviewLaneConfig[lane]?.action || "人工快速判断";
  const bucket = video.suggestedBucket || suggestedBucketLabel(video);
  const tier = video.suggestedTier || (lane === "archive_candidate" ? "Archive" : video.tier || "C");
  const reason = video.suggestedReason || fallbackSuggestionReason(lane);
  const confidence = video.reviewConfidence || (lane === "high_priority" ? "high" : lane === "low_priority" ? "low" : "medium");
  return { lane, action, bucket, tier, reason, confidence };
}

function suggestedBucketLabel(video) {
  if (video.bucket === "Competitor Intelligence") return "竞品相关";
  if (/Workflow|Use Case|Printing|Engine/.test(video.bucket || "")) return "工作流相关";
  return "AI 3D 基础知识";
}

function fallbackSuggestionReason(lane) {
  const reasons = {
    high_priority: "分数较高且命中明确主题信号，建议优先人工确认。",
    needs_review: "存在可用信号，但需要人工判断是否正式收录。",
    low_priority: "相关性较弱，建议保留观察，不占用本周审核时间。",
    archive_candidate: "信号较弱或信息量较低，可优先归档。",
  };
  return reasons[lane] || "需要人工快速判断。";
}

function reviewLaneLabel(value) {
  return reviewLaneConfig[value]?.label || value || "-";
}

function confidenceLabel(value) {
  const labels = {
    high: "高",
    medium: "中",
    low: "低",
  };
  return labels[value] || value || "-";
}

function videoCard(video, options = {}) {
  const tier = video.tier || "B";
  const suggestion = getReviewSuggestion(video);
  const decision = state.reviewDecisions[video.id];
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
          ${isNewCandidate(video) ? `<span class="mini-tag new-candidate-tag">新增候选</span>` : ""}
          ${video.manualStatus ? `<span class="mini-tag">人工 ${escapeHtml(manualStatusLabel(video.manualStatus))}</span>` : ""}
          ${decision ? `<span class="mini-tag decision-tag">本轮 ${escapeHtml(manualStatusLabel(decision.manualStatus))}</span>` : ""}
        </div>
        ${options.showReviewSuggestion ? `
          <div class="suggestion-line">
            <b>${escapeHtml(suggestion.action)}</b>
            <span>${escapeHtml(suggestion.bucket)} · ${escapeHtml(reviewLaneLabel(suggestion.lane))}</span>
          </div>
          <div class="quick-actions">
            <button type="button" data-review-action="approve" data-id="${video.id}">收录</button>
            <button type="button" data-review-action="reject" data-id="${video.id}">归档</button>
            <button type="button" data-review-action="needs_review" data-id="${video.id}">待复核</button>
          </div>
        ` : ""}
        ${scoreBars(video)}
      </div>
    </article>
  `;
}

function isNewCandidate(video) {
  return getNewCandidates([video]).length > 0;
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

function bindReviewActions(container, videos) {
  const byId = new Map(videos.map((video) => [video.id, video]));
  $(container).querySelectorAll("[data-review-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const video = byId.get(button.dataset.id);
      if (!video) return;
      saveReviewDecision(video, button.dataset.reviewAction);
      renderNewCandidates();
    });
  });
}

function openDrawer(video) {
  if (!video) return;
  const suggestion = getReviewSuggestion(video);
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

    ${isNewCandidate(video) ? `
      <div class="drawer-section">
        <p class="eyebrow">机器审核建议</p>
        <div class="tag-line">
          <span class="mini-tag">${escapeHtml(suggestion.action)}</span>
          <span class="mini-tag">建议归类: ${escapeHtml(suggestion.bucket)}</span>
          <span class="mini-tag">建议层级: ${escapeHtml(suggestion.tier)}</span>
          <span class="mini-tag">置信度: ${escapeHtml(confidenceLabel(suggestion.confidence))}</span>
        </div>
        <p style="margin-top:12px">${escapeHtml(suggestion.reason)}</p>
        <div class="drawer-actions">
          <button type="button" data-review-action="approve" data-id="${video.id}">收录</button>
          <button type="button" data-review-action="reject" data-id="${video.id}">归档</button>
          <button type="button" data-review-action="needs_review" data-id="${video.id}">待复核</button>
        </div>
      </div>

      <div class="drawer-section">
        <p class="eyebrow">人工处理记录</p>
        <div class="tag-line">
          <span class="mini-tag">来源: 自动更新</span>
          <span class="mini-tag">加入时间: ${escapeHtml(shortDate(video.addedAt))}</span>
          <span class="mini-tag">人工状态: ${escapeHtml(manualStatusLabel(video.manualStatus || "unreviewed"))}</span>
        </div>
        <p style="margin-top:12px">${escapeHtml(video.manualNote || "如需正式收录或归档，可把下面这段记录写入 data/manual-review.json。")}</p>
        <pre class="review-snippet">${escapeHtml(manualReviewSnippet(video, suggestion))}</pre>
      </div>
    ` : ""}

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
  bindReviewActions("#drawerContent", [video]);
  $("#detailDrawer").classList.add("open");
  $("#detailDrawer").setAttribute("aria-hidden", "false");
}

function manualReviewSnippet(video, suggestion) {
  return `"${video.id}": ${JSON.stringify(buildReviewRecord(video, suggestion.lane === "archive_candidate" ? "reject" : "approve"), null, 2)}`;
}

function buildReviewRecord(video, action) {
  const suggestion = getReviewSuggestion(video);
  const today = new Date().toISOString().slice(0, 10);
  const statusMap = {
    approve: "approved",
    reject: "rejected",
    needs_review: "needs_review",
  };
  const tierMap = {
    approve: suggestion.tier === "Archive" ? video.tier || "C" : suggestion.tier,
    reject: "Archive",
    needs_review: suggestion.tier === "Archive" ? video.tier || "C" : suggestion.tier,
  };
  const priorityMap = {
    approve: suggestion.lane === "high_priority" ? "High" : "Medium",
    reject: "Low",
    needs_review: "Medium",
  };
  const noteMap = {
    approve: `收录：${suggestion.reason}`,
    reject: `归档：${suggestion.reason}`,
    needs_review: `待复核：${suggestion.reason}`,
  };
  return {
    manualStatus: statusMap[action] || "needs_review",
    tierOverride: tierMap[action] || video.tier || "C",
    priorityOverride: priorityMap[action] || "Medium",
    roleOverride: video.role || "",
    reviewer: "",
    reviewedAt: today,
    note: noteMap[action] || suggestion.reason,
  };
}

function saveReviewDecision(video, action) {
  state.reviewDecisions[video.id] = buildReviewRecord(video, action);
  persistReviewDecisions();
  renderReviewDraft();
}

function loadReviewDecisions() {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function persistReviewDecisions() {
  try {
    localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(state.reviewDecisions));
  } catch {
    // If browser storage is unavailable, keep the draft in memory for this session.
  }
}

function renderReviewDraft() {
  const draft = $("#reviewDraft");
  const count = $("#reviewDraftCount");
  const focusList = $("#reviewFocusList");
  if (!draft || !count) return;
  const entries = Object.entries(state.reviewDecisions);
  count.textContent = `${entries.length} 条`;
  draft.textContent = entries.length ? JSON.stringify(state.reviewDecisions, null, 2) : "尚未标记候选。";
  if (!focusList) return;

  const videoById = new Map((state.data?.videos || []).map((video) => [video.id, video]));
  const needsReview = entries
    .filter(([, record]) => record.manualStatus === "needs_review")
    .map(([id, record]) => ({ id, record, video: videoById.get(id) }))
    .filter((item) => item.video);

  if (!needsReview.length) {
    focusList.innerHTML = `
      <div class="review-empty">
        <p class="eyebrow">本轮待复核</p>
        <strong>0</strong>
        <span>只有你点击“待复核”的条目会进入这里。</span>
      </div>
    `;
    return;
  }

  focusList.innerHTML = `
    <div class="review-focus-head">
      <div>
        <p class="eyebrow">本轮待复核</p>
        <h3>${needsReview.length} 条需要二次判断</h3>
      </div>
      <span>建议集中处理，不需要逐条重看全部新增候选。</span>
    </div>
    ${needsReview.map(({ video, record }) => `
      <article class="review-focus-item">
        <div>
          <strong>${escapeHtml(video.title)}</strong>
          <p>${escapeHtml(video.channel)} · ${shortDate(video.publishedAt)} · ${fmt(video.views)} views</p>
          <span>${escapeHtml(record.note || getReviewSuggestion(video).reason)}</span>
        </div>
        <a href="${video.url}" target="_blank" rel="noreferrer">打开</a>
      </article>
    `).join("")}
  `;
}

function exportReviewDecisions() {
  const text = JSON.stringify(state.reviewDecisions, null, 2);
  const blob = new Blob([`${text}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `manual-review-draft-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
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

function manualStatusLabel(value) {
  const labels = {
    approved: "通过",
    rejected: "不保留",
    needs_review: "待复核",
    unreviewed: "未判断",
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
    lastAutomationRunAt: "",
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
    const count = Math.min(34, Math.floor(window.innerWidth / 42));
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
        const limit = 130 * window.devicePixelRatio;
        if (distance < limit) {
          const alpha = (1 - distance / limit) * 0.06;
          ctx.strokeStyle = `rgba(255, 214, 74, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(point.x, point.y);
          ctx.lineTo(other.x, other.y);
          ctx.stroke();
        }
      }

      const pulse = 1.5 + Math.sin(time / 700 + point.phase) * 0.9;
      ctx.fillStyle = "rgba(255, 184, 0, 0.16)";
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

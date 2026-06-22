window.DASHBOARD_AUTOMATION = {
  mode: "static_mvp",
  statusLabel: "GitHub 自动更新",
  lastSourceUpdate: "2026-06-22",
  lastAutomationRunAt: "2026-06-22T07:39:35Z",
  plannedCadence: "GitHub Actions 每周自动更新",
  owner: "Strategy / Research",
  dataContractVersion: "dashboard-data.v1",
  sourceWorkbook: "GitHub repository / YouTube Data API",
  publishTarget: "data/dashboard-data.js",
  futureIntegrations: [
    "YouTube Data API 定期抓取",
    "评分脚本自动生成 v1.3 结果",
    "人工复核字段回写",
    "飞书多维表格同步"
  ],
  pipelineSteps: [
    {
      name: "采集",
      current: "手动导入 YouTube 结果文件",
      target: "定时抓取频道、关键词搜索结果与视频元数据"
    },
    {
      name: "评分",
      current: "基于 v1.3 评分结果生成静态数据",
      target: "抓取完成后自动运行评分、质量复核与元数据异常检测"
    },
    {
      name: "复核",
      current: "S 级样本已人工走查",
      target: "在复核队列中沉淀人工判断、备注和处理状态"
    },
    {
      name: "发布",
      current: "离线 HTML 页面读取本地数据包",
      target: "同步到飞书多维表格，并由网页读取最新发布数据"
    }
  ]
};

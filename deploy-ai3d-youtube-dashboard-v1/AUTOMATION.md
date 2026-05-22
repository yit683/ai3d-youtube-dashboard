# 自动更新方案

## 目标状态

GitHub 仓库是线上看板的数据源。GitHub Actions 每周运行一次：

1. 读取 `YOUTUBE_API_KEY` 这个 GitHub Secret。
2. 根据 `config/sources.json` 抓取近期 YouTube 视频。
3. 更新已有视频的公开元数据，例如播放量、评论数、标题。
4. 将新增视频加入候选池。
5. 合并 `data/manual-review.json` 中的人工复核结果。
6. 写回 `data/dashboard-data.js`。
7. 自动提交到 GitHub。
8. Netlify 监听到 GitHub 更新后自动重新部署网页。

## 是否还存在本地数据

上线后，本地文件只作为开发副本。真正会被网页读取的是 GitHub 仓库里的文件。

你每次手动修改后，需要 commit 到 GitHub。自动任务产生的新数据也会 commit 到 GitHub。

## API Key 放在哪里

不要把 YouTube API key 写进任何文件。

在 GitHub 仓库里设置：

`Settings -> Secrets and variables -> Actions -> New repository secret`

名称：

`YOUTUBE_API_KEY`

值：

你的 YouTube Data API key。

## 人工复核怎么做

网页里的 `新增候选` 会展示自动更新发现、但尚未人工确认的视频。这个页面用于每周快速查看新内容，不会影响已经确认过的 S 级样本。

人工复核结果写在：

`data/manual-review.json`

每条记录按 YouTube `video_id` 保存，例如：

```json
{
  "lkZ69q6ILEU": {
    "manualStatus": "approved",
    "tierOverride": "S",
    "priorityOverride": "High",
    "reviewer": "MT",
    "reviewedAt": "2026-05-22",
    "note": "可作为 S 级样本保留"
  }
}
```

自动更新脚本会保留并应用这些人工字段。也就是说，自动抓取不会覆盖你已经手动筛选过的内容。

## 配额与成本

- GitHub 仓库：免费。
- GitHub Actions：私有仓库 Free 计划通常有每月免费分钟数；每周一次基本够用。
- YouTube Data API：消耗 YouTube API quota，不消耗钱。`search.list` 成本较高，所以要控制 query 数量。
- Netlify：这个静态网页通常在免费额度内。

## 可调配置

`config/sources.json`

- `lookbackDays`：每次抓最近多少天
- `maxQueriesPerRun`：每次最多跑多少关键词
- `maxResultsPerQuery`：每个关键词最多取多少条
- `searchQueries`：关键词池
- `channelIds`：重点监控频道

## 当前注意事项

当前自动脚本会对新增视频做保守候选评分，不会自动把新增视频提升到 S/A。精确 v1.3 评分逻辑后续可以继续接入。

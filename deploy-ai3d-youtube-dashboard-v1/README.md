# AI 3D YouTube Research Dashboard

这是一个纯静态网页，可直接部署到 Netlify、Vercel 或其他静态网站托管服务。

## Netlify Drop

1. 打开 https://app.netlify.com/drop
2. 将整个 `deploy-ai3d-youtube-dashboard-v1` 文件夹拖入页面
3. Netlify 会生成一个可访问链接

## 文件说明

- `index.html`：页面入口
- `assets/`：样式与交互脚本
- `data/`：看板数据与自动化配置
- `config/sources.json`：自动更新使用的关键词与频道配置
- `scripts/update_youtube_dashboard.py`：YouTube 定期更新脚本
- `.github/workflows/update-dashboard.yml`：GitHub Actions 定时任务
- `netlify.toml`：Netlify 静态站点配置

## 自动更新

自动更新说明见：

`AUTOMATION.md`

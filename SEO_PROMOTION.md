# SEO 与推广指南

站点主域（canonical / sitemap）：`https://www.loong.click`（裸域 `https://loong.click` 建议在 DNS/CDN 301 跳转到 www，避免 SEO 权重分散）

## 技术 SEO 已落地

- `robots.txt`、`sitemap.xml`（根目录，经 server 提供）
- 首页与 7 个产品页：`title`、`description`、Open Graph、Twitter Card、canonical
- 首页结构化数据（Organization + WebSite）
- 产品页 JSON-LD（SoftwareApplication）
- `/user.html`、`/recharge.html`：`noindex`（robots.txt 亦 Disallow）

## 统计代码配置

编辑 [`shared/site-config.js`](shared/site-config.js)：

```js
gaMeasurementId: "G-XXXXXXXXXX",  // Google Analytics 4
baiduTongjiId: "xxxxxxxx",        // 百度统计 hm.js 站点 ID（可选）
```

在需要统计的页面已引入：

```html
<script src="/site-config.js"></script>
<script src="/seo-analytics.js" defer></script>
```

部署后请到 [Google Search Console](https://search.google.com/search-console) 与 [百度搜索资源平台](https://ziyuan.baidu.com/) 验证域名并提交：`https://www.loong.click/sitemap.xml`

## UTM 推广链接规范

在分享链接后追加参数，便于在 GA4 / 百度统计中区分渠道：

| 参数 | 说明 | 示例 |
|------|------|------|
| `utm_source` | 来源 | `wechat`、`xiaohongshu`、`qr` |
| `utm_medium` | 媒介 | `group`、`post`、`print` |
| `utm_campaign` | 活动名 | `2026spring`、`class3` |

**示例：**

```
https://www.loong.click/minimaths.html?utm_source=wechat&utm_medium=group&utm_campaign=2026spring
https://www.loong.click/?utm_source=xiaohongshu&utm_medium=post&utm_campaign=minimaths_intro
https://www.loong.click/minimaths.html?utm_source=qr&utm_medium=print&utm_campaign=parent_meeting
```

B2B 官网分享：

```
https://www.loong.click/?utm_source=linkedin&utm_medium=post&utm_campaign=polybox_services
```

## 推广渠道建议（运营）

### 教育产品（学生 / 家长）

1. **线下二维码**：使用 [`assets/minimaths-qr.png`](assets/minimaths-qr.png)，指向带 `utm_source=qr` 的 MiniMaths 链接。
2. **微信**：班级群 / 家长群分享产品直达链接 + 卡片图（依赖各页 `og:image`）。
3. **小红书 / 短视频**：口算打卡、平方立方记忆、小古文、英语跟读等选题，主页链到 polybox 或单品页。
4. **学校 / 机构**：免费课后练习工具，换取班级统一使用。

### POLYBOX 企业（开发 / 电商）

1. 官网作名片：服务说明 + 产品矩阵（已完成）。
2. 技术社区 / LinkedIn：案例短文链回首页（可带 `utm_campaign=polybox_services`）。
3. 目录站 / 黄页：公司名 + 官网链接。

### 每月关注指标

- 搜索收录与自然点击（Search Console / 百度）
- 各产品页 UV、注册转化（`/user.html`）
- 分 `utm_campaign` 对比渠道效果

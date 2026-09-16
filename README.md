# 骰子派对 🎲

一个为亲子桌游准备的轻量掷骰子网页。选择 1–6 颗骰子，点击投掷，约两秒的立体翻滚动画后显示每颗点数与总和。

支持手机和电脑、音效开关、空格键投掷、最近 8 次记录以及减少动态效果偏好。设置和记录仅保存在当前浏览器，无需登录。点数通过浏览器 Crypto API 生成，拒绝取模偏差；每颗骰子独立取 1–6 的整数。

## 本地运行

需要 Node.js 22.12+。

```sh
npm install
npm run dev
```

## 验证与构建

```sh
npm test
npm run build
npm run preview
```

生产文件输出至 `dist/`，使用相对资源路径，可部署到 GitHub Pages 或任意静态网页托管服务。字体使用 Google Fonts，网络不可用时自动回退到系统中文字体；骰子、动画、声音均无外部素材依赖。

## GitHub Pages

仓库包含 `.github/workflows/deploy.yml`，推送到 `main` 后会运行测试、构建并部署。

在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。随后推送或在 Actions 页面手动运行部署工作流。

预期访问地址：<https://liuhongli.github.io/dice/>。

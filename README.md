# ChatKeeper · v0.6.5

我写的一个 ChatGPT 浏览器插件，用来查找提问、保存对话。支持 Chrome / Edge，可以导出 Markdown 或带目录、搜索的离线 HTML，无需 API Key。

## 安装

[下载安装包](https://github.com/lee-max99/ChatKeeper/releases/download/v0.6.5/ChatKeeper-0.6.5.zip) · [所有版本](https://github.com/lee-max99/ChatKeeper/releases)

1. 下载并解压安装包。
2. 打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式。
3. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的解压目录。

更新时替换原目录的文件，重新加载扩展，再刷新 ChatGPT 页面。请保留安装目录。目前尚未上架商店。

## 使用

打开已保存的 ChatGPT 对话，等待回答结束，点击页面右侧的小按钮。

- **提问目录**：点击跳转；历史提问尚未加载时会自动滚动加载。手动操作聊天页或按 Esc 可停止定位。
- **搜索**：筛选目录中的提问，不影响已经勾选的内容。
- **选择导出**：勾选问答，或按完整目录序号选择范围，支持不连续选择。
- **下载**：选择 Markdown / HTML，保存整段对话或所选问答。也可以通过浏览器工具栏图标导出。

下载不需要滚动聊天页。保存完成后会显示“已保存”；没有弹出保存窗口或下载失败时，可按 Ctrl+J 查看下载列表。扩展更新后若提示连接失效，刷新 ChatGPT 页面即可。

## 说明

导出的是当前会话的一条回答分支，不包含账号全部历史。图片、音频和附件保留名称或可用链接，不嵌入原文件；特殊工具内容可能无法完整还原。保存记录仍带未完成标记时，导出文件会提醒内容可能尚未完整保存。

插件依赖 ChatGPT 网页内部接口，网页变化可能影响使用。不支持临时对话、分享页面及尚未保存的对话。

对话处理在本地完成，不上传到第三方，也不保存登录令牌。扩展只记住浮窗位置、开关和导出格式。[隐私说明](docs/privacy.md)

## 开发

需要 Node.js 22.12+：

```sh
npm ci
npm test
npm run build
```

构建后加载 `dist`。浏览器测试使用隔离环境和模拟对话：

```sh
npx playwright install chromium
npm run test:e2e
npm run test:floating
```

第三方依赖许可见安装包中的 `THIRD_PARTY_NOTICES.txt`。

[更新记录](CHANGELOG.md) · [问题反馈](https://github.com/lee-max99/ChatKeeper/issues)

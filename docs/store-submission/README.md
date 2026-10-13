# Chrome / Edge 上架材料 · ChatKeeper 0.6.4

准备日期：2026-10-11。当前材料只准备提交，不表示已经上传或审核通过。

## 已准备

- listing-zh-CN.md：名称、简短介绍、详细介绍和搜索词。
- review-notes.md：英文审核操作说明、权限理由、登录要求和接口说明。
- privacy-disclosures.md：数据流与后台隐私填写参考。
- ../privacy.md 与 ../privacy-policy.html：隐私说明，含 Limited Use 声明和反馈入口。
- npm run prepare:store：检查并打包已构建的 dist，生成两家商店用图与独立上传 ZIP。

## 生成文件

先运行 npm run build，然后 npm run prepare:store。

输出在 artifacts/store-submission-0.6.4/：

- ChatKeeper-0.6.4-store.zip：两家商店可上传同一个 ZIP；根目录有 manifest.json，不含宣传图和源码。
- assets/icon-128.png：Chrome 商店图标；Edge 也接受至少 128 × 128 图标。
- assets/edge-logo-300.png：Edge 推荐尺寸的商店图标。
- assets/promo-440x280.png：Chrome 必填的小宣传图；Edge 可选。
- assets/marquee-1400x560.png：可选的大宣传图。
- assets/screenshot-*.png：1280 × 800，真实扩展/阅读器界面加说明边栏，聊天内容是合成测试示例。
- docs/：本套商店文档与静态隐私页面。
- package-report.json：版本、文件清单及 ZIP 哈希。材料生成依赖 artifacts 中由浏览器测试产生的界面截图；更新版本后先重新运行 npm run test:e2e 和 npm run test:floating。

## 发布者还需要完成

1. 注册 Chrome Web Store 开发者账号并按后台完成费用、两步验证、联系信息；注册 Microsoft Edge 扩展开发者账号并完成 Partner Center 要求的验证。账号实名资料、收费/付款信息由你本人填写。
2. 把隐私政策发布到公开地址。可先将 docs/privacy.md 推送到 GitHub，使用 https://github.com/lee-max99/ChatKeeper/blob/main/docs/privacy.md（若默认分支不同则修改地址）；必须实际打开检查最新政策已显示且无需登录。也可将 privacy-policy.html 部署到自己的网站或 GitHub Pages。本次未推送代码、启用 Pages 或填造公开 URL。
3. 填写真实可收信的发布者联系邮箱。主页用 https://github.com/lee-max99/ChatKeeper，支持入口用 https://github.com/lee-max99/ChatKeeper/issues。
4. 在两家后台上传 store.zip，填入中文文案、隐私政策地址、权限用途和审核说明，上传 assets 内的素材。Edge 简短介绍跟随 manifest.description；详细介绍满足其至少 250 字符要求。隐私勾选需按现场定义确认。
5. 提交前用本人已登录的 ChatGPT 做下表测试。确认通过后再点击提交审核。

## 上架前真实页面检查

| 检查 | 预期 |
| --- | --- |
| Chrome、Edge 安装此 ZIP 解压目录，刷新旧 ChatGPT 页 | 无加载错误，目录入口正常 |
| 短对话分别导出 MD / HTML | 开头、中间、结尾文字及代码对应 |
| 很长的已保存对话，页面只显示部分内容 | 导出仍含服务端保存的首尾内容，不因页面未渲染而截断 |
| 编辑提问或切换回答版本 | 只保留一条消息路径；无法唯一识别页面版本时使用保存的当前版本，不混入其他分支 |
| 选择两个不连续问答导出 | 只包含所选问答，保持原顺序 |
| 点击尚未加载的提问，随后按 Esc | 尝试定位，可停止，失败有反馈 |
| HTML 断网后打开、搜索、复制代码、打印 | 可读可搜索；打印包括所有已导出消息 |
| 取消保存、退出登录、正在生成、网络失败 | 提示相应结果，不误报保存完成 |
| 导出文件与扩展本地设置 | 不含访问令牌；设置不含聊天正文 |

自动化测试使用合成数据，不能替代上述真实网站检查；两家商店审核结果由审核方决定。

## 官方参考

- Chrome 图片规格：https://developer.chrome.com/docs/webstore/images
- Chrome 用户数据政策解释：https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- Chrome 账号注册：https://developer.chrome.com/docs/webstore/register/
- Edge 提交流程与素材规格：https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension

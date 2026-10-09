# 下载无文件但界面报已开始

## 根因和复现

0.6.2 的 background.ts 在 downloads.download 返回 ID 后立即回应 ok:true，浮窗随即显示“下载已开始”，工具栏也立即提示已交给浏览器；没有查询最终 state/error，且未校验 ID 是否有效。

隔离 Chromium 实测：Browser.setDownloadBehavior=deny 时 downloads.download 仍返回 ID=4，随后 search 显示 state=interrupted/error=USER_CANCELED。没有保存文件或弹出选择框，旧代码却报告已开始。短文件、约 12 MB 中文文件、100 个 emoji 的文件名在同一隔离环境均完成，所以未把大小或文件名断言为用户的原因。实际用户浏览器的阻止原因仍需下载错误信息确认。

## 修复

- background 的 DOWNLOAD 只确认有效任务 ID；新增 DOWNLOAD_STATUS，只接受同扩展工具栏或 ChatGPT 顶层页面，按 ID 查询并验证 byExtensionId。
- 公用 download-client 在两处 UI 发起保存后每 500 ms 检查状态，直到 complete/interrupted；最多等待两分钟，超时提示尚未确认，保留实际浏览器任务，不自动再发起下载。
- 返回完成文件的基本文件名；取消、阻止、磁盘不足、权限/路径等中断翻译成明确提示。仍申请 saveAs:true，浏览器是否允许保存由其自身处理，不绕过安全检查。
- 浮窗导航/重置后停止旧任务的状态跟踪和界面更新；浏览器已经开始的文件保存继续由浏览器管理。

## 验证结果

新增单元回归先复现未确认就报成功、遗漏后续中断、无 ID 仍报成功；覆盖正确状态确认、并行任务归属、超时、导航、来源和其他扩展下载记录隔离。两套浏览器测试通过真实扩展发起下载，模拟浏览器拒绝保存后检查错误及手动重试成功，常规成功检查也要求 UI 等到实际完成。

- `npm test -- --maxWorkers=2`：11 个文件、106 项测试通过。
- `npm run build`：类型检查和生产构建通过。
- `npm run test:e2e`：14 个工具栏/离线导出场景通过，报告为 `artifacts/browser-report.json`。
- `npm run test:floating`：29 个浮窗场景通过，报告为 `artifacts/floating-report.json`。
- 浏览器验证使用 Chromium 153 的隔离配置和模拟页面/接口，下载由真实扩展执行；不等同于用户登录后的 ChatGPT 页面或 Edge 实测。
- 独立只读代码审查未发现实质性正确性或回归问题。
- `artifacts/ChatKeeper-0.6.3.zip`：14 个文件，版本 0.6.3；每个 ZIP 条目均与构建目录逐项校验一致。SHA-256：`bee0d542ccfee9cb5a36b058d6ef79018e8f7980e5f88fb10d07faa2d89a6878`。

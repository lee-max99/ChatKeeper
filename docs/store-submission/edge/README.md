# Edge 上架操作指南 · ChatKeeper

核对日期：2026-10-29。材料基于项目 v0.7.5 的 README、manifest 和隐私说明整理；未上传、未提交审核。

## 材料与状态

- 候选安装包：artifacts/edge-submission-0.7.5/package/ChatKeeper-0.7.5-edge.zip。已与原始发布包核对 SHA-256；上一轮核对运行文件与构建一致。真实 Edge/ChatGPT 最终测试仍待执行。
- 可用图标：public/icons/128.png，达到 Edge 最低尺寸。300×300 是推荐尺寸，可后续制作；不需要为凑尺寸放大图标。
- 商店中文文案：listing-zh-CN.txt。
- 权限及英文审核说明：review-and-privacy.txt。
- Edge 专用隐私政策：privacy-policy.md / privacy-policy.html，已补充 Edge 适用范围及用户控制。需发布为公开网址，不能提交本地路径。
- 已备三张 1280×800 截图：提问目录、选择导出、离线阅读器；使用扩展实际测试界面和演示数据。待补真实联系邮箱、公开 Edge 隐私网址、账号验证及真实 Edge 测试。

## 1. 注册开发者

打开 https://partner.microsoft.com/dashboard/microsoftedge/overview ，使用个人 Microsoft 账号登录。没有注册入口时进入 Account settings → Programs → Microsoft Edge → Get started。
选择实际国家/地区和 Individual（个人）或 Company（公司），填写发布者显示名称及联系方式，接受协议并完成后台要求的验证。国家/地区和账号类型注册后不可直接修改。Edge 开发者注册免费；不要误走 Windows 应用商店注册流程。

## 2. 确认包并在 Edge 测试

将候选 ZIP 解压到独立目录。在 Edge 地址栏输入 edge://extensions，开启开发者模式，点击“加载解压缩的扩展”，选择直接包含 manifest.json 的目录。已有同名开发版时先禁用，避免重复浮窗。
刷新已登录的 ChatGPT 页面，使用不含隐私的已保存测试对话，逐项检查：目录定位、选择两组不连续问答、完整导出 Markdown 和 HTML、含图片导出、断网打开 HTML、取消下载、刷新和切换会话。核对下载文件首尾内容与选择范围；检查扩展管理页是否有错误。
材料生成命令为 node scripts/prepare-edge-materials.mjs；它复用并校验已验证的 0.7.5 发布包，生成文案与截图，不暗中重建安装包。源码改动后需重新验证发布包。

## 3. 准备隐私网址

已有通用政策 https://github.com/lee-max99/ChatKeeper/blob/main/docs/privacy.md 可公开读取。但本次 Edge 专用版本尚未发布。请公开本目录 privacy-policy.html 或 privacy-policy.md，然后填写实际可访问的对应网址。
用未登录浏览器打开，确认无需登录、文字完整、版本和数据流与最终安装包一致。若线上旧版，先更新公开文件。也可以使用自己的 HTTPS 静态网页。

## 4. 创建草稿并上传

Partner Center → Edge → Create new extension → 上传最终 ZIP。等待校验通过；解压后第一层必须有 manifest.json。宣传图和商店说明不需要放入插件运行包。

## 5. 填写后台各页

- Availability：选择 Public（公开）或后台提供的目标可见性，选择发布市场。
- Properties：选择 Productivity 或最接近的分类，填写实际支持信息和相关网址。
- Privacy：粘贴单一用途、逐项权限理由，按最终包确认远程代码及数据使用声明，填写公开隐私政策 URL。参考 review-and-privacy.txt，遇到“收集”定义时按后台说明逐项判断，不自动全选或全不选。
- Store listings：添加简体中文，粘贴 listing-zh-CN.txt 的详细介绍，上传 128×128 图标。简短介绍跟随 manifest.description；要改它须改包并重新上传。
- 截图可选但建议上传；最多 6 张，1280×800 或 640×480。小宣传图可选 440×280，大宣传图可选 1400×560 PNG。
- 每页 Save draft / Save & Continue，直到各项完整。

## 6. 提交审核

点击 Publish 进入提交页，将 review-and-privacy.txt 的 Reviewer notes 段落填入 Notes for certification。确认描述、权限、截图与最终安装包一致，再点击最终 Publish 提交认证。
不要在审核说明里提供个人 ChatGPT 密码、Cookie 或访问令牌。插件依赖 ChatGPT 登录，说明审核员需用自己的账号创建测试会话；若审核方另需测试访问，再单独安排专用方式。
提交后在后台看状态和邮件。审核未通过时根据具体原因修改材料或包；更新包时递增版本。审核时长以后台实际情况为准。

官方资料：
https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account
https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension

## 可用材料目录

完整目录：artifacts/edge-submission-0.7.5/，先读 START-HERE.txt。提交商店时只上传 package/ 内的 ZIP；外层材料 ZIP 仅用于保存或传递材料，不能作为扩展安装包上传。

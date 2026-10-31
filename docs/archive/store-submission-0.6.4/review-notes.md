# Reviewer notes — ChatKeeper 0.6.4

## Single purpose

Navigate and save the currently opened, saved ChatGPT conversation. The question outline, navigation, selective export and offline reader all serve this purpose. The current UI is in Simplified Chinese.

## Review steps

1. Install the submitted ZIP in a Chromium browser. Sign in at https://chatgpt.com with a reviewer-controlled account. No ChatKeeper account or OpenAI API key is required. A saved conversation is required; temporary chats and shared pages are unsupported.
2. Create or open a saved conversation containing at least two questions. Wait until generation finishes. Refresh an already-open ChatGPT tab after installing the extension.
3. Click the small outline button at the right of the conversation. Click a question to navigate. Clicking an unloaded historical question attempts bounded scrolling, which can be cancelled.
4. Select Markdown or HTML in the outline footer and click 下载 (Download). The browser may ask where to save the file. Alternatively open the toolbar popup, edit the file title if desired and export there.
5. Click 选择 (Select), select a question and click 导出所选 (Export selected). Only selected question/answer groups should appear. 完成 exits selection mode.
6. Open the downloaded HTML locally. Test its outline, search, code-copy and print features. The file does not automatically fetch external scripts, fonts or images. External links are opened only by user action.

## Permissions and access

- activeTab: access the active ChatGPT tab when the user opens the toolbar export UI.
- scripting: inject the extension's bundled reading/export code into the current ChatGPT tab, including when an already-open tab has no content script.
- downloads: save requested files and check completion/interruption for the specific download created by this extension. It does not enumerate unrelated downloads.
- storage: store local outline visibility, position and selected export format. No conversations, titles, URLs or tokens are persisted here.
- content_scripts match https://chatgpt.com/*: show the question-outline entry and follow conversation changes. No content scripts run on other sites.

## Data flow and network

When export, selection or documented outline fallback/update needs saved records, the page code accesses /api/auth/session and temporarily uses the returned access token to request the current conversation at the same ChatGPT origin. This is not a remote-code request. The token stays in page memory and is not included in files, logs, extension storage or messages to the popup. Records are processed locally; there is no developer-operated upload, analytics or advertising endpoint.

Opening a collapsed outline button alone does not fetch full records. An expanded outline normally reads rendered question text; if no questions are recognizable it may read saved records automatically once for that URL, with retries and delayed updates as explained in the privacy policy. Export uses one message path from the currently opened conversation, never an account-wide archive or a merge of branches. If visible message IDs cannot uniquely identify a selected answer version, the stored current version is used.

All executable extension code and conversion libraries are packaged locally. The extension does not download executable JavaScript. Third-party library notices are included in the ZIP.

## Known limitations and test scope

ChatGPT's internal web endpoints can change and are not a supported public API. Authentication, workspace policies, unsaved content and unsupported attachment/tool representations can affect results. Source attachments are not embedded. A file is limited to 10 million characters.

Automated tests use synthetic conversations and mocked ChatGPT responses, including long conversations and selection/download scenarios. Store images also use synthetic data. These tests are not evidence of live ChatGPT compatibility for every account or workspace. The publisher should perform the live checks in README.md immediately before submission.

Support: https://github.com/lee-max99/ChatKeeper/issues

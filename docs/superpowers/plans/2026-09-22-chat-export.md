# ChatGPT Export Implementation Plan

> 历史开发记录：本文描述当时的设计或验证结果，可能与当前版本不同。当前行为以根目录 README 和源码为准。

> For agentic workers: use superpowers:executing-plans inline; user authorized implementing the agreed design. Track progress here.

**Goal:** Build a locally loadable extension exporting the current ChatGPT branch as Markdown and HTML.
**Architecture:** Content script collects structured messages; extension popup transforms them; service worker starts downloads independent of popup lifetime.
**Tech Stack:** TypeScript, Vite, esbuild (content/worker bundles), Turndown, DOMPurify, Vitest/jsdom, Playwright.
**Spec:** `docs/superpowers/specs/2026-09-22-chat-export-design.md`

## Global Constraints
- Chrome / Edge Manifest V3; Chinese UI.
- Only activeTab, scripting, downloads permissions. No external services.
- Always disclose DOM capture completeness is unverified.
- Only selected branch; remote assets remain links, HTML body is offline-readable.
- Empty directory is not a Git repository; work directly in the provided workspace without creating unrelated branches or commits.

## Review Focus
- Virtualized messages disappearing while scrolling: keep observed messages and honest scope warnings.
- Repeated identical prompts: do not deduplicate by text.
- Malicious DOM/URLs: no executable exported content or automatic remote asset requests.
- Markdown fences, tables and math: preserve content across both exports.
- Popup closure/navigation/generation/download cancellation: no false completion or mixed conversations.

## Task 1: Extraction and exporters
- [ ] Create package/config, typed `Conversation` / `ChatMessage`, fixtures and failing unit tests.
- [ ] Run `npm test`; verify missing extraction/conversion behavior fails.
- [ ] Implement `collectSnapshot(document, url): Conversation`, `renderMarkdown(conversation): string`, `renderHtml(conversation): string`, `safeFilename(title, extension): string`.
- [ ] Verify roles/order, same-text messages, fences, tables, TeX, unsafe content, non-supported URL, empty/generating conversations.
- [ ] Run `npm test` and `npm run typecheck`; expected green.

## Task 2: Extension interaction and long capture
- [ ] Add regression tests for merging/order/cancellation/navigation and implement bounded scrolling.
- [ ] Build manifest, idempotent content listener, popup interface and background download handler.
- [ ] Validate URLs in content and popup; reject empty exports; do not fabricate creation timestamps.
- [ ] Run unit suite and build; expected dist with manifest, popup and local bundles.

## Task 3: Browser validation and packaging
- [ ] Install/use Playwright Chromium in a separate test profile; route ChatGPT fixture only within that test browser.
- [ ] Test loaded extension, both actual downloads, invalid site, generation guard and HTML offline rendering.
- [ ] Inspect popup and generated HTML screenshots; fix material issues.
- [ ] Independent final review of the implementation; resolve important findings with regression tests.
- [ ] Write README and test evidence; produce ZIP containing only the loadable extension and installation notes.

## Progress
- Design and plan recorded. User instruction to proceed supplies implementation authorization; no repeated approval gate.

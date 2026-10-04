# Selected conversation export implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Select complete question-and-answer groups in the floating directory and export only those groups as Markdown or offline HTML.

**Architecture:** Read the complete current saved path when entering selection mode. Keep selected API question IDs in page memory, snapshot them when download starts, and filter a fresh conversation before the existing exporters run. Each group contains one user message and all following assistant messages up to the next user message.

**Tech Stack:** TypeScript, Shadow DOM, Vitest, Playwright, existing MV3 extension APIs.

**Spec:** User approved the in-chat design on 2026-10-04: compact selection entry, noncontiguous Q&A groups, select all/clear, selected count, existing MD/HTML formats and original order. Normal directory navigation remains unchanged.

## Global constraints

- Only the current saved message path; never add other conversations or branches.
- Default directory stays compact; checkboxes and select-all controls appear only in selection mode.
- Selection is not persisted and clears on conversation navigation or leaving selection mode.
- Toolbar export continues exporting the whole current conversation.
- Empty selection cannot download; a changed or removed selected question cannot silently produce a full or different export.
- No new dependencies or permissions. Keep current URL/generation/cancellation guards.

## Review focus

- Partially loaded DOM: selection must list saved history, including duplicate prompts with distinct IDs.
- Consecutive assistant messages: export every answer belonging to a selected question.
- Stale or changed saved path: snapshot validation must prevent exporting the wrong selection.
- Download races: freeze the selection at download start, including joining an outline read.
- Navigation/reset and select-all/clear: do not retain old IDs or accidentally export everything.

### Task 1: Q&A filtering

**Files:** Create `src/conversation-selection.ts`, `tests/conversation-selection.test.ts`.
**Interface:** `selectQuestionGroups(data: Conversation, questions: readonly ChatMessage[]): Conversation` validates selected question IDs/content, filters messages in source order, copies metadata, and adds a selected-export notice.

- [x] Write tests for noncontiguous/reversed choices, multiple answers, pending last question, empty/missing/edited choices, duplicate prompt IDs, metadata filtering and non-mutation.
- [x] Run targeted tests and observe missing selection behavior: 10 assertions failed with a temporary pass-through scaffold.
- [x] Implement the filtering function; targeted tests pass.

### Task 2: Floating selection and download

**Files:** Create `src/floating-selection.ts`; modify `src/floating.ts`, `src/floating-style.ts`, `src/floating-download.ts`, `tests/floating-download.test.ts`, `tests/floating.mjs`.
**Interfaces:** Download lifecycle exposes `prepareExport?: () => (data: Conversation) => Conversation`; download controls expose `availability(label: string, disabled: boolean)` and `downloading`. Selection controller handles entry/exit, checkbox controls, counts, full-record readiness, reconciliation, snapshot filtering and reset.

- [x] Add failing download tests for filtering, snapshot stability and rejecting changed selections without sending a file.
- [x] Add failing browser scenario covering full saved history from a partially loaded page, noncontiguous MD/HTML exports, select-all/clear, pending-read controls and reset.
- [x] Implement selection controller, compact controls/styles and existing download integration; targeted tests/build pass, browser suite rerunning after controls fix.

### Task 3: Verification and installable package

**Files:** Update README, CHANGELOG, privacy notes, package/lock/manifest versions to 0.6.0.

- [x] Run `npm test`, `npm run build`, `npm run test:floating`, `npm run test:e2e`; inspect outputs and selection screenshot.
- [x] Review the final change, address consequential findings, and record verification below.
- [x] Copy distribution docs and create `artifacts/ChatKeeper-0.6.0.zip`; verify archive matches built files.

## Execution record

- Starting commit: `0b43c7f`. Workspace was clean. Continue in the existing checkout; keep changes uncommitted and package locally, consistent with this conversation's delivery method.

- Task 1: filtering tests RED (whole path returned, no rejection) → GREEN, 8 tests.
- Task 2: snapshot integration RED (unselected text exported) → GREEN; browser RED missing selection control, then RED select-all stayed disabled after successful download. Added lifecycle state notification to restore controls on completion/error.
- Fresh unit suite: 84/84 passed; build/typecheck passed for 0.6.0. Floating browser rerun: 27 scenarios passed, no page errors, including selected MD/HTML actual file checks. Original full-export browser suite running.

- Task 3: 84 unit tests, build/typecheck, 27 floating browser scenarios and 12 full-export browser scenarios passed. Both browser reports have no page errors; selection screenshot inspected. Browser checks use isolated Chromium with simulated ChatGPT responses, not a live logged-in account.
- Final independent review: no consequential findings. Reviewer additionally exercised removed-selection + pending-outline-read + retry using the actual controllers: no wrong file; stale selection clears, controls recover, retry succeeds.

- Local package: ChatKeeper-0.6.0.zip, 14 archive files matched the built distribution by SHA-256. No commit, push, release publication or user browser changes performed.

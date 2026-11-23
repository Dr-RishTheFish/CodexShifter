# Codex Shifter local correctness review

Review completed against the initial untracked source tree, before subsequent fixes. Report-only; no application source changed by reviewer.

Verdict: Ready with fixes. Two concrete lifecycle findings and one telemetry issue require resolution.

| # | Severity | Location | Finding | Recommended fix |
|---|---|---|---|---|
| 1 | P2 | Resources/app.js:44,58 | Disconnect clears busy state but retains the active thread ID. Reconnect creates a fresh app-server without resuming that thread; the next send skips thread/start and addresses an unloaded thread. | Resume the saved active ID after reconnect, or clear it and require selection/create a new session. |
| 2 | P2 | Sources/main.swift:96-100 | Closing the last window first destroys the visible window, then the application termination confirmation can return terminateCancel on Keep working. There is no windowShouldClose interception or reopen handler, so the user loses the console while Codex keeps running. | Confirm before closing the window, preserve it on cancellation, and support reopening. |

| 3 | P2 | Resources/app.js:29,31,34,53 | Resuming resets lastOutput to zero, while the next token usage event reports cumulative thread output. The displayed RPM therefore includes all historical output on the first resumed turn. | Initialize the per-turn baseline from reported last-turn versus cumulative usage, or establish a baseline before measuring. |

## Evidence and validation

Read the complete Swift process bridge, JavaScript UI/session logic, model-selection core, HTML, build script, and both test files. Traced each finding through its callers and state transitions. Ran `node --test Tests/core.test.cjs`: 5 tests passed, 0 failed. These tests validate model selection but do not exercise the reconnect or window-close paths.

Additional coverage limits: native window behavior and end-to-end reconnect were not interactively reproduced by this reviewer. Parent task independently runs live integration/UI checks. CSS visual layout was not assessed here. No cross-model external review ran. No concrete script injection path was found: output uses textContent, navigation is restricted to bundled file URLs, the native bridge checks the main frame and resource directory, and CSP blocks network connections.

## Skill execution boundary

Read ce-code-review SKILL.md and scope/mode references. Its normal scope requires a base and excludes untracked files; this repository is unborn and the caller expressly requested review of its initial untracked source. Consequently this is a completed bounded manual review, not a completed formal CE pipeline or merge-ready certification. No governing criteria/config file was present in the repository search; artifact root defaults to docs. No source mutations were performed. This receipt records findings in the original reviewed state; later fixes require verification by the implementer.

## Scope update

The implementer subsequently created an empty baseline and marked initial sources intent-to-add. The official review-scope helper then reported 314 changed lines, 219 executable non-test lines, size_band=large, and hard_block_full=true. A formal skill review therefore requires the full multi-agent spine; this bounded source review does not claim that completion. The implementer is addressing findings concurrently; line numbers and findings refer to the original source snapshot.

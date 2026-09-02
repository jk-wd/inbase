---
name: example-target-visual-edits
description: >-
  Grounds example-target code changes in the Visual Coder map. Use when
  creating, editing, or deleting files under apps/example-target, including
  when the user chats a change request without /inbase. Connects this chat to
  the next empty Inbase session, or to a color with /coral /red /amber and
  the other session colors. Always works via the plan. A later change
  request must report-plan from the last proposal before editing. List every
  feature step, then edit live example-target files after invocation and
  record each step with inbase propose-patch (no patch file). Do not use for
  explorer, Vite, Three.js, or other non-target changes.
---

# Example-target visual edits

Apply this skill **only** when the work is file changes in `apps/example-target`.
Skip it for explorer, layout, lighting, or other Visual Coder app work.

Follow `skill/inbase/SKILL.md` for the chat-driven sequence (`attach`,
`read-blueprint`, say what you see on the blueprint, `report-plan`, then
stop for `/go`, `/accept`, `/explain`, or a later change request). Always work via the
plan. A change request must `report-plan` first: replace the waiting step
from the last proposal with the new remaining steps, then implement.
After `VISUAL_CODER_EXECUTE`, edit files under `apps/example-target` with Write,
StrReplace, and Delete for that step only, then `npx inbase propose-patch` with
no patch file. Do not run `wait-for-approval` or `explain wait`.

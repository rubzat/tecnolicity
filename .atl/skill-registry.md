# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

See `_shared/skill-resolver.md` for the full resolution protocol.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When implementing a change, preparing commits, splitting PRs, or planning chained/stacked PRs | work-unit-commits | /Users/rubzat/.config/opencode/skills/work-unit-commits/SKILL.md |
| When drafting or posting feedback, review comments, maintainer replies, or async messages | comment-writer | /Users/rubzat/.config/opencode/skills/comment-writer/SKILL.md |
| When writing guides, READMEs, RFCs, onboarding docs, architecture docs, or review-facing docs | cognitive-doc-design | /Users/rubzat/.config/opencode/skills/cognitive-doc-design/SKILL.md |
| When a PR would exceed 400 changed lines, when planning chained/stacked PRs | chained-pr | /Users/rubzat/.config/opencode/skills/chained-pr/SKILL.md |
| When creating a GitHub issue, reporting a bug, or requesting a feature | issue-creation | /Users/rubzat/.config/opencode/skills/issue-creation/SKILL.md |
| When creating a pull request, opening a PR, or preparing changes for review | branch-pr | /Users/rubzat/.config/opencode/skills/branch-pr/SKILL.md |
| When user asks to create a new skill, add agent instructions, or document patterns for AI | skill-creator | /Users/rubzat/.config/opencode/skills/skill-creator/SKILL.md |
| When writing Go tests, using teatest, or adding test coverage (NOT applicable to this TS project) | go-testing | /Users/rubzat/.config/opencode/skills/go-testing/SKILL.md |
| When user says "judgment day", "review adversarial", "dual review", "juzgar" | judgment-day | /Users/rubzat/.config/opencode/skills/judgment-day/SKILL.md |

## Compact Rules

Pre-digested rules per skill. Delegators copy matching blocks into sub-agent prompts as `## Project Standards (auto-resolved)`.

### work-unit-commits
- Commit by work unit (one deliverable behavior/fix/migration), never by file type (models, then services, then tests is wrong)
- Keep tests in the SAME commit as the behavior they verify; keep docs with the user-visible change they explain
- Each commit must make sense alone and be rollback-safe without reverting unrelated work
- Message explains the outcome, not the file list
- If an SDD change forecasts >400 changed lines, group commits into chained-PR slices BEFORE implementation

### comment-writer
- Lead with the actionable point; do not recap the PR before giving feedback
- Warm and direct, 1-3 short paragraphs or tight bullet list; explain WHY when requesting a change
- Comment on the highest-value issue only, avoid pile-ons
- Match thread language; in Spanish use Rioplatense voseo (podés, tenés, fijate, dale)
- No em dashes; use commas, periods, or parentheses

### cognitive-doc-design
- Lead with the answer/decision; context comes after
- Progressive disclosure: happy path first, then edge cases and references
- Prefer tables, checklists, examples, and templates over prose (recognition over recall)
- For PR/review docs: state what to review first, what is out of scope, link prev/next PR when chained

### chained-pr
- MUST split when a PR exceeds 400 changed lines (additions+deletions) unless maintainer-approved `size:exception`
- Each PR targets a <=60-minute human review, one deliverable work unit, CI green, clear rollback, tests/docs included
- Every chained PR states: start, end, what came before, what is next, out of scope, plus a dependency diagram marking the current PR with `📍`
- Ask the user to choose Stacked-to-main vs Feature-Branch-Chain-with-tracker before proceeding; cache the answer
- Diff is source of truth: a child PR showing prior-PR changes means wrong base; retarget/rebase until diff is clean
- Tracker PR (Feature Branch Chain) is a map, not the review surface; stays draft/no-merge until the chain is complete

### issue-creation
- Blank issues disabled; MUST use a template (bug_report or feature_request)
- Every issue gets `status:needs-review` on creation; a maintainer MUST add `status:approved` before any PR opens
- Questions go to Discussions, not issues; search for duplicates first
- Fill ALL required fields including pre-flight checkboxes

### branch-pr
- Every PR MUST link an approved issue (`Closes/Fixes/Resolves #N`) and have exactly one `type:*` label
- Branch name MUST match `^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)\/[a-z0-9._-]+$`
- Commit messages MUST match conventional commits: `type(scope): description` (types: build chore ci docs feat fix perf refactor revert style test)
- No `Co-Authored-By` trailers in commits
- Type-to-label mapping: feat→type:feature, fix→type:bug, docs→type:docs, refactor→type:refactor, chore/style/test/build/ci→type:chore, perf→type:feature, revert→type:bug, feat!/fix!→type:breaking-change

### skill-creator
- Create a skill only when a pattern is repeated AND differs from generic best practice or needs step-by-step guidance
- Structure: `skills/{name}/SKILL.md` (+ optional `assets/`, `references/`); frontmatter needs name, description (with Trigger), license Apache-2.0, metadata.author + version
- `references/` points to LOCAL files only, never web URLs; do NOT add a Keywords section (agent searches frontmatter)
- Start with critical patterns, use tables for decision trees, keep examples minimal; register the skill in AGENTS.md after creation

### go-testing
- GO-ONLY skill; NOT applicable to this TypeScript project. Ignore unless the target is Go code.
- Table-driven tests for pure functions; test Model.Update() directly for Bubbletea state changes
- Use teatest.NewTestModel for full TUI flows; golden-file testing for visual output; t.TempDir() for file ops

### judgment-day
- Orchestrator NEVER reviews code itself; launches exactly TWO blind judge sub-agents in parallel via `delegate` (never sequential), neither knows the other exists
- Classify every WARNING as real (normal user can trigger it) or theoretical (contrived); theoretical → INFO, not fixed, not re-judged
- Round 1: present verdict, ask user before fixing; Round 2+: only re-judge if confirmed CRITICALs remain; fix real WARNINGs inline without re-judge
- APPROVED = 0 confirmed CRITICALs + 0 confirmed real WARNINGs; after 2 fix iterations, ASK user before continuing
- MUST NOT push/commit/summarize/"done" until every JD reaches APPROVED or ESCALATED; after Fix Agent, immediate next action is re-launching both judges

## Project Conventions

No project-level convention files found (no AGENTS.md, CLAUDE.md, .cursorrules, GEMINI.md, or copilot-instructions.md in the project root).

This is a greenfield project. Convention files should be created as the project takes shape (e.g., an AGENTS.md documenting the pnpm-workspace layout, backend/frontend boundaries, and TS-strict conventions).

Read the convention files listed above for project-specific patterns and rules. All referenced paths have been extracted.

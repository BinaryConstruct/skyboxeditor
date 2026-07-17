# Agent Guide — BinaryConstruct Skybox

Free procedural stellar skybox editor (skyboxeditor.com). TypeScript + React
+ three.js/WebGL2, fully client-side. MIT.

## Ground rules

- Determinism contract: no `Math.random` in generation/render — seeded
  `MsvcRng`/`PerlinNoise` streams only; new features derive new seed offsets
  so legacy sequences stay identical.
- Gate everything: `npm test`, `npm run build`, `npm run lint` must pass.
- Verify visuals yourself: build, serve `dist`, screenshot with Playwright,
  and read the screenshot before calling rendering work done
  (see Docs/Instructions/VERIFICATION.md).
- Git identity is repo-local (`BinaryConstruct`); never add Co-Authored-By
  or AI-attribution lines to commits.
- Scene JSON schema is generated from `src/core/io.ts` — after changing the
  field tables, regenerate with `npx vitest run src/core/schema.test.ts -u`.

## Documentation

Place all plans, subagent instructions and results, results, research in subfolders of
./Docs
- EPIC-LIST.md - constantly updated high-level goals, status, current focus, and links to plans/research/todos so project direction is never lost
- Design/ - durable developer-facing game design documentation. This is the
  real design and architecture reference for humans, not AI in-progress work.
  Keep class purpose, rules, setup, requirements, content authoring rules, and system
  architecture here. Structure it like a HacknPlan-style design model: a tree of
  game design elements that explains what is being built and links to execution
  docs when useful.
- Instructions/{name}.md - instructions, CLI and API tooling how to
- Research/{date-time}-{subject}.md - ALL research summaries, hard facts
- Plans/{date-time}-{task}.md - ALL tasks plans and PRD documents
- Subagents/{date-time}-{task}-{instructions,results}.md - REQUIRED ALL subagent launch prompts, ALL subagent results write here, even if they are returned inline
- DevTodo/{task}.md - implementation follow-up tasks that should remain manual/editor-facing or be picked up in later focused changes
- Blog/{date-time}-{task}.md - used for post-task analysis, what went well, what didn't work, what should be done better
etc.

Update `Docs/EPIC-LIST.md` whenever a high-level goal is added, completed,
blocked, materially descoped, or superseded.

# 两次 LLM 调用架构 — 评估与建议

## Context

用户提问：「通过 AI 先返回一个 assignment 结构体再让 AI adaptation，这样需要进行两次 AI 调用，是不是有问题？」

我的核实结论是：**两次调用的结构本身合理，但当前用法在成本、首次延迟、和重启后重做这三个维度上确实存在浪费**。用户确认三者都在意，所以最终方案是三项同时推进，**不动**两次调用的架构边界。

## 当前数据流（已读代码核实）

| 调用 | 触发点 | 频次 | 是否持久化 |
|---|---|---|---|
| Parse（PDF → Assignment）| `AssignmentManager.ts:39` 经 `parser.ts:103`（Tier 1）或 `:178`（Tier 2） | 每次导入 1 次 | ❌ 仅内存 |
| Adapt（Assignment → AdaptationResponse） | `NeurocodeController.ts:350` → `AdaptationEngine.ts:207` | 每次用户动作 1 次，**无缓存** | ❌ 仅内存 |
| 自动 full_adapt（紧跟导入） | `NeurocodeController.ts:322` | 每次导入强制 1 次 | ❌ |

整体成本是 `1 + N` 而非 `2N`，但 N 完全没有去重、Assignment 重启就丢、导入后又强制再跑一次 full_adapt — 三处真问题。

## 为什么不合并 Parse 和 Adapt

- **关注点分离** — Parse 不知道 profile，Adapt 不知道 PDF。合并会把 ScaffoldEngine（`ScaffoldEngine.ts:68` 也消费 Assignment）的依赖拖进来。
- **降级语义独立** — Parse 有 Tier 1/2，Adapt 有 MCP → provider → rule-based。合并会让降级矩阵变成 6 种组合。
- **缓存边界天然** — Assignment 跨 profile 跨 session 可复用，AdaptationResponse 只对当前 prefs 有效。合并就丢掉这条分界线。
- **测试性** — `parser.test.ts` 现在能脱离 LLM 跑 heuristic 路径。合并就毁了这个能力。

## 最终方案 — 三项并行修复

### 1. 持久化 Assignment（解决「重启重做」）

- **改动点：**
  - `src/shared/schemas/assignment.ts` — 给 `AssignmentSchema` 加 `sourceHash: z.string()`（PDF 内容 sha256，导入时计算）。
  - `src/features/assignments/AssignmentManager.ts:16-40` — 导入流程改成：先算 hash，查 `context.globalState["neurocode.assignments"]: Record<sourceHash, Assignment>`，命中直接返回；未命中才走 `parseAssignmentFile()`，结果写回 globalState。
- **复用：** `globalState` 已经用来存 `userPreferences` 和 `assignmentProgress`（见 `docs/architecture.md` § State management），照同样模式加一条。
- **不变式：** 写回前必须 `AssignmentSchema.safeParse(...)`，避免坏数据污染存储。
- **测试：** 在 `__tests__/AssignmentManager.test.ts`（若无则新建）里写两条 case — 「同 hash 命中走缓存路径」「不同 hash miss 进 parser」。

### 2. AdaptationEngine 内部 memoization（解决「重复点 Help 烧 token」）

- **改动点：**
  - `src/services/llm/AdaptationEngine.ts` — 在 engine 内部加一张 LRU，容量 20。Key = `${assignmentId}:${sectionId ?? "full"}:${profile}:${prefsHash}`。命中直接返回（带 `cacheHit: true` 注入到 receipt）。
  - `src/shared/schemas/adaptation.ts` — `BuildReceipt`（或包裹它的 `AdaptationResponseWithReceipt`）加 `cacheHit?: boolean`。
- **复用：** `prefsHash` 直接用 `UserPreferences` 上稳定字段的 JSON.stringify 取 sha；不要把 prefs 整体当 key，避免无关字段（如 timestamp）引起 miss。
- **失效：** profile 切换或 preferences change 时 controller 已经在调 `engine.invalidate()` 即可（新加一个方法清缓存）。
- **测试：** `AdaptationEngine.test.ts` 加 case — 同 key 第二次调用不应触达 provider stub；profile 切换后应 miss。

### 3. 取消 / 后台化导入后的自动 full_adapt（解决「首次导入感知延迟」）

- **改动点：**
  - `src/core/controller/NeurocodeController.ts:322` — 当前是导入完成同步触发 full_adapt 阻塞 UI。改成：
    - parse 完成立即 `renderer.render(assignment, prefs, undefined, "raw")` 把原始结构推给 webview（用户先看到东西）
    - full_adapt 改为 `void this.requestAdaptation("full_adaptation").catch(log)`，fire-and-forget，完成后通过 `adaptation_result` 消息覆盖渲染
- **不变式：** 复用现有的 `adaptationInProgress` 并发闸门（`controller.ts:81`），用户在 adapt 还没回来前点 Help，按现状走「等待 + 提示」，不退化体验。
- **测试：** 这部分主要靠手测 Extension Development Host（`docs/architecture.md` § Testing strategy 已经把 webview 交互列为「不直接单测」的区域）。可以在 controller 单测里加一条 — 「import 完成后 `adaptationInProgress` 立刻是 true 且 setHtml 已被调用」。

## 落地顺序（建议）

1. 先做 #2（AdaptationEngine 缓存）— 改动最小、最局部，能立刻砍掉相当一部分 token 浪费。
2. 再做 #3（异步化 full_adapt）— 改动也小，但触及 webview 渲染顺序，要手测。
3. 最后做 #1（Assignment 持久化）— 需要新加 schema 字段和 globalState key，最有可能误伤现有数据；放最后单独 PR。

每一步独立可上线，互不阻塞。

## 关键文件

- `src/features/assignments/AssignmentManager.ts:16,39`
- `src/features/assignments/parser.ts:103,178`
- `src/services/llm/AdaptationEngine.ts:207,229,265-271`
- `src/core/controller/NeurocodeController.ts:240,287,322,350`
- `src/shared/schemas/assignment.ts`、`src/shared/schemas/adaptation.ts`
- `docs/architecture.md` § State management（持久化模式）

## 验证

每步落地后跑：

```bash
npx tsc --noEmit
npx jest                           # 整体回归
npx jest AssignmentManager         # 第 1 步
npx jest AdaptationEngine          # 第 2 步
npx jest NeurocodeController       # 第 3 步（若加了 controller 单测）
```

手测路径（`code --extensionDevelopmentPath=$PWD` 起一个 Extension Development Host）：

- **#1 验证：** 导入一个 PDF → reload window → 再导入**同一个**文件，应该没有 LLM 调用日志，瞬时完成。
- **#2 验证：** 在同一个 section 上连续点两次「Get AI Help」（保持 profile/prefs 不变），第二次应在 `Output → NeuroCode Adapter` 看到 `cacheHit: true`，无 provider 调用。
- **#3 验证：** 导入一个新 PDF，应该**立即**看到未适配的原始结构渲染；几秒后才被适配版覆盖；这期间点 Help 应排队不丢失。

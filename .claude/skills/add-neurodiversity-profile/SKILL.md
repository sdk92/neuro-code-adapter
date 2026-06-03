---
name: add-neurodiversity-profile
description: Add a new neurodiversity profile to NeuroCode Adapter (e.g. dyscalculia, dyspraxia). Use when the user asks to "add a profile", "support a new neurodiversity type", or names a specific condition not already in the BuiltInNeurodiversityTypes enum. This walks the four-file change in lockstep so the registry, schema, settings UI, and preferences HTML stay in sync.
---

# Add a neurodiversity profile

The codebase uses a Registry pattern — adding a profile is intended to be a single-direction change, but it must touch four locations or the enum/UI will drift from the registry.

## Ask first

Before writing any code, ask the user for:

1. **The internal slug** (e.g. `dyscalculia`) — lowercase, no spaces, used in code/config
2. **The display label** (e.g. `Dyscalculia`) — shown in the settings UI
3. **A one-sentence description** of the condition's needs
4. **Adaptation guidance** — what should the rule-based adapter and the LLM prompt fragment do differently for this profile?

Do not invent these. If the user gave you only a name, ask for the rest.

## The four-file change

Make these edits in order. After each, re-read the file to confirm.

### 1. Define the module — `src/features/adaptive/builtinProfiles.ts`

Add a `NeurodiversityModule` constant alongside the existing ones (`neurotypicalModule`, `dyslexiaModule`, etc.). It needs:

- `type` — the slug from step 1
- `profile.defaultPreferences` — sensible defaults across `visual`, `structural`, `cognitive` groups. Use a similar existing profile as the starting point (e.g. ADHD if focus-related, dyslexia if reading-related).
- `strategy` — CSS vars and structural flags. Match the conventions used by sibling modules.
- `ruleBasedAdapter(section, prefs)` — the offline fallback. Return an `AdaptationResponse`-shaped object.
- `promptFragment` — a short paragraph for the LLM. Speak in imperative voice ("Prefer X. Avoid Y. Always include Z.").

Then add `ProfileRegistry.register(yourModule)` to `registerBuiltinProfiles()`.

### 2. Extend the schema enum — `src/shared/schemas/primitives.ts`

Add the slug to `BuiltInNeurodiversityTypes`. The `as const` tuple drives the Zod enum, which drives the inferred type used everywhere.

### 3. Update `package.json` settings UI

In `contributes.configuration.neurocode.neurodiversityProfile.enum`, add the slug. The order should match `BuiltInNeurodiversityTypes`.

### 4. Update preferences HTML — `src/features/preferences/PreferenceManager.ts`

Find `generatePreferencesHtml` and add `<option value="<slug>">Label</option>` to the profile `<select>`. Match the formatting and ordering of existing options.

## Verify

After all four edits:

```bash
npx tsc --noEmit
npx jest src/shared/__tests__/ProfileRegistry.test.ts
```

If `ProfileRegistry.test.ts` has a parameterised test that iterates all `BuiltInNeurodiversityTypes`, the new profile will be covered automatically. Otherwise add an explicit test case.

## What NOT to do

- Don't add a new switch/case anywhere — every consumer goes through `ProfileRegistry`. If you find yourself writing `if (type === "yourslug")`, you're working around the registry; stop and use it instead.
- Don't add a separate fragment file under `resources/prompts/` unless the user explicitly asks. The profile's `promptFragment` string is composed in-process by `PromptBuilder.withRawText`.
- Don't touch `AdaptationEngine` — it picks up the new profile via the registry automatically.

## Reference

`docs/extending.md` has the canonical end-to-end walkthrough with a fully-worked example.

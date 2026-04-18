## M2 — Two small validator replacements

### 1. `src/services/llm/AdaptationEngine.ts`

Replace the entire hand-rolled `validateAdaptationResponse` function (~50 lines)
with this 4-line version. Also update the imports.

#### Imports — change

```ts
// OLD
import type {
  AdaptationRequest,
  AdaptationResponse,
  AdaptedSection,
  SuggestedAction,
  VisualModification,
} from "@shared/types";
```

```ts
// NEW
import type {
  AdaptationRequest,
  AdaptationResponse,
  AdaptedSection,
} from "@shared/types";
import { AdaptationResponseSchema } from "@shared/schemas";
```

#### Function body — replace

```ts
// OLD — ~50 lines of manual iteration, type coercion, and `any` casts
export function validateAdaptationResponse(raw: unknown): AdaptationResponse | null {
  if (!raw || typeof raw !== "object") { return null; }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.adaptedSections)) { return null; }

  const adaptedSections: AdaptedSection[] = [];
  for (const section of obj.adaptedSections) {
    // ... lots of String(s.foo ?? "") calls ...
  }
  // ... more manual extraction ...

  return { adaptedSections, ... };
}
```

```ts
// NEW — Zod does the iteration, coercion, and defaults
export function validateAdaptationResponse(raw: unknown): AdaptationResponse | null {
  const result = AdaptationResponseSchema.safeParse(raw);
  if (!result.success) {
    // Retained for observability — same Logger.warn pattern as before
    Logger.warn(
      `AdaptationResponse validation failed: ${result.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ")}`,
    );
    return null;
  }
  return result.data;
}
```

#### Clean up unused imports

After the swap, `AdaptedSection`, `SuggestedAction`, `VisualModification` may
only be needed in the `generateRuleBased()` method. Keep `AdaptedSection`,
drop the others if your IDE flags them.

---

### 2. `src/features/assignments/parser.ts`

Replace `validateAndNormalise` similarly.

#### Imports — add

```ts
import { AssignmentSchema } from "@shared/schemas";
```

#### Function body — replace

```ts
// OLD — ~40 lines of metadata.foo ?? fallback chains
export function validateAndNormalise(raw: any, fileName: string): Assignment {
  if (!raw || typeof raw !== "object") {
    throw new Error("Parsed result is not an object");
  }
  const metadata: AssignmentMetadata = {
    id: String(raw.metadata?.id ?? `assignment_${Date.now()}`),
    title: String(raw.metadata?.title ?? path.basename(fileName, path.extname(fileName))),
    // ... 10 more lines ...
  };
  const sections: AssignmentSection[] = Array.isArray(raw.sections)
    ? raw.sections.map((s: any, i: number) => ({ ... }))
    : [];
  if (sections.length === 0) {
    throw new Error("Assignment must contain at least one section");
  }
  return { metadata, sections, ... };
}
```

```ts
// NEW — Zod applies the fallbacks, enforces the section-count constraint
export function validateAndNormalise(raw: unknown, fileName: string): Assignment {
  // Inject a title fallback derived from the filename BEFORE parsing so the
  // schema's default doesn't overwrite what the LLM gave us.
  const withFilenameDefault =
    raw && typeof raw === "object" && raw !== null
      ? {
          ...raw,
          metadata: {
            ...(raw as any).metadata,
            title:
              (raw as any).metadata?.title ??
              path.basename(fileName, path.extname(fileName)),
          },
        }
      : raw;

  const result = AssignmentSchema.safeParse(withFilenameDefault);
  if (!result.success) {
    throw new Error(
      `Assignment validation failed: ${result.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}
```

#### Why the filename-title shim

The old code used `String(raw.metadata?.title ?? path.basename(...))`. Zod's
default runs when the field is `undefined`, so an empty string from the LLM
would bypass the fallback. We inject the filename-derived title as a proper
value before parsing so both missing-field and null-field cases work.

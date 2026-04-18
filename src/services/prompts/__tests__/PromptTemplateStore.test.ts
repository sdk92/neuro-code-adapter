/**
 * Integration test for PromptTemplateStore.
 *
 * Reads real template files from a tmp directory. Covers:
 *   - Manifest parsing
 *   - Template file loading
 *   - Round-trip: declared requiredVars match placeholders in body
 *   - Graceful error when manifest is missing or malformed
 *
 * The round-trip check is the most important test in the file:
 * if someone edits a .md template and adds a {{newVar}} without updating
 * manifest.json, this test catches it.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PromptTemplateStore } from "../PromptTemplateStore";

async function makeFixture(structure: Record<string, string>): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "prompt-store-test-"));
  for (const [relPath, content] of Object.entries(structure)) {
    const full = path.join(root, relPath);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, content, "utf-8");
  }
  return root;
}

async function cleanup(root: string): Promise<void> {
  await fs.promises.rm(root, { recursive: true, force: true });
}

describe("PromptTemplateStore (integration)", () => {
  let fixtureRoot: string;

  afterEach(async () => {
    if (fixtureRoot) { await cleanup(fixtureRoot); fixtureRoot = ""; }
  });

  it("loads templates per the manifest", async () => {
    fixtureRoot = await makeFixture({
      "manifest.json": JSON.stringify({
        manifestVersion: "1.0.0",
        templates: {
          "greet": { path: "greet.md", version: "1.0.0", requiredVars: ["name"] },
          "farewell": { path: "nested/farewell.md", version: "1.1.0", requiredVars: [] },
        },
      }),
      "greet.md": "Hello {{name}}!",
      "nested/farewell.md": "Goodbye.",
    });

    const store = new PromptTemplateStore(fixtureRoot);
    await store.load();

    expect(store.getIds().sort()).toEqual(["farewell", "greet"]);
    expect(store.getManifestVersion()).toBe("1.0.0");
    expect(store.get("greet").render({ name: "Alice" })).toBe("Hello Alice!");
    expect(store.get("farewell").render()).toBe("Goodbye.");
  });

  it("is idempotent — repeated load() without forceReload does nothing", async () => {
    fixtureRoot = await makeFixture({
      "manifest.json": JSON.stringify({
        manifestVersion: "1.0.0",
        templates: { "a": { path: "a.md", version: "1.0.0" } },
      }),
      "a.md": "A",
    });

    const store = new PromptTemplateStore(fixtureRoot);
    await store.load();
    const first = store.get("a");
    await store.load(); // second call
    expect(store.get("a")).toBe(first); // same instance
  });

  it("forceReload re-reads files (hot-swap semantics)", async () => {
    fixtureRoot = await makeFixture({
      "manifest.json": JSON.stringify({
        manifestVersion: "1.0.0",
        templates: { "a": { path: "a.md", version: "1.0.0" } },
      }),
      "a.md": "original",
    });

    const store = new PromptTemplateStore(fixtureRoot);
    await store.load();
    expect(store.get("a").raw).toBe("original");

    await fs.promises.writeFile(path.join(fixtureRoot, "a.md"), "updated", "utf-8");
    await store.load(true);
    expect(store.get("a").raw).toBe("updated");
  });

  it("surfaces a clear error when manifest is missing", async () => {
    fixtureRoot = await makeFixture({
      "greet.md": "Hi",
    });
    const store = new PromptTemplateStore(fixtureRoot);
    await expect(store.load()).rejects.toThrow(/failed to read manifest/);
  });

  it("surfaces a clear error when manifest is malformed JSON", async () => {
    fixtureRoot = await makeFixture({
      "manifest.json": "{ not valid json",
    });
    const store = new PromptTemplateStore(fixtureRoot);
    await expect(store.load()).rejects.toThrow(/not valid JSON/);
  });

  it("get() throws a helpful message for unknown template ids", async () => {
    fixtureRoot = await makeFixture({
      "manifest.json": JSON.stringify({
        manifestVersion: "1.0.0",
        templates: { "a": { path: "a.md", version: "1.0.0" } },
      }),
      "a.md": "A",
    });
    const store = new PromptTemplateStore(fixtureRoot);
    await store.load();
    expect(() => store.get("nope")).toThrow(/unknown template.*nope/i);
  });

  describe("round-trip with real project templates", () => {
    /**
     * This test points at the real resources/prompts/ directory.
     * Guarantee: every placeholder in every .md file is declared in manifest.requiredVars.
     *
     * Catches the most common authoring mistake: editing a template and adding a
     * {{newVar}} without updating the manifest.
     *
     * Skipped if the real resources directory isn't present (e.g. running tests
     * from a subfolder with only fixtures).
     */
    const realPromptsDir = path.resolve(__dirname, "../../../../resources/prompts");

    const runRealCheck = fs.existsSync(path.join(realPromptsDir, "manifest.json"));

    (runRealCheck ? it : it.skip)(
      "every placeholder in every real template is declared in the manifest",
      async () => {
        const store = new PromptTemplateStore(realPromptsDir);
        await store.load();

        const violations: string[] = [];
        for (const id of store.getIds()) {
          const tpl = store.get(id);
          const declared = new Set(tpl.metadata.requiredVars);
          const used = tpl.declaredPlaceholders();
          for (const u of used) {
            if (!declared.has(u)) {
              violations.push(
                `template "${id}" uses {{${u}}} but it is not in requiredVars`,
              );
            }
          }
        }

        expect(violations).toEqual([]);
      },
    );
  });
});

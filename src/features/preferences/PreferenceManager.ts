/**
 * PreferenceManager — Manages user preferences and neurodiversity profiles.
 *
 * Handles:
 *   - Loading/saving preferences from VS Code settings + workspace state
 *   - Profile switching with automatic preference reset to defaults
 *   - Preference merging (user overrides on top of profile defaults)
 *   - Preference change notification to other modules
 */
import * as vscode from "vscode";
import type { NeurodiversityType, UserPreferences, PartialUserPreferences } from "@shared/types";
import { getDefaultPreferences } from "./profiles";
import { Logger } from "@shared/logger";

type PreferenceChangeCallback = (prefs: UserPreferences) => void;

export class PreferenceManager implements vscode.Disposable {
  private context: vscode.ExtensionContext;
  private currentPreferences: UserPreferences;
  private changeCallbacks: PreferenceChangeCallback[] = [];
  private disposables: vscode.Disposable[] = [];

  private static readonly STORAGE_KEY = "neurocode.userPreferences";

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    // Load saved preferences or initialize from VS Code settings
    const saved = context.globalState.get<UserPreferences>(PreferenceManager.STORAGE_KEY);
    if (saved) {
      this.currentPreferences = saved;
    } else {
      const config = vscode.workspace.getConfiguration("neurocode");
      const profileType = config.get<NeurodiversityType>("neurodiversityProfile", "neurotypical");
      this.currentPreferences = getDefaultPreferences(profileType);
      this.syncFromVscodeSettings(config);
    }

    // Watch for VS Code settings changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("neurocode")) {
          const config = vscode.workspace.getConfiguration("neurocode");
          this.syncFromVscodeSettings(config);
        }
      })
    );

    Logger.log(`PreferenceManager initialized: profile=${this.currentPreferences.neurodiversityType}`);
  }

  /**
   * Sync individual VS Code settings into the preference object.
   */
  private syncFromVscodeSettings(config: vscode.WorkspaceConfiguration): void {
    const profileType = config.get<NeurodiversityType>("neurodiversityProfile");
    if (profileType && profileType !== this.currentPreferences.neurodiversityType) {
      this.setProfile(profileType);
      return;
    }

    // REFACTORED: Replaced 40+ lines of repetitive get/compare/set with a helper.
    let changed = false;

    const sync = <T>(key: string, current: T, setter: (v: T) => void): void => {
      const value = config.get<T>(key);
      if (value !== undefined && value !== current) {
        setter(value);
        changed = true;
      }
    };

    sync("fontSize", this.currentPreferences.visual.fontSize,
      (v) => { this.currentPreferences.visual.fontSize = v; });
    sync("fontFamily", this.currentPreferences.visual.fontFamily,
      (v) => { this.currentPreferences.visual.fontFamily = v; });
    sync("lineSpacing", this.currentPreferences.visual.lineSpacing,
      (v) => { this.currentPreferences.visual.lineSpacing = v; });
    sync("colorScheme", this.currentPreferences.visual.colorScheme,
      (v) => { this.currentPreferences.visual.colorScheme = v as any; });
    sync("focusMode", this.currentPreferences.cognitive.focusMode,
      (v) => { this.currentPreferences.cognitive.focusMode = v; });
    sync("textToSpeech", this.currentPreferences.cognitive.textToSpeech,
      (v) => { this.currentPreferences.cognitive.textToSpeech = v; });
    sync("taskGranularity", this.currentPreferences.structural.taskGranularity,
      (v) => { this.currentPreferences.structural.taskGranularity = v as any; });

    if (changed) {
      this.save();
      this.notifyChange();
    }
  }

  /**
   * Switch to a new neurodiversity profile.
   * Resets preferences to that profile's defaults, then re-applies any user overrides.
   */
  setProfile(type: NeurodiversityType): void {
    const defaults = getDefaultPreferences(type);
    this.currentPreferences = defaults;
    this.save();
    this.notifyChange();
    Logger.log(`Profile switched to: ${type}`);
  }

  /**
   * Update specific preferences (partial merge).
   *
   * REFACTORED (M2): Signature now takes PartialUserPreferences (deep partial)
   * to match the shape the webview actually sends: each sub-object's fields
   * are individually optional because the webview only includes the fields
   * the user touched.
   */
  updatePreferences(partial: PartialUserPreferences): void {
    if (partial.visual) {
      this.currentPreferences.visual = { ...this.currentPreferences.visual, ...partial.visual };
    }
    if (partial.structural) {
      this.currentPreferences.structural = { ...this.currentPreferences.structural, ...partial.structural };
    }
    if (partial.cognitive) {
      this.currentPreferences.cognitive = { ...this.currentPreferences.cognitive, ...partial.cognitive };
    }
    if (partial.neurodiversityType && partial.neurodiversityType !== this.currentPreferences.neurodiversityType) {
      this.setProfile(partial.neurodiversityType);
      return; // setProfile already saves and notifies
    }

    this.save();
    this.notifyChange();
  }

  /**
   * Get current preferences (immutable copy).
   */
  getPreferences(): UserPreferences {
    return JSON.parse(JSON.stringify(this.currentPreferences));
  }

  /**
   * Register callback for preference changes.
   */
  onPreferencesChanged(callback: PreferenceChangeCallback): void {
    this.changeCallbacks.push(callback);
  }

  /**
   * Save to VS Code global state.
   */
  private save(): void {
    this.context.globalState.update(PreferenceManager.STORAGE_KEY, this.currentPreferences);
  }

  /**
   * Notify all registered callbacks.
   */
  private notifyChange(): void {
    const prefs = this.getPreferences();
    for (const cb of this.changeCallbacks) {
      try { cb(prefs); } catch (e) { Logger.error("Preference change callback error:", e); }
    }
  }

  /**
   * Generate HTML for the preference configuration webview panel.
   */
  generatePreferencesHtml(): string {
    const p = this.currentPreferences;
    return `
      <div class="preferences-panel">
        <h2>NeuroCode Preferences</h2>

        <section class="profile-selector">
          <h3>Neurodiversity Profile</h3>
          <select id="profile-select" value="${p.neurodiversityType}">
            <option value="neurotypical" ${p.neurodiversityType === "neurotypical" ? "selected" : ""}>Neurotypical</option>
            <option value="dyslexia" ${p.neurodiversityType === "dyslexia" ? "selected" : ""}>Dyslexia</option>
            <option value="autism" ${p.neurodiversityType === "autism" ? "selected" : ""}>Autism Spectrum</option>
            <option value="adhd" ${p.neurodiversityType === "adhd" ? "selected" : ""}>ADHD</option>
          </select>
        </section>

        <section class="visual-prefs">
          <h3>Visual Settings</h3>
          <label>Font Size: <input type="range" id="fontSize" min="10" max="28" value="${p.visual.fontSize}"> <span>${p.visual.fontSize}px</span></label>
          <label>Line Spacing: <input type="range" id="lineSpacing" min="1.0" max="3.0" step="0.1" value="${p.visual.lineSpacing}"> <span>${p.visual.lineSpacing}</span></label>
          <label>Color Scheme:
            <select id="colorScheme">
              <option value="default" ${p.visual.colorScheme === "default" ? "selected" : ""}>Default</option>
              <option value="high-contrast" ${p.visual.colorScheme === "high-contrast" ? "selected" : ""}>High Contrast</option>
              <option value="warm" ${p.visual.colorScheme === "warm" ? "selected" : ""}>Warm</option>
              <option value="cool" ${p.visual.colorScheme === "cool" ? "selected" : ""}>Cool</option>
              <option value="pastel" ${p.visual.colorScheme === "pastel" ? "selected" : ""}>Pastel</option>
            </select>
          </label>
        </section>

        <section class="structural-prefs">
          <h3>Task Structure</h3>
          <label>Task Granularity:
            <select id="taskGranularity">
              <option value="combined" ${p.structural.taskGranularity === "combined" ? "selected" : ""}>Combined — broad milestones</option>
              <option value="standard" ${p.structural.taskGranularity === "standard" ? "selected" : ""}>Standard — as written</option>
              <option value="detailed" ${p.structural.taskGranularity === "detailed" ? "selected" : ""}>Detailed — atomic sub-steps</option>
            </select>
          </label>
          <p class="hint">Takes effect on the next adaptation request (Request Adaptation button).</p>
        </section>

        <section class="cognitive-prefs">
          <h3>Cognitive Support</h3>
          <label><input type="checkbox" id="focusMode" ${p.cognitive.focusMode ? "checked" : ""}> Focus Mode</label>
          <label><input type="checkbox" id="textToSpeech" ${p.cognitive.textToSpeech ? "checked" : ""}> Text-to-Speech</label>
          <label><input type="checkbox" id="breakReminders" ${p.cognitive.breakReminders ? "checked" : ""}> Break Reminders</label>
          <label><input type="checkbox" id="simplifiedLanguage" ${p.cognitive.simplifiedLanguage ? "checked" : ""}> Simplified Language</label>
        </section>

        <div style="margin-top: 2em;">
          <button id="apply-btn" style="
            padding: 0.5em 1.5em;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            font-size: 1em;
          ">Apply</button>
          <p class="hint" style="margin-top: 0.5em;">Visual changes re-render immediately. Granularity changes trigger a full re-adaptation.</p>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();

        // Profile switch — immediately resets all defaults for the chosen profile
        document.getElementById('profile-select').addEventListener('change', e => {
          vscode.postMessage({ type: 'set_profile', profile: e.target.value });
        });

        // Visual — font size (preview only, no message sent)
        const fontSizeInput = document.getElementById('fontSize');
        fontSizeInput.addEventListener('input', e => {
          e.target.nextElementSibling.textContent = e.target.value + 'px';
        });

        // Visual — line spacing (preview only)
        const lineSpacingInput = document.getElementById('lineSpacing');
        lineSpacingInput.addEventListener('input', e => {
          e.target.nextElementSibling.textContent = e.target.value;
        });

        // Apply button — collect all current values and send as one message
        document.getElementById('apply-btn').addEventListener('click', () => {
          const preferences = {
            visual: {
              fontSize: Number(document.getElementById('fontSize').value),
              lineSpacing: Number(document.getElementById('lineSpacing').value),
              colorScheme: document.getElementById('colorScheme').value,
            },
            structural: {
              taskGranularity: document.getElementById('taskGranularity').value,
            },
            cognitive: {
              focusMode: document.getElementById('focusMode').checked,
              textToSpeech: document.getElementById('textToSpeech').checked,
              breakReminders: document.getElementById('breakReminders').checked,
              simplifiedLanguage: document.getElementById('simplifiedLanguage').checked,
            },
          };
          vscode.postMessage({ type: 'apply_preferences', preferences });

          const btn = document.getElementById('apply-btn');
          btn.textContent = 'Applied!';
          btn.disabled = true;
          setTimeout(() => { btn.textContent = 'Apply'; btn.disabled = false; }, 1500);
        });
      </script>
    `;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.changeCallbacks = [];
  }
}

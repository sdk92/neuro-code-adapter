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
import type { NeurodiversityType, UserPreferences } from "@shared/types";
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

    let changed = false;

    const fontSize = config.get<number>("fontSize");
    if (fontSize !== undefined && fontSize !== this.currentPreferences.visual.fontSize) {
      this.currentPreferences.visual.fontSize = fontSize;
      changed = true;
    }

    const fontFamily = config.get<string>("fontFamily");
    if (fontFamily !== undefined && fontFamily !== this.currentPreferences.visual.fontFamily) {
      this.currentPreferences.visual.fontFamily = fontFamily;
      changed = true;
    }

    const lineSpacing = config.get<number>("lineSpacing");
    if (lineSpacing !== undefined && lineSpacing !== this.currentPreferences.visual.lineSpacing) {
      this.currentPreferences.visual.lineSpacing = lineSpacing;
      changed = true;
    }

    const colorScheme = config.get<string>("colorScheme");
    if (colorScheme !== undefined && colorScheme !== this.currentPreferences.visual.colorScheme) {
      this.currentPreferences.visual.colorScheme = colorScheme as any;
      changed = true;
    }

    const focusMode = config.get<boolean>("focusMode");
    if (focusMode !== undefined && focusMode !== this.currentPreferences.cognitive.focusMode) {
      this.currentPreferences.cognitive.focusMode = focusMode;
      changed = true;
    }

    const tts = config.get<boolean>("textToSpeech");
    if (tts !== undefined && tts !== this.currentPreferences.cognitive.textToSpeech) {
      this.currentPreferences.cognitive.textToSpeech = tts;
      changed = true;
    }

    const adaptiveMode = config.get<boolean>("adaptiveMode");
    if (adaptiveMode !== undefined && adaptiveMode !== this.currentPreferences.adaptiveMode) {
      this.currentPreferences.adaptiveMode = adaptiveMode;
      changed = true;
    }

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
   */
  updatePreferences(partial: Partial<UserPreferences>): void {
    if (partial.visual) {
      this.currentPreferences.visual = { ...this.currentPreferences.visual, ...partial.visual };
    }
    if (partial.structural) {
      this.currentPreferences.structural = { ...this.currentPreferences.structural, ...partial.structural };
    }
    if (partial.cognitive) {
      this.currentPreferences.cognitive = { ...this.currentPreferences.cognitive, ...partial.cognitive };
    }
    if (partial.adaptiveMode !== undefined) {
      this.currentPreferences.adaptiveMode = partial.adaptiveMode;
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
        </section>

        <section class="cognitive-prefs">
          <h3>Cognitive Support</h3>
          <label><input type="checkbox" id="focusMode" ${p.cognitive.focusMode ? "checked" : ""}> Focus Mode</label>
          <label><input type="checkbox" id="textToSpeech" ${p.cognitive.textToSpeech ? "checked" : ""}> Text-to-Speech</label>
          <label><input type="checkbox" id="breakReminders" ${p.cognitive.breakReminders ? "checked" : ""}> Break Reminders</label>
          <label><input type="checkbox" id="simplifiedLanguage" ${p.cognitive.simplifiedLanguage ? "checked" : ""}> Simplified Language</label>
        </section>
      </div>
    `;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.changeCallbacks = [];
  }
}

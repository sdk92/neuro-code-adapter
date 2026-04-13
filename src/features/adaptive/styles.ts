/**
 * Adaptive view CSS styles — extracted from AdaptiveRenderer for maintainability.
 *
 * Problem solved: ~100 lines of CSS was embedded as string constants inside
 * the TypeScript file, with no syntax highlighting, no linting, and high risk
 * of accidental breakage during edits.
 *
 * Now each CSS block is a named export, making it easy to:
 *   - Find and modify styles without scrolling through render logic
 *   - Add new profile CSS blocks by adding a new export
 *   - Test CSS generation independently
 */

export const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--nc-font-family);
    font-size: var(--nc-font-size);
    line-height: var(--nc-line-height);
    color: var(--nc-text-color);
    background: var(--nc-bg-color);
    letter-spacing: var(--nc-letter-spacing);
  }

  .nc-container {
    max-width: var(--nc-max-width);
    margin: 0 auto;
    padding: 2em;
  }

  .nc-header { margin-bottom: 2em; }
  .nc-header h1 { color: var(--nc-heading-color); margin-bottom: 0.5em; }

  .nc-meta { display: flex; gap: 0.5em; flex-wrap: wrap; margin-bottom: 1em; }
  .nc-badge {
    display: inline-block; padding: 0.2em 0.6em;
    border-radius: var(--nc-border-radius);
    font-size: 0.85em; font-weight: 600;
    background: var(--nc-code-bg); color: var(--nc-heading-color);
  }
  .nc-difficulty-beginner { background: #d1fae5; color: #065f46; }
  .nc-difficulty-intermediate { background: #fef3c7; color: #92400e; }
  .nc-difficulty-advanced { background: #fee2e2; color: #991b1b; }
  .nc-time { background: #dbeafe; color: #1e40af; }

  .nc-description { color: #6b7280; margin-bottom: 1em; }

  .nc-section { margin-bottom: var(--nc-paragraph-spacing); padding: 1.5em; border-radius: var(--nc-border-radius); }
  .nc-section-instruction { background: transparent; }
  .nc-section-task { background: var(--nc-code-bg); border-left: 4px solid var(--nc-accent-color); }
  .nc-section-hint { background: #fefce8; border-left: 4px solid #eab308; }
  .nc-section-example { background: #f0fdf4; border-left: 4px solid #22c55e; }
  .nc-section-reference { background: #eff6ff; border-left: 4px solid #3b82f6; }

  .nc-section-header { display: flex; align-items: center; gap: 0.5em; margin-bottom: 1em; }
  .nc-section-header h2 { flex: 1; color: var(--nc-heading-color); font-size: 1.3em; }

  .nc-checkbox { width: 1.2em; height: 1.2em; cursor: pointer; }

  .nc-help-btn {
    width: 2em; height: 2em; border-radius: 50%;
    border: 2px solid var(--nc-accent-color); background: transparent;
    color: var(--nc-accent-color); font-weight: bold; cursor: pointer;
    font-size: 0.9em; display: flex; align-items: center; justify-content: center;
  }
  .nc-help-btn:hover { background: var(--nc-accent-color); color: white; }

  .nc-section-body { line-height: var(--nc-line-height); }
  .nc-section-body p { margin-bottom: var(--nc-paragraph-spacing); }
  .nc-section-body pre { background: var(--nc-code-bg); padding: 1em; border-radius: var(--nc-border-radius); overflow-x: auto; margin: 1em 0; }
  .nc-section-body code { font-family: 'Fira Code', 'Consolas', monospace; font-size: 0.9em; }
  .nc-section-body ul, .nc-section-body ol { padding-left: 1.5em; margin-bottom: 1em; }
  .nc-section-body li { margin-bottom: 0.5em; }

  .nc-divider { border: none; border-top: 2px dashed #e5e7eb; margin: 2em 0; }

  .nc-summary-box {
    background: #fef3c7; padding: 0.8em 1em; border-radius: var(--nc-border-radius);
    margin-bottom: 1em; border: 1px solid #fbbf24;
  }

  .nc-support-message {
    background: #ecfdf5; padding: 1em; border-radius: var(--nc-border-radius);
    border: 1px solid #6ee7b7; margin-bottom: 2em; font-style: italic;
  }

  .nc-actions { display: flex; flex-direction: column; gap: 0.5em; margin-bottom: 2em; }
  .nc-action { display: flex; align-items: center; gap: 0.5em; padding: 0.5em 1em; border-radius: var(--nc-border-radius); }
  .nc-action-low { background: #f0f9ff; }
  .nc-action-medium { background: #fffbeb; }
  .nc-action-high { background: #fef2f2; }

  .nc-reasoning { margin-top: 2em; padding: 1em; background: #f9fafb; border-radius: var(--nc-border-radius); }
  .nc-reasoning summary { cursor: pointer; font-weight: 600; color: #6b7280; }
  .nc-reasoning p { margin-top: 0.5em; color: #6b7280; font-size: 0.9em; }
  .nc-confidence { font-style: italic; }

  .nc-adaptations-note { margin-top: 0.5em; padding: 0.3em 0.6em; background: #f3f4f6; border-radius: 4px; }
  .nc-adaptations-note small { color: #9ca3af; }

  .nc-footer { margin-top: 3em; padding-top: 1em; border-top: 1px solid #e5e7eb; text-align: center; color: #9ca3af; font-size: 0.85em; }
`;

export const PROFILE_CSS = `
  /* Focus mode — hides non-essential elements */
  .nc-focus-mode .nc-footer,
  .nc-focus-mode .nc-reasoning,
  .nc-focus-mode .nc-adaptations-note { display: none; }
  .nc-focus-mode .nc-section { border: 2px solid transparent; }
  .nc-focus-mode .nc-section:target,
  .nc-focus-mode .nc-section:focus-within { border-color: var(--nc-accent-color); }

  /* Dyslexia — extra spacing and alignment */
  .nc-profile-dyslexia .nc-section-body { text-align: left; }
  .nc-profile-dyslexia .nc-section-body p { max-width: 60ch; }

  /* Autism — consistent structure emphasis */
  .nc-profile-autism .nc-section { border: 1px solid #e2e8f0; }
  .nc-profile-autism .nc-section-header h2 { font-weight: 700; }

  /* ADHD — visual variety and engagement */
  .nc-profile-adhd .nc-section { box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .nc-profile-adhd .nc-section-header h2 { color: var(--nc-accent-color); }
`;

export const LOADING_CSS = `
  #nc-loading-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 9999;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.2em;
  }
  #nc-loading-overlay .nc-spinner {
    width: 48px; height: 48px;
    border: 5px solid rgba(255,255,255,0.25);
    border-top-color: #fff;
    border-radius: 50%;
    animation: nc-spin 0.9s linear infinite;
  }
  #nc-loading-overlay .nc-loading-label {
    color: #fff;
    font-size: 1.05em;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-align: center;
    max-width: 280px;
  }
  #nc-loading-overlay .nc-loading-sub {
    color: rgba(255,255,255,0.7);
    font-size: 0.85em;
    text-align: center;
    max-width: 260px;
  }
  @keyframes nc-spin { to { transform: rotate(360deg); } }
`;

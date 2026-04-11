/**
 * AdaptiveRenderer — Generates adaptive HTML views of assignments.
 *
 * Takes assignment content + adaptation response + user preferences
 * and produces a complete HTML page for the webview panel.
 *
 * Applies both:
 *   - LLM-generated adaptations (from AdaptationEngine)
 *   - Deterministic visual/structural transforms (from strategies)
 */
import { marked } from "marked";
import type {
  AdaptationResponse,
  AdaptedSection,
  Assignment,
  AssignmentSection,
  UserPreferences,
} from "@shared/types";
import { buildStrategy, type AdaptationStrategy } from "./strategies";

export class AdaptiveRenderer {
  /**
   * Render a full adaptive view of an assignment.
   */
  render(
    assignment: Assignment,
    preferences: UserPreferences,
    adaptation?: AdaptationResponse,
    requestType: "full_adaptation" | "help_request" = "full_adaptation"
  ): string {
    const strategy = buildStrategy(preferences);

    const cssVars = Object.entries(strategy.cssVariables)
      .map(([k, v]) => `${k}: ${v};`)
      .join("\n      ");

    const classes = strategy.containerClasses.join(" ");

    const sectionsHtml = assignment.sections
      .map((section) => {
        const adapted = adaptation?.adaptedSections.find(
          (a) => a.originalSectionId === section.id
        );
        return adapted
          ? this.renderAdaptedSection(adapted, section, strategy)
          : this.renderOriginalSection(section, strategy);
      })
      .join("\n");

    const supportHtml = adaptation?.supportMessage
      ? `<div class="nc-support-message">${this.escapeHtml(adaptation.supportMessage)}</div>`
      : "";

    // suggestedActions are only shown for help_request — not during full adaptation.
    const actionsHtml = requestType === "help_request" && adaptation?.suggestedActions?.length
      ? `<div class="nc-actions">
          ${adaptation.suggestedActions
            .map(
              (a) =>
                `<div class="nc-action nc-action-${a.priority}">
                  <span class="nc-action-icon">${this.getActionIcon(a.type)}</span>
                  <span>${this.escapeHtml(a.message)}</span>
                </div>`
            )
            .join("\n")}
        </div>`
      : "";

    const reasoningHtml = adaptation?.reasoning
      ? `<details class="nc-reasoning">
          <summary>Why these adaptations?</summary>
          <p>${this.escapeHtml(adaptation.reasoning)}</p>
          <p class="nc-confidence">Confidence: ${Math.round((adaptation.confidenceScore ?? 0) * 100)}%</p>
        </details>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(assignment.metadata.title)}</title>
  <style>
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
  </style>
  <!-- KaTeX for LaTeX formula rendering (solves garbled math symbols from PDF) -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
    onload="renderMathInElement(document.body, {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false},
        {left: '\\\\(', right: '\\\\)', display: false},
        {left: '\\\\[', right: '\\\\]', display: true}
      ],
      throwOnError: false
    });">
  </script>
  <style>
    :root {
      ${cssVars}
    }
    ${BASE_CSS}
    ${PROFILE_CSS}
  </style>
</head>
<body>
  <!-- Loading overlay: shown while LLM adaptation is in progress -->
  <div id="nc-loading-overlay">
    <div class="nc-spinner"></div>
    <div class="nc-loading-label">Adapting content for you...</div>
    <div class="nc-loading-sub">Generating a personalised view with AI. This may take a few seconds.</div>
  </div>

  <div class="nc-container ${classes}">
    <header class="nc-header">
      <h1>${this.escapeHtml(assignment.metadata.title)}</h1>
      <div class="nc-meta">
        <span class="nc-badge nc-difficulty-${assignment.metadata.difficulty}">
          ${assignment.metadata.difficulty}
        </span>
        <span class="nc-badge">${assignment.metadata.language}</span>
        ${strategy.showTimeEstimates
          ? `<span class="nc-badge nc-time">~${assignment.metadata.estimatedMinutes} min</span>`
          : ""}
      </div>
      ${assignment.metadata.description
        ? `<p class="nc-description">${this.escapeHtml(assignment.metadata.description)}</p>`
        : ""}
    </header>

    ${supportHtml}
    ${actionsHtml}

    <main class="nc-content">
      ${sectionsHtml}
    </main>

    ${reasoningHtml}

    <footer class="nc-footer">
      <p>Adapted for <strong>${preferences.neurodiversityType}</strong> profile by NeuroCode Adapter</p>
    </footer>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // Listen for progress messages from the extension host
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'adaptation_progress') {
        const overlay = document.getElementById('nc-loading-overlay');
        if (!overlay) { return; }
        if (msg.status === 'started') {
          overlay.style.display = 'flex';
        } else {
          // 'complete' or 'error' — hide overlay
          overlay.style.display = 'none';
        }
      }
    });

    // Section view tracking
    document.querySelectorAll('.nc-section').forEach(section => {
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            vscode.postMessage({
              type: 'section_viewed',
              sectionId: section.dataset.sectionId
            });
          }
        });
      }, { threshold: 0.5 });
      observer.observe(section);
    });

    // Checkbox tracking
    document.querySelectorAll('.nc-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        vscode.postMessage({
          type: 'section_viewed',
          sectionId: cb.dataset.sectionId
        });
      });
    });

    // Help request
    document.querySelectorAll('.nc-help-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'request_help',
          question: 'I need help with this section',
          sectionId: btn.dataset.sectionId
        });
      });
    });
  </script>
</body>
</html>`;
  }

  /**
   * Render an LLM-adapted section.
   */
  private renderAdaptedSection(
    adapted: AdaptedSection,
    original: AssignmentSection,
    strategy: AdaptationStrategy
  ): string {
    const content = this.markdownToHtml(adapted.adaptedContent);
    const divider = strategy.insertDividers ? '<hr class="nc-divider">' : "";

    return `
    ${divider}
    <section class="nc-section nc-section-${original.type}" data-section-id="${original.id}">
      <div class="nc-section-header">
        ${strategy.addCheckboxes
          ? `<input type="checkbox" class="nc-checkbox" data-section-id="${original.id}">`
          : ""}
        <h2>${this.escapeHtml(adapted.adaptedTitle)}</h2>
        <button class="nc-help-btn" data-section-id="${original.id}" title="Get help">?</button>
      </div>
      <div class="nc-section-body">${content}</div>
      ${adapted.structuralChanges.length > 0
        ? `<div class="nc-adaptations-note">
            <small>Adaptations: ${adapted.structuralChanges.join(", ")}</small>
          </div>`
        : ""}
    </section>`;
  }

  /**
   * Render an original (non-adapted) section with strategy transforms.
   */
  private renderOriginalSection(section: AssignmentSection, strategy: AdaptationStrategy): string {
    let content = section.content;

    // Apply paragraph splitting if content exceeds max length
    if (strategy.maxParagraphLength > 0) {
      content = this.splitLongParagraphs(content, strategy.maxParagraphLength);
    }

    // Add summary box for ADHD profile
    const summaryBox = strategy.addSummaryBoxes
      ? `<div class="nc-summary-box"><strong>Quick Summary:</strong> ${this.escapeHtml(section.title)}</div>`
      : "";

    const htmlContent = this.markdownToHtml(content);
    const divider = strategy.insertDividers ? '<hr class="nc-divider">' : "";

    return `
    ${divider}
    <section class="nc-section nc-section-${section.type}" data-section-id="${section.id}">
      <div class="nc-section-header">
        ${strategy.addCheckboxes
          ? `<input type="checkbox" class="nc-checkbox" data-section-id="${section.id}">`
          : ""}
        <h2>${this.escapeHtml(section.title)}</h2>
        <button class="nc-help-btn" data-section-id="${section.id}" title="Get help">?</button>
      </div>
      ${summaryBox}
      <div class="nc-section-body">${htmlContent}</div>
    </section>`;
  }

  /**
   * Convert Markdown to HTML using marked.
   */
  private markdownToHtml(markdown: string): string {
    try {
      // Protect math blocks from marked's backslash/entity processing.
      // marked doesn't know LaTeX: it converts \\ (matrix row separator) to \,
      // causing matrices to collapse into one line when KaTeX renders them.
      const mathBlocks: string[] = [];
      const protected_ = markdown
        // Display math $$...$$
        .replace(/\$\$([\s\S]*?)\$\$/g, (_, inner) => {
          mathBlocks.push(`$$${inner}$$`);
          return `%%MATH_BLOCK_${mathBlocks.length - 1}%%`;
        })
        // Inline math $...$
        .replace(/\$([^\n$]+?)\$/g, (_, inner) => {
          mathBlocks.push(`$${inner}$`);
          return `%%MATH_BLOCK_${mathBlocks.length - 1}%%`;
        });

      const result = marked.parse(protected_);
      const html = typeof result === "string" ? result : String(result);

      // Restore math blocks after marked has processed the markdown
      return html.replace(/%%MATH_BLOCK_(\d+)%%/g, (_, i) => mathBlocks[Number(i)]);
    } catch {
      return `<p>${this.escapeHtml(markdown)}</p>`;
    }
  }

  /**
   * Split paragraphs that exceed max length.
   */
  private splitLongParagraphs(text: string, maxLength: number): string {
    return text.replace(
      new RegExp(`(.{${maxLength},}?[.!?])\\s`, "g"),
      "$1\n\n"
    );
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private getActionIcon(type: string): string {
    const icons: Record<string, string> = {
      break: "⏸️", simplify: "📝", example: "💡",
      hint: "🔍", encouragement: "🌟", restructure: "🔄",
    };
    return icons[type] ?? "ℹ️";
  }
}

// ─── CSS Styles ──────────────────────────────────────────────────────────────

const BASE_CSS = `
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

const PROFILE_CSS = `
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

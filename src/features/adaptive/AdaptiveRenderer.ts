/**
 * AdaptiveRenderer — Generates adaptive HTML views of assignments.
 *
 * Takes assignment content + adaptation response + user preferences
 * and produces a complete HTML page for the webview panel.
 *
 * REFACTORED:
 *   - CSS extracted to styles.ts (maintainability)
 *   - Section rendering delegated to SectionRendererRegistry (extensibility)
 *   - RenderHelpers exposed for custom section renderers
 *   - markdownToHtml, escapeHtml, splitLongParagraphs are now public
 *     for independent testing
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
import { BASE_CSS, PROFILE_CSS, LOADING_CSS } from "./styles";
import {
  SectionRendererRegistry,
  defaultSectionRenderer,
  type RenderHelpers,
} from "./SectionRendererRegistry";

export class AdaptiveRenderer {
  /**
   * RenderHelpers instance — exposed for custom section renderers and testing.
   */
  readonly helpers: RenderHelpers = {
    escapeHtml: this.escapeHtml.bind(this),
    markdownToHtml: this.markdownToHtml.bind(this),
    splitLongParagraphs: this.splitLongParagraphs.bind(this),
  };

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
        return this.renderSection(section, adapted, strategy);
      })
      .join("\n");

    const supportHtml = adaptation?.supportMessage
      ? `<div class="nc-support-message">${this.escapeHtml(adaptation.supportMessage)}</div>`
      : "";

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
  <style>${LOADING_CSS}</style>
  <!-- KaTeX for LaTeX formula rendering -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
    onload="renderMathInElement(document.body, {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false},
        {left: '\\\\\\\\(', right: '\\\\\\\\)', display: false},
        {left: '\\\\\\\\[', right: '\\\\\\\\]', display: true}
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
  <!-- Loading overlay -->
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

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'adaptation_progress') {
        const overlay = document.getElementById('nc-loading-overlay');
        if (!overlay) { return; }
        if (msg.status === 'started') {
          overlay.style.display = 'flex';
        } else {
          overlay.style.display = 'none';
        }
      }
    });

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

    document.querySelectorAll('.nc-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        vscode.postMessage({
          type: 'section_viewed',
          sectionId: cb.dataset.sectionId
        });
      });
    });

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

  // ─── Section rendering (delegates to SectionRendererRegistry) ────────────

  /**
   * Render a single section, delegating to a custom renderer if registered.
   */
  private renderSection(
    section: AssignmentSection,
    adapted: AdaptedSection | undefined,
    strategy: AdaptationStrategy
  ): string {
    // Check for custom renderer first
    const customRenderer = SectionRendererRegistry.find(section);
    const renderer = customRenderer ?? defaultSectionRenderer;

    if (adapted) {
      return renderer.renderAdapted(adapted, section, strategy, this.helpers);
    }
    return renderer.renderOriginal(section, strategy, this.helpers);
  }

  // ─── Public utility methods (for testing and custom renderers) ────────────

  /**
   * Convert Markdown to HTML using marked.
   * Protects LaTeX math blocks from being mangled by the Markdown parser.
   */
  markdownToHtml(markdown: string): string {
    try {
      const mathBlocks: string[] = [];
      const protected_ = markdown
        .replace(/\$\$([\s\S]*?)\$\$/g, (_, inner) => {
          mathBlocks.push(`$$${inner}$$`);
          return `%%MATH_BLOCK_${mathBlocks.length - 1}%%`;
        })
        .replace(/\$([^\n$]+?)\$/g, (_, inner) => {
          mathBlocks.push(`$${inner}$`);
          return `%%MATH_BLOCK_${mathBlocks.length - 1}%%`;
        });

      const result = marked.parse(protected_);
      const html = typeof result === "string" ? result : String(result);

      return html.replace(/%%MATH_BLOCK_(\d+)%%/g, (_, i) => mathBlocks[Number(i)]);
    } catch {
      return `<p>${this.escapeHtml(markdown)}</p>`;
    }
  }

  /**
   * Split paragraphs that exceed max length.
   */
  splitLongParagraphs(text: string, maxLength: number): string {
    return text.replace(
      new RegExp(`(.{${maxLength},}?[.!?])\\s`, "g"),
      "$1\n\n"
    );
  }

  /**
   * Escape HTML entities.
   */
  escapeHtml(text: string): string {
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

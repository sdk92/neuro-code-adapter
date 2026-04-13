/**
 * SectionRendererRegistry — Pluggable section rendering.
 *
 * Problem solved: AdaptiveRenderer had all section type rendering inlined
 * in one class. Adding a new section type (e.g. "quiz", "video") required
 * modifying the monolithic render method.
 *
 * Now each section type can register a custom renderer. The AdaptiveRenderer
 * delegates to the registry, falling back to the default renderer if no
 * custom one is registered.
 */
import type {
  AdaptedSection,
  AssignmentSection,
} from "@shared/types";
import type { AdaptationStrategy } from "./strategies";

// ─── Renderer Interface ──────────────────────────────────────────────────────

export interface SectionRenderer {
  /**
   * Check if this renderer can handle the given section.
   * Returning true claims the section for this renderer.
   */
  canRender(section: AssignmentSection): boolean;

  /**
   * Render a non-adapted (original) section.
   */
  renderOriginal(
    section: AssignmentSection,
    strategy: AdaptationStrategy,
    helpers: RenderHelpers
  ): string;

  /**
   * Render an LLM-adapted section.
   */
  renderAdapted(
    adapted: AdaptedSection,
    original: AssignmentSection,
    strategy: AdaptationStrategy,
    helpers: RenderHelpers
  ): string;
}

/**
 * Helper functions passed to section renderers.
 * Avoids duplicating utility methods in each renderer.
 */
export interface RenderHelpers {
  escapeHtml(text: string): string;
  markdownToHtml(markdown: string): string;
  splitLongParagraphs(text: string, maxLength: number): string;
}

// ─── Registry ────────────────────────────────────────────────────────────────

const renderers: SectionRenderer[] = [];

export const SectionRendererRegistry = {
  /**
   * Register a custom section renderer.
   * Renderers are checked in registration order; first match wins.
   */
  register(renderer: SectionRenderer): void {
    renderers.push(renderer);
  },

  /**
   * Find a renderer for the given section.
   * Returns undefined if no custom renderer matches.
   */
  find(section: AssignmentSection): SectionRenderer | undefined {
    return renderers.find((r) => r.canRender(section));
  },

  /**
   * Clear all registrations (useful for testing).
   */
  clear(): void {
    renderers.length = 0;
  },

  /**
   * Get the number of registered renderers.
   */
  get count(): number {
    return renderers.length;
  },
};

// ─── Default Section Renderer ────────────────────────────────────────────────
// Built-in renderer that handles all standard section types.
// AdaptiveRenderer uses this as the fallback.

export const defaultSectionRenderer: SectionRenderer = {
  canRender(_section: AssignmentSection): boolean {
    // Matches everything — used as fallback
    return true;
  },

  renderOriginal(
    section: AssignmentSection,
    strategy: AdaptationStrategy,
    helpers: RenderHelpers
  ): string {
    let content = section.content;

    if (strategy.maxParagraphLength > 0) {
      content = helpers.splitLongParagraphs(content, strategy.maxParagraphLength);
    }

    const summaryBox = strategy.addSummaryBoxes
      ? `<div class="nc-summary-box"><strong>Quick Summary:</strong> ${helpers.escapeHtml(section.title)}</div>`
      : "";

    const htmlContent = helpers.markdownToHtml(content);
    const divider = strategy.insertDividers ? '<hr class="nc-divider">' : "";

    return `
    ${divider}
    <section class="nc-section nc-section-${section.type}" data-section-id="${section.id}">
      <div class="nc-section-header">
        ${strategy.addCheckboxes
          ? `<input type="checkbox" class="nc-checkbox" data-section-id="${section.id}">`
          : ""}
        <h2>${helpers.escapeHtml(section.title)}</h2>
        <button class="nc-help-btn" data-section-id="${section.id}" title="Get help">?</button>
      </div>
      ${summaryBox}
      <div class="nc-section-body">${htmlContent}</div>
    </section>`;
  },

  renderAdapted(
    adapted: AdaptedSection,
    original: AssignmentSection,
    strategy: AdaptationStrategy,
    helpers: RenderHelpers
  ): string {
    const content = helpers.markdownToHtml(adapted.adaptedContent);
    const divider = strategy.insertDividers ? '<hr class="nc-divider">' : "";

    return `
    ${divider}
    <section class="nc-section nc-section-${original.type}" data-section-id="${original.id}">
      <div class="nc-section-header">
        ${strategy.addCheckboxes
          ? `<input type="checkbox" class="nc-checkbox" data-section-id="${original.id}">`
          : ""}
        <h2>${helpers.escapeHtml(adapted.adaptedTitle)}</h2>
        <button class="nc-help-btn" data-section-id="${original.id}" title="Get help">?</button>
      </div>
      <div class="nc-section-body">${content}</div>
      ${adapted.structuralChanges.length > 0
        ? `<div class="nc-adaptations-note">
            <small>Adaptations: ${adapted.structuralChanges.join(", ")}</small>
          </div>`
        : ""}
    </section>`;
  },
};

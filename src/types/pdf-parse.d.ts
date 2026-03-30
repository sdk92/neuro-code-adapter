/**
 * Type declarations for pdf-parse.
 * pdf-parse doesn't ship with TypeScript types.
 */
declare module "pdf-parse/lib/pdf-parse" {
  interface PdfData {
    /** Number of pages */
    numpages: number;
    /** Number of rendered pages */
    numrender: number;
    /** PDF info (title, author, etc.) */
    info: Record<string, unknown>;
    /** PDF metadata */
    metadata: Record<string, unknown> | null;
    /** PDF version */
    version: string;
    /** Extracted text content */
    text: string;
  }

  function pdfParse(dataBuffer: Buffer, options?: Record<string, unknown>): Promise<PdfData>;
  export = pdfParse;
}

declare module "pdf-parse" {
  export * from "pdf-parse/lib/pdf-parse";
}

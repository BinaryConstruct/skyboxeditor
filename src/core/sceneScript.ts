/**
 * Scene "Script" support: parse the live JSON scene text an author (human or
 * AI agent) is editing, and turn failures into messages that name *where* the
 * problem is — a line:column for JSON syntax errors, a layer index/name/field
 * for schema errors. The valid path reuses the v2 loader in io.ts verbatim so
 * a clean round-trip is byte-stable (toJsonString(parse(text)) === text).
 */
import { fromJsonString, toJsonString, validateProjectJson } from './io';
import type { Layer } from './layers';

export interface ScriptError {
  message: string;
  /** 1-based line, when the failure is locatable (JSON syntax errors). */
  line?: number;
  /** 1-based column. */
  col?: number;
}

export type ScriptParse =
  | { ok: true; layers: Layer[] }
  | { ok: false; error: ScriptError };

/**
 * Convert a 0-based character offset (as V8's JSON.parse reports in
 * "…in JSON at position N") into a 1-based line and column. A position past
 * the end clamps to the end of the text.
 */
export function positionToLineCol(text: string, pos: number): { line: number; col: number } {
  const end = Math.max(0, Math.min(pos, text.length));
  let line = 1;
  let col = 1;
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

/** Trim V8's trailing "at position …/(line … column …)" locator off a message. */
function coreMessage(msg: string): string {
  return msg
    .replace(/\s+in JSON at position \d+.*$/, '')
    .replace(/\s+at position \d+.*$/, '')
    .replace(/\s*\(line \d+ column \d+\).*$/, '')
    .trim();
}

/** Build a located ScriptError from a JSON.parse failure. */
function jsonSyntaxError(text: string, err: unknown): ScriptError {
  const raw = err instanceof Error ? err.message : String(err);

  // Modern V8: "…at position 42 (line 3 column 5)"; classic: "…at position 42".
  const posMatch = /at position (\d+)/.exec(raw);
  if (posMatch) {
    const { line, col } = positionToLineCol(text, Number(posMatch[1]));
    return { message: `JSON syntax error at line ${line}, column ${col}: ${coreMessage(raw)}`, line, col };
  }

  // Some engines report only "(line L column C)".
  const lcMatch = /line (\d+) column (\d+)/.exec(raw);
  if (lcMatch) {
    const line = Number(lcMatch[1]);
    const col = Number(lcMatch[2]);
    return { message: `JSON syntax error at line ${line}, column ${col}: ${coreMessage(raw)}`, line, col };
  }

  // No position in the message (V8's "Unexpected end of JSON input") -- the
  // problem is that the text stops too early, so point at its end.
  if (/end of JSON input/i.test(raw)) {
    const { line, col } = positionToLineCol(text, text.length);
    return { message: `JSON syntax error at line ${line}, column ${col}: ${coreMessage(raw)}`, line, col };
  }

  return { message: `JSON syntax error: ${raw}` };
}

/**
 * Parse scene JSON text into layers. On failure returns a structured error:
 * JSON syntax errors carry a line:col; schema errors name the offending layer
 * and field. On success the layers come straight from the v2 loader.
 */
export function parseSceneScript(text: string): ScriptParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: jsonSyntaxError(text, err) };
  }

  const issue = validateProjectJson(raw);
  if (issue) {
    return { ok: false, error: { message: issue.message } };
  }

  // validateProjectJson guarantees this is a well-formed v2 scene, so the
  // loader normalizes without warnings or dropped layers.
  return { ok: true, layers: fromJsonString(text).layers };
}

/** Canonical serialization used by the editor (kept next to the parser). */
export function serializeScene(layers: Layer[]): string {
  return toJsonString(layers);
}

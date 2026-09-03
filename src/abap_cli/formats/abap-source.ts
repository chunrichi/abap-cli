import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Read an ABAP source file (.abap) or metadata file (.xml) from disk.
 */
export async function readAbapFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

/**
 * Normalize line endings so comparisons are insensitive to CRLF vs LF:
 * `\r\n` and stray `\r` both become `\n`. Only for compare paths — files
 * pulled from SAP keep their original bytes (pull stays byte-faithful).
 */
export function normalizeLineEndings(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Write an ABAP source file to disk, creating parent directories as needed.
 */
export async function writeAbapFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Check if a file exists on disk.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

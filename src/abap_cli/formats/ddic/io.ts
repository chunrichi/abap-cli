/**
 * DDIC local-file I/O: read / write / list `.doma.json` … `.stru.json`
 * artifacts, including the abap-file-format three-piece reader for TABL/STRU.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { DdicObject, DdicSupportedType } from './types.js';

// Known DDIC object extensions
export const DDIC_EXTENSIONS = ['.doma.json', '.dtel.json', '.tabl.json', '.stru.json', '.ttyp.json', '.msag.json', '.ddls.json'];

/**
 * Read a DDIC JSON file from disk.
 */
export async function readDdicJson(filePath: string): Promise<DdicObject> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as DdicObject;
}

/**
 * abap-file-format compliant reader for the `create` flow.
 *
 * For TABL/STRU, look for a three-piece layout next to the main JSON:
 * `<name>.tabl.json` + `<name>.tabl.ddic` (+ optional `<name>.tabl.settings.json`).
 * If the sidecars exist, parse them via `readTablArtifact` so the wire payload
 * honors abap-file-format (DDL is the source of truth for fields, settings
 * holds dataClassCategory / sizeCategory). If only the main JSON is present
 * (legacy wire-flat shape), fall back to `readDdicJson` for backwards
 * compatibility. For DOMA/DTEL the legacy wire-flat shape is the only one.
 */
export async function readDdicObjectForCreate(filePath: string, type: DdicSupportedType): Promise<DdicObject> {
  if (type === 'TABL' || type === 'STRU') {
    // Lazy import to avoid pulling tabl-artifact code for non-TABL flows.
    const { readTablArtifact } = await import('./tabl-artifact.js');
    const artifact = await readTablArtifact(filePath).catch((error: unknown) => {
      // readTablArtifact throws on malformed DDL / missing main+ddic pair.
      // Surface the message verbatim — the create-flow wrapper turns it into
      // a structured CliError.
      throw error instanceof Error ? error : new Error(String(error));
    });
    if (artifact) return artifact.local;
  }
  return readDdicJson(filePath);
}

/**
 * Write a DDIC JSON file to disk, creating parent directories as needed.
 */
export async function writeDdicJson(filePath: string, data: DdicObject): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * List all DDIC JSON files in a directory recursively.
 */
export async function listDdicFiles(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...await listDdicFiles(fullPath));
      } else if (DDIC_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  } catch {
    // directory may not exist
  }
  return results;
}

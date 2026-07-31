import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Read an ABAP source file (.abap) or metadata file (.xml) from disk.
 */
export async function readAbapFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
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

/**
 * List all .abap and .xml files in a directory recursively.
 */
export async function listAbapFiles(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...await listAbapFiles(fullPath));
    } else if (entry.name.endsWith('.abap') || entry.name.endsWith('.xml')) {
      results.push(fullPath);
    }
  }
  return results;
}

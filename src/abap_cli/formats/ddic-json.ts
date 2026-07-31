import * as fs from 'fs/promises';
import * as path from 'path';

// Known DDIC object extensions
export const DDIC_EXTENSIONS = ['.doma.json', '.dtel.json', '.tabl.json', '.stru.json', '.ttyp.json'];

export interface DdicObject {
  name: string;
  description?: string;
  [key: string]: unknown;
}

/**
 * Read a DDIC JSON file from disk.
 */
export async function readDdicJson(filePath: string): Promise<DdicObject> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as DdicObject;
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

/**
 * Basic validation: check that required fields exist for a DDIC type.
 */
export function validateDdicObject(data: DdicObject, objectType: string): string[] {
  const errors: string[] = [];
  if (!data.name) errors.push('Missing required field: name');

  switch (objectType) {
    case 'DOMA':
      if (!data.dataType) errors.push('Domain missing: dataType');
      if (!data.length) errors.push('Domain missing: length');
      break;
    case 'DTEL':
      if (!(data as Record<string, unknown>).domain) errors.push('DataElement missing: domain');
      break;
    case 'TABL':
    case 'STRU':
      if (!(data as Record<string, unknown>).fields) errors.push(`${objectType} missing: fields`);
      break;
    case 'TTYP':
      if (!(data as Record<string, unknown>).rowType) errors.push('TableType missing: rowType');
      break;
  }
  return errors;
}

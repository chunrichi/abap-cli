import * as path from 'path';
import * as fs from 'fs/promises';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { resolveFile } from '../formats/file-resolver.js';
import { readAbapFile } from '../formats/abap-source.js';

/**
 * Deploy bundled ABAP source files from abap/src/ to a SAP system.
 */
export async function deployBundledSources(transport?: string, targetPackage?: string): Promise<void> {
  const adt = new AdtClientWrapper();
  const bundledDir = path.resolve(__dirname, '../../../abap/src');

  let files: string[];
  try {
    const entries = await fs.readdir(bundledDir);
    files = entries
      .filter(f => f.endsWith('.abap') || f.endsWith('.xml'))
      .map(f => path.join(bundledDir, f));
  } catch {
    console.log('No bundled ABAP sources found in abap/src/');
    return;
  }

  if (files.length === 0) {
    console.log('No ABAP source files to deploy.');
    return;
  }

  for (const filePath of files) {
    const resolved = resolveFile(filePath);
    const source = await readAbapFile(filePath);
    console.log(`Deploying ${resolved.objectName} (${resolved.objectType})...`);

    // TODO: Implement full deploy workflow
    // 1. Lock object
    // 2. Set source
    // 3. Syntax check
    // 4. Activate
    // 5. Unlock
    console.log(`  [stub] Would deploy ${source.length} chars of source`);
  }

  console.log('Deploy complete.');
}

import type { ObjectMetadata } from '../sync/resolve.js';

/**
 * Render the <name>.<type>.json metadata file per abap-file-format v1.
 * Minimum-required content: formatVersion + header (description, originalLanguage).
 */
export function renderObjectMetadataJson(metadata: ObjectMetadata): string {
  const doc = {
    formatVersion: '1',
    header: {
      description: metadata.description ?? '',
      originalLanguage: (metadata.masterLanguage ?? 'EN').toLowerCase(),
    },
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

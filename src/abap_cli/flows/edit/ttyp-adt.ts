/**
 * TTYP content write over ADT: lock → PUT → unlock → activate.
 *
 * The ADT collection POST only registers the table type with default content;
 * the row type / access type / keys are the object content and go through a
 * locked PUT (vendor media type + `?lockHandle=`). The result is an inactive
 * version until activation, so every write activates before returning.
 *
 * Shared by `create-ttyp` (create the header, then write the definition) and
 * `push-ttyp` (existence check, then write the definition).
 */
import type { AdtClientWrapper } from '../../clients/adt-client.js';

/** Write the DDIC content of an existing TTYP over ADT and activate it. */
export async function writeTtypContent(
  client: AdtClientWrapper,
  name: string,
  body: string,
  transport?: string,
): Promise<void> {
  const url = `/sap/bc/adt/ddic/tabletypes/${name.toUpperCase()}`;
  const lock = await client.lock(url);
  const handle = lock.LOCK_HANDLE;
  try {
    await client.updateTtyp(name, body, handle, transport);
  } finally {
    await client.unLock(url, handle).catch(() => undefined);
  }
  await client.activate(url, 'TTYP/DA', name);
}

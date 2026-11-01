/**
 * MSAG content write over ADT: lock → PUT → unlock.
 *
 * The ADT creation endpoint only creates the message-class header; the message
 * texts are the object content and go through a locked PUT. Shared by
 * `create-msag` (create the header, then write the messages) and `push-msag`
 * (existence check, then write the messages).
 */
import type { AdtClientWrapper } from '../../clients/adt-client.js';

/** Write the `mc:messages` content of an existing MSAG over ADT. */
export async function writeMsagContent(
  client: AdtClientWrapper,
  name: string,
  xml: string,
  transport?: string,
): Promise<void> {
  const url = `/sap/bc/adt/messageclass/${name.toUpperCase()}`;
  const lock = await client.lock(url);
  const handle = lock.LOCK_HANDLE;
  try {
    await client.updateMsag(name, xml, handle, transport);
  } finally {
    await client.unLock(url, handle).catch(() => undefined);
  }
}

import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';

/**
 * Resolve the transport request: --tr > project config > user's first modifiable request.
 * Throws NO_TRANSPORT when nothing is available (contracts/cli-commands.md FR-006).
 */
export async function resolveTransport(
  client: AdtClientWrapper,
  tr?: string,
  configTransport?: string,
): Promise<string> {
  if (tr) return tr;
  if (configTransport) return configTransport;

  const user = client.getConfig().sap.username;
  const result = await client.userTransports(user);
  for (const target of [...result.workbench, ...result.customizing]) {
    const first = target.modifiable[0];
    if (first?.['tm:number']) return first['tm:number'];
  }
  throw new CliError('NO_TRANSPORT', 'No transport request available; specify one with --tr', {
    nextSteps: ['Re-run with --tr <request> (e.g. --tr NDK123456).', "Create one with 'abap transport create'."],
    example: 'abap push src/foo.abap --tr NDK123456',
  });
}

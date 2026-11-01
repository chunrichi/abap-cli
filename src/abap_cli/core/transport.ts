import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';

/**
 * True for SAP local packages (`$TMP`, `$CRW`, `$ZADT_TEST`, ...).
 *
 * SAP reserves the `$` prefix for LOCAL packages: their objects are never
 * recorded in a transport request, so write flows must not require `--tr` for
 * them. Only `$`-prefixed packages are transport-free — the DEVC naming rule
 * also accepts a `TEST` prefix when *creating* a local package, which is a
 * separate package-creation constraint (see `formats/devc/json.ts`).
 */
export function isLocalPackageName(packageName: string | undefined | null): boolean {
  return (packageName ?? '').trim().startsWith('$');
}

/**
 * The transport request to attach to a write: `$`-prefixed local packages are
 * transport-free, so a stray `--tr` is dropped instead of reaching the wire
 * (SAP would ignore it for a local object, but the CLI must not report it as
 * used). Non-local callers have already validated that a request is present.
 */
export function transportForPackage(
  packageName: string | undefined | null,
  transport: string | undefined,
): string | undefined {
  return isLocalPackageName(packageName) ? undefined : transport;
}

/**
 * Resolve the transport request: --tr > project config > user's first modifiable request.
 * Throws NO_TRANSPORT when nothing is available.
 *
 * When `transportOptional` is true (the caller targets a local package, e.g.
 * `$TMP` / `$CRW`), an empty string is always returned: local objects are
 * never recorded in a transport request, so the explicit `--tr`, the project
 * config default and the user's open requests must not be attached. Callers
 * decide local-ness beforehand ({@link isLocalPackageName}).
 */
export async function resolveTransport(
  client: AdtClientWrapper,
  tr?: string,
  configTransport?: string,
  opts: { transportOptional?: boolean } = {},
): Promise<string> {
  if (opts.transportOptional) return '';
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
    references: 'skills/abap-cli-setup/references/errors.md#no_transport',
  });
}

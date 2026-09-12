/**
 * Function module (FUGR/FF) create flow.
 *
 * `abap create FUGR <group> --func <name>`: the group must already exist; the
 * module is POSTed to the ADT create endpoint
 * `/sap/bc/adt/functions/groups/<group>/fmodules` (abap-adt-api objectcreator
 * FUGR/FF), then activated unless --no-activate. Create-then-pull writes the
 * `<group>.fugr.<fm>.func.{abap,json}` pair with the same layout pull produces
 * for an existing module; existing local group files are never overwritten.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { resolveObject, type ResolvedObject } from '../../core/resolve.js';
import { resolveTransport } from '../../core/transport.js';
import { toOutputPath } from '../../core/path-output.js';
import type { CreateOptions } from './create.js';
import { normalizeName, validateObjectName } from './object-name.js';

async function fugrFuncExists(client: AdtClientWrapper, group: string, funcName: string): Promise<boolean> {
  const results = await client.searchObject(`*${funcName}*`, '', 200);
  const groupLow = group.toLowerCase();
  return results.some(
    (r) =>
      r['adtcore:type']?.startsWith('FUGR/FF')
      && r['adtcore:name'] === funcName
      && String(r['adtcore:uri']).includes(`/functions/groups/${groupLow}/fmodules/`),
  );
}

export async function runCreateFugrFunc(
  groupName: string,
  funcNameArg: string,
  opts: CreateOptions,
  mode: OutputMode,
): Promise<void> {
  const funcName = normalizeName(funcNameArg);
  validateObjectName(funcName, 'ZFG_MY_GROUP_FF01');
  if (opts.checkOnly) {
    throw new CliError('INVALID_ARGUMENT', '--check-only is not supported with --func', {
      nextSteps: ['Create the function module directly (no validation endpoint for FUGR/FF in this phase).'],
      example: `abap create FUGR ${groupName} --func ${funcName} --package '${opts.package}' --description "..." --yes`,
    });
  }

  const client = await AdtClientWrapper.create();

  let group: ResolvedObject;
  try {
    group = await resolveObject(client, groupName, 'FUGR');
  } catch (error: unknown) {
    if (error instanceof CliError && error.code === 'OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `Function group ${groupName} not found — create it first`, {
        object: groupName,
        nextSteps: [`Create the group first: abap create FUGR ${groupName} --package <pkg> --description "..."`],
        example: `abap create FUGR ${groupName} --package '${opts.package}' --description "group for ${funcName}" --yes`,
      });
    }
    throw error;
  }
  const groupNameUp = group.name;
  const groupLow = groupNameUp.toLowerCase();
  const groupUrl = group.objectUrl.replace(/\/+$/, '');

  if (await fugrFuncExists(client, groupNameUp, funcName)) {
    throw new CliError('OBJECT_EXISTS', `Function module ${funcName} already exists in function group ${groupNameUp}`, {
      object: funcName,
      nextSteps: ['Choose a different --func name, or edit/push the existing module instead.'],
    });
  }

  const transport = await resolveTransport(
    client,
    opts.tr,
    client.getConfig().transport,
    { transportOptional: (opts.package ?? '$TMP').trim().toUpperCase() === '$TMP' },
  );

  const fmUrl = `${groupUrl}/fmodules/${funcName.toLowerCase()}`;
  try {
    await client.createObject({
      objtype: 'FUGR/FF',
      name: funcName,
      parentName: groupNameUp,
      description: opts.description,
      parentPath: groupUrl,
      transport,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('CREATE_FAILED', `Failed to create function module ${funcName} in ${groupNameUp}: ${message}`, {
      object: funcName,
      type: 'FUGR/FF',
    });
  }

  const skipActivate = opts.activate === false;
  if (!skipActivate) {
    try {
      await client.activate(fmUrl, 'FUGR/FF', funcName);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError('ACTIVATION_FAILED', `Created ${funcName} but activation failed: ${message}`, {
        object: funcName,
        type: 'FUGR/FF',
        nextSteps: ['Re-run activation: abap activate <group> or activate the module in ADT/SE80.'],
      });
    }
  }

  let localFile: string | undefined;
  if (opts.pull !== false) {
    const { pullObject } = await import('./pull-source.js');
    const pulled = await pullObject(
      client,
      { name: groupNameUp, type: 'FUGR/F', objectUrl: groupUrl },
      { dir: 'src', overwrite: false, skipExisting: true },
    );
    const funcAbapSuffix = `${groupLow}.fugr.${funcName.toLowerCase()}.func.abap`;
    const written = pulled.written.find((f) => f.endsWith(funcAbapSuffix));
    if (written) localFile = toOutputPath(written);
  }

  printResult(mode,
    {
      object: funcName,
      type: 'FUGR/FF',
      group: groupNameUp,
      package: opts.package,
      description: opts.description,
      transport,
      activated: skipActivate ? false : true,
      localFile,
    },
    `Created function module ${funcName} in function group ${groupNameUp}${skipActivate ? ' (not activated)' : ''} (${transport})`,
  );
}

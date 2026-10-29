/**
 * `abap activate` flow.
 *
 * Activates every inactive item that belongs to one object. A root-URI-only
 * activate can report success while method / OSI items stay inactive (013
 * dogfooding lesson), so the flow collects the object's inactive items from
 * the ADT inactive-objects list and activates them together.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { resolveObject } from '../../core/resolve.js';

export interface ActivateRunOptions {
  type?: string;
  yes?: boolean;
}

/** Flow outcome: JSON envelope data + human summary, printed by the command layer. */
export interface ActivateResult {
  data: Record<string, unknown>;
  human: string;
}

export async function runActivate(object: string, opts: ActivateRunOptions): Promise<ActivateResult> {
  if (!opts.yes && !process.stdin.isTTY) {
    throw new CliError('VALIDATION_ERROR', 'abap activate modifies SAP; confirm with --yes in non-interactive mode', {
      nextSteps: ['Re-run with --yes to apply activation.', 'Or use abap inspect <object> --activation to review the state first.'],
      example: 'abap activate ZCL_MY_CLASS --yes',
    });
  }
  const client = await AdtClientWrapper.create();
  const resolved = await resolveObject(client, object, opts.type);

  // Collect all inactive items that belong to this object. Method/OSI
  // items carry a #fragment URI; match on the object part only so a
  // same-prefix name (ZCL_FOO vs ZCL_FOO_BAR) never leaks in.
  const inact = await client.inactiveObjects();
  const mine = (inact ?? []).filter((i) => {
    const uri = (i?.object?.['adtcore:uri'] ?? '') as string;
    return uri.split('#')[0] === resolved.objectUrl;
  });

  if (mine.length === 0) {
    return {
      data: { object: resolved.name, activated: 0, message: 'no inactive items to activate' },
      human: `${resolved.name}: no inactive items to activate.`,
    };
  }

  const items = mine.map((i) => {
    const o = i.object as { 'adtcore:uri': string; 'adtcore:type': string; 'adtcore:name': string };
    return { uri: o['adtcore:uri'], type: o['adtcore:type'], name: o['adtcore:name'], parentUri: o['adtcore:uri'].split('#')[0] ?? o['adtcore:uri'] };
  });
  const res = await client.activateAll(items);
  return {
    data: { object: resolved.name, activated: items.length, messages: res.messages },
    human: `Activated ${items.length} inactive item(s) of ${resolved.name}.`,
  };
}

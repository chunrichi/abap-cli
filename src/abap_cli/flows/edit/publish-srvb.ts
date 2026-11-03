/**
 * SRVB publish / unpublish flow.
 *
 * The ADT publish job needs the OData service version and the binding protocol
 * version; both are read from the binding's metadata envelope, so the command
 * works on an existing binding without pulling it first. Publishing is a
 * local (non-transportable) endpoint activation: run it after the binding and
 * its service definition are active.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { parseSrvbMetadata } from '../../clients/srvb.js';
import { CliError, type OutputMode } from '../../output/json.js';
import type { PublishSrvbOptions } from './publish-srvb-types.js';

export type { PublishSrvbOptions } from './publish-srvb-types.js';

export interface PublishSrvbResult {
  object: string;
  type: 'SRVB';
  action: 'published' | 'unpublished';
  channel: 'adt';
  serviceVersion: string;
  bindingVersion: string;
  published: boolean;
  status: string;
  message?: string;
}

/**
 * Run the publish or unpublish job for one service binding.
 *
 * A missing binding maps to `OBJECT_NOT_FOUND`; a binding without the versions
 * the job needs (e.g. metadata-only creation that never got a service
 * definition) maps to `VALIDATION_ERROR` with a pull/inspect pointer.
 */
export async function runPublishSrvb(
  objectName: string,
  opts: PublishSrvbOptions,
  _mode?: OutputMode,
): Promise<{ data: PublishSrvbResult; human: string }> {
  const name = objectName.trim().toUpperCase();
  const client = await AdtClientWrapper.create();
  let xml: string;
  try {
    xml = await client.getSrvbMetadata(name);
  } catch (error) {
    if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
      throw new CliError('OBJECT_NOT_FOUND', `Service binding ${name} not found`, {
        object: name,
        type: 'SRVB',
        nextSteps: [`Verify the name/type: 'abap search ${name}'.`, 'Create it first: abap create SRVB … --file … --package … --yes'],
      });
    }
    throw error;
  }
  const meta = parseSrvbMetadata(xml);
  if (!meta.serviceVersion || !meta.bindingVersion) {
    throw new CliError(
      'VALIDATION_ERROR',
      `Cannot determine the publish versions of SRVB ${name} (service version "${meta.serviceVersion || '?'}", binding version "${meta.bindingVersion || '?'}")`,
      {
        object: name,
        type: 'SRVB',
        details: { serviceVersion: meta.serviceVersion, bindingVersion: meta.bindingVersion },
        nextSteps: [`Inspect the binding: abap pull ${name} --type SRVB`, 'The binding needs an active service definition and a binding protocol version (V2/V4).'],
      },
    );
  }
  const unpublish = opts.unpublish === true;
  const job = await client.publishSrvb(name, meta.serviceVersion, meta.bindingVersion, unpublish);
  const action = unpublish ? 'unpublished' : 'published';
  const data: PublishSrvbResult = {
    object: name,
    type: 'SRVB',
    action,
    channel: 'adt',
    serviceVersion: meta.serviceVersion,
    bindingVersion: meta.bindingVersion,
    published: !unpublish,
    status: job.severity || 'OK',
    ...(job.shortText ? { message: job.shortText } : {}),
  };
  return {
    data,
    human:
      `${unpublish ? 'Unpublished' : 'Published'} SRVB ${name}` +
      ` (${meta.bindingVersion}, service version ${meta.serviceVersion})`,
  };
}

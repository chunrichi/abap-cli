/**
 * EVTB schema compliance — the vendored `evtb-v1.json` against the upstream
 * AFF example document plus the shapes the CLI must reject.
 */
import { describe, expect, it } from 'vitest';
import { expectSchemaFail } from './_helpers.js';
import { validateAff } from '../../../src/abap_cli/aff/schema-validator.js';

/** Upstream `file-formats/evtb/examples/z_aff_example_evtb.evtb.json`. */
const EVTB_EXAMPLE = {
  formatVersion: '1',
  header: {
    description: 'Event binding example',
    originalLanguage: 'en',
  },
  producerNamespace: 'sap.s4',
  producer: 'PC59C0E46A5E8B597EB82CB1AA2890FE8',
  producerVersion: '0001',
  boName: 'BusinessUser',
  boOperation: 'Deleted',
  producerType: 'sap.s4.BusinessUser.Deleted.v*',
  events: [
    {
      eventVersion: '0001',
      entityName: 'I_SBOI_RAP_ATC',
      entityEventName: 'DELETED',
    },
  ],
};

describe('evtb-v1.json', () => {
  it('accepts the upstream AFF example', async () => {
    const r = await validateAff('EVTB', EVTB_EXAMPLE);
    expect(r.status).toBe('pass');
  });

  it('rejects a document without events', async () => {
    const { events: _omitted, ...withoutEvents } = EVTB_EXAMPLE;
    await expectSchemaFail('EVTB', withoutEvents, /required property 'events'/);
  });

  it('rejects unknown top-level properties (additionalProperties: false)', async () => {
    await expectSchemaFail(
      'EVTB',
      { ...EVTB_EXAMPLE, package: '$TMP' },
      /additionalProperties|must NOT have additional properties/,
    );
  });
});

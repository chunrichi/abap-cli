/**
 * JOBD (application job definition) local document contract.
 *
 * Pins `jobd-v1.json` (local extension — upstream AFF has no JOBD format), the
 * local ↔ ICF wire mapping and the semantic rules the ICF route enforces.
 */
import { describe, it, expect } from 'vitest';
import {
  jobdArtifact,
  localToWire,
  wireToLocal,
  validateJobdObject,
  getJobdJsonExample,
  JOB_DEFINITION_NAME_MAX_LENGTH,
  type JobdLocal,
} from '../../src/abap_cli/formats/jobd/json.js';
import { schemaPathFor } from '../../src/abap_cli/aff/schema-paths.js';
import { routeType } from '../../src/abap_cli/aff/router.js';

const DOC: JobdLocal = {
  formatVersion: '1',
  name: 'ZCLI_TC_JOBD_DAILY',
  package: '$TMP',
  btcjobName: 'ZCLI_TC_JOBD_DAILY',
  prodClient: '',
  sysClient: '',
  maintMode: '',
  isScope: '',
  maxRuntime: 12,
  abortionCode: 'C',
  isTimeBased: 'X',
  isEventBased: '',
  startTime: '06:00:00',
  startWeekday: 0,
  startMonthday: 0,
  beginMonth: '',
  endMonth: '',
  recurCode: 'D',
  recurValue: 1,
  eventName: '',
  eventParam: '',
  isLight: '',
  jdType: '',
  timezoneIndicator: 'S',
  scopeClass: '',
  schedulingConditions: '',
  alwaysRun: '',
  techClntRun: '',
  noRandomStarttime: '',
  isScopeChanged: '',
  passClient: false,
  sysTimezoneIndicator: false,
  reportName: 'ZCLI_TC_REPORT',
  variantName: '',
  localDeact: false,
  localCust: false,
};

describe('formats/jobd/json.ts (local extension)', () => {
  it('resolves the schema path and file suffix', () => {
    expect(schemaPathFor('JOBD')).toContain('jobd-v1.json');
    expect(routeType('src/zcli_tc_jobd_daily.jobd.json')).toBe('JOBD');
    expect(JOB_DEFINITION_NAME_MAX_LENGTH).toBe(32);
  });

  it('accepts a complete document and rejects unknown properties', async () => {
    expect(await jobdArtifact.validate(DOC)).toEqual([]);
    const errors = await jobdArtifact.validate({ ...DOC, unexpected: true });
    expect(errors.join(' ')).toContain('additional properties');
  });

  it('rejects over-long names, bad flags and non-ISO times', async () => {
    const tooLong = await jobdArtifact.validate({ ...DOC, name: `ZCLI_${'X'.repeat(40)}` });
    expect(tooLong.join(' ')).toContain('not exceed 32');

    const badFlag = await jobdArtifact.validate({ ...DOC, isTimeBased: 'Y' });
    expect(badFlag.join(' ')).toContain('isTimeBased');

    const badTime = await jobdArtifact.validate({ ...DOC, startTime: '060000' });
    expect(badTime.join(' ')).toContain('HH:MM:SS');

    const badBool = await jobdArtifact.validate({ ...DOC, passClient: 'X' });
    expect(badBool.join(' ')).toContain('passClient must be a boolean');
  });

  it('maps local ↔ wire: package is read-side only, name is upper-cased', () => {
    const wire = localToWire({ ...DOC, name: 'zcli_tc_jobd_daily' });
    expect(wire.name).toBe('ZCLI_TC_JOBD_DAILY');
    expect(wire).not.toHaveProperty('package');
    expect(wire.formatVersion).toBe('1');

    const local = wireToLocal({
      formatVersion: '1',
      name: 'zcli_tc_jobd_daily',
      package: 'ztest',
      isTimeBased: 'X',
      maxRuntime: '7',
      passClient: true,
      startTime: '06:00:00',
    });
    expect(local).toMatchObject({
      formatVersion: '1',
      name: 'ZCLI_TC_JOBD_DAILY',
      package: 'ZTEST',
      isTimeBased: 'X',
      maxRuntime: 7,
      passClient: true,
      reportName: '',
    });
  });

  it('keeps the name/mismatch validation actionable', () => {
    expect(validateJobdObject({ formatVersion: '1' }).join(' ')).toContain('name');
    expect(validateJobdObject({ formatVersion: '1', name: 'ZCLI BAD' }).join(' ')).toContain('only');
  });

  it('ships an agent-facing example with the editable fields', () => {
    const example = getJobdJsonExample();
    expect(example).toContain('"formatVersion": "1"');
    expect(example).toContain('"recurCode"');
    expect(example).toContain('"reportName"');
  });
});

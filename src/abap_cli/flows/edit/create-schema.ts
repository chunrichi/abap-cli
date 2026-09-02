import type { CommandSchema } from '../../output/json.js';
import { getDdicJsonExample, type DdicSupportedType } from '../../formats/ddic/json.js';
import { listTemplates } from '../../formats/templates.js';
import { isDdicSupportedType, isHttpSupportedType, isTranSupportedType } from './create-types.js';
import { allSupportedTypes, createObjtypeFor, isSupportedType } from '../../types/registry.js';

/** `create --schema` 的返回类型：在通用 schema 上补充类型维度。 */
export type CreateCommandSchema = CommandSchema & {
  type?: string;
  supported?: boolean;
  /** 'icf' for DDIC types created via the self-built ICF service. */
  route?: 'icf';
  reason?: 'DDIC_NOT_SUPPORTED' | 'TYPE_NOT_SUPPORTED';
  message?: string;
  templates?: { name: string; description: string }[];
  /** BUG-1: minimal abap-file-format JSON example for the requested type. */
  exampleJson?: string;
};

/**
 * Machine-readable parameter contract for `abap create --schema [type]` (P0.1).
 * 无 type → 通用 schema（列出支持的类型）；DDIC/未知类型 → supported:false。
 *
 * T051 (US11): all 10 supported types come from `types/registry.ts`.
 */
export function createSchema(type?: string): CreateCommandSchema {
  const t = type?.trim().toUpperCase();
  const supportedTypes = allSupportedTypes();
  const base: CreateCommandSchema = {
    schemaVersion: 1,
    command: 'create',
    description: 'Create a new ABAP source object (CLAS, INTF, PROG, FUGR) and activate it',
    usage: 'abap create <type> <name> [options]',
    arguments: [
      { name: 'type', required: true, description: 'Object type', allowedValues: supportedTypes },
      { name: 'name', required: true, description: 'Object name' },
    ],
    options: [
      { name: '--package', type: 'string', valuePlaceholder: '<package>', required: true, description: 'Target SAP package (required)' },
      { name: '--description', type: 'string', valuePlaceholder: '<desc>', required: true, description: 'Object description (required)' },
      { name: '--tr', type: 'string', valuePlaceholder: '<transport>', description: 'Transport number' },
      { name: '--no-activate', type: 'boolean', description: 'Create the object but do not activate it' },
      { name: '--template', type: 'string', valuePlaceholder: '<template>', description: 'Skeleton template' },
      { name: '--no-pull', type: 'boolean', description: 'Skip the create-then-pull local copy (default: pull after create)' },
      { name: '--check-only', type: 'boolean', description: 'Validate the proposed object without creating it' },
      { name: '--audit', type: 'boolean', description: 'Include the before-checksum (extra SAP round-trip, off by default)' },
      { name: '--file', type: 'string', valuePlaceholder: '<path>', description: 'abap-file-format DDIC JSON input (required for DOMA/DTEL/TABL/STRU)' },
      { name: '--schema', type: 'boolean', default: false, description: 'Print the command parameter schema as JSON and exit (no SAP call).' },
      { name: '--yes', type: 'boolean', default: false, description: 'Confirm in non-interactive environments.' },
      { name: '--non-interactive', type: 'boolean', default: false, description: 'Alias of --yes.' },
    ],
    globalOptions: ['--json'],
    examples: ['abap create CLAS ZCL_MY_CLASS --package ZPKG --description "desc"'],
  };

  if (!t) return base;
  // Supported DDIC types now report supported:true with the ICF route
  // (TTYP and unknown types stay rejected).
  if (isDdicSupportedType(t)) {
    return {
      ...base,
      type: t,
      supported: true,
      route: 'icf',
      message: `DDIC type ${t} created via the self-built ICF service. Requires --file <abap-file-format JSON> with top-level fields: name, description, fields[].`,
      exampleJson: getDdicJsonExample(t as DdicSupportedType),
      options: [
        ...base.options,
        { name: '--file', type: 'string', valuePlaceholder: '<path>', required: true, description: 'abap-file-format DDIC JSON input (top-level fields; see exampleJson)' },
      ],
    };
  }
  // HTTP service routed via the self-built ICF service.
  if (isHttpSupportedType(t)) {
    return {
      ...base,
      type: t,
      supported: true,
      route: 'icf',
      message: `HTTP service created via the self-built ICF service. Requires --file <abap-file-format JSON>.`,
      options: [
        ...base.options,
        { name: '--file', type: 'string', valuePlaceholder: '<path>', required: true, description: 'abap-file-format HTTP service JSON input' },
      ],
    };
  }
  if (isTranSupportedType(t)) {
    return {
      ...base,
      type: t,
      supported: true,
      route: 'icf',
      message: `Transaction code created via the self-built ICF service. Requires --file <abap-file-format JSON>.`,
      options: [
        ...base.options,
        { name: '--file', type: 'string', valuePlaceholder: '<path>', required: true, description: 'abap-file-format Transaction JSON input' },
      ],
    };
  }
  if (t === 'TTYP') {
    return {
      ...base,
      type: t,
      supported: false,
      reason: 'DDIC_NOT_SUPPORTED',
      message: `Object type ${t} is a DDIC object; deferred to a later phase (Q2).`,
    };
  }
  if (!isSupportedType(t) || !createObjtypeFor(t)) {
    return {
      ...base,
      type: t,
      supported: false,
      reason: 'TYPE_NOT_SUPPORTED',
      message: `Object type ${t} is not supported. Supported types: ${supportedTypes.join(', ')}`,
    };
  }

  const templates = listTemplates(t).map((x) => ({ name: x.name, description: x.description }));
  return {
    ...base,
    type: t,
    supported: true,
    templates,
    options: base.options.map((o) =>
      o.name === '--template' ? { ...o, allowedValues: templates.map((x) => x.name) } : o,
    ),
  };
}

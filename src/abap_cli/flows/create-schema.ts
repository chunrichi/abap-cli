import type { CommandSchema } from '../output/json.js';
import { DDIC_SUPPORTED_TYPES } from '../dictionary/ddic-json.js';
import { listTemplates } from '../formats/templates.js';
import { TYPE_MAP, DDIC_TYPES } from './create-types.js';

/** `create --schema` 的返回类型：在通用 schema 上补充类型维度。 */
export type CreateCommandSchema = CommandSchema & {
  type?: string;
  supported?: boolean;
  /** 014: 'icf' for DDIC types created via the self-built ICF service. */
  route?: 'icf';
  reason?: 'DDIC_NOT_SUPPORTED' | 'TYPE_NOT_SUPPORTED';
  message?: string;
  templates?: { name: string; description: string }[];
};

/**
 * Machine-readable parameter contract for `abap create --schema [type]` (P0.1).
 * 无 type → 通用 schema（列出支持的类型）；DDIC/未知类型 → supported:false。
 */
export function createSchema(type?: string): CreateCommandSchema {
  const t = type?.trim().toUpperCase();
  const base: CreateCommandSchema = {
    schemaVersion: 1,
    command: 'create',
    description: 'Create a new ABAP source object (CLAS, INTF, PROG, FUGR) and activate it',
    usage: 'abap create <type> <name> [options]',
    arguments: [
      { name: 'type', required: true, description: 'Object type', allowedValues: Object.keys(TYPE_MAP) },
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
    ],
    globalOptions: ['--json', '--report-stuck'],
    examples: ['abap create CLAS ZCL_MY_CLASS --package ZPKG --description "desc"'],
  };

  if (!t) return base;
  // 014: supported DDIC types now report supported:true with the ICF route
  // (TTYP and unknown types stay rejected).
  if (DDIC_TYPES.has(t)) {
    return {
      ...base,
      type: t,
      supported: true,
      route: 'icf',
      message: `DDIC type ${t} created via the self-built ICF service (014). Requires --file <abap-file-format JSON>.`,
      options: [
        ...base.options,
        { name: '--file', type: 'string', valuePlaceholder: '<path>', required: true, description: 'abap-file-format DDIC JSON input' },
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
  if (!TYPE_MAP[t]) {
    return {
      ...base,
      type: t,
      supported: false,
      reason: 'TYPE_NOT_SUPPORTED',
      message: `Object type ${t} is not supported. Supported types: ${[...Object.keys(TYPE_MAP), ...DDIC_SUPPORTED_TYPES].join(', ')}`,
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

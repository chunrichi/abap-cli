import type { CommandSchema } from '../../output/json.js';
import { getDdicJsonExample, type DdicSupportedType } from '../../formats/ddic/json.js';
import { listTemplates } from '../../formats/templates.js';
import {
  isDdicSupportedType,
  allSupportedTypes,
  createObjtypeFor,
  isSupportedType,
  requiresFileFor,
  sourceFor,
  typesRequiringFile,
} from '../../types/registry.js';

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
      { name: '--file', type: 'string', valuePlaceholder: '<path>', description: `abap-file-format JSON input (required for ${typesRequiringFile().join('/')})` },
      { name: '--func', type: 'string', valuePlaceholder: '<name>', description: 'With FUGR: create a function module (FUGR/FF) inside the existing function group <name>' },
      { name: '--schema', type: 'boolean', default: false, description: 'Print the command parameter schema as JSON and exit (no SAP call).' },
      { name: '--yes', type: 'boolean', default: false, description: 'Confirm in non-interactive environments.' },
      { name: '--non-interactive', type: 'boolean', default: false, description: 'Alias of --yes.' },
    ],
    globalOptions: ['--json'],
    examples: ['abap create CLAS ZCL_MY_CLASS --package ZPKG --description "desc"'],
  };

  if (!t) return base;
  // Types whose `create` has no skeleton path require `--file`; the registry
  // is the single source of truth (`requiresFile`), so this branch covers the
  // former DDIC / HTTP / TRAN special cases plus TTYP / MSAG / DDLS.
  if (requiresFileFor(t)) {
    const route = sourceFor(t) === 'ICF' ? ('icf' as const) : undefined;
    const isDdic = isDdicSupportedType(t);
    const message = isDdic
      ? `DDIC type ${t} created via the self-built ICF service. Requires --file <abap-file-format JSON> with top-level fields: name, description, fields[].`
      : `Type ${t} requires --file <abap-file-format JSON>. No local skeleton path exists; write the JSON first, then create.`;
    return {
      ...base,
      type: t,
      supported: true,
      ...(route ? { route } : {}),
      message,
      ...(isDdic ? { exampleJson: getDdicJsonExample(t as DdicSupportedType) } : {}),
      options: [
        ...base.options,
        {
          name: '--file',
          type: 'string',
          valuePlaceholder: '<path>',
          required: true,
          description: isDdic
            ? 'abap-file-format DDIC JSON input (top-level fields; see exampleJson)'
            : `abap-file-format ${t} JSON input`,
        },
      ],
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

import { Command } from 'commander';
import { printError, printSchema, jsonFromCommand, type CommandSchema, type OutputMode } from '../output/json.js';
import { runCreate, type CreateOptions, type CreateLocalOptions } from '../flows/edit/create.js';
import { runCreateLocal } from '../flows/edit/create-local.js';
import { normalizeTypeInput } from '../cli/type-alias.js';
import { getDdicJsonExample } from '../formats/ddic/examples.js';
import type { DdicSupportedType } from '../formats/ddic/types.js';
import { listTemplates } from '../formats/templates.js';
import {
  isDdicSupportedType,
  allSupportedTypes,
  createObjtypeFor,
  isSupportedType,
  requiresFileFor,
  sourceFor,
  typesRequiringFile,
} from '../types/registry.js';
import { schemaOption } from './schema-helpers.js';

export function registerCreateCommand(program: Command): void {
  const createCmd = program
    .command('create')
    .description('Create a new ABAP object (CLAS, INTF, PROG, FUGR, DEVC, TABL, STRU, DOMA, DTEL, HTTP)')
    // [type]/[name]（可选）是因为 --schema 模式下不需要 name；真实创建仍需两者。
    .argument('[type]', 'Object type (CLAS, INTF, PROG, FUGR, DEVC, TABL, STRU, DOMA, DTEL, HTTP)')
    .argument('[name]', 'Object name')
    .addHelpText('after', [
      '',
      'Supported types:',
      '  CLAS  Class              (ADT route)',
      '  INTF  Interface          (ADT route)',
      '  PROG  Program            (ADT route)',
      '  FUGR  Function group     (ADT route)',
      '        + --func <name>    Create a function module inside an existing group (FUGR/FF)',
      '  DEVC  Package            (ADT route; --package is the super package)',
      '        + --software-component / --transport-layer / --package-type',
      '  DOMA  Domain             (ICF /ddic/doma — requires --file)',
      '  DTEL  Data element       (ICF /ddic/dtel — requires --file)',
      '  TABL  Database table     (ICF /ddic/tabl — requires --file)',
      '  STRU  Structure          (ICF /ddic/stru — requires --file)',
      '  ENQU  Lock object        (ICF /ddic/enqu — requires --file)',
      '  NROB  Number range obj.  (ICF /ddic/nrob — requires --file; no abap-adt-api endpoint)',
      '  HTTP  SICF service node  (ICF /http/<name> — requires --file)',
      '  TRAN  Transaction code   (ICF /tran/<code> — requires --file)',
      '  TTYP / MSAG / DDLS       (requires --file; ADT, ICF fallback on ECC for TTYP/MSAG)',
      '',
      'Run `abap create <type> --schema` for the machine-readable contract of a specific type.',
      '',
      'Tip: --package $TMP must be quoted as \'$TMP\' in shells that expand $-variables',
      '(zsh/bash will silently expand to empty string otherwise).',
      '',
    ].join('\n'))
    // 不用 requiredOption：父命令的 mandatory 选项会被 commander 在子命令
    // local 的解析中一并校验（walk ancestors），故改为 .option + 手动校验。
    .option('--package <package>', 'Target SAP package (required, quote $TMP as \'$TMP\')')
    .option('--description <desc>', 'Object description (required)')
    .option('--tr <transport>', 'Transport number')
    .option('--no-activate', 'Create without activating')
    .option('--template <template>', 'Skeleton template (minimal, public-method, report, selection-screen, report-alv, report-alv-selection, ...)')
    .option('--no-pull', 'Skip the create-then-pull local copy (default: pull after create)')
    .option('--overwrite', 'When pulling the new object back, replace an existing local file (default: keep the local draft)')
    .option('--check-only', 'Validate without creating')
    .option('--audit', 'Include the before-checksum (extra SAP round-trip, off by default)')
    .option('--file <path>', `abap-file-format JSON input (required for ${typesRequiringFile().join('/')})`)
    .option('--func <name>', 'With FUGR: create a function module (FUGR/FF) inside the existing function group <name>')
    .option('--software-component <swcomp>', 'With DEVC: software component of the new package (default: inherited from the super package)')
    .option('--transport-layer <layer>', 'With DEVC: transport layer of the new package (default: inherited from the super package)')
    .option('--package-type <type>', 'With DEVC: package type — development (default), main, or structure')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .option('--yes', 'Confirm in non-interactive mode')
    .action(async (type, name, opts, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        // --schema branch — emit machine-readable parameter schema (no SAP call).
        // `abap create --schema` returns the general contract; `abap create --schema <type>`
        // adds the type dimension (templates / supported flag).
        if (cmd.optsWithGlobals().schema) {
          printSchema(createSchema(type), mode);
          return;
        }
        // --schema path is untyped (type may be undefined); only normalize when present.
        const normalized = type ? normalizeTypeInput(type) : { type: type as string };
        await runCreate(normalized.type, name, opts, mode);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });

  registerCreateLocalCommand(createCmd);
}

function registerCreateLocalCommand(createCmd: Command): void {
  // 实验性：本地生成草稿骨架，不连接 SAP。
  createCmd
    .command('local')
    .description('Experimental: create a local draft skeleton file (no SAP connection)')
    .addHelpText('after', [
      '',
      'This command is experimental and creates a local draft only — nothing is sent to SAP.',
      'It supports the source-object types (CLAS, INTF, PROG, FUGR) only; DDIC /',
      'HTTP / TRAN / CDS / RAP types have no local skeleton and require',
      '`abap create <type> <name> --file <path>` with an abap-file-format JSON instead.',
      'To land a draft in SAP, run:',
      '  abap create <type> <name> --package <pkg> --description <desc> --no-pull',
      '  abap push src/<obj>.<type>.abap --tr <transport>',
      '',
    ].join('\n'))
    .argument('<type>', 'Object type (CLAS, INTF, PROG, FUGR)')
    .argument('<name>', 'Object name')
    .option('--template <template>', 'Skeleton template (minimal, public-method, report, selection-screen, report-alv, report-alv-selection, ...)')
    .option('--dir <path>', 'Output directory', 'src/')
    .action(async (type, name, opts, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        // 父子同名选项 --template：commander 把值路由到父命令 create 上（子命令自身为 undefined）。
        await runCreateLocal(type, name, { ...opts, template: cmd.parent?.opts().template }, mode);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}

/** `create --schema` 的返回类型：在通用 schema 上补充类型维度。 */
export type CreateCommandSchema = CommandSchema & {
  type?: string;
  supported?: boolean;
  /** SAP channel: 'icf' for DDIC types, 'adt' for ADT-handler types (DEVC). */
  route?: 'icf' | 'adt';
  reason?: 'DDIC_NOT_SUPPORTED' | 'TYPE_NOT_SUPPORTED';
  message?: string;
  templates?: { name: string; description: string }[];
  /** BUG-1: minimal abap-file-format JSON example for the requested type. */
  exampleJson?: string;
};

/**
 * Machine-readable parameter contract for `abap create --schema [type]`.
 * 无 type → 通用 schema（列出支持的类型）；DDIC/未知类型 → supported:false。
 *
 * all 10 supported types come from `types/registry.ts`.
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
      { name: '--overwrite', type: 'boolean', description: 'When pulling the new object back, replace an existing local file (default: keep the local draft)' },
      { name: '--file', type: 'string', valuePlaceholder: '<path>', description: `abap-file-format JSON input (required for ${typesRequiringFile().join('/')})` },
      { name: '--func', type: 'string', valuePlaceholder: '<name>', description: 'With FUGR: create a function module (FUGR/FF) inside the existing function group <name>' },
      { name: '--software-component', type: 'string', valuePlaceholder: '<swcomp>', description: 'With DEVC: software component of the new package (default: inherited from the super package)' },
      { name: '--transport-layer', type: 'string', valuePlaceholder: '<layer>', description: 'With DEVC: transport layer of the new package (default: inherited from the super package)' },
      { name: '--package-type', type: 'string', valuePlaceholder: '<type>', description: 'With DEVC: package type', allowedValues: ['development', 'main', 'structure'] },
      schemaOption(),
      { name: '--yes', type: 'boolean', default: false, description: 'Confirm in non-interactive environments.' },
      { name: '--non-interactive', type: 'boolean', default: false, description: 'Alias of --yes.' },
    ],
    globalOptions: ['--json'],
    examples: ['abap create CLAS ZCL_MY_CLASS --package ZPKG --description "desc"'],
  };

  if (!t) return base;
  // Package (DEVC) is flag-driven: the ADT package resource has no source
  // include and no skeleton, and `--package` names the super package.
  if (t === 'DEVC') {
    return {
      ...base,
      type: t,
      supported: true,
      route: 'adt',
      message:
        'DEVC packages are created as an ADT `DEVC/K` object. `--package` is the super package; ' +
        'software component and transport layer default to the super package\'s values. ' +
        'LOCAL packages must be named `$...` or `TEST...`.',
      options: base.options.map((o) =>
        o.name === '--package'
          ? { ...o, description: 'Super package of the new package (required)' }
          : o,
      ),
      examples: [
        "abap create DEVC $MY_PACKAGE --package '$TMP' --description \"Scratch package\"",
        'abap create DEVC ZPKG_SUB --package ZPKG_MAIN --description "Sub package" --software-component HOME --tr NDK900123',
      ],
    };
  }
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

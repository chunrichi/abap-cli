import { Command } from 'commander';
import { printError, printSchema, jsonFromCommand, type CommandSchema, type OutputMode } from '../output/json.js';
import { runCreate, type CreateOptions, type CreateLocalOptions } from '../flows/edit/create.js';
import { runCreateLocal } from '../flows/edit/create-local.js';
import { normalizeTypeInput } from '../cli/type-alias.js';
import { getDdicJsonExample } from '../formats/ddic/examples.js';
import { getViewJsonExample } from '../formats/view/json.js';
import { getShlpJsonExample } from '../formats/shlp/json.js';
import { getJobdJsonExample } from '../formats/jobd/json.js';
import { getSm59JsonExample } from '../formats/sm59/json.js';
import { getSrfcJsonExample } from '../formats/srfc/json.js';
import { getOa2pJsonExample } from '../formats/oa2p/json.js';
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
    .description('Create a new ABAP object (CLAS, INTF, PROG, FUGR, DEVC, DDIC, HTTP, TRAN, VIEW, SHLP, XSLT, CDS)')
    // [type]/[name]（可选）是因为 --schema 模式下不需要 name；真实创建仍需两者。
    .argument('[type]', 'Object type (CLAS, INTF, PROG, FUGR, DEVC, TABL, STRU, DOMA, DTEL, ENQU, VIEW, SHLP, NROB, HTTP, TRAN, XSLT)')
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
      '  VIEW  Database view      (ICF /ddic/view — requires --file; view-v1)',
      '  SHLP  Search help        (ICF /ddic/shlp — requires --file; shlp-v1, elementary/collective)',
      '  ENQU  Lock object        (ICF /ddic/enqu — requires --file)',
      '  NROB  Number range obj.  (ICF /ddic/nrob — requires --file; no abap-adt-api endpoint)',
      '  HTTP  SICF service node  (ICF /http/<name> — requires --file)',
      '  TRAN  Transaction code   (ICF /tran/<code> — requires --file)',
      '  XSLT  Transformation     (ICF /xslt/<name> — requires --file <name>.xslt.json + .xslt.xml)',
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
    .option('--publish', 'With SRVB: publish the service binding after activation')
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
      'HTTP / TRAN / XSLT / CDS / RAP types have no local skeleton and require',
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
      { name: '--publish', type: 'boolean', description: 'With SRVB: publish the service binding after activation' },
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
    // SM59 destinations live outside the package/transport model: the type
    // dimension of the schema states which flags are not applicable instead of
    // silently accepting them.
    const isSm59 = t === 'SM59';
    // SRFC/OA2P are TADIR objects (package + transport apply), so only their
    // wire shape and the no-activation note differ from the DDIC types.
    const isUcon = t === 'SRFC' || t === 'OA2P';
    const message = t === 'VIEW'
      ? 'VIEW (DDIC database view) is created through the self-built ICF service (/ddic/view). Requires --file with a local-extension view-v1 JSON: header.description, viewClass, rootTable, tables[] and fields[]; joinConditions[] for a multi-table view.'
      : t === 'SHLP'
        ? 'SHLP (DDIC search help) is created through the self-built ICF service (/ddic/shlp). Requires --file with a local-extension shlp-v1 JSON: kind (elementary/collective), header.description and parameters[]; an elementary search help also needs selectionMethod, a collective one needs includedSearchHelps[] and parameterMappings[].'
        : t === 'JOBD'
          ? 'JOBD (application job definition, SM36) is created through the self-built ICF service (/jobd/<name>). Requires --file with a local-extension jobd-v1 JSON. Writes save and activate in one step; --no-activate is not supported.'
          : isSm59
          ? 'SM59 (HTTP destination, RFCTYPE=G) is created through the self-built ICF service (/sm59/<name>). Requires --file with a local-extension sm59-v1 JSON: targetHost, protocol (HTTP/HTTPS), optional port, pathPrefix and description. Destinations are client-independent system-table entries: --package and --tr are not applicable (no TADIR object, no transport), and there is no activation step. Names are RFCDEST (max 32 chars); SAP rejects its reserved/internal name patterns — maintain those directly in SM59.'
          : t === 'SRFC'
            ? 'SRFC (UCON RFC service) is created through the self-built ICF service (/srfc/<name>). Requires --file with a local-extension srfc-v1 JSON: functionName (RFC-enabled function module), optional description/scope/defaultProfile. There is no separate activation step: the write stores the active version and refreshes the UCON runtime cache. Names are UCONRFCSERVID (max 30 chars); every scope is client-independent and lifecycle/cache maintenance stays in UCONCOCKPIT.'
            : t === 'OA2P'
              ? 'OA2P (OAuth 2.0 client profile) is created through the self-built ICF service (/oa2p/<name>). Requires --file with a local-extension oa2p-v1 JSON: type (OAuth 2.0 service provider type from OA2C_TYPES), optional noAuthCheck/scopes. There is no description field and no activation step. Names are OA2C_PROFILE (max 30 chars); profile assignments to OAuth 2.0 clients stay in OA2C_CONFIG.'
          : isDdic
            ? `DDIC type ${t} created via the self-built ICF service. Requires --file <abap-file-format JSON> with top-level fields: name, description, fields[].`
            : t === 'XSLT'
              ? `Type XSLT requires --file <name>.xslt.json (AFF xslt-v1 metadata); the sibling <name>.xslt.xml source must exist in the same directory. Created via the self-built ICF service at /xslt/<name>.`
              : `Type ${t} requires --file <abap-file-format JSON>. No local skeleton path exists; write the JSON first, then create.`;
    const exampleJson = t === 'VIEW'
      ? getViewJsonExample()
      : t === 'SHLP'
        ? getShlpJsonExample()
        : t === 'JOBD'
          ? getJobdJsonExample()
          : isSm59
          ? getSm59JsonExample()
          : t === 'SRFC'
            ? getSrfcJsonExample()
            : t === 'OA2P'
              ? getOa2pJsonExample()
          : isDdic
            ? getDdicJsonExample(t as DdicSupportedType)
            : undefined;
    const typeOptions = isSm59
      ? base.options.map((o) => {
          if (o.name === '--package') {
            return { ...o, required: false, description: 'Not applicable for SM59: destinations are client-independent system-table entries with no package' };
          }
          if (o.name === '--tr') {
            return { ...o, description: 'Not applicable for SM59: destinations cannot be transported' };
          }
          if (o.name === '--description') {
            return { ...o, required: false, description: 'Optional override of the document description' };
          }
          if (o.name === '--no-activate') {
            return { ...o, description: 'Not applicable for SM59: destinations have no activation step' };
          }
          return o;
        })
      : isUcon
        ? base.options.map((o) => {
            if (o.name === '--description') {
              return t === 'OA2P'
                ? { ...o, required: false, description: 'Not applicable for OA2P: profiles have no description field' }
                : { ...o, required: false, description: 'Optional override of the document description (SRFC short text)' };
            }
            if (o.name === '--no-activate') {
              return { ...o, description: `Not applicable for ${t}: the write stores the active version directly` };
            }
            return o;
          })
        : base.options;
    return {
      ...base,
      type: t,
      supported: true,
      ...(route ? { route } : {}),
      message,
      ...(exampleJson !== undefined ? { exampleJson } : {}),
      options: [
        ...typeOptions,
        {
          name: '--file',
          type: 'string',
          valuePlaceholder: '<path>',
          required: true,
          description: isDdic
            ? 'abap-file-format DDIC JSON input (top-level fields; see exampleJson)'
            : t === 'JOBD'
              ? 'local-extension jobd-v1 JSON input (see exampleJson)'
            : isSm59
              ? 'local-extension sm59-v1 JSON input (see exampleJson)'
              : t === 'SRFC'
                ? 'local-extension srfc-v1 JSON input (see exampleJson)'
                : t === 'OA2P'
                  ? 'local-extension oa2p-v1 JSON input (see exampleJson)'
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

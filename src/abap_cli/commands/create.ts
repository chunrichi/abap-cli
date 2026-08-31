import { Command } from 'commander';
import { printError, printSchema, jsonFromCommand, type OutputMode } from '../output/json.js';
import { runCreate, runCreateLocal, type CreateOptions, type CreateLocalOptions } from '../flows/create-flow.js';
import { createSchema } from '../flows/create-schema.js';

export function registerCreateCommand(program: Command): void {
  const createCmd = program
    .command('create')
    .description('Create and activate a new ABAP object (CLAS, INTF, PROG, FUGR, TABL, STRU, DOMA, DTEL, HTTP)')
    // [type]/[name]（可选）是因为 --schema 模式下不需要 name；真实创建仍需两者。
    .argument('[type]', 'Object type (CLAS, INTF, PROG, FUGR, TABL, STRU, DOMA, DTEL, HTTP)')
    .argument('[name]', 'Object name')
    .addHelpText('after', [
      '',
      'Supported types:',
      '  CLAS  Class              (ADT route)',
      '  INTF  Interface          (ADT route)',
      '  PROG  Program            (ADT route)',
      '  FUGR  Function group     (ADT route)',
      '  DOMA  Domain             (ICF /ddic/doma — requires --file)',
      '  DTEL  Data element       (ICF /ddic/dtel — requires --file)',
      '  TABL  Database table     (ICF /ddic/tabl — requires --file)',
      '  STRU  Structure          (ICF /ddic/stru — requires --file)',
      '  HTTP  SICF service node  (ICF /http/<name> — requires --file)',
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
    .option('--template <template>', 'Skeleton template (minimal, public-method, report, selection-screen, ...)')
    .option('--no-pull', 'Skip the create-then-pull local copy (default: pull after create)')
    .option('--check-only', 'Validate without creating')
    .option('--audit', 'Include the before-checksum (extra SAP round-trip, off by default)')
    .option('--file <path>', 'abap-file-format JSON input (required for DOMA/DTEL/TABL/STRU/HTTP)')
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
        await runCreate(type, name, opts, mode);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });

  registerCreateLocalCommand(createCmd);
}

function registerCreateLocalCommand(createCmd: Command): void {
  // 实验性：本地生成草稿骨架，不连接 SAP（FR-021-local）。
  createCmd
    .command('local')
    .description('Experimental: create a local draft skeleton file (no SAP connection)')
    .addHelpText('after', [
      '',
      'This command is experimental and creates a local draft only — nothing is sent to SAP.',
      'To land the draft in SAP, run:',
      '  abap create <type> <name> --package <pkg> --description <desc> --no-pull',
      '  abap push src/<obj>/<obj>.<type>.abap --tr <transport>',
      '',
    ].join('\n'))
    .argument('<type>', 'Object type (CLAS, INTF, PROG, FUGR)')
    .argument('<name>', 'Object name')
    .option('--template <template>', 'Skeleton template (minimal, public-method, report, selection-screen, ...)')
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

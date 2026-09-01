/**
 * Lazy command registration.
 *
 * index.ts declares every command by name + description only; the heavy module
 * import is deferred until that command is actually dispatched or its help is
 * requested. Each spec contributes a lightweight stub command so `abap --help`
 * stays fast and dependency-light.
 *
 * The module's `register(program)` keeps the existing
 * `register<Name>Command(program: Command): void` shape (it creates the real
 * command as a child of `program`), so on first dispatch the stub is removed
 * and replaced by the fully-registered command.
 */

import type { Command } from 'commander';

export type CommandScope = 'local' | 'sap';

export interface LazyCommandSpec {
  /** Command name as typed on the CLI, e.g. 'pull' (no positional args). */
  name: string;
  /** One-line description shown in root help (must match the module). */
  description: string;
  /**
   * Whether the command talks to SAP. Used by root --help to group commands
   * under "Local Commands" / "SAP Commands" sections (P2.9). Defaults to 'sap'
   * so existing specs stay grouped with the SAP section unless explicitly
   * overridden.
   */
  scope?: CommandScope;
  /** Dynamic import returning the module with a register(program) function. */
  load: () => Promise<{ register: (program: Command) => void }>;
}

interface CommanderInternals {
  _parseCommand(operands: string[], unknown: string[]): unknown;
  _dispatchHelpCommand(subcommandName?: string): unknown;
}

// Real command per stub, so a command is imported/registered exactly once.
const realByStub = new WeakMap<Command, Command & CommanderInternals>();

/**
 * Register the given commands declaratively and lazily. Root help and unknown-
 * command handling only ever see the stubs; the module is imported on demand.
 */
export function registerLazyCommands(program: Command, specs: LazyCommandSpec[]): void {
  const stubs = new Map<Command, LazyCommandSpec>();
  for (const spec of specs) {
    const stub = program.command(spec.name).description(spec.description) as Command &
      CommanderInternals;
    stubs.set(stub, spec);
    stub._parseCommand = async (operands, unknown) => {
      const real = await loadAndSwap(program, stub, spec);
      return real._parseCommand(operands, unknown);
    };
  }

  // `abap help <cmd>` shows a stub before it is dispatched: load it first.
  const programInternals = program as Command & CommanderInternals;
  const dispatchHelp = programInternals._dispatchHelpCommand.bind(program);
  programInternals._dispatchHelpCommand = (subcommandName?: string) => {
    const stub = subcommandName
      ? program.commands.find((c) => c.name() === subcommandName)
      : undefined;
    if (stub && stubs.has(stub)) {
      return (async () => {
        await loadAndSwap(program, stub, stubs.get(stub)!);
        return dispatchHelp(subcommandName);
      })();
    }
    return dispatchHelp(subcommandName);
  };

  // Root help (P2.9): append a "Local commands" section so the agent can see
  // at a glance which commands don't need a SAP connection. The default
  // Commands: list above still shows every command; this section is a guide,
  // not a replacement.
  const localNames = specs.filter((s) => s.scope === 'local').map((s) => s.name);
  if (localNames.length > 0) {
    const localList = localNames.map((n) => `  ${n}`).join('\n');
    program.addHelpText('after', [
      '',
      'Local commands (no SAP connection required):',
      '',
      localList,
      '',
      'These commands do not call SAP. All other commands listed above do.',
      '',
    ].join('\n'));
  }
}

async function loadAndSwap(
  program: Command,
  stub: Command,
  spec: LazyCommandSpec,
): Promise<Command & CommanderInternals> {
  const cached = realByStub.get(stub);
  if (cached) return cached;
  // Drop the stub first: register() re-creates the command by name and
  // commander rejects a duplicate command name.
  (program as Command & { commands: Command[] }).commands = program.commands.filter(
    (c) => c !== stub,
  );
  const mod = await spec.load();
  mod.register(program);
  const real = program.commands.find((c) => c.name() === spec.name);
  if (!real) throw new Error(`lazy command '${spec.name}' did not register a command`);
  const withInternals = real as Command & CommanderInternals;
  realByStub.set(stub, withInternals);
  return withInternals;
}

/**
 * ExtensionRegistry: process-wide extension state and dispatcher (FR-001 / FR-002 / FR-007).
 *
 * Responsible for:
 * - Loading + validating extension modules from ProjectConfig.extensions[]
 * - Indexing ValidationRules by command name
 * - Indexing LifecycleHooks by event name
 * - Providing metaFragment() for OutputMeta merging
 * - dispatch() / dispatchAll() for lifecycle events
 * - runValidation() for ValidationRule enforcement in flows
 */

import type { Command } from 'commander';
import type {
  Extension,
  CommandExtension,
  ValidationRule,
  LifecycleHook,
  ExtensionManifest,
  ExtensionSource,
  ExtensionContext,
  ValidationContext,
  ValidationResult,
  ValidationFailure,
  LifecycleContext,
  LifecycleErrorContext,
  LifecycleVeto,
  ExtensionLoadResult,
} from './types.js';
import { validateExtension } from './shape.js';
import { loadExtensionModule } from './loader.js';
import { extensionValidationFailed, extensionLoadFailed, extensionCommandBlocked } from './errors.js';
import type { ExtensionMeta } from '../output/meta.js';
import { collectWarning } from '../output/meta.js';

function isValidationRule(ext: Extension): ext is ValidationRule {
  return ext.type === 'validation';
}
function isLifecycleHook(ext: Extension): ext is LifecycleHook {
  return ext.type === 'lifecycle';
}
function isCommandExtension(ext: Extension): ext is CommandExtension {
  return ext.type === 'command';
}

/** Check if an extension applies to a given command (matches '*' or command name in array). */
function appliesTo(ext: { appliesTo: string[] | '*' }, command: string): boolean {
  return ext.appliesTo === '*' || ext.appliesTo.includes(command);
}

/** Process-wide singleton — set once in index.ts. */
let _singleton: ExtensionRegistry | undefined;

export function getExtensionRegistry(): ExtensionRegistry {
  if (!_singleton) {
    // Return a no-op registry so commands work even before extensions load
    _singleton = new ExtensionRegistry();
  }
  return _singleton;
}

export function setExtensionRegistry(r: ExtensionRegistry): void {
  _singleton = r;
}

export class ExtensionRegistry {
  private _loaded: ExtensionLoadResult[] = [];
  private _failed: ExtensionLoadResult[] = [];
  private _rulesByCommand = new Map<string, ValidationRule[]>();
  private _hooks = {
    beforeParse: [] as LifecycleHook[],
    beforeCommand: [] as LifecycleHook[],
    afterCommand: [] as LifecycleHook[],
    onError: [] as LifecycleHook[],
  };
  /** Map of extension name → command spec for conflict detection. */
  private _commandNames = new Set<string>();

  /** Load and register all extensions from the project config. */
  async loadAndRegisterExtensions(
    program: Command,
    extensions: ExtensionManifest[] | undefined,
  ): Promise<ExtensionRegistry> {
    if (!extensions || extensions.length === 0) return this;

    for (const manifest of extensions) {
      const name = manifest.name;

      // Validate manifest structure (type, name, source) — not the loaded module
      if (!manifest.type || typeof manifest.type !== 'string') {
        this._failed.push({ name, type: manifest.type ?? '(missing)', source: manifest.source, status: 'failed', error: 'MISSING_TYPE: Extension manifest missing type field' });
        continue;
      }
      if (!manifest.name || typeof manifest.name !== 'string') {
        this._failed.push({ name, type: manifest.type, source: manifest.source, status: 'failed', error: 'MISSING_NAME: Extension manifest missing name field' });
        continue;
      }
      if (!/^[a-z][a-z0-9-]*$/.test(manifest.name)) {
        this._failed.push({ name, type: manifest.type, source: manifest.source, status: 'failed', error: `INVALID_NAME: Extension name '${manifest.name}' must be lowercase alphanumeric, start with a letter, and use hyphens only` });
        continue;
      }
      if (!manifest.source || typeof manifest.source !== 'object') {
        this._failed.push({ name, type: manifest.type, source: manifest.source, status: 'failed', error: 'MISSING_SOURCE: Extension manifest missing source field' });
        continue;
      }
      const src = manifest.source as Record<string, unknown>;
      const validSource =
        (src.sourceType === 'path' && typeof src.path === 'string') ||
        (src.sourceType === 'npm' && typeof src.packageName === 'string');
      if (!validSource) {
        this._failed.push({ name, type: manifest.type, source: manifest.source, status: 'failed', error: 'INVALID_SOURCE: Extension source must be {sourceType:"path", path:string} or {sourceType:"npm", packageName:string}' });
        continue;
      }

      // Load the module
      let extModule: unknown;
      try {
        const result = await loadExtensionModule(manifest.source);
        extModule = result.default;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this._failed.push({
          name,
          type: manifest.type,
          source: manifest.source,
          status: 'failed',
          error: reason,
        });
        continue;
      }

      // Validate the exported extension shape
      const shapeOk = validateExtension(extModule as Record<string, unknown>);
      if (!shapeOk.ok) {
        this._failed.push({
          name,
          type: manifest.type,
          source: manifest.source,
          status: 'failed',
          error: `${shapeOk.code}: ${shapeOk.message}`,
        });
        continue;
      }
      const ext = shapeOk.value;

      // Override appliesTo from manifest if present
      if (manifest.appliesTo && isValidationRule(ext)) {
        ext.appliesTo = manifest.appliesTo;
      }

      // Register by type
      if (isCommandExtension(ext)) {
        const builtIn = program.commands.some((c) => c.name() === ext.name);
        if (this._commandNames.has(ext.name) || builtIn) {
          this._failed.push({
            name: ext.name,
            type: 'command',
            source: manifest.source,
            status: 'failed',
            error: `Command name '${ext.name}' is already registered`,
          });
          continue;
        }
        this._commandNames.add(ext.name);
        // Register via Commander's lazy command API
        this._registerCommandExtension(program, ext);
        this._loaded.push({ name: ext.name, type: 'command', source: manifest.source, status: 'loaded' });
      } else if (isValidationRule(ext)) {
        const cmds = ext.appliesTo === '*' ? ['*'] : ext.appliesTo;
        for (const cmd of cmds) {
          const existing = this._rulesByCommand.get(cmd) ?? [];
          existing.push(ext);
          this._rulesByCommand.set(cmd, existing);
        }
        this._loaded.push({ name: ext.name, type: 'validation', source: manifest.source, status: 'loaded' });
      } else if (isLifecycleHook(ext)) {
        const bucket = this._hooks[ext.event];
        if (bucket) bucket.push(ext);
        this._loaded.push({ name: ext.name, type: 'lifecycle', source: manifest.source, status: 'loaded' });
      }
    }

    // Strict mode: fail fast if any extension failed to load
    if (this._failed.length > 0 && process.env['ABAP_CLI_EXTENSIONS_STRICT'] === '1') {
      const first = this._failed[0]!;
      throw extensionLoadFailed(first.name, first.error ?? 'unknown error');
    }

    return this;
  }

  /** Register a CommandExtension as a real commander sub-command. */
  private _registerCommandExtension(program: Command, ext: CommandExtension): void {
    const cmd = program.command(ext.command).description(ext.description);
    cmd.action(async (...args: unknown[]) => {
      // Commander appends (options, command) after the declared positionals.
      const positionals = args.slice(0, -2) as string[];
      const opts = (args[args.length - 2] ?? {}) as Record<string, unknown>;
      const ctx: ExtensionContext = { command: ext.name, argv: process.argv.slice(2) };
      await ext.action(ctx, opts, ...positionals);
    });
  }

  /**
   * Run all ValidationRules that apply to `command` with the given context.
   * Throws CliError(EXTENSION_VALIDATION_FAILED) on first rule failure.
   * Silently collects warnings for other errors (lifecycle hooks).
   */
  async runValidation(
    command: string,
    ctx: ValidationContext,
  ): Promise<void> {
    const rules = this._rulesByCommand.get(command) ?? [];
    const starRules = this._rulesByCommand.get('*') ?? [];
    const allRules = [...rules, ...starRules];

    for (const rule of allRules) {
      try {
        const result = await rule.validate(ctx);
        if (!result.ok) {
          const file = ctx.files?.[0] ?? String(ctx.payload ?? '(unknown)');
          throw extensionValidationFailed(rule.name, file, result.violation);
        }
      } catch (err) {
        // Only re-throw extension validation errors; swallow dispatch errors
        if (err instanceof Error && err.name === 'CliError') throw err;
        collectWarning('EXTENSION_DEGRADED', `ValidationRule '${rule.name}' threw: ${String(err)}`, {
          rule: rule.name,
        });
      }
    }
  }

  /** Dispatch a lifecycle event to all registered hooks. Errors are swallowed. */
  async dispatch(event: 'beforeParse', ctx: ExtensionContext): Promise<void>;
  async dispatch(
    event: 'beforeCommand' | 'afterCommand',
    ctx: { command: string; argv: string[]; ts: number },
  ): Promise<void>;
  async dispatch(event: 'onError', ctx: LifecycleErrorContext): Promise<void>;
  async dispatch(event: string, ctx: ExtensionContext | LifecycleErrorContext): Promise<void> {
    const hooks = (this._hooks as Record<string, LifecycleHook[]>)[event] ?? [];
    for (const h of hooks) {
      try {
        await h.hook(ctx as LifecycleContext);
      } catch {
        collectWarning('EXTENSION_DEGRADED', `LifecycleHook '${h.name}' (${event}) threw`, {
          hook: h.name,
          event,
        });
      }
    }
  }

  /**
   * Dispatch to all hooks for an event, returning all settle results.
   * Used by onError for isolation — each hook result is independent.
   */
  async dispatchAll(
    event: string,
    ctx: LifecycleContext | LifecycleErrorContext,
  ): Promise<PromiseSettledResult<void | LifecycleVeto>[]> {
    const hooks = (this._hooks as Record<string, LifecycleHook[]>)[event] ?? [];
    // Wrap in Promise.resolve().then() so synchronous throws are captured
    return Promise.allSettled(
      hooks.map((h) => Promise.resolve().then(() => h.hook(ctx as LifecycleContext))),
    );
  }

  /**
   * Dispatch `beforeCommand`, honouring a hook's veto.
   * Throws CliError(EXTENSION_COMMAND_BLOCKED) on the first {block:true}.
   * Hook exceptions are still swallowed as EXTENSION_DEGRADED warnings.
   */
  async dispatchBeforeCommand(ctx: LifecycleContext): Promise<void> {
    for (const h of this._hooks.beforeCommand) {
      let result: void | LifecycleVeto;
      try {
        result = await h.hook(ctx);
      } catch {
        collectWarning('EXTENSION_DEGRADED', `LifecycleHook '${h.name}' (beforeCommand) threw`, {
          hook: h.name,
          event: 'beforeCommand',
        });
        continue;
      }
      if (result && result.block === true) {
        throw extensionCommandBlocked(h.name, ctx.command, result.reason);
      }
    }
  }

  /**
   * Full snapshot of all extensions for `extensions list` and audit.
   * Omits keys when their count is zero (byType, validationRules).
   */
  snapshot(): ExtensionMeta {
    // Collect unique rules from the index (has appliesTo) not just the load results
    const uniqueRules = new Map<string, ValidationRule>();
    for (const rules of this._rulesByCommand.values()) {
      for (const r of rules) uniqueRules.set(r.name, r);
    }
    const validationRules = Array.from(uniqueRules.values()).map((r) => ({
      name: r.name,
      appliesTo: r.appliesTo,
    }));

    const meta: ExtensionMeta = {
      loaded: this._loaded.length,
      byType: {},
      names: this._loaded.map((r) => r.name),
    };

    if (this._failed.length > 0) meta.failed = this._failed.length;
    const cmdCount = this._loaded.filter((r) => r.type === 'command').length;
    const valCount = this._loaded.filter((r) => r.type === 'validation').length;
    const lifeCount = this._loaded.filter((r) => r.type === 'lifecycle').length;
    if (cmdCount > 0) meta.byType.command = cmdCount;
    if (valCount > 0) meta.byType.validation = valCount;
    if (lifeCount > 0) meta.byType.lifecycle = lifeCount;
    if (validationRules.length > 0) meta.validationRules = validationRules;

    return meta;
  }

  /**
   * Per-command meta fragment for renderResult/renderError merging.
   * Returns undefined when no extensions are loaded (no keys added to envelope).
   */
  metaFragment(currentCommand: string): ExtensionMeta | undefined {
    if (this._loaded.length === 0 && this._failed.length === 0) return undefined;

    const rulesForCmd = this._rulesByCommand.get(currentCommand) ?? [];
    const starRules = this._rulesByCommand.get('*') ?? [];
    const relevantRules = [...rulesForCmd, ...starRules];

    const meta: ExtensionMeta = {
      loaded: this._loaded.length,
      byType: {},
      names: this._loaded.map((r) => r.name),
    };

    if (this._failed.length > 0) meta.failed = this._failed.length;
    const cmdCount = this._loaded.filter((r) => r.type === 'command').length;
    const valCount = this._loaded.filter((r) => r.type === 'validation').length;
    const lifeCount = this._loaded.filter((r) => r.type === 'lifecycle').length;
    if (cmdCount > 0) meta.byType.command = cmdCount;
    if (valCount > 0) meta.byType.validation = valCount;
    if (lifeCount > 0) meta.byType.lifecycle = lifeCount;
    if (relevantRules.length > 0) {
      meta.validationRules = relevantRules.map((r) => ({ name: r.name, appliesTo: r.appliesTo }));
    }

    return meta;
  }

  get loaded(): ExtensionLoadResult[] {
    return this._loaded;
  }
  get failed(): ExtensionLoadResult[] {
    return this._failed;
  }
}

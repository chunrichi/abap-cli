/**
 * Extension type system.
 * All types are frozen — no index signatures, no `any`.
 */

/** Shared context passed to every extension hook. */
export interface ExtensionContext {
  /** Canonical command name, e.g. 'push', 'pull', 'select'. */
  command: string;
  /** Raw argv after commander parsing (process.argv.slice(2)). */
  argv: string[];
}

/** Context for ValidationRule. */
export interface ValidationContext extends ExtensionContext {
  /**
   * For `push` flow: absolute file paths being pushed.
   * For `select` flow: the SelectRequest payload.
   * For `run` flow: {class, method, args}.
   */
  files?: string[];
  payload?: unknown;
}

/** Result of a ValidationRule check. */
export interface ValidationResult {
  ok: true;
}
export type ValidationFailure = {
  ok: false;
  message: string;
  violation?: string;
};
export type ValidationRuleResult = ValidationResult | ValidationFailure;

/**
 * Synchronous or async validation function.
 * Return `{ok: true}` to pass; `{ok: false, message, violation?}` to reject.
 */
export type ValidationFn = (
  ctx: ValidationContext,
) => ValidationRuleResult | Promise<ValidationRuleResult>;

/** A single ValidationRule instance. */
export interface ValidationRule {
  type: 'validation';
  /** Lowercase alphanumeric + hyphens only. */
  name: string;
  /** Which commands this rule applies to, or '*' for all. */
  appliesTo: string[] | '*';
  validate: ValidationFn;
}

/** Context for LifecycleHook. */
export interface LifecycleContext extends ExtensionContext {
  ts: number;
}

/** Context for LifecycleHook `onError` (extends base with error detail). */
export interface LifecycleErrorContext extends LifecycleContext {
  error: {
    code: string;
    message: string;
    category: string;
  };
}

/** Lifecycle hook event name. */
export type LifecycleHookEvent = 'beforeParse' | 'beforeCommand' | 'afterCommand' | 'onError';

/**
 * A `beforeCommand` hook may veto execution by returning this. The command is
 * aborted with EXTENSION_COMMAND_BLOCKED before its action runs.
 */
export interface LifecycleVeto {
  block: true;
  /** Human-readable reason surfaced in the error message. */
  reason: string;
}

/**
 * Sync or async hook function.
 * Errors are always swallowed — use onError for error handling.
 * Only `beforeCommand` honours a returned {block:true} veto.
 */
export type LifecycleFn = (
  ctx: LifecycleContext | LifecycleErrorContext,
) => void | LifecycleVeto | Promise<void | LifecycleVeto>;

/** A single LifecycleHook instance. */
export interface LifecycleHook {
  type: 'lifecycle';
  name: string;
  event: LifecycleHookEvent;
  hook: LifecycleFn;
}

/**
 * A command contributed by an extension.
 * Must export a `command` property and a `action` function.
 */
export interface CommandExtension {
  type: 'command';
  /** Lowercase alphanumeric + hyphens only. */
  name: string;
  /** Short description for --help. */
  description: string;
  /** The command spec passed to commander, e.g. 'myorg-hello [name]'. */
  command: string;
  /** Action body; receives (ctx, opts, ...args). */
  action: (ctx: ExtensionContext, opts: Record<string, unknown>, ...args: string[]) => unknown;
}

/** Union of all extension types. */
export type Extension = CommandExtension | ValidationRule | LifecycleHook;

/** Source of an extension — npm package or local file path. */
export type ExtensionSource =
  | { sourceType: 'npm'; packageName: string; path?: string }
  | { sourceType: 'path'; path: string };

/**
 * Extension manifest entry (written in .abap.json).
 * Appears in ProjectConfig.extensions[].
 */
export interface ExtensionManifest {
  type: 'command' | 'validation' | 'lifecycle';
  name: string;
  source: ExtensionSource;
  /** Optional per-extension config passed as 2nd arg to the factory. */
  options?: Record<string, unknown>;
  /** Soft peer-dep check (logged as warning, not fatal). */
  peerDependencies?: Record<string, string>;
  /** Override appliesTo from the extension's own declaration. */
  appliesTo?: string[] | '*';
}

/** Snapshot of extension loading state for meta.extensions. */
export interface ExtensionLoadResult {
  name: string;
  type: Extension['type'];
  source: ExtensionSource;
  status: 'loaded' | 'failed';
  error?: string;
}

/**
 * Shape validation for untrusted extension payloads.
 * Hand-rolled discriminator — no Zod/Valibot (research decision #3).
 */

import type {
  Extension,
  CommandExtension,
  ValidationRule,
  LifecycleHook,
  ValidationContext,
  LifecycleContext,
} from './types.js';

/** Discriminator tag field. */
const TYPE_FIELD = 'type' as const;

/** Name regex: lowercase alphanumeric + hyphens, must start with letter. */
const NAME_RE = /^[a-z][a-z0-9-]*$/;

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; code: string; message: string };
export type Result<T> = Ok<T> | Err;

function err(code: string, message: string): Err {
  return { ok: false, code, message };
}

/** Validate the common fields shared by all extension types. */
function validateCommon(raw: Record<string, unknown>): Err | null {
  if (!raw[TYPE_FIELD] || typeof raw[TYPE_FIELD] !== 'string') {
    return err('MISSING_TYPE', `Extension missing 'type' field`);
  }
  if (!raw.name || typeof raw.name !== 'string') {
    return err('MISSING_NAME', `Extension missing 'name' field`);
  }
  if (!NAME_RE.test(raw.name)) {
    return err(
      'INVALID_NAME',
      `Extension name '${raw.name}' must be lowercase alphanumeric, start with a letter, and use hyphens only`,
    );
  }
  return null;
}

function validateCommand(raw: Record<string, unknown>): Result<CommandExtension> {
  const type = raw[TYPE_FIELD];
  if (type !== 'command') return err('WRONG_TYPE', `Expected type 'command', got '${type}'`);
  const common = validateCommon(raw);
  if (common) return common;

  if (!raw.command || typeof raw.command !== 'string') {
    return err('MISSING_COMMAND', `Command extension missing 'command' string`);
  }
  if (!raw.action || typeof raw.action !== 'function') {
    return err('MISSING_ACTION', `Command extension '${raw.name}' missing 'action' function`);
  }
  if (raw.description !== undefined && typeof raw.description !== 'string') {
    return err('INVALID_DESCRIPTION', `Command extension '${raw.name}' 'description' must be a string`);
  }
  return {
    ok: true,
    value: {
      type: 'command',
      name: raw.name as string,
      description: (raw.description as string) ?? '',
      command: raw.command as string,
      action: raw.action as CommandExtension['action'],
    },
  };
}

function validateValidation(raw: Record<string, unknown>): Result<ValidationRule> {
  const type = raw[TYPE_FIELD];
  if (type !== 'validation') return err('WRONG_TYPE', `Expected type 'validation', got '${type}'`);
  const common = validateCommon(raw);
  if (common) return common;

  if (!raw.validate || typeof raw.validate !== 'function') {
    return err('MISSING_VALIDATE', `ValidationRule '${raw.name}' missing 'validate' function`);
  }
  if (raw.appliesTo !== undefined) {
    const at = raw.appliesTo;
    const isValid =
      (Array.isArray(at) && at.every((s) => typeof s === 'string')) || at === '*';
    if (!isValid) {
      return err(
        'INVALID_APPLIES_TO',
        `ValidationRule '${raw.name}' 'appliesTo' must be '*' or string[]`,
      );
    }
  }
  return {
    ok: true,
    value: {
      type: 'validation',
      name: raw.name as string,
      appliesTo: (raw.appliesTo as ValidationRule['appliesTo']) ?? '*',
      validate: raw.validate as ValidationRule['validate'],
    },
  };
}

function validateLifecycle(raw: Record<string, unknown>): Result<LifecycleHook> {
  const type = raw[TYPE_FIELD];
  if (type !== 'lifecycle') return err('WRONG_TYPE', `Expected type 'lifecycle', got '${type}'`);
  const common = validateCommon(raw);
  if (common) return common;

  const validEvents = ['beforeParse', 'beforeCommand', 'afterCommand', 'onError'];
  if (!raw.event || !validEvents.includes(raw.event as string)) {
    return err(
      'INVALID_EVENT',
      `LifecycleHook '${raw.name}' 'event' must be one of: ${validEvents.join(', ')}`,
    );
  }
  if (!raw.hook || typeof raw.hook !== 'function') {
    return err('MISSING_HOOK', `LifecycleHook '${raw.name}' missing 'hook' function`);
  }
  return {
    ok: true,
    value: {
      type: 'lifecycle',
      name: raw.name as string,
      event: raw.event as LifecycleHook['event'],
      hook: raw.hook as LifecycleHook['hook'],
    },
  };
}

/**
 * Validate an untrusted raw object as an Extension.
 * Returns Ok<Extension> on success, Err on failure.
 */
export function validateExtension(raw: unknown): Result<Extension> {
  if (!raw || typeof raw !== 'object') {
    return err('NOT_OBJECT', 'Extension must be a plain object');
  }
  const rec = raw as Record<string, unknown>;
  const type = rec[TYPE_FIELD];
  if (type === 'command') return validateCommand(rec);
  if (type === 'validation') return validateValidation(rec);
  if (type === 'lifecycle') return validateLifecycle(rec);
  return err('UNKNOWN_TYPE', `Unknown extension type '${type}'. Expected: command, validation, lifecycle`);
}

/**
 * Shared helpers for command `--schema` literals.
 *
 * Each command module owns its schema object (`commands/<cmd>.ts#SCHEMA`).
 * These helpers only hold the boilerplate every schema shares: the `--schema`
 * option entry and the common envelope fields. They intentionally know nothing
 * about individual commands — there is no central command → schema table.
 */
import type { CommandSchema, CommandSchemaOption } from '../output/json.js';

/** Single source of the `--schema` option literal — every command schema
 *  exposes it so `abap <cmd> --schema` discovers the same surface. */
export function schemaOption(): CommandSchemaOption {
  return {
    name: '--schema',
    type: 'boolean' as const,
    default: false,
    description: 'Print the command parameter schema as JSON and exit (no SAP call).',
  };
}

/** Common envelope for a command schema. Command modules spread this and then
 *  override / extend the command-specific parts. */
export function baseSchema(
  command: string,
  description: string,
  usage: string,
  scope: 'sap' | 'local',
): CommandSchema {
  return {
    schemaVersion: 1,
    command,
    description,
    usage,
    scope,
    arguments: [],
    options: [schemaOption()],
    exclusiveGroups: [],
    globalOptions: ['--json'],
    examples: [],
  };
}

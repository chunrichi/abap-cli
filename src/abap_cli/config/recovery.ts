/**
 * Shared recovery metadata for `CONFIG_ERROR`.
 *
 * Configuration failures are the first error an agent hits in a fresh
 * workspace, so the envelope must carry machine-actionable recovery instead of
 * prose only: which value is missing (`details.missing`), the ordered commands
 * that create/bind the profile (`nextSteps`), one canonical invocation
 * (`example`) and the setup-skill reference that documents the whole flow.
 */

/** Repo-relative reference for the CONFIG_ERROR recovery table. */
export const CONFIG_ERROR_REFERENCE = 'skills/abap-cli-setup/references/errors.md#config_error';

/** Ordered recovery steps shared by the workspace/profile first errors. */
export function profileRecovery(systemName?: string): string[] {
  const add = systemName
    ? `Create the profile: abap profile add ${systemName} --url <url> --username <user>`
    : 'Create the connection profile: abap profile add <name> --url <url> --username <user>';
  const bind = systemName
    ? `Bind this workspace: abap init --profile ${systemName}`
    : 'Bind this workspace: abap init --profile <name>';
  return [add, bind];
}

/** Canonical example that creates + binds a profile. */
export function profileExample(systemName = 'dev'): string {
  return `abap profile add ${systemName} --url https://sap.example.com --username DEV`;
}

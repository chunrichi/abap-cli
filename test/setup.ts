/**
 * Vitest global setup: never let unit tests touch the host OS keychain.
 * macOS would show an interactive authorization dialog, which blocks the
 * test process and hides real failures. Individual tests that exercise a
 * backend explicitly (e.g. secrets-native.test.ts) override this env var.
 */
process.env.ABAP_CLI_KEYCHAIN_BACKEND ||= 'fixture';
process.env.ABAP_CLI_KEYCHAIN_FIXTURE_PASSWORD ||= 'dummy';

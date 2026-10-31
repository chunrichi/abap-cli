import type { LazyCommandSpec } from './lazy.js';

// 声明式惰性注册：启动时只加载 name + description，模块体在命令真正被调用
// （或请求其 --help）时才 import。这是唯一的命令清单；drift 检查、文档生成器
// 与测试都应从这里派生，不要另维护副本。
export const COMMAND_SPECS: LazyCommandSpec[] = [
  {
    name: 'init',
    scope: 'local',
    description: 'Initialize the workspace (bind a profile, write .abap.json) and/or scaffold AI agent context',
    load: () => import('../commands/init.js').then((m) => ({ register: m.registerInitCommand })),
  },
  {
    name: 'pull',
    description: 'Download ABAP objects from SAP to local files',
    load: () => import('../commands/pull.js').then((m) => ({ register: m.registerPullCommand })),
  },
  {
    name: 'run',
    scope: 'sap',
    description: 'Execute ABAP class (classrun) or PUBLIC STATIC method; returns stdout + exit code',
    load: () => import('../commands/run.js').then((m) => ({ register: m.registerRunCommand })),
  },
  {
    name: 'select',
    scope: 'sap',
    description: 'Query table data read-only (SE16N equivalent) via the bundled ICF /data endpoint',
    load: () => import('../commands/select.js').then((m) => ({ register: m.registerSelectCommand })),
  },
  {
    name: 'fields',
    scope: 'sap',
    description: 'List the fields of a table or view (read-only, DD03L-backed)',
    load: () => import('../commands/fields.js').then((m) => ({ register: m.registerFieldsCommand })),
  },
  {
    name: 'run-report',
    scope: 'sap',
    description: 'Execute an activated REPORT and return its list output (read-only)',
    load: () => import('../commands/run-report.js').then((m) => ({ register: m.registerRunReportCommand })),
  },
  {
    name: 'list',
    scope: 'sap',
    description: 'List ABAP objects in a package (read-only)',
    load: () => import('../commands/list.js').then((m) => ({ register: m.registerListCommand })),
  },
  {
    name: 'delete',
    scope: 'sap',
    description: 'Delete an ABAP object from SAP (lock → delete → unlock)',
    load: () => import('../commands/delete.js').then((m) => ({ register: m.registerDeleteCommand })),
  },
  {
    name: 'push',
    description: 'Push local ABAP files to SAP',
    load: () => import('../commands/push.js').then((m) => ({ register: m.registerPushCommand })),
  },
  {
    name: 'check',
    description: 'Validate ABAP source code (syntax / content / atc)',
    load: () => import('../commands/check.js').then((m) => ({ register: m.registerCheckCommand })),
  },
  {
    name: 'test',
    scope: 'sap',
    description: 'Run ABAP Unit tests for an object (read-only)',
    load: () => import('../commands/test.js').then((m) => ({ register: m.registerTestCommand })),
  },
  {
    name: 'search',
    description: 'Search for ABAP objects in SAP system',
    load: () => import('../commands/search.js').then((m) => ({ register: m.registerSearchCommand })),
  },
  {
    name: 'create',
    description: 'Create a new ABAP object (CLAS, INTF, PROG, FUGR, DEVC, TABL, STRU, DOMA, DTEL, HTTP)',
    load: () => import('../commands/create.js').then((m) => ({ register: m.registerCreateCommand })),
  },
  {
    name: 'status',
    description: 'Show local vs SAP sync status',
    load: () => import('../commands/status.js').then((m) => ({ register: m.registerStatusCommand })),
  },
  {
    name: 'transport',
    description: 'Manage transport requests',
    load: () => import('../commands/transport.js').then((m) => ({ register: m.registerTransportCommand })),
  },
  {
    name: 'deploy',
    description: 'Deploy bundled ICF ABAP service to SAP',
    load: () => import('../commands/deploy.js').then((m) => ({ register: m.registerDeployCommand })),
  },
  {
    name: 'profile',
    scope: 'local',
    description: 'Manage global connection profiles',
    load: () => import('../commands/profile.js').then((m) => ({ register: m.registerProfileCommand })),
  },
  {
    name: 'doctor',
    scope: 'local',
    description: 'Diagnose CLI environment and configuration (read-only)',
    load: () => import('../commands/doctor.js').then((m) => ({ register: m.registerDoctorCommand })),
  },
  {
    name: 'inspect',
    description: 'View ABAP object metadata',
    load: () => import('../commands/inspect.js').then((m) => ({ register: m.registerInspectCommand })),
  },
  {
    name: 'where-used',
    scope: 'sap',
    description: 'Find SAP object references (read-only)',
    load: () => import('../commands/where-used.js').then((m) => ({ register: m.registerWhereUsedCommand })),
  },
  {
    name: 'tcode',
    scope: 'sap',
    description: 'Resolve transaction code to its ABAP entry program (read-only)',
    load: () => import('../commands/tcode.js').then((m) => ({ register: m.registerTcodeCommand })),
  },
  {
    name: 'activate',
    description: 'Activate inactive ABAP objects',
    load: () => import('../commands/activate.js').then((m) => ({ register: m.registerActivateCommand })),
  },
  {
    name: 'diff',
    description: 'Compare local files against SAP',
    load: () => import('../commands/diff.js').then((m) => ({ register: m.registerDiffCommand })),
  },
  {
    name: 'dumps',
    scope: 'sap',
    description: 'List recent ST22 ABAP runtime dumps (read-only)',
    load: () => import('../commands/dumps.js').then((m) => ({ register: m.registerDumpsCommand })),
  },
  {
    // static CLI ↔ TADIR ↔ DDIC tabclass mapping (pure local).
    name: 'types',
    scope: 'local',
    description: 'Print the CLI type ↔ TADIR / DDIC mapping (no SAP call)',
    load: () => import('../commands/types.js').then((m) => ({ register: m.registerTypesCommand })),
  },
  {
    // report-stuck command
    name: 'report-stuck',
    description: 'Write a stuck-operation report for offline triage',
    load: () => import('../commands/report-stuck.js').then((m) => ({ register: m.registerReportStuckCommand })),
  },
  {
    name: 'mime',
    scope: 'sap',
    description: 'Create, delete, or upload MIME Repository resources (create | delete | push)',
    load: () => import('../commands/mime.js').then((m) => ({ register: m.registerMimeCommand })),
  },
  {
    // Two-segment command name: `abap validate:aff <file-or-dir> ...`.
    // Lazy-loaded like any other command so it doesn't bloat startup.
    name: 'validate:aff',
    description: 'Validate JSON files against official abap-file-format (AFF) canonical schemas (Draft 2020-12)',
    load: () => import('../commands/validate-aff.js').then((m) => ({ register: m.registerValidateAffCommand })),
  },
  {
    // session reuse inspector — read-only, no SAP traffic.
    name: 'session',
    description: 'Inspect / manage session cookie reuse state',
    load: () => import('../commands/session.js').then((m) => ({ register: m.registerSessionCommand })),
  },
];

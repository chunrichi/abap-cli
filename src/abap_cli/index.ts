#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerPullCommand } from './commands/pull.js';
import { registerPushCommand } from './commands/push.js';
import { registerCheckCommand } from './commands/check.js';
import { registerSearchCommand } from './commands/search.js';
import { registerCreateCommand } from './commands/create.js';
import { registerAtcCommand } from './commands/atc.js';
import { registerStatusCommand } from './commands/status.js';
import { registerTransportCommand } from './commands/transport.js';
import { registerDeployCommand } from './commands/deploy.js';
import { registerSystemCommand } from './commands/system.js';

const program = new Command();

// 单一版本来源：从 package.json 读取
const require = createRequire(import.meta.url);
const { version } = require('../../../package.json') as { version: string };

program
  .name('abap-cli')
  .description('CLI tool for ABAP vibe coding — agent-driven ABAP development')
  .version(version)
  .option('--json', 'Output in JSON format');

// Register all commands
registerInitCommand(program);
registerPullCommand(program);
registerPushCommand(program);
registerCheckCommand(program);
registerSearchCommand(program);
registerCreateCommand(program);
registerAtcCommand(program);
registerStatusCommand(program);
registerTransportCommand(program);
registerDeployCommand(program);
registerSystemCommand(program);

program.parse();

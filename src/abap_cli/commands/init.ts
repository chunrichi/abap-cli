import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize workspace configuration for SAP connection')
    .option('--url <url>', 'SAP system URL')
    .option('--client <client>', 'SAP client number', '100')
    .option('--username <user>', 'SAP username')
    .option('--password <password>', 'SAP password')
    .option('--language <language>', 'SAP language', 'EN')
    .option('--transport <transport>', 'Default transport number')
    .option('--package <package>', 'Default SAP package')
    .action(async (opts) => {
      try {
        const cwd = process.cwd();

        // Gather values from options or environment
        const url = opts.url || process.env.SAP_URL || '';
        const client = opts.client || process.env.SAP_CLIENT || '100';
        const username = opts.username || process.env.SAP_USER || '';
        const password = opts.password || process.env.SAP_PASSWORD || '';
        const language = opts.language || process.env.SAP_LANGUAGE || 'EN';
        const transport = opts.transport || process.env.SAP_TRANSPORT || '';
        const pkg = opts.package || process.env.SAP_PACKAGE || '';

        // Generate .abap.json
        const config = {
          sap: { url, client, username, language },
          transport,
          package: pkg,
        };
        const configPath = path.join(cwd, '.abap.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
        console.log(`Created ${configPath}`);

        // Generate .env
        const envContent = [
          `SAP_URL=${url}`,
          `SAP_USER=${username}`,
          `SAP_PASSWORD=${password}`,
          `SAP_CLIENT=${client}`,
          `SAP_LANGUAGE=${language}`,
          '',
        ].join('\n');
        const envPath = path.join(cwd, '.env');
        fs.writeFileSync(envPath, envContent, 'utf-8');
        console.log(`Created ${envPath}`);

        // Create local work directories
        const dirs = ['src', 'ddic'];
        for (const dir of dirs) {
          const dirPath = path.join(cwd, dir);
          if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            console.log(`Created directory ${dirPath}`);
          }
        }

        console.log('Workspace initialized. Edit .abap.json and .env to configure your SAP connection.');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}

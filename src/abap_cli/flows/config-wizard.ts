import { select, text, password, confirm } from '@clack/prompts';
import { getSystem, listSystemNames } from '../config/user-config.js';
import { getPassword, storePassword } from '../config/secrets.js';
import {
  str,
  orCancel,
  transportFromOpts,
  saveProfile,
  handleFileOverwrite,
  writeConfig,
  outputJson,
  validateInputs,
  type CollectedConfig,
  type CommandOpts,
} from './config-write.js';

/** `abap config init` — interactive wizard. */
export async function interactiveInit(opts: CommandOpts, jsonOutput: boolean): Promise<void> {
  const names = listSystemNames();

  let systemName = '';
  if (names.length > 0) {
    systemName = await selectSystem(names);
  }

  let config: CollectedConfig;
  if (systemName) {
    // Existing system selected
    const profile = getSystem(systemName)!;
    config = {
      ...profile,
      password: '',
      transport: '',
      pkg: '',
    };
    const useStored = orCancel(await confirm({ message: 'Use stored password?', initialValue: true }));
    if (useStored) {
      config.password = (await getPassword(systemName)) || '';
      if (!config.password) {
        if (!jsonOutput) console.log(`No stored password for '${systemName}'.`);
        config.password = orCancel(await password({ message: `Password for ${systemName}` }));
        // The user asked for a stored password — persist it so later runs find it.
        await storePassword(systemName, config.password);
      }
    } else {
      config.password = orCancel(await password({ message: `Password for ${systemName}` }));
    }
    if (!jsonOutput) console.log(`Using system profile '${systemName}' (${profile.url}).`);
  } else {
    // Create new system profile
    systemName = orCancel(
      await text({
        message: 'System name',
        placeholder: 'e.g. dev',
        validate: (value) => ((value ?? '').trim() ? undefined : 'System name is required'),
      }),
    );
    config = await collectNewSystem(opts);
    await saveProfile(systemName, {
      url: config.url,
      client: config.client,
      username: config.username,
      language: config.language,
      insecure: config.insecure,
      ca: config.ca,
    }, config.password, jsonOutput);
  }

  // Workspace-level fields
  config.transport = transportFromOpts(opts) || (orCancel(await text({ message: 'Transport request (optional)' }))) || '';
  config.pkg = str(opts.package) || (orCancel(await text({ message: 'Default package (optional)' }))) || '';

  validateInputs(config);
  await handleFileOverwrite(opts.yes === true || opts.nonInteractive === true ? 'overwrite' : 'prompt');
  await writeConfig(systemName, config, jsonOutput);
  if (jsonOutput) outputJson(systemName, config);
}

/** Select an existing system profile, or signal creating a new one (returns '') */
async function selectSystem(names: string[]): Promise<string> {
  const choice = orCancel(
    await select({
      message: 'Select a system profile',
      options: [
        ...names.map((name) => {
          const p = getSystem(name)!;
          return { value: name, label: name, hint: `${p.username}@${p.url}` };
        }),
        { value: '__new__', label: 'Create a new system profile' },
      ],
    }),
  );
  return choice === '__new__' ? '' : choice;
}

/** Prompt for a brand-new system profile */
async function collectNewSystem(opts: CommandOpts): Promise<CollectedConfig> {
  return {
    url: str(opts.url) || orCancel(await text({
      message: 'SAP URL',
      placeholder: 'https://sap.example.com',
      validate: (value) => ((value ?? '').trim() ? undefined : 'URL is required'),
    })),
    client: str(opts.client) || orCancel(await text({ message: 'Client', initialValue: '100' })),
    username: str(opts.username) || orCancel(await text({
      message: 'Username',
      validate: (value) => ((value ?? '').trim() ? undefined : 'Username is required'),
    })),
    password: str(opts.password) || orCancel(await password({ message: 'Password' })),
    language: str(opts.language) || orCancel(await text({ message: 'Language', initialValue: 'EN' })),
    insecure: opts.insecure === true ? true : undefined,
    ca: str(opts.ca) || undefined,
    transport: '',
    pkg: '',
  };
}

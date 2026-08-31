/** Named skeleton registry for `abap create --template`. */
export interface CreateTemplate {
  name: string;
  description: string;
  skeleton: (name: string) => string;
}

const TEMPLATES: Record<string, CreateTemplate[]> = {
  CLAS: [
    {
      name: 'minimal',
      description: 'Empty public class',
      skeleton: (n) => `CLASS ${n} DEFINITION PUBLIC.\n  PUBLIC SECTION.\nENDCLASS.\nCLASS ${n} IMPLEMENTATION.\nENDCLASS.\n`,
    },
    {
      name: 'public-method',
      description: 'Class with a public method',
      skeleton: (n) =>
        `CLASS ${n} DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    METHODS hello.\nENDCLASS.\n` +
        `CLASS ${n} IMPLEMENTATION.\n  METHOD hello.\n  ENDMETHOD.\nENDCLASS.\n`,
    },
  ],
  INTF: [
    {
      name: 'minimal',
      description: 'Empty public interface',
      skeleton: (n) => `INTERFACE ${n} PUBLIC.\nENDINTERFACE.\n`,
    },
  ],
  PROG: [
    {
      name: 'report',
      description: 'Simple report',
      skeleton: (n) => `REPORT ${n}.\nWRITE: / 'Hello'.\n`,
    },
    {
      name: 'selection-screen',
      description: 'Report with a selection screen',
      skeleton: (n) => `REPORT ${n}.\nPARAMETERS: p_name TYPE string.\nSTART-OF-SELECTION.\n  WRITE: / p_name.\n`,
    },
  ],
  FUGR: [
    {
      name: 'minimal',
      description: 'Empty function pool',
      skeleton: (n) => `FUNCTION-POOL ${n}.\n`,
    },
  ],
};

/** Default skeleton (no --template) — matches the pre-existing per-type skeleton. */
export function defaultSkeleton(type: string, name: string): string {
  const list = TEMPLATES[type.toUpperCase()] ?? [];
  const minimal = list.find((t) => t.name === 'minimal');
  if (minimal) return minimal.skeleton(name);
  // Fallbacks for types without a registry entry.
  if (type.toUpperCase() === 'INTF') return `INTERFACE ${name} PUBLIC.\nENDINTERFACE.\n`;
  return `REPORT ${name}.\n`;
}

export function getTemplate(type: string, name: string): CreateTemplate | undefined {
  const list = TEMPLATES[type.toUpperCase()] ?? [];
  return list.find((t) => t.name === name);
}

export function listTemplates(type: string): CreateTemplate[] {
  return TEMPLATES[type.toUpperCase()] ?? [];
}

import { IcfClient } from '../../clients/icf-client.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { CliError } from '../../output/json.js';

const TCODE_MAX_LENGTH = 20;

export interface TcodeEntry {
  program: string;
  screen: string;
}

export interface TcodeTarget {
  kind: string;
  name: string;
  resolved: boolean;
}

export interface TcodeResolutionStep {
  tcode: string;
  kind: string;
  name: string;
  screen: string;
  relation: string;
}

export interface TcodeResult {
  tcode: string;
  description: string;
  entry: TcodeEntry;
  target: TcodeTarget;
  resolutionState: string;
  resolutionChain: TcodeResolutionStep[];
}

interface TcodeWireData {
  tcode?: string;
  description?: string;
  entry?: Partial<TcodeEntry>;
  target?: Partial<TcodeTarget>;
  resolutionState?: string;
  resolutionChain?: Partial<TcodeResolutionStep>[];
}

interface TcodeWireError {
  code?: string;
  message?: string;
  details?: unknown;
}

/**
 * Validate a transaction code before it becomes a URL path component. SAP's
 * TCODE domain is CHAR20; namespaced codes may contain '/', so only blanks
 * and overlong values are rejected locally.
 */
export function validateTcode(raw: string | undefined): string {
  const tcode = (raw ?? '').trim();
  if (!tcode) {
    throw new CliError('INVALID_ARGUMENT', 'tcode is required', {
      nextSteps: ['Specify a transaction code, e.g. abap tcode SE38'],
    });
  }
  if (/\s/.test(tcode)) {
    throw new CliError('INVALID_ARGUMENT', 'tcode must not contain whitespace', {
      nextSteps: ['Pass only the transaction code, without /n or other SAP GUI command prefixes'],
    });
  }
  if (tcode.length > TCODE_MAX_LENGTH) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `tcode must be ${TCODE_MAX_LENGTH} characters or fewer (got ${tcode.length})`,
      { nextSteps: ['Use the transaction code from SE93 or SAP Easy Access'] },
    );
  }
  return tcode.toUpperCase();
}

/** Invoke the read-only ICF endpoint and shape its stable CLI result. */
export async function runTcode(tcode: string, client?: IcfClient): Promise<TcodeResult> {
  const normalized = validateTcode(tcode);
  const icf = client ?? (await IcfClient.create());
  const wire = await icf.getTcode<TcodeWireData>(normalized);
  return interpretTcode(normalized, wire);
}

/** Pure response interpreter, exported for focused unit tests. */
export function interpretTcode(
  requestedTcode: string,
  wire: {
    status: 'success' | 'error';
    data?: TcodeWireData | null;
    error?: TcodeWireError | null;
  },
): TcodeResult {
  if (wire.status === 'error' || !wire.data) {
    const error = wire.error ?? {};
    const code = mapTcodeError(error.code);
    throw new CliError(code, error.message || `ICF ${code} response`, {
      details: {
        tcode: requestedTcode,
        ...(error.details && typeof error.details === 'object' && !Array.isArray(error.details)
          ? error.details as Record<string, unknown>
          : {}),
      },
      nextSteps: nextStepsFor(code, requestedTcode),
    });
  }

  const data = wire.data;
  const program = data.entry?.program?.trim() ?? '';
  if (!program) {
    throw new CliError('SAP_ERROR', 'ICF response is missing entry.program', {
      details: { tcode: requestedTcode },
      nextSteps: ['Deploy the current ICF service: abap extension deploy'],
    });
  }

  return {
    tcode: typeof data.tcode === 'string' && data.tcode ? data.tcode : requestedTcode,
    description: typeof data.description === 'string' ? data.description : '',
    entry: {
      program,
      screen: typeof data.entry?.screen === 'string' ? data.entry.screen : '',
    },
    target: {
      kind: typeof data.target?.kind === 'string' && data.target.kind ? data.target.kind : 'program',
      name: typeof data.target?.name === 'string' && data.target.name ? data.target.name : program,
      resolved: data.target?.resolved !== false,
    },
    resolutionState:
      typeof data.resolutionState === 'string' && data.resolutionState
        ? data.resolutionState
        : 'entry_only',
    resolutionChain: (data.resolutionChain ?? []).map((step) => ({
      tcode: typeof step.tcode === 'string' ? step.tcode : requestedTcode,
      kind: typeof step.kind === 'string' ? step.kind : 'program',
      name: typeof step.name === 'string' ? step.name : program,
      screen: typeof step.screen === 'string' ? step.screen : '',
      relation: typeof step.relation === 'string' ? step.relation : 'entry',
    })),
  };
}

function mapTcodeError(code: string | undefined): ErrorCode {
  switch (code) {
    case 'TCODE_NOT_FOUND':
    case 'TCODE_NOT_AUTHORIZED':
      return code;
    case 'AUTH_ERROR':
      return 'AUTH_ERROR';
    case 'INVALID_ARGUMENT':
      return 'INVALID_ARGUMENT';
    default:
      return 'SAP_ERROR';
  }
}

function nextStepsFor(code: ErrorCode, tcode: string): string[] {
  switch (code) {
    case 'TCODE_NOT_FOUND':
      return [`Verify ${tcode} in SE93`, 'Check that the code is valid in the current SAP system'];
    case 'TCODE_NOT_AUTHORIZED':
      return [`Ask for authorization to inspect transaction ${tcode}`, 'Verify the assigned role in SU53/PFCG'];
    case 'AUTH_ERROR':
      return ['Verify the active connection credentials and SAP authorization'];
    default:
      return ['Deploy the current ICF service: abap extension deploy', 'Run abap doctor to check the SAP connection'];
  }
}

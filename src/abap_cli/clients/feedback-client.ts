import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { CliError, type CliErrorOptions } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';

export const FEEDBACK_API_PATH = '/api/v1/issues';
export const FEEDBACK_ENDPOINT = 'http://s4pcxapp.bmwbrill.cn:50000/sap/bc/abapcli/feedback/api/v1/issues?sap-client=100&spnego=disabled';

export interface FeedbackCreateRequest {
  username: string;
  email?: string;
  feature_key: string;
  title: string;
  description: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  source_system?: string;
  agent_id?: string;
  session_id?: string;
}

export const FEEDBACK_ISSUE_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type FeedbackIssuePriority = (typeof FEEDBACK_ISSUE_PRIORITIES)[number];

export const FEEDBACK_ISSUE_STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED'] as const;
export type FeedbackIssueStatus = (typeof FEEDBACK_ISSUE_STATUSES)[number];

export interface FeedbackIssue {
  issueId: string;
  featureKey: string;
  title: string;
  description: string;
  reporterUsername: string;
  reporterEmail: string;
  authenticatedUser: string;
  sourceSystem: string;
  agentId: string;
  sessionId: string;
  correlationId: string;
  priority: FeedbackIssuePriority;
  status: FeedbackIssueStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string;
  lastActor: string;
}

export interface FeedbackSuccessResponse {
  success: true;
  data: {
    duplicate: boolean;
    issue?: Partial<FeedbackIssue>;
  };
  request_id?: string;
}

interface FeedbackErrorResponse {
  success: false;
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
  };
  request_id?: string;
}

type FeedbackApiResponse = FeedbackSuccessResponse | FeedbackErrorResponse;

export interface FeedbackRequestOptions {
  idempotencyKey: string;
  correlationId?: string;
}

export class FeedbackClient {
  private http: AxiosInstance;
  private endpoint: string;

  private constructor() {
    this.endpoint = FEEDBACK_ENDPOINT;
    this.http = axios.create({
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30000,
    });
  }

  static create(): FeedbackClient {
    return new FeedbackClient();
  }

  async createIssue(body: FeedbackCreateRequest, options: FeedbackRequestOptions): Promise<FeedbackSuccessResponse> {
    const headers: Record<string, string> = {
      'Idempotency-Key': options.idempotencyKey,
    };
    if (options.correlationId) headers['X-Correlation-ID'] = options.correlationId;

    let response: AxiosResponse<FeedbackApiResponse>;
    try {
      response = await this.http.post<FeedbackApiResponse>(this.endpoint, body, { headers });
    } catch (error: unknown) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const serviceError = feedbackServiceError(axios.isAxiosError(error) ? error.response?.data : undefined, status);
      if (serviceError) throw serviceError;
      throw toFeedbackHttpError(error);
    }

    const serviceError = feedbackServiceError(response.data, response.status);
    if (serviceError) throw serviceError;
    const success = normalizeFeedbackSuccess(response.data, response.status);
    if (!success) {
      throw new CliError('SAP_ERROR', 'Feedback service returned an invalid success response.', {
        details: { httpStatus: response.status },
      });
    }
    return success;
  }
}

function normalizeFeedbackSuccess(value: unknown, status: number): FeedbackSuccessResponse | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const response = value as Partial<FeedbackSuccessResponse>;
  if (response.success !== true || !response.data || typeof response.data !== 'object') return undefined;

  const data = response.data as Partial<FeedbackSuccessResponse['data']>;
  if (typeof data.duplicate !== 'boolean') return undefined;
  if (data.issue !== undefined && (!data.issue || typeof data.issue !== 'object')) return undefined;
  if (response.request_id !== undefined && typeof response.request_id !== 'string') return undefined;

  return {
    success: true,
    data: {
      duplicate: data.duplicate,
      ...(data.issue ? { issue: data.issue } : {}),
    },
    ...(response.request_id ? { request_id: response.request_id } : {}),
  };
}

function feedbackServiceError(value: unknown, status?: number): CliError | undefined {
  if (!value || typeof value !== 'object' || (value as { success?: unknown }).success !== false) return undefined;

  const response = value as FeedbackErrorResponse;
  const rawCode = response.error?.code;
  const code = mapFeedbackErrorCode(rawCode, status);
  const requestId = response.error?.request_id || response.request_id;
  const details: Record<string, unknown> = {
    ...(rawCode && rawCode !== code ? { serviceCode: rawCode } : {}),
    ...(typeof status === 'number' ? { httpStatus: status } : {}),
    ...(requestId ? { requestId } : {}),
  };
  const options: CliErrorOptions | undefined = Object.keys(details).length > 0 ? { details } : undefined;
  return new CliError(code, feedbackErrorMessage(code), options);
}

function mapFeedbackErrorCode(rawCode: string | undefined, status?: number): ErrorCode {
  if (rawCode === 'VALIDATION_ERROR' || rawCode === 'CONFLICT' || rawCode === 'PERSISTENCE_ERROR' || rawCode === 'HTTP_ERROR') {
    return rawCode;
  }
  if (status === 400) return 'VALIDATION_ERROR';
  if (status === 409) return 'CONFLICT';
  if (status !== undefined && status >= 500) return 'PERSISTENCE_ERROR';
  return 'SAP_ERROR';
}

function toFeedbackHttpError(error: unknown): CliError {
  const axiosError = axios.isAxiosError(error) ? error : undefined;
  const status = axiosError?.response?.status;
  const causeCode = axiosError?.cause && typeof axiosError.cause === 'object'
    ? (axiosError.cause as NodeJS.ErrnoException).code
    : undefined;
  const details: Record<string, unknown> = {
    ...(typeof status === 'number' ? { httpStatus: status } : {}),
    ...(causeCode ? { cause: causeCode } : {}),
  };
  if (status === 401 || status === 403) {
    return new CliError('AUTH_ERROR', 'Feedback service authentication was rejected.', { details });
  }
  if (causeCode && ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_REVOKED', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(causeCode)) {
    return new CliError('TLS_ERROR', 'Feedback service TLS validation failed.', { details });
  }
  const code: ErrorCode = status !== undefined && status >= 500 ? 'PERSISTENCE_ERROR' : 'HTTP_ERROR';
  return new CliError(code, feedbackErrorMessage(code), Object.keys(details).length > 0 ? { details } : undefined);
}

function feedbackErrorMessage(code: ErrorCode): string {
  switch (code) {
    case 'VALIDATION_ERROR': return 'Feedback service rejected the submitted fields.';
    case 'CONFLICT': return 'The idempotency key is already associated with different feedback.';
    case 'PERSISTENCE_ERROR': return 'Feedback service could not persist the issue.';
    case 'HTTP_ERROR': return 'Feedback request could not reach the feedback service.';
    default: return 'Feedback service rejected the request.';
  }
}
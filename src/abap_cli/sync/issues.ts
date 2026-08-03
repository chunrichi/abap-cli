/** One finding, unified across syntax / content / ATC modes (FR-008). */
export interface CheckIssue {
  file: string;
  line: number;
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

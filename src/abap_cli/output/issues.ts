/** One finding, unified across syntax / content / ATC modes. */
export interface CheckIssue {
  file: string;
  line: number;
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

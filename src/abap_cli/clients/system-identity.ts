/**
 * System-side identity of the live SAP session.
 *
 * Read from the bundled ICF service (`GET /sap/abap_cli/whoami`), which answers
 * from the ABAP session that authenticated the HTTP request — `sy-uname` and
 * friends. That is the point of routing identity through the server instead of
 * echoing the local profile: it keeps working when the auth method changes
 * (SSO / ticket / future mechanisms), because the system, not the CLI config,
 * states who the caller is.
 */
export interface SystemIdentity {
  /** SAP user the session is authenticated as (`sy-uname`). */
  user: string;
  /** SAP system ID (`sy-sysid`). */
  systemId: string;
  /** SAP client (`sy-mandt`). */
  client: string;
  /** Application server host (`sy-host`). */
  applicationServer: string;
  /** Database system (`sy-dbsys`), e.g. `HDB`. */
  database: string;
  /** Application server operating system (`sy-opsys`). */
  os: string;
  /** SAP Basis release (`sy-saprl`), e.g. `757`. */
  abapRelease: string;
}

/** ICF route that reports the system-side identity. */
export const ICF_WHOAMI_PATH = '/whoami';

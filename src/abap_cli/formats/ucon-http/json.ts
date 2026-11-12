/**
 * UCON HTTP service (UCON_HTTP) local-file ↔ ICF wire mapping.
 *
 * A UCON HTTP service is a TADIR object (OBJECT='HTTP') backed by
 * UCONHTTPSERVHEAD / UCONHTTPSERVTEXT / UCONHTTPSERVHANDL and maintained
 * through the public UCON HTTP service API (CL_UCON_API_FACTORY). Upstream
 * abap-file-formats has no UCON HTTP service format, so the local document is a
 * local extension validated by `ucon_http-v1.json` and served by the bundled
 * ICF service at `/ucon_http/<name>`.
 *
 * Local file: `<name>.ucon_http.json` (single flat document, no `name` field —
 * the file name / command argument carries the service name, matching the AFF
 * HTTP / SRFC convention). Shape:
 *
 *   {
 *     "formatVersion": "1",
 *     "description": "Sales order HTTP service",
 *     "handlers": [
 *       { "order": "01", "handlerClass": "ZCL_MY_HTTP_HANDLER" }
 *     ],
 *     "icfService": { "icfName": "ZMY_NODE", "icfParGuid": "..." }
 *   }
 *
 * Wire: the same document plus the read-only `name` (service id) and
 * `package` (TADIR package); pull strips the read-only fields so pull → push
 * round-trips stay stable.
 */
import { validateAff } from '../../aff/schema-validator.js';
import { defineWireArtifact } from '../artifact.js';

/** UCONHTTPSERVID is CHAR 30. */
export const UCON_HTTP_NAME_MAX_LENGTH = 30;

/** UCONHTTPSERVTEXT-SHORTTEXT is CHAR 255, single line. */
export const UCON_HTTP_DESCRIPTION_MAX_LENGTH = 255;

/** UCONHTTPSERVHANDL-SERVICEHANDLER (class name) is CHAR 30. */
export const UCON_HTTP_HANDLER_MAX_LENGTH = 30;

/** ICFNAME is CHAR 15. */
export const UCON_HTTP_ICF_NAME_MAX_LENGTH = 15;

/** ICFPARGUID is CHAR 25. */
export const UCON_HTTP_ICF_PAR_GUID_MAX_LENGTH = 25;

/** Handler classes are global class names (namespaces use '/' tokens). */
export const UCON_HTTP_HANDLER_CLASS_PATTERN = /^[A-Za-z0-9_/]+$/;

/** One ordered handler class of the service. */
export interface UconHttpHandler {
  /** SERVICEORDER (1-2 digits); omitted when the list position is used. */
  order?: string;
  /** SERVICEHANDLER: global ABAP class implementing the HTTP handler. */
  handlerClass: string;
}

/** Optional link to an existing SICF node (required on releases before 757). */
export interface UconHttpIcfService {
  icfName?: string;
  icfParGuid?: string;
}

/** Local `<name>.ucon_http.json` document. */
export interface UconHttpLocal {
  formatVersion: '1';
  /** Service short text (UCONHTTPSERVTEXT); omitted when unset. */
  description?: string;
  /** Handler classes; at least one is required on write. */
  handlers: UconHttpHandler[];
  /** ICF node link; omitted for a standalone service. */
  icfService?: UconHttpIcfService;
}

/** Wire payload of ICF `/ucon_http/<name>`: local document + server-owned fields. */
export interface UconHttpWire extends UconHttpLocal {
  /** Service id — from the URL on GET, echoed in the POST body. */
  name?: string;
  /** Package of the TADIR entry (read-only; used by push/delete transport rules). */
  package?: string;
}

/** Body ICF `/ucon_http/<name>` accepts on POST (write path with package/transport). */
export interface UconHttpWrite extends UconHttpWire {
  transportRequest?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

function asUpperText(value: unknown): string {
  return asText(value).toUpperCase();
}

/** Normalize one handler entry: uppercase class, keep an explicit order only. */
function normalizeHandler(value: unknown): UconHttpHandler | undefined {
  const handler = asRecord(value);
  if (!handler) return undefined;
  const handlerClass = asUpperText(handler.handlerClass);
  if (!handlerClass) return undefined;
  const order = asText(handler.order);
  return order ? { order, handlerClass } : { handlerClass };
}

function normalizeHandlers(value: unknown): UconHttpHandler[] {
  return Array.isArray(value)
    ? value.map(normalizeHandler).filter((handler): handler is UconHttpHandler => handler !== undefined)
    : [];
}

function normalizeIcfService(value: unknown): UconHttpIcfService | undefined {
  const icf = asRecord(value);
  if (!icf) return undefined;
  const icfName = asUpperText(icf.icfName);
  const icfParGuid = asUpperText(icf.icfParGuid);
  if (!icfName && !icfParGuid) return undefined;
  return {
    ...(icfName ? { icfName } : {}),
    ...(icfParGuid ? { icfParGuid } : {}),
  };
}

/** Effective service order of a handler: the explicit value or its list position. */
export function effectiveHandlerOrder(handler: UconHttpHandler, index: number): string {
  return asText(handler.order) || String(index + 1);
}

/**
 * Convert the ICF GET payload into the local ucon_http-v1 document.
 *
 * `name`, `package` and the admin fields are deliberately dropped: they are
 * server-owned and the local file does not carry them (the file name is the
 * service name).
 */
export function wireToLocal(wire: unknown): UconHttpLocal {
  const w = asRecord(wire) ?? {};
  const local: UconHttpLocal = {
    formatVersion: '1',
    handlers: normalizeHandlers(w.handlers),
  };
  const description = asText(w.description);
  if (description) local.description = description;
  const icfService = normalizeIcfService(w.icfService);
  if (icfService) local.icfService = icfService;
  return local;
}

/**
 * Convert the local document into the body ICF `/ucon_http/<name>` accepts.
 * `name` is taken from the command argument / file name; the read-only admin
 * fields are never sent.
 */
export function localToWire(local: UconHttpLocal, name?: string): UconHttpWire {
  const wire: UconHttpWire = {
    formatVersion: '1',
    handlers: normalizeHandlers(local.handlers),
  };
  const description = asText(local.description);
  if (description) wire.description = description;
  const icfService = normalizeIcfService(local.icfService);
  if (icfService) wire.icfService = icfService;
  const service = asUpperText(name);
  if (service) wire.name = service;
  return wire;
}

/**
 * Semantic validation beyond JSON Schema: the rules the ICF route enforces,
 * surfaced locally with actionable messages. Name rules are separate because
 * the local document does not carry `name` (see `validateUconName`).
 */
export function validateUconHttpObject(doc: unknown): string[] {
  const data = asRecord(doc);
  if (!data) return ['ucon_http document must be a JSON object'];
  const errors: string[] = [];

  const description = asText(data.description);
  if (description.length > UCON_HTTP_DESCRIPTION_MAX_LENGTH) {
    errors.push(
      `description must not exceed ${UCON_HTTP_DESCRIPTION_MAX_LENGTH} characters (UCONHTTPSERVTEXT; got ${description.length})`,
    );
  }
  if (/[\r\n]/.test(description)) {
    errors.push('description must be a single line (no line breaks; UCONHTTPSERVTEXT is one CHAR 255 field)');
  }

  if (!Array.isArray(data.handlers) || data.handlers.length === 0) {
    errors.push('handlers must contain at least one handler class (UCONHTTPSERVHANDL-SERVICEHANDLER)');
  } else {
    if (data.handlers.length > 100) {
      errors.push(`handlers must not exceed 100 entries (got ${data.handlers.length})`);
    }
    const orders = new Map<string, number>();
    data.handlers.forEach((entry, index) => {
      const handler = asRecord(entry);
      if (!handler) {
        errors.push(`handlers[${index}] must be an object with handlerClass`);
        return;
      }
      const handlerClass = asText(handler.handlerClass);
      if (!handlerClass) {
        errors.push(`handlers[${index}].handlerClass is required (global ABAP class, e.g. "ZCL_MY_HTTP_HANDLER")`);
      } else if (handlerClass.length > UCON_HTTP_HANDLER_MAX_LENGTH) {
        errors.push(
          `handlers[${index}].handlerClass must not exceed ${UCON_HTTP_HANDLER_MAX_LENGTH} characters (got ${handlerClass.length})`,
        );
      } else if (!UCON_HTTP_HANDLER_CLASS_PATTERN.test(handlerClass)) {
        errors.push(
          `handlers[${index}].handlerClass may only contain A-Z, 0-9, '_' and '/' (got "${String(handler.handlerClass)}")`,
        );
      }
      const order = asText(handler.order);
      if (order && (!/^[0-9]{1,2}$/.test(order) || Number(order) > 99)) {
        errors.push(`handlers[${index}].order must be a 1 or 2 digit service order (got "${order}")`);
      }
      const effective = order || String(index + 1);
      // Compare numerically: the SAP side stores a N2 field, so "02" and "2"
      // are the same service order and would silently collapse into one row.
      const orderKey = String(Number(effective));
      if (orders.has(orderKey)) {
        errors.push(
          `handlers[${index}].order ${effective} collides with handlers[${orders.get(orderKey)}]; service orders must be unique`,
        );
      } else {
        orders.set(orderKey, index);
      }
    });
  }

  const icfService = asRecord(data.icfService);
  if (icfService) {
    const icfName = asText(icfService.icfName);
    if (icfName.length > UCON_HTTP_ICF_NAME_MAX_LENGTH) {
      errors.push(`icfService.icfName must not exceed ${UCON_HTTP_ICF_NAME_MAX_LENGTH} characters (ICFNAME; got ${icfName.length})`);
    }
    const icfParGuid = asText(icfService.icfParGuid);
    if (icfParGuid.length > UCON_HTTP_ICF_PAR_GUID_MAX_LENGTH) {
      errors.push(
        `icfService.icfParGuid must not exceed ${UCON_HTTP_ICF_PAR_GUID_MAX_LENGTH} characters (ICFPARGUID; got ${icfParGuid.length})`,
      );
    }
  }

  return errors;
}

/** Agent-facing minimal ucon_http-v1 example (`abap create --schema UCON_HTTP`). */
export function getUconHttpJsonExample(): string {
  return `# src/zcli_http_demo.ucon_http.json (single file)
{
  "formatVersion": "1",
  "description": "Demo UCON HTTP service",
  "handlers": [
    { "order": "01", "handlerClass": "ZCL_HTTP_DEMO_HANDLER" }
  ]
}
# handlers is required: ordered global handler classes (UCONHTTPSERVHANDL).
# order is optional (1-2 digits); the list position is used when omitted.
# icfService is optional: { "icfName": "<ICFNAME>", "icfParGuid": "<ICFPARGUID>" }
# links the service to an existing SICF node; pull fills it when present.
# Create records the TADIR entry / transport request (--package / --tr);
# description is written in the session language only.`;
}

/** UCON_HTTP artifact: file/schema plumbing + local ↔ ICF wire mapping. */
export const uconHttpArtifact = defineWireArtifact<UconHttpLocal, UconHttpWire>({
  type: 'UCON_HTTP',
  toWire: (local) => localToWire(local),
  fromWire: (wire) => wireToLocal(wire),
  validate: async (doc) => {
    const result = await validateAff('UCON_HTTP', doc);
    const schemaErrors =
      result.status === 'pass' || result.status === 'warn'
        ? []
        : result.errors.map((e) => `${e.instancePath || '/'}: ${e.message}`);
    return [...schemaErrors, ...validateUconHttpObject(doc)];
  },
});

/**
 * SRVB (service binding) ADT wire helpers.
 *
 * ADT exposes the binding as a metadata-only blue-style resource:
 *   POST /sap/bc/adt/businessservices/bindings
 *   GET  /sap/bc/adt/businessservices/bindings/<name>
 *   POST /sap/bc/adt/businessservices/{odatav2|odatav4}/publishjobs
 *
 * The typed `abap-adt-api` creator hard-codes category 0 / version V2, so the
 * CLI builds the body itself from the AFF document.
 */
import { XMLParser } from 'fast-xml-parser';
import type { SrvbLocal } from '../formats/srvb/json.js';
import { CliError } from '../output/json.js';

/** ADT media type of a service-binding resource. */
export const SRVB_MEDIA_TYPE =
  'application/vnd.sap.adt.businessservices.servicebinding.v2+xml';

/** ADT collection for service bindings. */
export const SRVB_BASE_PATH = '/sap/bc/adt/businessservices/bindings';

/** Per-object URL; namespaced names are percent-encoded. */
export function srvbObjectUrl(name: string): string {
  return `${SRVB_BASE_PATH}/${encodeURIComponent(name.toLowerCase())}`;
}

/** Publish-job status media type; on-prem renders the status only as as+xml. */
export const PUBLISH_JOB_ACCEPT =
  'application/vnd.sap.as+xml, application/*;q=0.8';

export interface ParsedBindingType {
  type: string;
  version: string;
}

/**
 * Parse the AFF `bindingType` string (e.g. `"ODATA V4"`) into the ADT
 * `srvb:type` / `srvb:version` pair. The pull renderer joins the two with a
 * space, so the last token is the version and everything before it is the
 * type.
 */
export function parseBindingType(bindingType: string): ParsedBindingType {
  const value = bindingType.trim();
  const split = value.lastIndexOf(' ');
  if (split <= 0) {
    return { type: value, version: '' };
  }
  return {
    type: value.slice(0, split).trim(),
    version: value.slice(split + 1).trim(),
  };
}

/** Map the AFF category enum to the ADT numeric category. */
export function bindingCategory(category: SrvbLocal['bindingTypeCategory']): '0' | '1' {
  return category === 'webApi' ? '1' : '0';
}

function encodeAttr(value: string | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface SrvbCreateOptions {
  name: string;
  packageName: string;
  language?: string;
}

/**
 * Build the service-binding create body from the AFF document.
 *
 * `srvb:implementation` stays empty: ADT creates the binding implementation
 * during activation when it is not supplied (verified on S/4HANA).
 */
export function buildSrvbCreateBody(doc: SrvbLocal, options: SrvbCreateOptions): string {
  const parsed = parseBindingType(doc.bindingType);
  if (!parsed.type || !parsed.version) {
    throw new CliError(
      'VALIDATION_ERROR',
      `Invalid SRVB bindingType "${doc.bindingType}" (expected "<type> <version>", e.g. "ODATA V4")`,
    );
  }
  if (doc.services.length === 0) {
    throw new CliError('VALIDATION_ERROR', 'Invalid SRVB definition: at least one service is required');
  }
  const language = options.language ?? 'EN';
  const masterLanguage = doc.header.originalLanguage || language;
  const services = doc.services
    .map((service) => {
      const content = service.versions
        .map(
          (version) =>
            `<srvb:content srvb:version="${encodeAttr(version.serviceVersion)}">` +
            `<srvb:serviceDefinition adtcore:name="${encodeAttr(version.serviceDefinition)}"/>` +
            '</srvb:content>',
        )
        .join('');
      return `<srvb:services srvb:name="${encodeAttr(service.name)}">${content}</srvb:services>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<srvb:serviceBinding' +
    ' xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings"' +
    ' xmlns:adtcore="http://www.sap.com/adt/core"' +
    ` adtcore:description="${encodeAttr(doc.header.description)}"` +
    ` adtcore:name="${encodeAttr(options.name)}"` +
    ' adtcore:type="SRVB/SVB"' +
    ` adtcore:language="${encodeAttr(language)}"` +
    ` adtcore:masterLanguage="${encodeAttr(masterLanguage)}">` +
    `<adtcore:packageRef adtcore:name="${encodeAttr(options.packageName)}"/>` +
    services +
    `<srvb:binding srvb:type="${encodeAttr(parsed.type)}" srvb:version="${encodeAttr(parsed.version)}"` +
    ` srvb:category="${bindingCategory(doc.bindingTypeCategory)}">` +
    '<srvb:implementation adtcore:name=""/>' +
    '</srvb:binding>' +
    '</srvb:serviceBinding>'
  );
}

export interface PublishJobResult {
  severity: string;
  shortText: string;
  longText: string;
}

/** Parse the `asx:abap` publish/unpublish status document. */
export function parsePublishJobResponse(xml: string): PublishJobResult {
  const node = (tag: string): string => {
    const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
    return match?.[1]?.trim() ?? '';
  };
  return {
    severity: node('SEVERITY'),
    shortText: node('SHORT_TEXT'),
    longText: node('LONG_TEXT'),
  };
}

/** Fully-qualified as+xml type used when a 406 names as+xml as the only renderer. */
export function publishJobAsXmlType(
  serviceType: 'odatav2' | 'odatav4',
  job: 'publishjob' | 'unpublishjob',
): string {
  return `application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.businessservices.${serviceType}.${job}`;
}


/** Projection of the ADT service-binding metadata needed by publish jobs. */
export interface SrvbMetadata {
  name: string;
  /** OData service version (`srvb:content@srvb:version`, e.g. `0001`). */
  serviceVersion: string;
  /** Binding protocol version (`srvb:binding@srvb:version`, e.g. `V2`/`V4`). */
  bindingVersion: string;
  /** Whether the local service endpoint is currently published. */
  published: boolean;
  /** Referenced service definition, when present. */
  serviceDefinition?: string;
}

type XmlNode = Record<string, unknown>;

const srvbParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

function asNode(value: unknown): XmlNode {
  return value !== null && typeof value === 'object' ? (value as XmlNode) : {};
}

function attr(node: XmlNode, name: string): string | undefined {
  const value = node[`@_${name}`];
  return value === undefined || value === null ? undefined : String(value);
}

/** First child of a node, tolerating both single-object and array shapes. */
function first(value: unknown): XmlNode | undefined {
  if (Array.isArray(value)) return value.length > 0 ? asNode(value[0]) : undefined;
  if (value === undefined || value === null) return undefined;
  return asNode(value);
}

/**
 * Parse the `srvb:serviceBinding` metadata envelope.
 *
 * The publish job needs the OData service version and the binding protocol
 * version; both are derived from the metadata rather than from local files, so
 * `publish` can run on an existing binding without pulling it first.
 */
export function parseSrvbMetadata(xml: string): SrvbMetadata {
  let parsed: XmlNode;
  try {
    parsed = srvbParser.parse(xml) as XmlNode;
  } catch (error) {
    throw new CliError('SAP_ERROR', `Unexpected SRVB response from SAP: XML parse failed: ${error instanceof Error ? error.message : String(error)}`, {
      type: 'SRVB',
    });
  }
  const root = parsed.serviceBinding;
  if (root === undefined) {
    throw new CliError('SAP_ERROR', 'Unexpected SRVB response from SAP: expected <srvb:serviceBinding> root element', {
      type: 'SRVB',
    });
  }
  const node = asNode(root);
  const services = first(node.services);
  const content = services ? first(services.content) : undefined;
  const binding = first(node.binding);
  const serviceDefinition = content ? first(content.serviceDefinition) : undefined;
  return {
    name: attr(node, 'name') ?? '',
    serviceVersion: content ? (attr(content, 'version') ?? '') : '',
    bindingVersion: binding ? (attr(binding, 'version') ?? '') : '',
    published: attr(node, 'published') === 'true',
    ...(serviceDefinition ? { serviceDefinition: attr(serviceDefinition, 'name') } : {}),
  };
}

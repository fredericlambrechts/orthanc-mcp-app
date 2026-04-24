export type AuthMode = 'none';

export type DicomWebServer = {
  id: string;
  label: string;
  base_url: string;
  auth: AuthMode;
  default: boolean;
};

export const DEFAULT_SERVERS: readonly DicomWebServer[] = [
  {
    id: 'orthanc-demo',
    label: 'Orthanc public demo server',
    base_url: 'https://orthanc.uclouvain.be/demo/dicom-web',
    auth: 'none',
    default: true,
  },
];

// Runtime-registered servers populated when a user pastes a DICOMweb URL
// from a host we don't know yet. Keyed by generated server id.
const runtimeServers = new Map<string, DicomWebServer>();

export function getDefaultServer(): DicomWebServer {
  const d = DEFAULT_SERVERS.find((s) => s.default);
  if (!d) {
    throw new Error('No default DICOMweb server configured');
  }
  return d;
}

export function getServerById(id: string): DicomWebServer | undefined {
  const builtin = DEFAULT_SERVERS.find((s) => s.id === id);
  if (builtin) return builtin;
  return runtimeServers.get(id);
}

export function listServers(): readonly DicomWebServer[] {
  return [...DEFAULT_SERVERS, ...runtimeServers.values()];
}

/**
 * Register an ad-hoc DICOMweb server at runtime. Used when a user pastes a
 * URL from a host the server was not pre-configured to know about.
 *
 * Returns the registered entry. If an entry with the same id already exists,
 * it is replaced.
 */
export function registerRuntimeServer(s: DicomWebServer): DicomWebServer {
  runtimeServers.set(s.id, s);
  return s;
}

export function clearRuntimeServers(): void {
  runtimeServers.clear();
}

/**
 * Generate a stable, short server id from an origin URL. Same origin -> same id.
 */
export function generateServerId(origin: string): string {
  // Strip protocol + trailing slashes, replace non-word chars with dashes.
  const cleaned = origin
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .toLowerCase();
  return `adhoc-${cleaned}`;
}

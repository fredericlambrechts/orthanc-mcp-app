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

export function getDefaultServer(): DicomWebServer {
  const d = DEFAULT_SERVERS.find((s) => s.default);
  if (!d) {
    throw new Error('No default DICOMweb server configured');
  }
  return d;
}

export function getServerById(id: string): DicomWebServer | undefined {
  return DEFAULT_SERVERS.find((s) => s.id === id);
}

export function listServers(): readonly DicomWebServer[] {
  return DEFAULT_SERVERS;
}

/**
 * Parses user-pasted references into DICOMweb study coordinates.
 *
 * Accepted shapes (see tool-signatures.md §"URL parser spec"):
 *   1. Bare StudyInstanceUID       e.g. 1.2.840.113619.2.5...
 *   2. Orthanc UI URL              .../ui/app/#/studies/<orthanc-id>
 *   3. Orthanc REST URL            .../studies/<orthanc-id>
 *   4. DICOMweb study URL          .../dicom-web/studies/<StudyInstanceUID>
 *   5. OHIF share URL              .../viewer?StudyInstanceUIDs=<uid>
 *
 * Rejections:
 *   - Non-http(s) schemes (file://, data:, ftp://)
 *   - Tokenised URLs (?token=, ?access_token=, /auth/)
 *   - Raw IP-literal hosts (defence against proxy-style redirections)
 *   - Unrecognized URL shapes from an otherwise-valid host
 */

// Require at least 3 components to avoid classifying "1.2.3" or short codes as UIDs.
const OID_RE = /^[0-9]+(?:\.[0-9]+){2,}$/;

// Orthanc IDs are 5 groups of 8 hex chars joined by dashes, total 44 chars.
const ORTHANC_ID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{8}){4}$/i;
const ORTHANC_ID_GROUP = '[0-9a-f]{8}(?:-[0-9a-f]{8}){4}';

export type ParsedRef =
  | { kind: 'bare_uid'; studyUid: string }
  | {
      kind: 'dicomweb_study';
      host: string;
      dicomwebBase: string;
      studyUid: string;
    }
  | {
      kind: 'orthanc_ui';
      host: string;
      restBase: string;
      orthancId: string;
    }
  | {
      kind: 'orthanc_rest';
      host: string;
      restBase: string;
      orthancId: string;
    }
  | { kind: 'ohif_share'; host: string; studyUid: string }
  | { kind: 'reject'; code: RejectCode; message: string; suggestions?: string[] };

export type RejectCode =
  | 'UNPARSEABLE'
  | 'AUTHENTICATED'
  | 'REJECTED_SCHEME'
  | 'REJECTED_HOST';

/**
 * Pure shape parser. Does no I/O. Returns the structured shape of the
 * reference, or a rejection with a useful error.
 */
export function parseReferenceShape(raw: string): ParsedRef {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      kind: 'reject',
      code: 'UNPARSEABLE',
      message: 'empty reference',
      suggestions: [
        'paste a DICOMweb study URL',
        'paste an Orthanc UI URL',
        'paste a StudyInstanceUID',
      ],
    };
  }

  // (1) Bare StudyInstanceUID (dotted OID, >=3 components)
  if (OID_RE.test(trimmed)) {
    return { kind: 'bare_uid', studyUid: trimmed };
  }

  // Everything else must be a URL
  if (/^[a-z][a-z0-9+\-.]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return {
      kind: 'reject',
      code: 'REJECTED_SCHEME',
      message: 'only http(s):// URLs are accepted',
    };
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      kind: 'reject',
      code: 'UNPARSEABLE',
      message:
        'expected a StudyInstanceUID or an http(s):// URL (Orthanc / DICOMweb / OHIF)',
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { kind: 'reject', code: 'UNPARSEABLE', message: 'invalid URL' };
  }

  // Reject IP-literal, metadata, loopback, and private-range hosts to avoid
  // SSRF pivots through the server-side Orthanc lookup and DICOMweb proxy.
  if (isIpLiteralHost(url.hostname) || isPrivateIpv4(url.hostname)) {
    return {
      kind: 'reject',
      code: 'REJECTED_HOST',
      message:
        'IP-literal, localhost, cloud-metadata, and private-range hosts are not accepted in v1 (public DICOMweb servers only)',
    };
  }

  // Reject authenticated-looking URLs
  if (looksAuthenticated(url)) {
    return {
      kind: 'reject',
      code: 'AUTHENTICATED',
      message:
        'URLs with authentication tokens or /auth/ paths are not supported in v1 (public DICOMweb servers only)',
    };
  }

  // (5) OHIF share URL: any /viewer path with StudyInstanceUIDs query.
  if (
    url.pathname.toLowerCase().includes('/viewer') &&
    url.searchParams.has('StudyInstanceUIDs')
  ) {
    const studyUid = url.searchParams.get('StudyInstanceUIDs')!;
    if (OID_RE.test(studyUid)) {
      return { kind: 'ohif_share', host: url.origin, studyUid };
    }
  }

  // (4) DICOMweb study URL: /dicom-web/studies/<uid> or /dicomweb/studies/<uid>
  const dwMatch = url.pathname.match(
    /^(.*?\/(?:dicom-web|dicomweb|wado-rs))\/studies\/([0-9.]+)(?:\/.*)?$/i,
  );
  if (dwMatch && OID_RE.test(dwMatch[2])) {
    return {
      kind: 'dicomweb_study',
      host: url.origin,
      dicomwebBase: dwMatch[1],
      studyUid: dwMatch[2],
    };
  }

  // (2) Orthanc UI URL: contains /ui/app/ + hash #/studies/<orthanc-id>.
  // Orthanc may be mounted at the root (/ui/app/) or under a prefix
  // (/demo/ui/app/). We capture the prefix before /ui/app/ so we know the
  // REST base for subsequent lookups.
  const uiPathMatch = url.pathname.match(/^(.*?)\/ui\/app\/?.*$/);
  if (uiPathMatch) {
    const hashMatch = url.hash.match(
      new RegExp(`^#\\/studies\\/(${ORTHANC_ID_GROUP})`, 'i'),
    );
    if (hashMatch) {
      const prefix = uiPathMatch[1]; // may be '' or e.g. '/demo'
      return {
        kind: 'orthanc_ui',
        host: url.origin,
        restBase: url.origin + prefix,
        orthancId: hashMatch[1].toLowerCase(),
      };
    }
  }

  // (3) Orthanc REST URL: ends with /studies/<orthanc-id>. Orthanc may be
  // mounted at the root or under a prefix (e.g. /demo/studies/<id>).
  // The Orthanc id format is distinctive enough (5x8 hex joined by dashes)
  // that false positives against unrelated path segments are very unlikely.
  const restMatch = url.pathname.match(
    new RegExp(`^(.*?)\\/studies\\/(${ORTHANC_ID_GROUP})\\/?$`, 'i'),
  );
  if (restMatch) {
    const prefix = restMatch[1]; // may be '' or e.g. '/demo'
    return {
      kind: 'orthanc_rest',
      host: url.origin,
      restBase: url.origin + prefix,
      orthancId: restMatch[2].toLowerCase(),
    };
  }

  return {
    kind: 'reject',
    code: 'UNPARSEABLE',
    message: 'URL does not match any supported shape',
    suggestions: [
      'DICOMweb study URL: https://<host>/dicom-web/studies/<StudyInstanceUID>',
      'Orthanc UI URL: https://<host>/ui/app/#/studies/<orthanc-id>',
      'Orthanc REST URL: https://<host>/studies/<orthanc-id>',
      'OHIF share URL: https://<host>/viewer?StudyInstanceUIDs=<uid>',
    ],
  };
}

// Hostnames that must be rejected regardless of IP resolution. These are
// known cloud-metadata endpoints and common internal-service aliases that
// an attacker might paste to turn the proxy into an internal port scanner.
const BLOCKED_HOSTNAMES: readonly string[] = [
  'localhost',
  'localhost.localdomain',
  // Cloud metadata services (Google, AWS, Azure, DigitalOcean, Oracle)
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
  // Kubernetes service aliases
  'kubernetes',
  'kubernetes.default',
  'kubernetes.default.svc',
];

// DNS suffixes that imply private/internal addressing.
const BLOCKED_HOSTNAME_SUFFIXES: readonly string[] = [
  '.internal',
  '.local',
  '.localdomain',
  '.svc',
  '.svc.cluster.local',
  '.cluster.local',
];

export function isIpLiteralHost(hostname: string): boolean {
  // URL parsing preserves brackets on IPv6 literals (e.g. '[::1]'). If the
  // brackets are present at all, it IS an IPv6 literal - reject unconditionally,
  // which also covers IPv4-mapped forms like [::ffff:127.0.0.1].
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;

  const bare = hostname;
  const lower = bare.toLowerCase();

  // IPv6 literal without brackets (defensive - URL() normally adds brackets)
  if (/^[0-9a-f:]+$/i.test(bare) && bare.includes(':')) return true;

  // IPv4 literal - classic dotted notation
  const ipv4Match = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) return true;

  // IPv4 literal - decimal form (e.g. 2130706433 = 127.0.0.1)
  if (/^\d+$/.test(bare) && bare.length <= 10) return true;

  // IPv4 literal - hex form (e.g. 0x7f000001)
  if (/^0x[0-9a-f]+$/i.test(bare)) return true;

  // Known-bad DNS aliases
  if (BLOCKED_HOSTNAMES.includes(lower)) return true;

  // Suffix-based blocks (internal DNS, kubernetes service aliases, etc).
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (lower.endsWith(suffix)) return true;
  }

  return false;
}

/**
 * Returns true when the hostname resolves (or is an IP literal pointing at)
 * a private, loopback, link-local, or otherwise non-routable address.
 *
 * This is only exact for IP literals. For DNS hostnames we intentionally
 * do NOT do DNS lookups in the parser (that would be a side effect); higher
 * layers (proxy, resolver) should apply DNS-pinning guards if they want a
 * truly authoritative check. For v1 we rely on IP-literal rejection plus
 * BLOCKED_HOSTNAMES/BLOCKED_HOSTNAME_SUFFIXES to catch the obvious bypasses.
 */
export function isPrivateIpv4(hostname: string): boolean {
  const bare =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;

  const m = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a < 0 || a > 255 || b < 0 || b > 255) return true; // malformed - reject
  // 0.0.0.0/8 - "this network"
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 127.0.0.0/8 - loopback
  if (a === 127) return true;
  // 169.254.0.0/16 - link-local (includes AWS/GCP metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 - CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

// Query parameter keys whose presence implies a user-bearable credential.
// Matched case-insensitively against the full URLSearchParams keyset.
const AUTH_QUERY_KEYS: readonly string[] = [
  'token',
  'access_token',
  'authorization',
  'api_key',
  'apikey',
  'key',
  'jwt',
  'bearer',
  'sig',
  'signature',
  'x-amz-signature',
  'auth',
];

export function looksAuthenticated(url: URL): boolean {
  // Check the fragment as well as the pathname - a URL like
  // `https://x.com/foo#/auth/bar` keeps `/auth/` in `url.hash`, not `pathname`.
  const pathAndHash = (url.pathname + url.hash).toLowerCase();
  if (pathAndHash.includes('/auth/')) return true;
  if (/%2fauth%2f/i.test(pathAndHash)) return true;

  // Case-insensitive query-key scan. URLSearchParams.has() is case-sensitive,
  // so we iterate keys and lowercase-compare.
  for (const key of url.searchParams.keys()) {
    if (AUTH_QUERY_KEYS.includes(key.toLowerCase())) return true;
  }

  // http://user:pass@host
  if (url.username || url.password) return true;

  return false;
}

export function isOrthancId(s: string): boolean {
  return ORTHANC_ID_RE.test(s);
}

export function isBareStudyInstanceUID(s: string): boolean {
  return OID_RE.test(s.trim());
}

/**
 * Resolve an Orthanc REST "orthanc id" into a StudyInstanceUID by fetching
 * /studies/<id> from the Orthanc REST API.
 *
 * `restBase` should be the Orthanc mount point (e.g. `https://host/demo`),
 * not just the origin. The REST and DICOMweb plugin conventionally share
 * that mount point.
 *
 * Throws on HTTP failure or if the response is missing
 * MainDicomTags.StudyInstanceUID.
 */
const ORTHANC_LOOKUP_TIMEOUT_MS = 10_000;

export async function resolveOrthancId(
  restBase: string,
  orthancId: string,
): Promise<string> {
  const base = restBase.replace(/\/+$/, '');
  const restUrl = `${base}/studies/${orthancId}`;
  let res: globalThis.Response;
  try {
    res = await fetch(restUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(ORTHANC_LOOKUP_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('Orthanc REST lookup timed out');
    }
    throw new Error('Orthanc REST lookup failed (upstream unreachable)');
  }
  if (res.status >= 300 && res.status < 400) {
    throw new Error(
      'Orthanc REST server returned a redirect; cross-host redirects are disabled',
    );
  }
  if (!res.ok) {
    throw new Error(`Orthanc REST lookup failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as {
    MainDicomTags?: { StudyInstanceUID?: string };
  };
  const uid = data.MainDicomTags?.StudyInstanceUID;
  if (!uid) {
    throw new Error(
      'Orthanc REST response is missing MainDicomTags.StudyInstanceUID',
    );
  }
  return uid;
}

/**
 * Derive the DICOMweb base URL from an Orthanc mount point. Orthanc's
 * DICOMweb plugin conventionally mounts at `/dicom-web` under the same base.
 */
export function orthancDicomWebBase(restBase: string): string {
  return `${restBase.replace(/\/+$/, '')}/dicom-web`;
}

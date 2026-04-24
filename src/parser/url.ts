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

  // Reject IP-literal hosts (including localhost) to avoid proxy-style tricks.
  if (isIpLiteralHost(url.hostname)) {
    return {
      kind: 'reject',
      code: 'REJECTED_HOST',
      message: 'IP-literal and localhost hosts are not accepted in v1',
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

export function isIpLiteralHost(hostname: string): boolean {
  // IPv4 literal
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  // IPv6 literal (URL parsing keeps square brackets stripped from hostname)
  if (/^[0-9a-f:]+$/i.test(hostname) && hostname.includes(':')) return true;
  // localhost (security - could be a local proxy)
  if (hostname.toLowerCase() === 'localhost') return true;
  return false;
}

export function looksAuthenticated(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  if (path.includes('/auth/')) return true;
  if (url.searchParams.has('token')) return true;
  if (url.searchParams.has('access_token')) return true;
  if (url.searchParams.has('authorization')) return true;
  if (url.username || url.password) return true; // http://user:pass@host
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
export async function resolveOrthancId(
  restBase: string,
  orthancId: string,
): Promise<string> {
  const base = restBase.replace(/\/+$/, '');
  const restUrl = `${base}/studies/${orthancId}`;
  const res = await fetch(restUrl, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(
      `Orthanc REST lookup failed: ${res.status} ${res.statusText} (${restUrl})`,
    );
  }
  const data = (await res.json()) as {
    MainDicomTags?: { StudyInstanceUID?: string };
  };
  const uid = data.MainDicomTags?.StudyInstanceUID;
  if (!uid) {
    throw new Error(
      `Orthanc REST response at ${restUrl} is missing MainDicomTags.StudyInstanceUID`,
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

import { describe, expect, test } from 'vitest';
import {
  isBareStudyInstanceUID,
  isIpLiteralHost,
  isOrthancId,
  looksAuthenticated,
  orthancDicomWebBase,
  parseReferenceShape,
  resolveOrthancId,
} from '../src/parser/url.js';

describe('parseReferenceShape - bare StudyInstanceUID', () => {
  test('accepts a typical DICOM OID (>=3 components)', () => {
    const uid = '1.2.840.113619.2.5.1762583153.215519.978957063.78';
    expect(parseReferenceShape(uid)).toEqual({ kind: 'bare_uid', studyUid: uid });
  });

  test('accepts Orthanc demo server canonical UIDs from probe C', () => {
    const uid = '2.16.840.1.113669.632.20.1211.10000315526';
    expect(parseReferenceShape(uid)).toEqual({ kind: 'bare_uid', studyUid: uid });
  });

  test('rejects a 2-component "OID" (too short to be a real StudyInstanceUID)', () => {
    const parsed = parseReferenceShape('1.2');
    expect(parsed.kind).toBe('reject');
  });

  test('trims whitespace', () => {
    const parsed = parseReferenceShape('  1.2.3.4  ');
    expect(parsed).toEqual({ kind: 'bare_uid', studyUid: '1.2.3.4' });
  });
});

describe('parseReferenceShape - DICOMweb study URL', () => {
  test('extracts StudyInstanceUID from a /dicom-web/studies URL', () => {
    const parsed = parseReferenceShape(
      'https://orthanc.uclouvain.be/demo/dicom-web/studies/1.2.840.113619.2.5.1762583153',
    );
    expect(parsed).toEqual({
      kind: 'dicomweb_study',
      host: 'https://orthanc.uclouvain.be',
      dicomwebBase: '/demo/dicom-web',
      studyUid: '1.2.840.113619.2.5.1762583153',
    });
  });

  test('accepts /dicomweb/ (no hyphen) variants', () => {
    const parsed = parseReferenceShape(
      'https://example.com/dicomweb/studies/1.2.3.4',
    );
    expect(parsed.kind).toBe('dicomweb_study');
  });

  test('accepts /wado-rs/ variants', () => {
    const parsed = parseReferenceShape(
      'https://example.com/wado-rs/studies/1.2.3.4',
    );
    expect(parsed.kind).toBe('dicomweb_study');
  });

  test('preserves trailing path segments without letting them leak into the UID', () => {
    const parsed = parseReferenceShape(
      'https://example.com/dicom-web/studies/1.2.3.4/series',
    );
    expect(parsed.kind).toBe('dicomweb_study');
    if (parsed.kind === 'dicomweb_study') {
      expect(parsed.studyUid).toBe('1.2.3.4');
    }
  });
});

describe('parseReferenceShape - Orthanc UI URL', () => {
  test('extracts orthanc id + mount prefix on a sub-path mount (demo)', () => {
    const parsed = parseReferenceShape(
      'https://orthanc.uclouvain.be/demo/ui/app/#/studies/4d52b9c7-ff3aa9c0-e9ffef79-5ef2ec49-7a72eefc',
    );
    expect(parsed).toEqual({
      kind: 'orthanc_ui',
      host: 'https://orthanc.uclouvain.be',
      restBase: 'https://orthanc.uclouvain.be/demo',
      orthancId: '4d52b9c7-ff3aa9c0-e9ffef79-5ef2ec49-7a72eefc',
    });
  });

  test('extracts orthanc id when mounted at root /ui/', () => {
    const parsed = parseReferenceShape(
      'https://example.org/ui/app/#/studies/4d52b9c7-ff3aa9c0-e9ffef79-5ef2ec49-7a72eefc',
    );
    expect(parsed).toEqual({
      kind: 'orthanc_ui',
      host: 'https://example.org',
      restBase: 'https://example.org',
      orthancId: '4d52b9c7-ff3aa9c0-e9ffef79-5ef2ec49-7a72eefc',
    });
  });

  test('orthanc id is case-normalised to lowercase', () => {
    const parsed = parseReferenceShape(
      'https://example.org/ui/app/#/studies/4D52B9C7-FF3AA9C0-E9FFEF79-5EF2EC49-7A72EEFC',
    );
    if (parsed.kind === 'orthanc_ui') {
      expect(parsed.orthancId).toBe('4d52b9c7-ff3aa9c0-e9ffef79-5ef2ec49-7a72eefc');
    } else {
      throw new Error('expected orthanc_ui');
    }
  });
});

describe('parseReferenceShape - Orthanc REST URL', () => {
  test('extracts orthanc id from /studies/<id>', () => {
    const parsed = parseReferenceShape(
      'https://example.org/studies/4d52b9c7-ff3aa9c0-e9ffef79-5ef2ec49-7a72eefc',
    );
    expect(parsed).toEqual({
      kind: 'orthanc_rest',
      host: 'https://example.org',
      restBase: 'https://example.org',
      orthancId: '4d52b9c7-ff3aa9c0-e9ffef79-5ef2ec49-7a72eefc',
    });
  });

  test('extracts orthanc id from sub-path mount (demo)', () => {
    const parsed = parseReferenceShape(
      'https://orthanc.uclouvain.be/demo/studies/4d52b9c7-ff3aa9c0-e9ffef79-5ef2ec49-7a72eefc',
    );
    expect(parsed).toEqual({
      kind: 'orthanc_rest',
      host: 'https://orthanc.uclouvain.be',
      restBase: 'https://orthanc.uclouvain.be/demo',
      orthancId: '4d52b9c7-ff3aa9c0-e9ffef79-5ef2ec49-7a72eefc',
    });
  });

  test('accepts trailing slash', () => {
    const parsed = parseReferenceShape(
      'https://example.org/studies/4d52b9c7-ff3aa9c0-e9ffef79-5ef2ec49-7a72eefc/',
    );
    expect(parsed.kind).toBe('orthanc_rest');
  });

  test('does not mis-classify /studies/<StudyInstanceUID>', () => {
    // A DICOM StudyInstanceUID (dotted OID) should NOT be picked up by the
    // Orthanc REST matcher (which requires 5x8 hex dash-separated).
    const parsed = parseReferenceShape(
      'https://example.org/studies/1.2.840.113619.2.5.1762583153',
    );
    expect(parsed.kind).not.toBe('orthanc_rest');
  });
});

describe('parseReferenceShape - OHIF share URL', () => {
  test('extracts StudyInstanceUIDs query param', () => {
    const parsed = parseReferenceShape(
      'https://viewer.example.com/viewer?StudyInstanceUIDs=1.2.3.4',
    );
    expect(parsed).toEqual({
      kind: 'ohif_share',
      host: 'https://viewer.example.com',
      studyUid: '1.2.3.4',
    });
  });

  test('works with additional query params', () => {
    const parsed = parseReferenceShape(
      'https://viewer.example.com/viewer?StudyInstanceUIDs=1.2.3.4&url=https%3A%2F%2Fdwh.example.com%2Fdicom-web',
    );
    expect(parsed.kind).toBe('ohif_share');
  });
});

describe('parseReferenceShape - rejections', () => {
  test('rejects empty input with suggestions', () => {
    const parsed = parseReferenceShape('');
    expect(parsed.kind).toBe('reject');
    if (parsed.kind === 'reject') {
      expect(parsed.suggestions).toBeDefined();
      expect(parsed.suggestions!.length).toBeGreaterThan(0);
    }
  });

  test('rejects file:// scheme', () => {
    const parsed = parseReferenceShape('file:///etc/passwd');
    expect(parsed.kind).toBe('reject');
    if (parsed.kind === 'reject') {
      expect(parsed.code).toBe('REJECTED_SCHEME');
    }
  });

  test('rejects data: scheme', () => {
    const parsed = parseReferenceShape('data:text/html,<h1>');
    expect(parsed.kind).toBe('reject');
  });

  test('rejects URL with ?token=', () => {
    const parsed = parseReferenceShape(
      'https://example.com/dicom-web/studies/1.2.3.4?token=abc',
    );
    expect(parsed.kind).toBe('reject');
    if (parsed.kind === 'reject') {
      expect(parsed.code).toBe('AUTHENTICATED');
    }
  });

  test('rejects URL with ?access_token=', () => {
    const parsed = parseReferenceShape(
      'https://example.com/dicom-web/studies/1.2.3.4?access_token=abc',
    );
    expect(parsed.kind).toBe('reject');
    if (parsed.kind === 'reject') {
      expect(parsed.code).toBe('AUTHENTICATED');
    }
  });

  test('rejects URL containing /auth/', () => {
    const parsed = parseReferenceShape(
      'https://example.com/auth/dicom-web/studies/1.2.3.4',
    );
    expect(parsed.kind).toBe('reject');
    if (parsed.kind === 'reject') {
      expect(parsed.code).toBe('AUTHENTICATED');
    }
  });

  test('rejects URL with user:password@', () => {
    const parsed = parseReferenceShape(
      'https://bob:secret@example.com/dicom-web/studies/1.2.3.4',
    );
    expect(parsed.kind).toBe('reject');
    if (parsed.kind === 'reject') {
      expect(parsed.code).toBe('AUTHENTICATED');
    }
  });

  test('rejects IP-literal host', () => {
    const parsed = parseReferenceShape(
      'https://192.168.1.1/dicom-web/studies/1.2.3.4',
    );
    expect(parsed.kind).toBe('reject');
    if (parsed.kind === 'reject') {
      expect(parsed.code).toBe('REJECTED_HOST');
    }
  });

  test('rejects localhost', () => {
    const parsed = parseReferenceShape(
      'https://localhost/dicom-web/studies/1.2.3.4',
    );
    expect(parsed.kind).toBe('reject');
  });

  test('rejects unrecognized URL shape on a valid host', () => {
    const parsed = parseReferenceShape('https://example.com/random/path');
    expect(parsed.kind).toBe('reject');
    if (parsed.kind === 'reject') {
      expect(parsed.code).toBe('UNPARSEABLE');
      expect(parsed.suggestions).toBeDefined();
    }
  });
});

describe('predicates', () => {
  test('isBareStudyInstanceUID', () => {
    expect(isBareStudyInstanceUID('1.2.840.113619')).toBe(true);
    expect(isBareStudyInstanceUID('1.2')).toBe(false);
    expect(isBareStudyInstanceUID('abc.def')).toBe(false);
  });

  test('isOrthancId', () => {
    expect(
      isOrthancId('4d52b9c7-ff3aa9c0-e9ffef79-5ef2ec49-7a72eefc'),
    ).toBe(true);
    expect(isOrthancId('1.2.840.113619')).toBe(false);
    expect(isOrthancId('hello-world')).toBe(false);
  });

  test('isIpLiteralHost', () => {
    expect(isIpLiteralHost('192.168.1.1')).toBe(true);
    expect(isIpLiteralHost('10.0.0.1')).toBe(true);
    expect(isIpLiteralHost('localhost')).toBe(true);
    expect(isIpLiteralHost('example.com')).toBe(false);
  });

  test('looksAuthenticated', () => {
    expect(looksAuthenticated(new URL('https://x.com/auth/studies/1.2.3'))).toBe(true);
    expect(looksAuthenticated(new URL('https://x.com/studies/1.2.3?token=a'))).toBe(true);
    expect(looksAuthenticated(new URL('https://x.com/studies/1.2.3'))).toBe(false);
  });

  test('orthancDicomWebBase constructs the canonical DICOMweb path', () => {
    expect(orthancDicomWebBase('https://x.com')).toBe('https://x.com/dicom-web');
    expect(orthancDicomWebBase('https://x.com/')).toBe('https://x.com/dicom-web');
  });
});

describe('resolveOrthancId (live integration)', () => {
  test('resolves a real Orthanc REST orthanc-id to its StudyInstanceUID', async () => {
    // Fetch a study list first to pick a real orthanc-id.
    const res = await fetch('https://orthanc.uclouvain.be/demo/studies');
    const orthancIds = (await res.json()) as string[];
    expect(orthancIds.length).toBeGreaterThan(0);
    const firstId = orthancIds[0];

    const studyUid = await resolveOrthancId(
      'https://orthanc.uclouvain.be/demo',
      firstId,
    );
    expect(studyUid).toMatch(/^[0-9]+(?:\.[0-9]+)+$/);
  }, 15_000);

  test('throws on a non-existent orthanc-id', async () => {
    await expect(
      resolveOrthancId(
        'https://orthanc.uclouvain.be/demo',
        '00000000-00000000-00000000-00000000-00000000',
      ),
    ).rejects.toThrow();
  }, 15_000);
});

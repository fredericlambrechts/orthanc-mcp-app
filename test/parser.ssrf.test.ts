/**
 * SSRF-hardening regression tests for the URL parser.
 *
 * Every case here was an accepted-URL bypass in the original implementation.
 * Each must now route to a `reject` with code REJECTED_HOST or AUTHENTICATED.
 */
import { describe, expect, test } from 'vitest';
import {
  isIpLiteralHost,
  isPrivateIpv4,
  looksAuthenticated,
  parseReferenceShape,
} from '../src/parser/url.js';

describe('isIpLiteralHost - IPv6 bracketed literals and beyond', () => {
  test('rejects bracketed IPv6 loopback [::1]', () => {
    expect(isIpLiteralHost('[::1]')).toBe(true);
  });

  test('rejects bracketed IPv6 link-local [fe80::1]', () => {
    expect(isIpLiteralHost('[fe80::1]')).toBe(true);
  });

  test('rejects bracketed IPv4-mapped IPv6 [::ffff:127.0.0.1]', () => {
    expect(isIpLiteralHost('[::ffff:127.0.0.1]')).toBe(true);
  });

  test('rejects unbracketed IPv6 (defensive)', () => {
    expect(isIpLiteralHost('::1')).toBe(true);
    expect(isIpLiteralHost('fe80::1')).toBe(true);
  });

  test('rejects decimal IPv4 literal (2130706433 = 127.0.0.1)', () => {
    expect(isIpLiteralHost('2130706433')).toBe(true);
  });

  test('rejects hex IPv4 literal', () => {
    expect(isIpLiteralHost('0x7f000001')).toBe(true);
  });

  test('rejects cloud-metadata hostnames', () => {
    expect(isIpLiteralHost('metadata.google.internal')).toBe(true);
    expect(isIpLiteralHost('metadata.goog')).toBe(true);
    expect(isIpLiteralHost('metadata')).toBe(true);
    expect(isIpLiteralHost('instance-data')).toBe(true);
  });

  test('rejects kubernetes service aliases', () => {
    expect(isIpLiteralHost('kubernetes')).toBe(true);
    expect(isIpLiteralHost('kubernetes.default.svc')).toBe(true);
  });

  test('rejects .internal, .local, .cluster.local suffix hostnames', () => {
    expect(isIpLiteralHost('my-service.internal')).toBe(true);
    expect(isIpLiteralHost('printer.local')).toBe(true);
    expect(isIpLiteralHost('pacs.cluster.local')).toBe(true);
    expect(isIpLiteralHost('thing.svc.cluster.local')).toBe(true);
  });

  test('still accepts legitimate public hostnames', () => {
    expect(isIpLiteralHost('orthanc.uclouvain.be')).toBe(false);
    expect(isIpLiteralHost('example.com')).toBe(false);
    expect(isIpLiteralHost('dicom.example.co.uk')).toBe(false);
  });
});

describe('isPrivateIpv4 - private-range and metadata IPs', () => {
  test('rejects AWS/GCP metadata 169.254.169.254', () => {
    expect(isPrivateIpv4('169.254.169.254')).toBe(true);
  });

  test('rejects the link-local /16', () => {
    expect(isPrivateIpv4('169.254.0.1')).toBe(true);
    expect(isPrivateIpv4('169.254.255.255')).toBe(true);
  });

  test('rejects 127.0.0.0/8 loopback', () => {
    expect(isPrivateIpv4('127.0.0.1')).toBe(true);
    expect(isPrivateIpv4('127.1.2.3')).toBe(true);
  });

  test('rejects RFC1918 (10/8, 172.16/12, 192.168/16)', () => {
    expect(isPrivateIpv4('10.0.0.1')).toBe(true);
    expect(isPrivateIpv4('10.255.255.255')).toBe(true);
    expect(isPrivateIpv4('172.16.0.1')).toBe(true);
    expect(isPrivateIpv4('172.31.255.255')).toBe(true);
    expect(isPrivateIpv4('172.15.0.1')).toBe(false); // below range
    expect(isPrivateIpv4('172.32.0.1')).toBe(false); // above range
    expect(isPrivateIpv4('192.168.0.1')).toBe(true);
  });

  test('rejects 0.0.0.0/8', () => {
    expect(isPrivateIpv4('0.0.0.0')).toBe(true);
    expect(isPrivateIpv4('0.1.2.3')).toBe(true);
  });

  test('rejects CGNAT 100.64.0.0/10', () => {
    expect(isPrivateIpv4('100.64.0.1')).toBe(true);
    expect(isPrivateIpv4('100.127.255.255')).toBe(true);
    expect(isPrivateIpv4('100.63.0.1')).toBe(false);
    expect(isPrivateIpv4('100.128.0.1')).toBe(false);
  });

  test('allows public unicast', () => {
    expect(isPrivateIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateIpv4('1.1.1.1')).toBe(false);
    expect(isPrivateIpv4('130.104.1.1')).toBe(false); // uclouvain-ish
  });
});

describe('parseReferenceShape - SSRF rejections end-to-end', () => {
  const rejectCases = [
    ['https://[::1]/dicom-web/studies/1.2.3.4', 'IPv6 loopback'],
    ['https://[::ffff:127.0.0.1]/studies/abc', 'IPv4-mapped IPv6 loopback'],
    ['https://169.254.169.254/latest/meta-data', 'AWS metadata IP'],
    ['https://metadata.google.internal/studies/x', 'GCP metadata hostname'],
    ['https://10.0.0.1/dicom-web/studies/1.2.3.4', 'RFC1918 10/8'],
    ['https://192.168.1.5/studies/abc', 'RFC1918 192.168/16'],
    ['https://172.16.0.1/dicom-web/studies/1.2.3.4', 'RFC1918 172.16/12'],
    ['https://127.0.0.1/dicom-web/studies/1.2.3.4', 'IPv4 loopback'],
    ['https://0.0.0.0/dicom-web/studies/1.2.3.4', '0.0.0.0'],
    ['https://2130706433/dicom-web/studies/1.2.3.4', 'decimal IPv4 127.0.0.1'],
    ['https://pacs.cluster.local/studies/x', 'k8s cluster.local'],
    ['https://printer.local/studies/x', 'mDNS .local'],
  ] as const;

  for (const [input, label] of rejectCases) {
    test(`rejects ${label}: ${input}`, () => {
      const parsed = parseReferenceShape(input);
      expect(parsed.kind).toBe('reject');
      if (parsed.kind === 'reject') {
        expect(parsed.code).toBe('REJECTED_HOST');
      }
    });
  }
});

describe('looksAuthenticated - case and fragment coverage', () => {
  test('rejects uppercase TOKEN param', () => {
    expect(looksAuthenticated(new URL('https://x.com/?TOKEN=abc'))).toBe(true);
  });

  test('rejects mixed-case Access_Token', () => {
    expect(looksAuthenticated(new URL('https://x.com/?Access_Token=abc'))).toBe(true);
  });

  test('rejects ?API_KEY=', () => {
    expect(looksAuthenticated(new URL('https://x.com/?API_KEY=abc'))).toBe(true);
  });

  test('rejects ?JWT=', () => {
    expect(looksAuthenticated(new URL('https://x.com/?JWT=eyJhbGc...'))).toBe(true);
  });

  test('rejects ?signature= (signed-URL style)', () => {
    expect(looksAuthenticated(new URL('https://x.com/?signature=abc'))).toBe(true);
  });

  test('rejects /auth/ in fragment', () => {
    expect(
      looksAuthenticated(new URL('https://x.com/foo#/auth/callback')),
    ).toBe(true);
  });

  test('rejects encoded /auth/ in path (%2fauth%2f)', () => {
    expect(
      looksAuthenticated(new URL('https://x.com/%2Fauth%2Fstuff')),
    ).toBe(true);
  });

  test('still accepts clean URLs', () => {
    expect(looksAuthenticated(new URL('https://x.com/dicom-web/studies/1.2.3'))).toBe(false);
    expect(looksAuthenticated(new URL('https://x.com/?limit=10&modality=CT'))).toBe(false);
  });
});

describe('parseReferenceShape - auth rejections (case + fragment)', () => {
  const authCases = [
    'https://example.com/dicom-web/studies/1.2.3.4?TOKEN=abc',
    'https://example.com/dicom-web/studies/1.2.3.4?Access_Token=abc',
    'https://example.com/dicom-web/studies/1.2.3.4?API_KEY=abc',
    'https://example.com/dicom-web/studies/1.2.3.4#/auth/next',
    'https://bob:secret@example.com/dicom-web/studies/1.2.3.4',
  ];
  for (const input of authCases) {
    test(`rejects ${input}`, () => {
      const parsed = parseReferenceShape(input);
      expect(parsed.kind).toBe('reject');
      if (parsed.kind === 'reject') {
        expect(parsed.code).toBe('AUTHENTICATED');
      }
    });
  }
});

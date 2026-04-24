/**
 * DICOM → PNG renderer used by the `/render/:study/:series/:instance/:frame.png`
 * endpoint. The widget is a thin `<img>`-per-slice viewer; all DICOM decoding
 * happens here so the widget bundle stays tiny.
 *
 * Supported transfer syntaxes (what the Orthanc demo BRAINIX / CT / MR
 * studies actually use): Implicit VR Little Endian, Explicit VR Little Endian.
 * Compressed syntaxes (JPEG2000, JPEG-LS, RLE) are NOT decoded here — the
 * response is 415 Unsupported Media Type for those. Expanding coverage is a
 * follow-up if we add studies that need it.
 */
import dicomParser, { type DataSet } from 'dicom-parser';
import { PNG } from 'pngjs';

const SUPPORTED_TRANSFER_SYNTAXES = new Set([
  '1.2.840.10008.1.2', // Implicit VR Little Endian
  '1.2.840.10008.1.2.1', // Explicit VR Little Endian
]);

export type RenderOptions = {
  // Optional override of the DICOM-declared window center/width.
  windowCenter?: number;
  windowWidth?: number;
  // If true, apply VOI LUT as linear (WC/WW). Default true.
  applyVoiLut?: boolean;
  // Max edge in pixels; keeps PNGs small for the widget. Default 640.
  maxEdge?: number;
};

export type RenderResult = {
  png: Buffer;
  width: number;
  height: number;
  transferSyntax: string;
  windowCenter: number;
  windowWidth: number;
};

export class UnsupportedTransferSyntax extends Error {
  code = 'UNSUPPORTED_TRANSFER_SYNTAX';
  constructor(public tsuid: string) {
    super(`Unsupported transfer syntax: ${tsuid}`);
  }
}

/**
 * Parse a DICOM bytestream (file or WADO-RS payload) and render the frame
 * as PNG bytes. WADO-RS multipart responses must be de-enveloped before
 * calling this — pass the raw Part-1 (Basic File + dataset) bytes.
 */
export function renderDicomToPng(
  dicomBytes: Uint8Array,
  options: RenderOptions = {},
): RenderResult {
  const ds: DataSet = dicomParser.parseDicom(dicomBytes);

  const tsuid = ds.string('x00020010') ?? '1.2.840.10008.1.2';
  if (!SUPPORTED_TRANSFER_SYNTAXES.has(tsuid)) {
    throw new UnsupportedTransferSyntax(tsuid);
  }

  const rows = ds.uint16('x00280010') ?? 0;
  const cols = ds.uint16('x00280011') ?? 0;
  const bitsAllocated = ds.uint16('x00280100') ?? 8;
  const pixelRepresentation = ds.uint16('x00280103') ?? 0; // 1 = signed
  const samplesPerPixel = ds.uint16('x00280002') ?? 1;
  const photometric = ds.string('x00280004') ?? 'MONOCHROME2';

  if (rows === 0 || cols === 0) {
    throw new Error('Missing rows/columns');
  }
  if (samplesPerPixel !== 1) {
    throw new Error(`samplesPerPixel=${samplesPerPixel} not supported`);
  }

  const pixelDataElement = ds.elements.x7fe00010;
  if (!pixelDataElement) throw new Error('No PixelData element');

  const rescaleSlope = ds.floatString('x00281053') ?? 1;
  const rescaleIntercept = ds.floatString('x00281052') ?? 0;

  // Window center/width can be multi-valued; use the first entry.
  const wc =
    options.windowCenter ??
    (ds.floatString('x00281050', 0) as number | undefined);
  const ww =
    options.windowWidth ??
    (ds.floatString('x00281051', 0) as number | undefined);

  const pixelCount = rows * cols;
  const buf = ds.byteArray;
  const start = pixelDataElement.dataOffset;

  // Collect pixel values as integers, in modality-corrected (rescaled) space.
  const values = new Float32Array(pixelCount);
  if (bitsAllocated === 16) {
    const dv = new DataView(buf.buffer, buf.byteOffset + start, pixelCount * 2);
    for (let i = 0; i < pixelCount; i++) {
      const raw =
        pixelRepresentation === 1 ? dv.getInt16(i * 2, true) : dv.getUint16(i * 2, true);
      values[i] = raw * rescaleSlope + rescaleIntercept;
    }
  } else if (bitsAllocated === 8) {
    for (let i = 0; i < pixelCount; i++) {
      const raw = pixelRepresentation === 1 ? (buf[start + i] << 24) >> 24 : buf[start + i];
      values[i] = raw * rescaleSlope + rescaleIntercept;
    }
  } else {
    throw new Error(`bitsAllocated=${bitsAllocated} not supported`);
  }

  // Resolve window/level: if the DICOM doesn't carry one, derive from min/max.
  let resolvedWc = wc;
  let resolvedWw = ww;
  if (!resolvedWc || !resolvedWw || resolvedWw <= 0) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < pixelCount; i++) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    resolvedWw = Math.max(1, max - min);
    resolvedWc = (max + min) / 2;
  }

  // Linear VOI LUT. For MONOCHROME1, invert after windowing.
  const wwHalf = (resolvedWw ?? 1) / 2;
  const wcVal = resolvedWc ?? 0;
  const lo = wcVal - wwHalf;
  const hi = wcVal + wwHalf;
  const invert = photometric === 'MONOCHROME1';

  // Downscale if the edge exceeds maxEdge. Nearest-neighbour is fine for a
  // preview; it keeps the PNG small and the code simple. PNG dimensions are
  // (dstCols, dstRows).
  const maxEdge = options.maxEdge ?? 640;
  const scale = Math.min(1, maxEdge / Math.max(rows, cols));
  const dstCols = Math.max(1, Math.round(cols * scale));
  const dstRows = Math.max(1, Math.round(rows * scale));

  const png = new PNG({ width: dstCols, height: dstRows, colorType: 0 });
  const invScaleX = cols / dstCols;
  const invScaleY = rows / dstRows;

  for (let y = 0; y < dstRows; y++) {
    const srcY = Math.min(rows - 1, Math.floor(y * invScaleY));
    for (let x = 0; x < dstCols; x++) {
      const srcX = Math.min(cols - 1, Math.floor(x * invScaleX));
      const v = values[srcY * cols + srcX];
      let g: number;
      if (v <= lo) g = 0;
      else if (v >= hi) g = 255;
      else g = Math.round(((v - lo) / (resolvedWw ?? 1)) * 255);
      if (invert) g = 255 - g;
      const dstIdx = (y * dstCols + x) * 4;
      png.data[dstIdx] = g;
      png.data[dstIdx + 1] = g;
      png.data[dstIdx + 2] = g;
      png.data[dstIdx + 3] = 255;
    }
  }

  const pngBuf = PNG.sync.write(png);
  return {
    png: pngBuf,
    width: dstCols,
    height: dstRows,
    transferSyntax: tsuid,
    windowCenter: wcVal,
    windowWidth: resolvedWw ?? 1,
  };
}

/**
 * Pull the DICOM bytes for one instance from a DICOMweb server. WADO-RS
 * returns `multipart/related` with one part carrying `application/dicom`
 * bytes; we de-envelope to a single Uint8Array.
 *
 * `dicomwebBase` is the root (e.g. https://host/dicom-web) — we append the
 * `/studies/.../series/.../instances/...` path ourselves.
 */
export async function fetchInstanceBytes(
  dicomwebBase: string,
  studyUid: string,
  seriesUid: string,
  instanceUid: string,
): Promise<Uint8Array> {
  const url = `${dicomwebBase.replace(/\/+$/, '')}/studies/${encodeURIComponent(
    studyUid,
  )}/series/${encodeURIComponent(seriesUid)}/instances/${encodeURIComponent(instanceUid)}`;
  // Ask for uncompressed Little Endian so we don't have to decompress.
  const res = await fetch(url, {
    headers: {
      Accept:
        'multipart/related; type="application/dicom"; transfer-syntax=1.2.840.10008.1.2.1',
    },
  });
  if (!res.ok) {
    throw new Error(`WADO-RS fetch ${res.status}: ${url}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  const body = new Uint8Array(await res.arrayBuffer());
  // Fast path: if the upstream served a raw DICOM, skip multipart parsing.
  if (contentType.startsWith('application/dicom')) return body;
  return demultipartSingle(body);
}

/**
 * Extract the single-part body of a `multipart/related` WADO-RS response.
 * Assumes one part — the DICOMweb spec allows multiple but for a single
 * instance GET, servers conventionally return one.
 */
function demultipartSingle(bytes: Uint8Array): Uint8Array {
  // Find the first \r\n\r\n — end of headers, start of body.
  const headerEnd = findSeq(bytes, CRLF2);
  if (headerEnd < 0) throw new Error('multipart: no header terminator');
  // Find the boundary terminator (which starts with --) before EOF.
  // Servers use \r\n--<boundary> to separate parts; we just need to cut
  // before the trailing boundary marker which starts with \r\n--.
  const bodyStart = headerEnd + CRLF2.length;
  let bodyEnd = bytes.length;
  const tail = findSeqFrom(bytes, CRLF_DASHDASH, bodyStart);
  if (tail > 0) bodyEnd = tail;
  return bytes.subarray(bodyStart, bodyEnd);
}

const CRLF2 = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]);
const CRLF_DASHDASH = new Uint8Array([0x0d, 0x0a, 0x2d, 0x2d]);

function findSeq(hay: Uint8Array, needle: Uint8Array): number {
  return findSeqFrom(hay, needle, 0);
}
function findSeqFrom(hay: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

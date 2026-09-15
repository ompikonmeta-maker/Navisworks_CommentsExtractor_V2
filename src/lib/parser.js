// =====================================================================
// Navisworks HTML report parser
// ---------------------------------------------------------------------
// A Navisworks "Viewpoints" HTML export is a flat list of
//   <div class="viewpoint">
//     <h2>Viewpoint name</h2>
//     <a href="vpNNNN.jpg"><img src="vpNNNN.jpg"></a>
//     <span class="namevaluepair"><span class="name">Camera Position</span>
//        <span class="value">x, y, z</span></span>
//     <div class="comments">
//       <div class="comment">
//         <h4>Comment 228</h4>
//         <span ...>Status</span><span ...>New</span>
//         <span ...>User</span><span ...>PSS955574</span>
//         <span ...>Text</span><span ...>PIP: ...</span>
//         2024/12/9 04:0:23      (trailing text node = date)
//       </div>
//     </div>
//   </div>
//
// Only viewpoints that actually carry comments become records (per spec:
// "HTML tanpa komentar — jangan membuat record").
// =====================================================================

import { extract, DEFAULT_DETECT } from './detect.js';

export const DISCIPLINES = [
  'PIP',
  'STR',
  'ELE',
  'INS',
  'TEL',
  'HVAC',
  'LOSPE',
  'HANDLING',
  'OTHER',
];

export const STATUSES = ['Open', 'In Review', 'Closed'];

// Navisworks statuses seen in the wild → normalized workspace status.
const STATUS_MAP = {
  new: 'Open',
  active: 'Open',
  approved: 'Closed',
  resolved: 'Closed',
  closed: 'Closed',
  pending: 'In Review',
  'in review': 'In Review',
};

let idCounter = 0;
export function resetIdCounter() {
  idCounter = 0;
}

/** Pull the `.value` text for a given `.name` label inside a container. */
function readNameValue(container, label) {
  const pairs = container.querySelectorAll(':scope > span.namevaluepair');
  for (const pair of pairs) {
    const name = pair.querySelector('span.name');
    const value = pair.querySelector('span.value');
    if (name && value && name.textContent.trim().toLowerCase() === label.toLowerCase()) {
      return value.textContent.replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

/** Collapse Navisworks' multi-line camera coordinate blob into "x, y, z". */
function normalizeCamera(raw) {
  if (!raw) return '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * The comment date is a bare text node trailing the last <span>, e.g.
 * "2024/12/9 04:0:23". Grab the direct text children of the comment div.
 */
function readCommentDate(commentEl) {
  let text = '';
  for (const node of commentEl.childNodes) {
    if (node.nodeType === 3 /* text */) text += node.textContent;
  }
  return text.replace(/\s+/g, ' ').trim();
}

// Commenter and discipline are both extracted by the shared, user-configurable
// engine (lib/detect.js). These thin wrappers apply the built-in default
// configs at import time; the Settings "Detection" editor can re-apply custom
// rules across records later.

/** Detect the commenter (person who wrote the comment) from the text. */
export function detectCommenter(text) {
  return extract(text, DEFAULT_DETECT.commenter).val;
}

/** Infer a coordination discipline from the comment text. */
export function inferDiscipline(text) {
  return extract(text, DEFAULT_DETECT.discipline, DISCIPLINES).val || 'OTHER';
}

/** Clean the comment body — strip the leading commenter prefix if present,
 *  else keep the original text unchanged. */
export function cleanComment(text) {
  return extract(text, DEFAULT_DETECT.comment).val || (text || '').trim();
}

/** Normalize a raw Navisworks status string to a workspace status. */
export function normalizeStatus(raw) {
  if (!raw) return 'Open';
  const key = raw.trim().toLowerCase();
  return STATUS_MAP[key] || (STATUSES.includes(raw.trim()) ? raw.trim() : 'Open');
}

/**
 * Parse a single HTML report document into normalized comment records.
 * @param {string} htmlString raw report HTML
 * @param {string} sourceName file name for provenance
 * @returns {{records: object[], viewpointCount: number, htmlName: string}}
 */
export function parseReportHtml(htmlString, sourceName = 'report.html') {
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  const viewpoints = doc.querySelectorAll('div.viewpoint');
  const records = [];

  viewpoints.forEach((vp) => {
    const commentsWrap = vp.querySelector(':scope > div.comments');
    if (!commentsWrap) return; // no comments → no record

    const name = vp.querySelector(':scope > h2')?.textContent.trim() || 'Untitled viewpoint';
    const imgEl = vp.querySelector(':scope > a > img, :scope > img');
    const imageRef = imgEl ? decodeURIComponent(imgEl.getAttribute('src') || '').split('/').pop() : '';
    const camera = normalizeCamera(readNameValue(vp, 'Camera Position'));

    const comments = commentsWrap.querySelectorAll(':scope > div.comment');
    comments.forEach((c) => {
      const commentId = c.querySelector(':scope > h4')?.textContent.replace(/comment/i, '').trim() || '';
      const rawStatus = readNameValue(c, 'Status');
      const authorCode = readNameValue(c, 'User');
      const rawText = readNameValue(c, 'Text');
      if (!rawText) return; // spec: viewpoint text is required

      records.push({
        ID: ++idCounter,
        commentId,
        viewpoint: name,
        discipline: inferDiscipline(rawText),
        commenter: detectCommenter(rawText), // person who wrote it (from text)
        // Raw source text (keeps the "Name:" prefix) — kept so commenter /
        // discipline / comment detection can be re-run; not shown/exported.
        commentRaw: rawText,
        // Cleaned comment body (prefix stripped) — the value shown & exported.
        commentText: cleanComment(rawText),
        resolution: '',
        status: normalizeStatus(rawStatus),
        rawStatus: rawStatus || 'New',
        // Close-out timestamp (ISO). The source has no close date, so this is
        // null on import and stamped when the comment is set to Closed here.
        closedAt: null,
        commentDate: readCommentDate(c),
        authorCode,
        cameraPosition: camera,
        imageRef,
        imageData: '', // "before" image, linked later from companion images
        afterImageData: '', // "after" photo, uploaded in the detail drawer
        // Free-form extra attributes for template export (evidence, applicability,
        // actionBy, remarks, …). Keyed by attribute id; edited in the drawer.
        extra: {},
        source: sourceName,
      });
    });
  });

  return { records, viewpointCount: viewpoints.length, htmlName: sourceName };
}

/**
 * Link imageRef → imageData (data URL) across records, case-insensitively.
 * @param {object[]} records
 * @param {Record<string,string>} imagesByName map of lowercased name → dataURL
 * @returns {number} count of records that received an image
 */
export function linkImages(records, imagesByName) {
  let linked = 0;
  for (const r of records) {
    if (!r.imageRef) continue;
    const key = r.imageRef.toLowerCase();
    if (imagesByName[key]) {
      r.imageData = imagesByName[key];
      linked += 1;
    }
  }
  return linked;
}

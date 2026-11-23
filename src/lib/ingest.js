// =====================================================================
// File ingestion — turns a user's file selection (loose HTML + images, or
// a ZIP package) into normalized records with linked image data.
// Runs entirely in the browser; nothing is uploaded.
// =====================================================================
import JSZip from 'jszip';
import { parseReportHtml, linkImages, resetIdCounter } from './parser.js';

const IMAGE_RE = /\.(jpe?g|png)$/i;
const HTML_RE = /\.(html?)$/i;
const ZIP_RE = /\.zip$/i;

function readAsText(file) {
  return file.text();
}
function readAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/**
 * @param {File[]} files
 * @param {(p: {step: string, done: number, total: number}) => void} [onProgress]
 * @returns {Promise<{records:object[], stats:{html:number, comments:number, images:number, linked:number}, errors:string[]}>}
 */
export async function ingestFiles(files, onProgress = () => {}) {
  const errors = [];
  const htmlDocs = []; // { name, text }
  const imagesByName = {}; // lowercased basename -> dataURL

  let done = 0;
  onProgress({ step: 'Reading files', done, total: files.length });
  for (const file of files) {
    onProgress({ step: `Reading ${file.name}`, done, total: files.length });
    try {
      if (ZIP_RE.test(file.name)) {
        await ingestZip(file, htmlDocs, imagesByName, errors);
      } else if (HTML_RE.test(file.name)) {
        htmlDocs.push({ name: file.name, text: await readAsText(file) });
      } else if (IMAGE_RE.test(file.name)) {
        imagesByName[file.name.toLowerCase()] = await readAsDataURL(file);
      }
      // unsupported formats are silently ignored per spec
    } catch (e) {
      errors.push(`Couldn’t read ${file.name}: ${e.message}`);
    }
    done += 1;
    onProgress({ step: 'Reading files', done, total: files.length });
  }
  onProgress({ step: 'Reading the comments', done: files.length, total: files.length });

  if (htmlDocs.length === 0) {
    return {
      records: [],
      stats: { html: 0, comments: 0, images: Object.keys(imagesByName).length, linked: 0 },
      errors: [...errors, 'No HTML report file selected.'],
    };
  }

  resetIdCounter();
  let records = [];
  for (const d of htmlDocs) {
    try {
      const { records: recs } = parseReportHtml(d.text, d.name);
      records = records.concat(recs);
    } catch (e) {
      errors.push(`Couldn’t parse ${d.name}: ${e.message}`);
    }
  }

  const linked = linkImages(records, imagesByName);

  return {
    records,
    stats: {
      html: htmlDocs.length,
      comments: records.length,
      images: Object.keys(imagesByName).length,
      linked,
    },
    errors,
  };
}

async function ingestZip(file, htmlDocs, imagesByName, errors) {
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e) {
    errors.push(`${file.name} could not be read (corrupt ZIP).`);
    return;
  }
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  for (const entry of entries) {
    const base = entry.name.split('/').pop();
    try {
      if (HTML_RE.test(base)) {
        htmlDocs.push({ name: base, text: await entry.async('string') });
      } else if (IMAGE_RE.test(base)) {
        const blob = await entry.async('blob');
        imagesByName[base.toLowerCase()] = await readAsDataURL(blob);
      }
    } catch (e) {
      errors.push(`Couldn’t read ${base} from ${file.name}: ${e.message}`);
    }
  }
}

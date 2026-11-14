// Photos for the Excel exports. Exports embed photos from data URLs; server
// records point at /api/files/… instead, so those are fetched and inlined.
// Records that already carry data URLs (offline) pass through untouched.
export async function inlineImages(records) {
  const blobToDataURL = (blob) =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  const fetchAsDataURL = async (url) => {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      return res.ok ? await blobToDataURL(await res.blob()) : '';
    } catch {
      return '';
    }
  };
  const isRemote = (v) => typeof v === 'string' && v !== '' && !v.startsWith('data:');
  const out = records.slice();
  const jobs = [];
  out.forEach((r, i) => {
    for (const f of ['imageData', 'afterImageData']) if (isRemote(r[f])) jobs.push([i, f]);
  });
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [i, f] = jobs[next++];
      const data = await fetchAsDataURL(out[i][f]);
      out[i] = { ...out[i], [f]: data };
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, worker));
  return out;
}

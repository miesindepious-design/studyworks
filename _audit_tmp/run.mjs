// Minimal DOM stub so exportPDF's downloadPdf() can run under node.
globalThis.document = { createElement: () => ({ href:'', download:'', click(){ console.log('  [a.click()] would download:', this.download); } }) };
globalThis.URL = { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} };
globalThis.Blob = class { constructor(parts){ this.parts = parts; } };

const { exportNotesToPDF, exportFullLibraryToPDF } = await import('./exportPDF.bundle.mjs');

const notes = [
  { id:'1', title:'Test Note', content:'<p>Hello <b>world</b></p>', type:'note', tags:['a'],
    folderId:'default', createdAt:new Date(), updatedAt:new Date(), files:[], highlights:[], personalNotes:[] },
];

for (const [name, fn] of [['exportNotesToPDF', () => exportNotesToPDF(notes)],
                          ['exportFullLibraryToPDF', () => exportFullLibraryToPDF(notes, [], [])]]) {
  console.log('---', name);
  try { await fn(); console.log('  RESULT: resolved OK'); }
  catch (e) { console.log('  RESULT: THREW ->', e.constructor.name + ': ' + e.message); }
}

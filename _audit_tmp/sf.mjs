import { matchesSmartFilter, previewSmartFilter } from './smartFolders.bundle.mjs';
const note = { id:'1', title:'N', content:'', type:'article', tags:['lecture','exam'], summary:'s', nextReminder:new Date(), highlights:[], files:[] };
const filters = ['tag:exam', 'tag:lecture,tag:exam', '-tag:exam', 'tag:exam|tag:homework', 'type:article', 'has:summary', 'starred', 'nonsense:xyz'];
for (const f of filters) {
  console.log(JSON.stringify(f).padEnd(28), '=> match:', matchesSmartFilter(note, f), '| preview:', JSON.stringify(previewSmartFilter(f)));
}

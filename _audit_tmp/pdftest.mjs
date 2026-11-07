import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const page = pdf.addPage([595.28, 841.89]);
const cases = ['StudyWorks','📝 Notes','💡 Flashcards','👥 Contacts','·','…','✉','☎','→','—'];
for (const t of cases) {
  try { page.drawText(t, { x: 50, y: 700, size: 10, font, color: rgb(0,0,0) }); console.log('OK   ', JSON.stringify(t)); }
  catch (e) { console.log('FAIL ', JSON.stringify(t), '->', e.message); }
}

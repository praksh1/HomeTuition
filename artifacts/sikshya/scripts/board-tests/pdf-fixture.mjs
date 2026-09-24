/** Small, valid synthetic PDF. No external fonts, user documents or downloads. */
export function makePdf(pageCount) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({length:pageCount},(_,i)=>`${3+i*2} 0 R`).join(' ')}] >>`];
  for (let i=0;i<pageCount;i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << >> /Contents ${4+i*2} 0 R >>`);
    const drawing=`1 0 0 rg 40 60 520 680 re f\n0 0 0 rg 80 100 ${20*(i+1)} 20 re f\n`;
    objects.push(`<< /Length ${drawing.length} >>\nstream\n${drawing}endstream`);
  }
  let pdf='%PDF-1.4\n'; const offsets=[0];
  objects.forEach((object,index)=>{ offsets.push(pdf.length); pdf+=`${index+1} 0 obj\n${object}\nendobj\n`; });
  const start=pdf.length;
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1)) pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return 'data:application/pdf;base64,'+Buffer.from(pdf).toString('base64');
}

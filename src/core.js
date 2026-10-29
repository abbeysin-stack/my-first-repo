export const statuses = ['present', 'absent', 'leave', 'late'];
// Bounded RFC 4180-style reader. No input values appear in errors.
export function parseCSV(text) {
  if (text.length > 5_000_000) throw Error('File exceeds the 5 MB limit.');
  const rows=[]; let row=[], field='', quoted=false, closed=false;
  text=text.replace(/^\uFEFF/, '');
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted) { if(c==='"') { if(text[i+1]==='"'){field+='"';i++;} else {quoted=false;closed=true;} } else field+=c; }
    else if(c===',' || c==='\n' || c==='\r') {
      row.push(field); field='';closed=false;
      if(c!==','){if(c==='\r' && text[i+1]==='\n')i++; if(row.some(v=>v.trim())) rows.push(row);row=[];}
    } else if(c==='"' && !field && !closed) quoted=true;
    else {if(closed || c==='"') throw Error('Invalid CSV quoting. Export a new CSV file and retry.');field+=c;}
  }
  if(quoted)throw Error('The CSV contains an unfinished quoted field.');
  row.push(field);if(row.some(v=>v.trim()))rows.push(row);
  if(rows.length<2)throw Error('Include column headings and at least one attendance row.');
  const width=rows[0].length;
  if(rows.some(r=>r.length!==width))throw Error('CSV rows must have the same number of columns.');
  return rows;
}
export function summarize(d){const total=statuses.reduce((n,k)=>n+d[k],0);const attending=d.present;return {...d,total,attending,rate:total ? attending/total*100 : 0};}
export function reportText(divisions,date,minimum=5){
  const lines=[`DAILY ATTENDANCE | ${date}`,'','Dear leadership team,',`Please find the consolidated attendance update for ${date}.`,''];
  for(const d of divisions.map(summarize)){
    lines.push(d.division.toUpperCase());
    if(d.total<minimum)lines.push(`Details withheld: division is below the ${minimum}-person reporting threshold.`);
    else lines.push(`Attendance: ${d.rate.toFixed(1)}% | Recorded headcount: ${d.total}`,`Present: ${d.present} | Exceptions (late): ${d.late}`,`Absent: ${d.absent} | Leave: ${d.leave}`);
    lines.push('');
  }
  lines.push('Reporting basis: one record per student per day. Attendance rate = present ÷ all recorded students; leave and late remain in the denominator. Late is reported as an exception. Counts reflect submitted records and do not establish completeness against a student roster.','', 'Privacy: student-level fields are excluded. Small divisions are withheld; individual status counts in larger divisions may still be sensitive. Share only with authorized recipients.','','Regards,','Attendance Operations');
  return lines.join('\n');
}

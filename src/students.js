import {parseCSV} from './core.js';
export const schoolDivisions=['Junior School (PYP)','Junior School (MYP)','Secondary (IGCSE)','Secondary (IB DP)'];
export function divisionForGrade(grade){const n=Number(grade);if(!Number.isInteger(n)||n<1||n>12)return null;return schoolDivisions[n<=5?0:n<=7?1:n<=10?2:3];}
export const studentStatuses=['present','absent','leave','late'];
export function validateRecord(r){
  if(!r||['date','student_code','grade','division','status'].some(k=>typeof r[k]!=='string'))throw Error('Attendance fields must be text values.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||Number.isNaN(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date)throw Error('Use a valid attendance date.');
  if(!/^S-[A-Z0-9]{6,16}$/.test(r.student_code))throw Error('Use an opaque student code: S- followed by 6–16 uppercase letters or digits. Never use names, initials, birth dates, or admission numbers.');
  if(!/^([1-9]|1[0-2])$/.test(r.grade))throw Error('Grade must be 1–12.');
  if(!r.division || r.division.length>60 || /^[=+@-]/.test(r.division) || /[\x00-\x1f]/.test(r.division))throw Error('Choose an approved division label.');
  if(!studentStatuses.includes(r.status))throw Error('Use present, absent, leave, or late.');
  if(r.division!==divisionForGrade(r.grade))throw Error('Division must match the student’s grade.');
  return {date:r.date,student_code:r.student_code,grade:r.grade,division:r.division,status:r.status};
}
export function importStudents(text,approved){const rows=parseCSV(text);const header=rows.shift().map(x=>x.trim().toLowerCase());const keys=['date','student_code','grade','division','status'];if(new Set(header).size!==header.length||keys.some(x=>!header.includes(x)))throw Error('Student CSV requires unique date, student_code, grade, division, status columns.');const seen=new Set();return rows.map(row=>{const r=validateRecord(Object.fromEntries(keys.map(k=>[k,row[header.indexOf(k)].trim()])));if(!approved.includes(r.division))throw Error('CSV includes an unapproved division.');const key=r.date+'|'+r.student_code;if(seen.has(key))throw Error('Duplicate student/date records found. Correct the file before import.');seen.add(key);return r;});}
export function mergeRecords(existing,incoming){const map=new Map(existing.map(r=>[r.date+'|'+r.student_code,r]));for(const r of incoming)map.set(r.date+'|'+r.student_code,r);return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.student_code.localeCompare(b.student_code));}
export function aggregateStudents(records,date){const groups=new Map();for(const r of records.filter(r=>r.date===date)){if(!groups.has(r.division))groups.set(r.division,{division:r.division,present:0,absent:0,leave:0,late:0,remote:0});groups.get(r.division)[r.status]++;}return [...groups.values()];}
export function exportStudents(records){const quote=s=>'"'+String(s).replace(/"/g,'""')+'"';return ['date,student_code,grade,division,status',...records.map(r=>[r.date,r.student_code,r.grade,r.division,r.status].map(quote).join(','))].join('\r\n');}

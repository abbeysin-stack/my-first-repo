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
  const allowedReasons=['illness','appointment','family','authorized','unexplained'];
  if(r.reason!==undefined && (typeof r.reason!=='string'||(r.reason!==''&&!allowedReasons.includes(r.reason))))throw Error('Choose a predefined absence reason.');
  if(r.status!=='absent'&&r.reason)throw Error('Absence reasons apply only to absent students.');
  if(r.note!==undefined&&(typeof r.note!=='string'||r.note.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(r.note)))throw Error('Staff notes must be text of at most 1,000 characters without control characters.');
  if(r.status!=='absent'&&r.note?.trim())throw Error('Absence notes apply only to absent students.');
  const note=r.status==='absent'?(r.note||'').trim():'';
  const reason=r.status==='absent'?(r.reason||'unexplained'):'';
  return {...(reason?{reason}:{}),...(note?{note}:{}),date:r.date,student_code:r.student_code,grade:r.grade,division:r.division,status:r.status};
}
export function importStudents(text,approved){const rows=parseCSV(text);const header=rows.shift().map(x=>x.trim().toLowerCase());const keys=['date','student_code','grade','division','status'];if(new Set(header).size!==header.length||keys.some(x=>!header.includes(x)))throw Error('Student CSV requires unique date, student_code, grade, division, status columns.');const seen=new Set();return rows.map(row=>{const r=validateRecord(Object.fromEntries([...keys,...['reason','note'].filter(k=>header.includes(k))].map(k=>[k,row[header.indexOf(k)].trim()])));if(!approved.includes(r.division))throw Error('CSV includes an unapproved division.');const key=r.date+'|'+r.student_code;if(seen.has(key))throw Error('Duplicate student/date records found. Correct the file before import.');seen.add(key);return r;});}
export function mergeRecords(existing,incoming){const map=new Map(existing.map(r=>[r.date+'|'+r.student_code,r]));for(const r of incoming)map.set(r.date+'|'+r.student_code,r);return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.student_code.localeCompare(b.student_code));}
export function aggregateStudents(records,date){const groups=new Map();for(const r of records.filter(r=>r.date===date)){if(!groups.has(r.division))groups.set(r.division,{division:r.division,present:0,absent:0,leave:0,late:0,remote:0});groups.get(r.division)[r.status]++;}return [...groups.values()];}
export function exportStudents(records){const quote=s=>'"'+String(s).replace(/"/g,'""')+'"';return ['date,student_code,grade,division,status,reason',...records.map(r=>[r.date,r.student_code,r.grade,r.division,r.status,r.reason||''].map(quote).join(','))].join('\r\n');}

export function validateRosterStudent(value){
  if(!value||typeof value.grade!=='string'||!/^([1-9]|1[0-2])$/.test(value.grade))throw Error('Choose grade 1–12.');
  const student={grade:value.grade};
  if(value.student_code!==undefined){if(typeof value.student_code!=='string'||!/^S-[A-Z0-9]{6,16}$/.test(value.student_code))throw Error('The internal student code is invalid.');student.student_code=value.student_code;}
  if(value.display_name!==undefined||value.registration_number!==undefined){
    if(typeof value.display_name!=='string'||typeof value.registration_number!=='string')throw Error('Provide both the display name and registration number.');
    const name=value.display_name.trim().replace(/ +/g,' '),registration=value.registration_number.trim();
    if(!/^[\p{L}\p{M}][\p{L}\p{M}'’ -]{0,59}\s+\p{L}\.?$/u.test(name))throw Error('Use the first name followed by one last initial, for example Ava R.');
    if(!/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/.test(registration))throw Error('Use a registration number of up to 40 letters, digits, spaces, dots, slashes, hyphens, or underscores.');
    student.display_name=name;student.registration_number=registration;
  }else if(!student.student_code)throw Error('Provide a display name and registration number.');
  return student;
}
export function parseRosterCSV(text){
  const rows=parseCSV(text),header=rows.shift().map(x=>x.trim().toLowerCase());
  const named=header.includes('display_name')&&header.includes('registration_number');
  if(new Set(header).size!==header.length||!header.includes('grade')||(!named&&!header.includes('student_code')))throw Error('Roster CSV requires display_name, registration_number, grade (or legacy student_code, grade).');
  const seenCodes=new Set(),seenRegistrations=new Set();
  return rows.map(row=>{const value=Object.fromEntries(['student_code','display_name','registration_number','grade'].filter(k=>header.includes(k)&&row[header.indexOf(k)].trim()).map(k=>[k,row[header.indexOf(k)].trim()]));const student=validateRosterStudent(value);const registration=student.registration_number?.toUpperCase();
    if((student.student_code&&seenCodes.has(student.student_code))||(registration&&seenRegistrations.has(registration)))throw Error('Duplicate students or registration numbers found in roster.');
    if(student.student_code)seenCodes.add(student.student_code);if(registration)seenRegistrations.add(registration);return student;});
}

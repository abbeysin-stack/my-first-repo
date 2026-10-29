import test from 'node:test';
import assert from 'node:assert/strict';
import {importStudents,mergeRecords,aggregateStudents,exportStudents,validateRecord} from '../src/students.js';
const r={date:'2026-10-29',student_code:'S-A7K9M2Q4',grade:'3',division:'Junior School (PYP)',status:'absent'};
test('extra PII columns discarded, only safe schema retained',()=>{const rows=importStudents('date,student_code,grade,division,status,name,email\n2026-10-29,S-A7K9M2Q4,3,Junior School (PYP),absent,PRIVATE_NAME,private@example.com',['Junior School (PYP)']);assert.deepEqual(rows,[r]);assert.doesNotMatch(exportStudents(rows),/PRIVATE_NAME|example.com/);});
test('student-date upsert prevents double-counting',()=>{const records=mergeRecords([r],[{...r,status:'present'}]);assert.equal(records.length,1);assert.equal(records[0].status,'present');assert.equal(aggregateStudents(records,r.date)[0].present,1);});
test('duplicate entries within an import are rejected',()=>assert.throws(()=>importStudents('date,student_code,grade,division,status\n2026-10-29,S-A7K9M2Q4,3,Junior School (PYP),absent\n2026-10-29,S-A7K9M2Q4,3,Junior School (PYP),present',['Junior School (PYP)']),/Duplicate/));
test('coded CSV roundtrip retains multiday history',()=>{const records=[r,{...r,date:'2026-10-28',status:'present'}];assert.deepEqual(importStudents(exportStudents(records),['Junior School (PYP)']),records);assert.equal(aggregateStudents(records,'2026-10-29')[0].absent,1);assert.doesNotMatch(JSON.stringify(aggregateStudents(records,r.date)),/S-A7K9M2Q4/);});
test('invalid dates, grades, statuses and personal-name identifiers rejected',()=>{for(const invalid of [{student_code:'Jane Smith'},{date:'2026-02-30'},{grade:'14'},{status:'unknown'}])assert.throws(()=>validateRecord({...r,...invalid}));});

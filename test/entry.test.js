import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTotals,aggregateAttendance,rosterForGrade} from '../src/entry.js';
const date='2026-10-29';
test('present count is calculated; invalid counts and dates rejected',()=>{assert.equal(validateTotals({date,grade:'1',total:30,absent:2,leave:1,late:1}).present,26);for(const values of [{total:0},{absent:-1},{absent:31},{late:1.5},{date:'2026-02-30'},{grade:'13'}])assert.throws(()=>validateTotals({date,grade:'1',total:30,absent:0,leave:0,late:0,...values}));});
test('totals and individual entry combine across grades without double counting',()=>{const r={date,student_code:'S-A7K9M2Q4',grade:'1',division:'Junior School (PYP)',status:'absent'};const totals=[{date,grade:'1',total:30,present:28,absent:2,leave:0,late:0}];const result=aggregateAttendance([r,{...r,student_code:'S-X7K9M2Q4',grade:'2',status:'present'}],totals,date);assert.deepEqual(result,[{division:'Junior School (PYP)',present:29,absent:2,leave:0,late:0}]);assert.deepEqual(aggregateAttendance([r],totals,'2026-10-28'),[]);});
test('unmarked roster students are not silently counted present',()=>{const students=rosterForGrade([{student_code:'S-A7K9M2Q4',grade:'1'}],[],'1',date);assert.equal(students[0].record,undefined);assert.deepEqual(aggregateAttendance([],[],date),[]);});

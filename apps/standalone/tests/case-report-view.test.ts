import {describe,it,expect} from 'vitest';
import {buildCaseTimeline} from '@asq/sdk';
import {caseReportView} from '../lib/case-report-view';

const empty=()=>({schemaVersion:'gss.case-report.v1',caseId:'CASE-test',generatedAt:'2026-10-14T03:00:00Z',
  scope:'LATEST_INVESTIGATION_AND_BOUNDED_CASE_TIMELINE',analystReview:'REQUIRED',reportHash:'a'.repeat(64),
  investigation:null,limitations:['No analyst verdict.'],timeline:buildCaseTimeline('CASE-test',[],{
    completedQueryCount:0,unprojectedQueryCount:0,omittedProjectionCount:0})});
describe('case report display boundary',()=>{
  it('accepts no investigation without inventing a verdict or frontier',()=>{
    const report=empty();expect(caseReportView(report,'CASE-test')).toEqual(report);
    expect(()=>caseReportView(report,'OTHER')).toThrow();
  });
  it('rejects unsupported scope, fabricated frontier and mismatched provenance',()=>{
    expect(()=>caseReportView({...empty(),scope:'ALL_EVENTS'},'CASE-test')).toThrow();
    expect(()=>caseReportView({...empty(),analystReview:'COMPLETE'},'CASE-test')).toThrow();
    expect(()=>caseReportView({...empty(),investigation:{frontier:{}}},'CASE-test')).toThrow();
    expect(()=>caseReportView({...empty(),timeline:{...empty().timeline,caseId:'OTHER'}},'CASE-test')).toThrow();
  });
});

import { describe,it,expect } from 'vitest';
import { buildCaseTimeline } from '@asq/sdk';
import { caseTimelineView } from '../lib/case-timeline-view';
describe('case timeline display contract',()=>{
  it('keeps an empty authority snapshot empty',()=>{
    const t=buildCaseTimeline('CASE-test',[],{completedQueryCount:0,unprojectedQueryCount:0,omittedProjectionCount:0});
    expect(caseTimelineView(t,'CASE-test')).toEqual(t);
    expect(()=>caseTimelineView(t,'OTHER')).toThrow();
    expect(()=>caseTimelineView({...t,completedQueryCount:1},'CASE-test')).toThrow();
  });
  it('rejects dangling entries and invalid source shapes before display',()=>{
    const t=buildCaseTimeline('CASE-test',[],{completedQueryCount:0,unprojectedQueryCount:0,omittedProjectionCount:0});
    expect(()=>caseTimelineView({...t,entries:[{taskId:'invented'}],inputEventCount:1},'CASE-test')).toThrow();
    expect(()=>caseTimelineView({...t,sources:[null],completedQueryCount:1},'CASE-test')).toThrow();
  });
});

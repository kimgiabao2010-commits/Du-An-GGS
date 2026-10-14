import {describe,it,expect} from 'vitest';
import {buildCaseEntities} from '@asq/sdk';
import {caseEntitiesView} from '../lib/case-entities-view';
describe('entity display contract',()=>{
  it('keeps no retained query projection empty and exposes missing coverage',()=>{
    const p=buildCaseEntities('CASE-test',[],{completedQueryCount:1,unprojectedQueryCount:1,omittedProjectionCount:0});
    expect(caseEntitiesView(p,'CASE-test')).toEqual(p);
    expect(()=>caseEntitiesView(p,'OTHER')).toThrow();
    expect(()=>caseEntitiesView({...p,partial:false},'CASE-test')).toThrow();
  });
  it('rejects fabricated source/event associations before display',()=>{
    const p=buildCaseEntities('CASE-test',[],{completedQueryCount:0,unprojectedQueryCount:0,omittedProjectionCount:0});
    expect(()=>caseEntitiesView({...p,entries:[{taskId:'invented'}],inputEventCount:1},'CASE-test')).toThrow();
    expect(()=>caseEntitiesView({...p,sources:[null],completedQueryCount:1},'CASE-test')).toThrow();
  });
});

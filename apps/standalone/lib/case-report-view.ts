import { caseTimelineView } from './case-timeline-view';
import { investigationView } from './investigation-view';
import {caseEntitiesView} from './case-entities-view';

export function caseReportView(input: unknown, caseId: string): Record<string,unknown> {
  if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('Invalid case report.');
  const report=input as Record<string,any>;
  if(report.schemaVersion!=='gss.case-report.v1' || report.caseId!==caseId ||
    report.scope!=='LATEST_INVESTIGATION_AND_BOUNDED_CASE_TIMELINE' || report.analystReview!=='REQUIRED' ||
    typeof report.generatedAt!=='string' || !Number.isFinite(Date.parse(report.generatedAt)) ||
    typeof report.reportHash!=='string' || !/^[a-f0-9]{64}$/.test(report.reportHash) ||
    !Array.isArray(report.limitations) || report.limitations.length>16 ||
    report.limitations.some((x:unknown)=>typeof x!=='string' || !x || x.length>1000))throw new Error('Invalid case report.');
  caseTimelineView(report.timeline,caseId);
  if(report.entities!==undefined)caseEntitiesView(report.entities,caseId);
  const investigation=report.investigation;
  if(investigation?.frontier)investigationView(investigation,caseId);
  else if(investigation!==null && (!investigation || investigation.frontier!==null ||
    investigation.run?.schemaVersion!=='gss.investigation-run.v1' || investigation.run.caseId!==caseId ||
    investigation.run.frontierVersion!==0 || investigation.hypothesisPlan!==undefined))throw new Error('Invalid empty investigation report.');
  return report;
}

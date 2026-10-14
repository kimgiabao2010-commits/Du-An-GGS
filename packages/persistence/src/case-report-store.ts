import type { Pool } from 'pg';
import { sha256Canonical,annotateOfflineIntel,type OfflineIntelCatalog } from '@asq/sdk';
import { readCaseTimelineWithClient } from './case-timeline-store.js';
import { readCaseInvestigationSnapshot } from './loop-store.js';
import {readCaseEntitiesWithClient} from './case-entities-store.js';
import {readCaseAttackWithClient} from './case-attack-store.js';

/** One database snapshot; only retained evidence and policy decisions, no model-authored conclusion. */
export async function readCaseReport(pool: Pool, caseId: string, catalog?:OfflineIntelCatalog,attackKnowledge?:import('@asq/sdk').AttackKnowledge) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    const timeline=await readCaseTimelineWithClient(client,caseId);
    const investigation=await readCaseInvestigationSnapshot(client,caseId);
    const entities=await readCaseEntitiesWithClient(client,caseId);
    const generatedAt=(await client.query('SELECT transaction_timestamp() AS at')).rows[0].at.toISOString();
    const attack=await readCaseAttackWithClient(client,caseId,attackKnowledge,generatedAt);
    const report={schemaVersion:'gss.case-report.v1' as const,caseId,generatedAt,
      scope:'LATEST_INVESTIGATION_AND_BOUNDED_CASE_TIMELINE' as const,
      analystReview:'REQUIRED' as const,investigation,timeline,entities,offlineIntel:annotateOfflineIntel(entities,catalog,generatedAt),attack,
      limitations:[
        'This report preserves stored facts, semantic labels, contradictions and authority decisions; it supplies no analyst verdict.',
        'Timeline ordering is not causation. Equal event IDs in different queries are not deduplicated.',
        'Timeline covers at most 32 retained authority query projections and 200 events; omitted query event counts are unknown.',
        'Source labels and hashes do not attest to live Chronicle, SOC quality or staging readiness.',
        'Entity values are equal only within their source. Event co-observation establishes neither causation nor physical asset identity. Omitted events may contain uncounted mentions.',
        'Offline intel is an exact-value external feed annotation, not a FACT or verdict. No match is not benign; expired/unconfigured catalogs supply no active annotations. Operator license review is required.',
        'ATTACK v1 resolves literal provider-reported technique IDs only. An annotation is neither a FACT nor proof of compromise; no match is not benign. Behavioral technique inference and analyst quality are not implemented by this rule.',
      ]};
    if(Buffer.byteLength(JSON.stringify(report))>2_000_000)throw Object.assign(new Error('case_report_size_limit'),{statusCode:413});
    const output={...report,reportHash:sha256Canonical(report)};
    await client.query('COMMIT');return output;
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
}

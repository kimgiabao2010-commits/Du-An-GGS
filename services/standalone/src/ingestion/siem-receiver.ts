import { createHash } from 'node:crypto';
import { ContextBudgeter } from '@asq/guardrails';
import type { UDMEvent } from '@asq/sdk';

/** User log intake is not a Chronicle event or a verified security verdict. */
export class SiemReceiver {
  public ingestRawLog(rawPayload:string):UDMEvent {
    if(typeof rawPayload!=='string' || Buffer.byteLength(rawPayload)>65536) throw new Error('Log intake exceeds bounded input');
    const hash=createHash('sha256').update(rawPayload).digest('hex');
    const context=new ContextBudgeter().prepare(rawPayload);
    return {id:'log-'+hash,timestamp:Date.now(),type:'SIEM_ALERT',severity:'LOW',source:'user-provided-log',
      details:{classification:'UNCLASSIFIED',payloadHash:hash,sanitizedExcerpt:context.modelInput,
        truncated:context.omittedCharacters>0,verified:false}};
  }
}

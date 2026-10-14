import {isIP} from 'node:net';
import {createHash} from 'node:crypto';
import type {IndicatorType} from './types.js';

const patterns:Record<Exclude<IndicatorType,'IP'>,RegExp>={
  DOMAIN:/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/,
  HOSTNAME:/^[a-zA-Z0-9._-]{1,253}$/, HASH:/^(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/,
  USER:/^[a-zA-Z0-9._@\\-]{1,256}$/,
};
export function validReadOnlyIndicator(type:unknown,value:unknown):type is IndicatorType {
  return typeof type==='string' && typeof value==='string' && value.length<=256 &&
    (type==='IP'?isIP(value)!==0:Object.hasOwn(patterns,type) && patterns[type as Exclude<IndicatorType,'IP'>].test(value));
}
/** Version-pinned UDM templates shared by worker and authority. No arbitrary fields/query text. */
export function readOnlyUdmQuery(type:IndicatorType,value:string):string {
  if(!validReadOnlyIndicator(type,value)) throw new Error('Invalid read-only indicator');
  const quoted='"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
  const templates:Record<IndicatorType,string[]>={IP:['principal.ip','target.ip','src.ip'],
    DOMAIN:['principal.hostname','target.hostname','network.dns.questions.name'],HASH:['target.file.md5','target.file.sha1','target.file.sha256'],
    USER:['principal.user.userid','target.user.userid'],HOSTNAME:['principal.hostname','target.hostname']};
  return templates[type].map(field=>field+' = '+quoted).join(' OR ');
}
export function readOnlyUdmQueryHash(type:IndicatorType,value:string):string {
  return createHash('sha256').update(readOnlyUdmQuery(type,value)).digest('hex');
}

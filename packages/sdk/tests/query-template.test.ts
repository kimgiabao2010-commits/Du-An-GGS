import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readOnlyUdmQuery,readOnlyUdmQueryHash,validReadOnlyIndicator,type IndicatorType} from '../src/index.js';
describe('shared read-only UDM templates',()=>{
  it('hashes the exact allowlisted worker query and handles all supported indicator types',()=>{
    for(const [type,value] of [['IP','203.0.113.1'],['IP','2001:db8::1'],['DOMAIN','example.test'],['HASH','a'.repeat(64)],['USER','EXAMPLE\\analyst'],['HOSTNAME','host-a']]) {
      const query=readOnlyUdmQuery(type as IndicatorType,value);
      expect(readOnlyUdmQueryHash(type as IndicatorType,value)).toBe(createHash('sha256').update(query).digest('hex'));
      expect(query).not.toContain('undefined');
    }
  });
  it('rejects malformed IP/IPv6, arbitrary fields, query operators and prototype names',()=>{
    for(const [type,value] of [['IP','aa'],['IP','999.1.1.1'],['IP',':::1'],['DOMAIN','x.test" OR true'],['USER','a"'],['__proto__','a']]) {
      expect(validReadOnlyIndicator(type,value)).toBe(false);expect(()=>readOnlyUdmQuery(type as IndicatorType,value)).toThrow();
    }
  });
});

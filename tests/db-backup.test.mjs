import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localDatabaseTarget} from '../scripts/backup-local-postgres.mjs';
test('backup target rejects staging, remote, service/search_path and unsupported protocols',()=>{
  for(const url of ['postgresql://user:fake@example.com/db','http://127.0.0.1/db','postgresql://127.0.0.1/db?service=remote',
    'postgresql://127.0.0.1/db?options=-c%20search_path%3Dpublic','postgresql://127.0.0.1/db?sslmode=bogus'])assert.throws(()=>localDatabaseTarget(url));
  assert.throws(()=>localDatabaseTarget('postgresql://127.0.0.1/db','staging'));
});
test('backup target accepts explicit loopback and decodes password without argv interpolation',()=>{
  const a=localDatabaseTarget('postgresql://user:fake%20%24%26%3B@127.0.0.1:5432/db');
  assert.equal(a.password,'fake $&;');assert.equal(a.database,'db');assert.equal(a.port,'5432');
  assert.equal(localDatabaseTarget('postgresql://[::1]/db').host,'::1');
});

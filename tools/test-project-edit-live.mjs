import assert from 'node:assert/strict';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  .map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();
const user = (await client.query("SELECT id,username,role FROM users WHERE status='active' ORDER BY (role='admin') DESC,created_at LIMIT 1")).rows[0];
const original = (await client.query(`SELECT id,code,report_code,system_name,org_name,assessment_year,system_level,
  start_date::text AS start_date,end_date::text AS end_date FROM projects ORDER BY updated_at DESC LIMIT 1`)).rows[0];
assert.ok(user && original, '需要至少一个有效用户和项目');
const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, env.JWT_SECRET, { expiresIn: '10m' });
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const update = async body => {
  const response = await fetch(`http://127.0.0.1:${env.PORT || 3100}/api/projects/${original.id}`, {
    method: 'PUT', headers, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`PUT ${response.status}: ${JSON.stringify(data)}`);
  return data;
};
const read = async () => {
  const response = await fetch(`http://127.0.0.1:${env.PORT || 3100}/api/projects/${original.id}`, { headers });
  const data = await response.json();
  if (!response.ok) throw new Error(`GET ${response.status}: ${JSON.stringify(data)}`);
  return data;
};
const bodyFor = values => ({
  code: original.code,
  reportCode: values.reportCode,
  systemName: values.systemName,
  orgName: values.orgName,
  assessmentYear: Number(original.assessment_year),
  systemLevel: Number(original.system_level),
  startDate: values.startDate,
  endDate: values.endDate,
});
const restoreBody = bodyFor({
  reportCode: original.report_code || '', systemName: original.system_name, orgName: original.org_name,
  startDate: original.start_date || '', endDate: original.end_date || '',
});

try {
  const marker = `保存测试-${Date.now()}`;
  const changed = bodyFor({
    reportCode: marker,
    systemName: original.system_name + '（保存测试）',
    orgName: original.org_name + '（保存测试）',
    startDate: '2026-11-12',
    endDate: '2026-12-13',
  });
  await update(changed);
  const actual = await read();
  assert.equal(actual.report_code, changed.reportCode);
  assert.equal(actual.system_name, changed.systemName);
  assert.equal(actual.org_name, changed.orgName);
  assert.equal(actual.start_date, changed.startDate);
  assert.equal(actual.end_date, changed.endDate);
  for (const stage of actual.stages || []) {
    assert.deepEqual(stage.data?.projectDates, { startDate: changed.startDate, endDate: changed.endDate },
      `${stage.stage_key} 阶段日期没有同步`);
  }
  const stored = (await client.query(`SELECT report_code,system_name,org_name,start_date::text AS start_date,
    end_date::text AS end_date FROM projects WHERE id=$1`, [original.id])).rows[0];
  assert.deepEqual(stored, {
    report_code: changed.reportCode, system_name: changed.systemName, org_name: changed.orgName,
    start_date: changed.startDate, end_date: changed.endDate,
  });
  console.log('PASS: live project edit persisted through API and database.');
} finally {
  await update(restoreBody);
  const restored = await read();
  assert.equal(restored.report_code || '', original.report_code || '');
  assert.equal(restored.system_name, original.system_name);
  assert.equal(restored.org_name, original.org_name);
  assert.equal(restored.start_date || '', original.start_date || '');
  assert.equal(restored.end_date || '', original.end_date || '');
  for (const stage of restored.stages || []) {
    assert.deepEqual(stage.data?.projectDates,
      { startDate: original.start_date || '', endDate: original.end_date || '' },
      `${stage.stage_key} 阶段日期没有恢复`);
  }
  await client.end();
  console.log('PASS: test project restored to its original values.');
}

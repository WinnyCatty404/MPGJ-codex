import dotenv from 'dotenv';
import pg from 'pg';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });

const connectionString = process.env.DATABASE_URL
  || 'postgresql://bb_miping_app:BbMiping-App-2026!@127.0.0.1:54328/bb_miping';
const client = new pg.Client({ connectionString });

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replace(/'/g, "''")}'`;
}

await client.connect();
try {
  const result = await client.query(`
    SELECT username, display_name, password_hash, role, status,
      certificate_date::text AS certificate_date, certificate_no,
      certificate_file_name, certificate_file_path, must_change_password
    FROM users
    ORDER BY CASE WHEN username='admin' THEN 0 ELSE 1 END, username
  `);
  if (!result.rows.some(row => row.username === 'admin')) {
    throw new Error('当前数据库中缺少 admin 账号，拒绝生成初始用户数据');
  }
  const columns = [
    'username', 'display_name', 'password_hash', 'role', 'status',
    'certificate_date', 'certificate_no', 'certificate_file_name',
    'certificate_file_path', 'must_change_password',
  ];
  const values = result.rows.map(row =>
    `  (${columns.map(column => sqlLiteral(row[column])).join(', ')})`,
  ).join(',\n');
  const sql = `-- 由 tools/export-users-seed.mjs 从当前数据库生成。
-- 仅包含初始用户资料、证书和不可逆密码哈希；不包含登录时间、项目或运行数据。
-- 已存在的用户名保持原值，重复初始化不会覆盖实际使用中的账号。
INSERT INTO users (
  username, display_name, password_hash, role, status,
  certificate_date, certificate_no, certificate_file_name,
  certificate_file_path, must_change_password
)
VALUES
${values}
ON CONFLICT (username) DO NOTHING;
`;
  const output = path.join(projectRoot, 'database', 'seed.sql');
  await writeFile(output, sql, 'utf8');
  const certificateCount = result.rows.filter(row => row.certificate_file_path).length;
  console.log(`已生成 database/seed.sql：${result.rows.length} 个用户，${certificateCount} 份证书附件。`);
} finally {
  await client.end();
}

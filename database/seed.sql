INSERT INTO users (username, display_name, password_hash, role, status, must_change_password, certificate_date)
VALUES
  ('admin', '系统管理员', crypt('Admin@123', gen_salt('bf')), 'admin', 'active', false, NULL),
  ('zhanghf', '张鸿飞', crypt('Miping@2026', gen_salt('bf')), 'manager', 'active', true, '2022-07-01'),
  ('huanglf', '黄凌锋', crypt('Miping@2026', gen_salt('bf')), 'evaluator', 'active', true, '2022-07-01')
ON CONFLICT (username) DO NOTHING;

INSERT INTO projects (code, report_code, system_name, org_name, assessment_year, system_level, status, current_stage, progress, start_date, end_date, owner_id, created_by)
SELECT v.code, v.report_code, v.system_name, v.org_name, v.assessment_year, v.system_level, v.status, v.current_stage, v.progress, v.start_date::date, v.end_date::date, u.id, a.id
FROM (VALUES
  ('MP-2026-001', 'BB-2026-001', '办公自动化（OA）系统', 'XX市大数据管理局', 2026, 3, 'in_progress', 3, 68, '2026-04-01', '2026-06-30'),
  ('MP-2026-002', 'BB-2026-002', '社会保险业务信息系统', 'XX市人力资源和社会保障局', 2026, 3, 'in_progress', 2, 42, '2026-05-01', '2026-08-31'),
  ('MP-2025-018', 'BB-2025-018', '住房公积金业务管理系统', 'XX市住房公积金管理中心', 2025, 2, 'completed', 5, 100, '2025-12-01', '2026-02-28'),
  ('MP-2026-003', NULL, '医院信息管理系统（HIS）', 'XX市中心医院', 2026, 3, 'draft', 1, 16, '2026-07-01', '2026-09-30'),
  ('MP-2026-004', NULL, '智慧校园一卡通系统', 'XX职业技术学院', 2026, 2, 'reviewing', 4, 82, '2026-08-01', '2026-11-30'),
  ('MP-2025-009', 'BB-2025-009', '政务服务审批系统', 'XX市行政审批服务局', 2025, 4, 'completed', 5, 100, '2025-09-01', '2025-12-31')
) AS v(code, report_code, system_name, org_name, assessment_year, system_level, status, current_stage, progress, start_date, end_date)
CROSS JOIN (SELECT id FROM users WHERE username = 'zhanghf') u
CROSS JOIN (SELECT id FROM users WHERE username = 'admin') a
ON CONFLICT (code) DO NOTHING;

INSERT INTO project_stage_records (project_id, stage_key, title, completion, data)
SELECT p.id, s.stage_key, s.title, CASE WHEN s.stage_no < p.current_stage THEN 100 WHEN s.stage_no = p.current_stage THEN GREATEST(20, p.progress) ELSE 0 END,
  CASE WHEN s.stage_key = 'preparation' THEN jsonb_build_object('orgName', p.org_name, 'contactName', '', 'contactMobile', '', 'cryptoAuthority', '') ELSE '{}'::jsonb END
FROM projects p
CROSS JOIN (VALUES
  (1, 'preparation', '项目准备'),
  (2, 'planning', '测评准备与方案编制'),
  (3, 'onsite', '现场测评'),
  (4, 'reporting', '报告编制'),
  (5, 'review', '报告导出')
) s(stage_no, stage_key, title)
ON CONFLICT (project_id, stage_key) DO NOTHING;

INSERT INTO risks (project_id, domain, issue_description, threat_code, risk_analysis, risk_level, recommendation)
SELECT p.id, '应用和数据安全', '关键业务数据传输完整性保护证据不足', 'TP-AD-03', '传输链路未形成完整、可核验的密码保护证据链。', 'high', '补充国密算法配置、产品认证材料与抓包验证记录。'
FROM projects p WHERE p.code = 'MP-2026-001'
AND NOT EXISTS (SELECT 1 FROM risks r WHERE r.project_id = p.id);

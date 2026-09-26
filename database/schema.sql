CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(40) NOT NULL UNIQUE,
  display_name varchar(80) NOT NULL,
  password_hash text NOT NULL,
  role varchar(24) NOT NULL DEFAULT 'evaluator' CHECK (role IN ('admin', 'manager', 'evaluator', 'reviewer')),
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'disabled')),
  certificate_date date,
  certificate_no varchar(100),
  certificate_file_name varchar(255),
  certificate_file_path text,
  must_change_password boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(40) NOT NULL UNIQUE,
  report_code varchar(60),
  system_name varchar(200) NOT NULL,
  org_name varchar(200) NOT NULL,
  assessment_year integer NOT NULL CHECK (assessment_year BETWEEN 2000 AND 2100),
  system_level smallint NOT NULL CHECK (system_level BETWEEN 1 AND 4),
  status varchar(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'reviewing', 'completed', 'archived')),
  current_stage smallint NOT NULL DEFAULT 1 CHECK (current_stage BETWEEN 1 AND 5),
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  start_date date,
  end_date date,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_role varchar(40) NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS project_stage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_key varchar(50) NOT NULL,
  title varchar(100) NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  completion smallint NOT NULL DEFAULT 0 CHECK (completion BETWEEN 0 AND 100),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, stage_key)
);

CREATE TABLE IF NOT EXISTS asset_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category varchar(50) NOT NULL,
  name varchar(200) NOT NULL,
  importance varchar(20) NOT NULL DEFAULT 'important',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assessment_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain varchar(60) NOT NULL,
  indicator_code varchar(60),
  indicator_name varchar(240) NOT NULL,
  target_name varchar(240),
  applicable boolean NOT NULL DEFAULT true,
  result varchar(24) CHECK (result IN ('conform', 'partial', 'nonconform', 'not_applicable')),
  score numeric(6,2),
  evidence text,
  analysis text,
  risk_level varchar(16) CHECK (risk_level IN ('high', 'medium', 'low')),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain varchar(60) NOT NULL,
  issue_description text NOT NULL,
  threat_code varchar(40),
  risk_analysis text,
  risk_level varchar(16) NOT NULL CHECK (risk_level IN ('high', 'medium', 'low')),
  recommendation text,
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'tracking', 'closed', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_key varchar(50) NOT NULL,
  evidence_type varchar(80) NOT NULL,
  original_name varchar(255) NOT NULL,
  storage_path text NOT NULL,
  mime_type varchar(120),
  file_size bigint,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(80) NOT NULL,
  entity_type varchar(50) NOT NULL,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key varchar(80) PRIMARY KEY,
  setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system_settings(setting_key, setting_value) VALUES (
  'institution',
  '{"name":"浙江省电子信息产品检验研究院","address":"浙江省杭州市天目山路50号信息技术大厦","postalCode":"310012","contact":"朱晨鸣","title":"主任 / 高工","department":"信息安全测评中心","telephone":"0571-81029696","mobile":"15167100948","email":"zcm@zdjy.org.cn"}'::jsonb
) ON CONFLICT(setting_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_projects_year_level ON projects(assessment_year, system_level);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_stage_records_project ON project_stage_records(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_project_category ON asset_items(project_id, category);
CREATE INDEX IF NOT EXISTS idx_assessment_project_domain ON assessment_records(project_id, domain);
CREATE INDEX IF NOT EXISTS idx_risks_project_level ON risks(project_id, risk_level);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

GRANT USAGE ON SCHEMA public TO bb_miping_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bb_miping_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bb_miping_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bb_miping_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bb_miping_app;

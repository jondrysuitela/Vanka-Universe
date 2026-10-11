-- Vanka Universe Database Schema (PostgreSQL)
-- Tahap 4A: Fondasi Database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Audit metadata helper
-- updated_at trigger will be created in init script if needed
CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'admin',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_admins_role CHECK (role IN ('admin','owner','editor'))
);

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  memory_date DATE NOT NULL, -- tanggal kejadian
  category VARCHAR(100),
  privacy VARCHAR(50) NOT NULL DEFAULT 'private',
  owner_id UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_memories_privacy CHECK (privacy IN ('private','shared','public'))
);

CREATE INDEX IF NOT EXISTS idx_memories_memory_date ON memories(memory_date);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_owner ON memories(owner_id);

CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  memory_id UUID REFERENCES memories(id) ON DELETE RESTRICT,
  title VARCHAR(255),
  description TEXT,
  media_type VARCHAR(50) NOT NULL, -- photo|video
  taken_date DATE, -- tanggal pengambilan berbeda dengan uploaded_at
  storage_key VARCHAR(512) NOT NULL,
  storage_provider VARCHAR(50) NOT NULL DEFAULT 'r2',
  file_size BIGINT,
  mime_type VARCHAR(100),
  width INT,
  height INT,
  duration_seconds INT,
  privacy VARCHAR(50) NOT NULL DEFAULT 'private',
  owner_id UUID REFERENCES admins(id) ON DELETE SET NULL,
  uploaded_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_media_type CHECK (media_type IN ('photo','video')),
  CONSTRAINT chk_media_privacy CHECK (privacy IN ('private','shared','public')),
  CONSTRAINT chk_media_provider CHECK (storage_provider IN ('r2','s3','gcs'))
);

CREATE INDEX IF NOT EXISTS idx_media_memory ON media(memory_id);
CREATE INDEX IF NOT EXISTS idx_media_uploaded_at ON media(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_media_taken_date ON media(taken_date);

CREATE TABLE IF NOT EXISTS birthday_editions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  year INT NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  subtitle VARCHAR(255),
  narrative TEXT,
  cover_media_id UUID REFERENCES media(id) ON DELETE RESTRICT,
  status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft|scheduled|published|archived
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  privacy VARCHAR(50) NOT NULL DEFAULT 'private',
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_edition_status CHECK (status IN ('draft','scheduled','published','archived')),
  CONSTRAINT chk_edition_privacy CHECK (privacy IN ('private','shared','public')),
  CONSTRAINT chk_edition_sched CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL),
  CONSTRAINT chk_edition_pub CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_birthday_year ON birthday_editions(year);
CREATE INDEX IF NOT EXISTS idx_birthday_status ON birthday_editions(status);

CREATE TABLE IF NOT EXISTS content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(50) NOT NULL, -- narrative|letter|caption|page
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE,
  body TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft|review|scheduled|published|archived
  privacy VARCHAR(50) NOT NULL DEFAULT 'private',
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_content_type CHECK (type IN ('narrative','letter','caption','page')),
  CONSTRAINT chk_content_status CHECK (status IN ('draft','review','scheduled','published','archived')),
  CONSTRAINT chk_content_privacy CHECK (privacy IN ('private','shared','public')),
  CONSTRAINT chk_content_sched CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL),
  CONSTRAINT chk_content_pub CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_content_status ON content(status);
CREATE INDEX IF NOT EXISTS idx_content_created_at ON content(created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES admins(id) ON DELETE SET NULL,
  actor_email VARCHAR(255),
  actor_label VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(255),
  ip_address VARCHAR(100),
  user_agent TEXT,
  diff_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_audit_action CHECK (action IN ('create','read','update','delete','publish','unpublish')),
  CONSTRAINT chk_audit_entity CHECK (entity_type IN ('memory','media','birthday_edition','content'))
);

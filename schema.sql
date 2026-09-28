CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin','super_admin')),
  referral_code TEXT UNIQUE NOT NULL,
  referred_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tontines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contribution_amount INTEGER NOT NULL CHECK (contribution_amount > 0),
  frequency TEXT NOT NULL DEFAULT 'monthly',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tontine_id UUID NOT NULL REFERENCES tontines(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id,tontine_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  tontine_id UUID NOT NULL REFERENCES tontines(id),
  base_amount INTEGER NOT NULL CHECK (base_amount > 0),
  admin_commission INTEGER NOT NULL DEFAULT 0 CHECK (admin_commission >= 0),
  sponsor_commission INTEGER NOT NULL DEFAULT 0 CHECK (sponsor_commission >= 0),
  total_amount INTEGER NOT NULL CHECK (total_amount > 0),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','CONFIRMED','FAILED','EXPIRED','REFUNDED')),
  provider TEXT NOT NULL DEFAULT 'MANUAL_TEST',
  provider_reference TEXT UNIQUE,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_pending
  ON payments(user_id,tontine_id) WHERE status='PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_idempotency
  ON payments(user_id,tontine_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES payments(id),
  tontine_id UUID REFERENCES tontines(id),
  user_id UUID REFERENCES users(id),
  nature TEXT NOT NULL CHECK (nature IN ('TONTINE_FUNDS','ADMIN_COMMISSION','SPONSOR_COMMISSION','REFUND')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('ORANGE_MONEY','MTN_MONEY','WAVE','MOOV_MONEY','BANK')),
  label TEXT NOT NULL,
  account_identifier TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS beneficiary_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tontine_id UUID NOT NULL REFERENCES tontines(id),
  beneficiary_user_id UUID NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  due_date DATE NOT NULL,
  provider TEXT,
  source_account TEXT,
  status TEXT NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED','PREPARED','PENDING_ADMIN_VALIDATION','APPROVED','PAYMENT_IN_PROGRESS','PAID','CONFIRMED','REJECTED')),
  payment_reference TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_user_tontine ON payments(user_id,tontine_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_ledger_tontine ON ledger_entries(tontine_id);
CREATE INDEX IF NOT EXISTS idx_beneficiary_due ON beneficiary_payments(due_date,status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,created_at DESC);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), full_name TEXT NOT NULL, birth_date DATE NOT NULL,
 phone TEXT UNIQUE NOT NULL, email TEXT UNIQUE, password_hash TEXT NOT NULL,
 referral_code TEXT UNIQUE NOT NULL, referred_by UUID REFERENCES users(id), role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin','super_admin')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tontines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, contribution_amount BIGINT NOT NULL CHECK(contribution_amount>0),
 frequency TEXT NOT NULL CHECK(frequency IN ('WEEKLY','BIWEEKLY','MONTHLY')), start_date DATE NOT NULL, end_date DATE,
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PAUSED','CLOSED')), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tontine_members (
 tontine_id UUID REFERENCES tontines(id) ON DELETE CASCADE, user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 position_no INT NOT NULL, joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tontine_id,user_id),
 UNIQUE(tontine_id,position_no)
);
CREATE TABLE IF NOT EXISTS payments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), tontine_id UUID NOT NULL REFERENCES tontines(id),
 base_amount BIGINT NOT NULL CHECK(base_amount>0), admin_commission BIGINT NOT NULL DEFAULT 0 CHECK(admin_commission>=0),
 sponsor_commission BIGINT NOT NULL DEFAULT 0 CHECK(sponsor_commission>=0), total_amount BIGINT NOT NULL CHECK(total_amount>0),
 status TEXT NOT NULL CHECK(status IN ('PENDING','CONFIRMED','FAILED','EXPIRED','REFUNDED')),
 provider TEXT, provider_reference TEXT UNIQUE, idempotency_key TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payments_user_tontine_idx ON payments(user_id,tontine_id,created_at);
CREATE TABLE IF NOT EXISTS ledger_entries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), payment_id UUID REFERENCES payments(id), tontine_id UUID NOT NULL REFERENCES tontines(id),
 fund_type TEXT NOT NULL CHECK(fund_type IN('TONTINE_FUNDS','ADMIN_COMMISSION','SPONSOR_COMMISSION','REFUND')),
 amount BIGINT NOT NULL CHECK(amount<>0), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS collection_accounts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), provider TEXT NOT NULL CHECK(provider IN('ORANGE_MONEY','MTN_MONEY','WAVE','BANK')),
 label TEXT NOT NULL, account_identifier TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS beneficiary_payments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tontine_id UUID NOT NULL REFERENCES tontines(id), beneficiary_user_id UUID NOT NULL REFERENCES users(id),
 position_no INT NOT NULL, amount BIGINT NOT NULL CHECK(amount>0), due_date DATE NOT NULL, provider TEXT, source_account_id UUID REFERENCES collection_accounts(id),
 status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN('SCHEDULED','PREPARED','PENDING_ADMIN_VALIDATION','APPROVED','PAYMENT_IN_PROGRESS','PAID','CONFIRMED','REJECTED')),
 provider_reference TEXT UNIQUE, rejection_reason TEXT, approved_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id UUID REFERENCES users(id), action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id UUID,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
 read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tontine_id UUID NOT NULL REFERENCES tontines(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id),
 body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

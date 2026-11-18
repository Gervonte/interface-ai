CREATE TABLE demo.members (
  member_id text PRIMARY KEY CHECK (member_id ~ '^M[0-9]{4}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('active','inactive')),
  account_access boolean NOT NULL
);
CREATE TABLE demo.accounts (
  account_id text PRIMARY KEY CHECK (account_id ~ '^[SC][0-9]{4}$'),
  member_id text NOT NULL REFERENCES demo.members(member_id),
  account_type text NOT NULL CHECK (account_type IN ('savings','checking')),
  is_primary boolean NOT NULL, status text NOT NULL CHECK (status IN ('active','closed')),
  current_balance_minor bigint NOT NULL CHECK (current_balance_minor BETWEEN 0 AND 9007199254740991),
  available_balance_minor bigint NOT NULL CHECK (available_balance_minor BETWEEN 0 AND 9007199254740991),
  currency text NOT NULL CHECK (currency = 'USD'), sort_order integer NOT NULL CHECK (sort_order >= 0),
  CHECK (NOT is_primary OR account_type = 'savings')
);
CREATE UNIQUE INDEX one_primary_savings ON demo.accounts(member_id) WHERE is_primary;
CREATE INDEX member_account_order ON demo.accounts(member_id, sort_order, account_id);
CREATE TABLE demo.fixture_metadata (name text PRIMARY KEY, version integer NOT NULL CHECK (version > 0));

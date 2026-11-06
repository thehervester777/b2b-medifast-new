-- MediFast database schema.
-- Import this file once into an EMPTY database (phpMyAdmin > Import). It is safe to run again:
-- every statement uses IF NOT EXISTS or INSERT IGNORE. It contains no demo rows and no accounts.
-- Needs MySQL 5.7+ or MariaDB 10.3+. All text is utf8mb4 so Bangla and other scripts are stored correctly.
-- Times are stored in UTC. JSON values are stored as text and read by the server.

CREATE TABLE IF NOT EXISTS roles (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(40)  NOT NULL,
  permissions TEXT         NOT NULL,
  is_system   TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admins (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name                 VARCHAR(80)  NOT NULL,
  email                VARCHAR(190) NOT NULL,
  password_hash        VARCHAR(100) NOT NULL,
  role_id              INT UNSIGNED NOT NULL,
  active               TINYINT(1)   NOT NULL DEFAULT 1,
  must_change_password TINYINT(1)   NOT NULL DEFAULT 0,
  last_seen_at         DATETIME(3)  NULL,
  last_ip              VARCHAR(64)  NULL,
  last_device          VARCHAR(120) NULL,
  created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_email (email),
  KEY ix_admins_role (role_id),
  CONSTRAINT fk_admins_role FOREIGN KEY (role_id) REFERENCES roles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS suppliers (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code                 VARCHAR(16)  NULL,
  name                 VARCHAR(120) NOT NULL,
  owner_name           VARCHAR(80)  NOT NULL,
  city                 VARCHAR(60)  NOT NULL DEFAULT '',
  address              VARCHAR(200) NOT NULL DEFAULT '',
  email                VARCHAR(190) NOT NULL,
  phone                VARCHAR(30)  NOT NULL DEFAULT '',
  password_hash        VARCHAR(100) NOT NULL,
  licence              VARCHAR(40)  NOT NULL DEFAULT '',
  tin                  VARCHAR(40)  NOT NULL DEFAULT '',
  status               VARCHAR(12)  NOT NULL DEFAULT 'Pending',
  docs                 TEXT         NULL,
  note                 VARCHAR(255) NOT NULL DEFAULT '',
  must_change_password TINYINT(1)   NOT NULL DEFAULT 0,
  last_login_at        DATETIME(3)  NULL,
  joined_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_suppliers_code (code),
  UNIQUE KEY uq_suppliers_email (email),
  KEY ix_suppliers_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  code          VARCHAR(32)   NULL,
  name          VARCHAR(120)  NOT NULL,
  generic       VARCHAR(120)  NOT NULL DEFAULT '',
  brand         VARCHAR(80)   NOT NULL DEFAULT '',
  stock         INT           NOT NULL DEFAULT 0,
  reorder_level INT           NOT NULL DEFAULT 5,
  buy_price     DECIMAL(12,2) NOT NULL DEFAULT 0,
  sale_price    DECIMAL(12,2) NOT NULL DEFAULT 0,
  status        VARCHAR(12)   NOT NULL DEFAULT 'Active',
  last_sent_at  DATETIME(3)   NULL,
  created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_code (code),
  KEY ix_products_brand (brand)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci AUTO_INCREMENT=3001;

CREATE TABLE IF NOT EXISTS requests (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  name        VARCHAR(120)  NOT NULL,
  generic     VARCHAR(120)  NOT NULL DEFAULT '',
  company     VARCHAR(80)   NOT NULL DEFAULT '',
  qty         INT UNSIGNED  NOT NULL,
  ask_price   DECIMAL(12,2) NOT NULL,
  status      VARCHAR(12)   NOT NULL DEFAULT 'Active',
  no_end      TINYINT(1)    NOT NULL DEFAULT 0,
  deadline_at DATETIME(3)   NULL,
  posted_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  note        VARCHAR(500)  NOT NULL DEFAULT '',
  product_id  INT UNSIGNED  NULL,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_requests_status (status, posted_at),
  KEY ix_requests_product (product_id),
  CONSTRAINT fk_requests_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci AUTO_INCREMENT=1001;

CREATE TABLE IF NOT EXISTS submissions (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id  INT UNSIGNED NOT NULL,
  submitted_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_submissions_supplier (supplier_id),
  CONSTRAINT fk_submissions_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci AUTO_INCREMENT=1001;

CREATE TABLE IF NOT EXISTS quotes (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  request_id    INT UNSIGNED  NOT NULL,
  supplier_id   INT UNSIGNED  NOT NULL,
  submission_id INT UNSIGNED  NULL,
  qty           INT UNSIGNED  NOT NULL,
  price         DECIMAL(12,2) NOT NULL,
  status        VARCHAR(12)   NOT NULL DEFAULT 'Pending',
  submitted_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_at    DATETIME(3)   NULL,
  decided_by    VARCHAR(80)   NOT NULL DEFAULT '',
  reason        VARCHAR(255)  NOT NULL DEFAULT '',
  delivery      VARCHAR(10)   NOT NULL DEFAULT '',
  supplier_note VARCHAR(500)  NOT NULL DEFAULT '',
  created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_quotes_request_supplier (request_id, supplier_id),
  KEY ix_quotes_supplier (supplier_id, status),
  KEY ix_quotes_submission (submission_id),
  KEY ix_quotes_status (status),
  CONSTRAINT fk_quotes_request FOREIGN KEY (request_id) REFERENCES requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_quotes_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_quotes_submission FOREIGN KEY (submission_id) REFERENCES submissions (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci AUTO_INCREMENT=7001;

CREATE TABLE IF NOT EXISTS orders (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  quote_id     INT UNSIGNED  NOT NULL,
  request_id   INT UNSIGNED  NOT NULL,
  supplier_id  INT UNSIGNED  NOT NULL,
  name         VARCHAR(120)  NOT NULL,
  generic      VARCHAR(120)  NOT NULL DEFAULT '',
  company      VARCHAR(80)   NOT NULL DEFAULT '',
  qty          INT UNSIGNED  NOT NULL,
  price        DECIMAL(12,2) NOT NULL,
  ask_price    DECIMAL(12,2) NOT NULL,
  status       VARCHAR(12)   NOT NULL DEFAULT 'Pending',
  expected_at  DATETIME(3)   NOT NULL,
  delivered_at DATETIME(3)   NULL,
  note         VARCHAR(500)  NOT NULL DEFAULT '',
  created_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_quote (quote_id),
  KEY ix_orders_supplier (supplier_id),
  KEY ix_orders_status (status, created_at),
  KEY ix_orders_request (request_id),
  CONSTRAINT fk_orders_quote FOREIGN KEY (quote_id) REFERENCES quotes (id),
  CONSTRAINT fk_orders_request FOREIGN KEY (request_id) REFERENCES requests (id),
  CONSTRAINT fk_orders_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci AUTO_INCREMENT=5001;

CREATE TABLE IF NOT EXISTS order_history (
  id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id INT UNSIGNED NOT NULL,
  status   VARCHAR(12)  NULL,
  note     VARCHAR(255) NULL,
  at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  by_name  VARCHAR(80)  NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY ix_history_order (order_id, at),
  CONSTRAINT fk_history_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id INT UNSIGNED NOT NULL,
  icon        VARCHAR(20)  NOT NULL DEFAULT 'bolt',
  title       VARCHAR(120) NOT NULL,
  body        VARCHAR(400) NOT NULL DEFAULT '',
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  read_at     DATETIME(3)  NULL,
  PRIMARY KEY (id),
  KEY ix_notifications_supplier (supplier_id, created_at),
  CONSTRAINT fk_notifications_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_settings (
  name       VARCHAR(40) NOT NULL,
  value      TEXT        NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only: the application never updates or deletes rows here.
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type       VARCHAR(20)  NOT NULL,
  actor_type VARCHAR(10)  NOT NULL DEFAULT 'admin',
  actor_id   INT UNSIGNED NULL,
  actor_name VARCHAR(120) NOT NULL DEFAULT '',
  text       VARCHAR(400) NOT NULL,
  ref_kind   VARCHAR(20)  NULL,
  ref_id     VARCHAR(40)  NULL,
  ip         VARCHAR(64)  NULL,
  device     VARCHAR(120) NULL,
  at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_audit_at (at),
  KEY ix_audit_actor (actor_type, actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token_hash CHAR(64)     NOT NULL,
  actor_type VARCHAR(10)  NOT NULL,
  actor_id   INT UNSIGNED NOT NULL,
  expires_at DATETIME(3)  NOT NULL,
  remember   TINYINT(1)   NOT NULL DEFAULT 0,
  ip         VARCHAR(64)  NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token (token_hash),
  KEY ix_sessions_actor (actor_type, actor_id),
  KEY ix_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
  id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind  VARCHAR(10)  NOT NULL,
  email VARCHAR(190) NOT NULL DEFAULT '',
  ip    VARCHAR(64)  NOT NULL DEFAULT '',
  at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_attempts_email (kind, email, at),
  KEY ix_attempts_ip (kind, ip, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What "Undo" needs to put a change back. Rows expire after one minute and are removed by the server.
CREATE TABLE IF NOT EXISTS undo_log (
  token      CHAR(32)     NOT NULL,
  admin_id   INT UNSIGNED NOT NULL,
  label      VARCHAR(200) NOT NULL DEFAULT '',
  payload    MEDIUMTEXT   NOT NULL,
  expires_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (token),
  KEY ix_undo_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta (
  k VARCHAR(40) NOT NULL,
  v BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- defaults (no demo data, no accounts) ----------

INSERT IGNORE INTO meta (k, v) VALUES ('data_version', 1), ('schema_version', 1);

INSERT IGNORE INTO roles (name, permissions, is_system) VALUES
  ('Owner', '["dashboard.view","requests.view","requests.manage","quotes.view","quotes.decide","orders.view","orders.manage","orders.documents","products.view","products.manage","products.send","suppliers.view","suppliers.manage","reports.view","reports.export","audit.view","site.manage","settings.manage","access.manage"]', 1),
  ('Manager', '["dashboard.view","requests.view","requests.manage","quotes.view","quotes.decide","orders.view","orders.manage","orders.documents","products.view","products.manage","products.send","suppliers.view","suppliers.manage","reports.view","reports.export","audit.view","site.manage"]', 1),
  ('Reviewer', '["dashboard.view","requests.view","quotes.view","quotes.decide","orders.view","products.view","suppliers.view"]', 1),
  ('Warehouse', '["dashboard.view","orders.view","orders.manage","orders.documents","products.view","suppliers.view"]', 1),
  ('Finance', '["dashboard.view","quotes.view","orders.view","orders.documents","suppliers.view","reports.view","reports.export"]', 1);

INSERT IGNORE INTO site_settings (name, value) VALUES
  ('settings', '{"requireReason":true,"flagLowPrice":true,"lowPricePct":25,"reviewHours":48,"leadDays":4,"rejectOthersOnAward":true,"notifyPending":true,"notifyDigest":false,"notifySuppliers":false}'),
  ('notice', '{"on":false,"tone":"info","title":"","body":"","audience":"suppliers","dismissible":true,"scheduled":false,"startAt":null,"endAt":null}'),
  ('maintenance', '{"mode":"off","message":"We are updating the supplier app. Quotes you already sent are safe. Please check back soon.","startAt":null,"endAt":null}');

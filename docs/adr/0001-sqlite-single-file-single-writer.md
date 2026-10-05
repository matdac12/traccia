# SQLite as the only datastore, one writer process

All state is one SQLite file (WAL, FTS5, `better-sqlite3`) plus an attachments folder under `DATA_DIR`, owned by a single backend process. We chose it over Postgres, which already runs on the VPS, because it keeps RAM low (the VPS is small), makes backup a file snapshot, and fits one human plus a few agents. The cost is that a second backend instance must never open the same file.

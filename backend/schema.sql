
CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45) NOT NULL UNIQUE,
    mac_address VARCHAR(17),
    device_type VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS status_history (
    id SERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL
        REFERENCES devices(id) ON DELETE CASCADE,
    status VARCHAR(10) NOT NULL
        CHECK (status IN ('online', 'offline', 'unknown')),
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    latency_ms INTEGER
        CHECK (latency_ms IS NULL OR latency_ms >= 0)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (ip, window_start)
);

-- Atomic increment: inserts a new row for this minute-window, or increments the existing one.
-- Returns the updated request count.
CREATE OR REPLACE FUNCTION increment_rate_limit(p_ip TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
  v_window TIMESTAMPTZ := date_trunc('minute', NOW());
BEGIN
  INSERT INTO rate_limits (ip, window_start, request_count)
  VALUES (p_ip, v_window, 1)
  ON CONFLICT (ip, window_start) DO UPDATE
    SET request_count = rate_limits.request_count + 1
  RETURNING request_count INTO v_count;
  RETURN v_count;
END;
$$;

-- Auto-clean rows older than 1 hour so the table doesn't grow forever
CREATE OR REPLACE FUNCTION cleanup_rate_limits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour';
$$;

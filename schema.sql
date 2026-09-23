-- Схема БД «Двоичная змейка» (PostgreSQL)
-- Приложение создаёт таблицы само через SQLAlchemy,
-- но этот файл можно выполнить вручную в psql на сервере.

CREATE TABLE IF NOT EXISTS users (
    id         SERIAL PRIMARY KEY,
    nickname   VARCHAR(32) NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_users_nickname ON users (nickname);

CREATE TABLE IF NOT EXISTS scores (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    score      INTEGER NOT NULL DEFAULT 0,
    stars      INTEGER NOT NULL DEFAULT 0,
    levels     INTEGER NOT NULL DEFAULT 0,
    errors     INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_scores_user_id ON scores (user_id);
CREATE INDEX IF NOT EXISTS ix_scores_created_at ON scores (created_at);

-- Таблица лидеров: лучший результат каждого игрока
CREATE OR REPLACE VIEW leaderboard AS
SELECT u.nickname,
       MAX(s.score) AS best_score,
       MAX(s.stars) AS best_stars
FROM users u
JOIN scores s ON s.user_id = u.id
GROUP BY u.id, u.nickname
ORDER BY best_score DESC;

import os

from dotenv import load_dotenv

# Загружаем ТОЛЬКО локальный .env проекта (рядом с config.py),
# чтобы случайные .env в родительских папках не влияли на приложение.
_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
try:
    load_dotenv(_ENV_PATH, encoding="utf-8")
except Exception:
    # некорректный .env не должен ронять приложение
    pass


class Config:
    """Конфигурация приложения.

    DATABASE_URL — строка подключения к PostgreSQL.
    На Timeweb её выдают в панели «Базы данных» примерно так:

        postgresql://user:password@host:5432/dbname

    Если переменная не задана, для локальной разработки используется SQLite.
    """

    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")

    _db_url = os.getenv("DATABASE_URL", "").strip()

    if _db_url:
        # Timeweb иногда отдаёт postgres://, SQLAlchemy ожидает postgresql://
        if _db_url.startswith("postgres://"):
            _db_url = _db_url.replace("postgres://", "postgresql://", 1)
        SQLALCHEMY_DATABASE_URI = _db_url
    else:
        SQLALCHEMY_DATABASE_URI = "sqlite:///snake_local.db"

    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        # Полезно для удержания соединения на хостинге
        "pool_pre_ping": True,
        "pool_recycle": 300,
    }

    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"

    NICKNAME_MIN = 2
    NICKNAME_MAX = 20

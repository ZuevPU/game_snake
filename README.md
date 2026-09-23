# 🐍 Двоичная змейка — Flask + PostgreSQL

Обучающая игра для 8 класса: переведи десятичное число в двоичный код, ведя змейку к правильным битам. Рекорды сохраняются в PostgreSQL. Готово к размещению на Timeweb.

## Стек

- **Flask 3** — веб-сервер и API
- **Flask-SQLAlchemy + psycopg2** — работа с PostgreSQL
- **Gunicorn** — WSGI-сервер для продакшена
- **Vanilla JS + Canvas** — игра в браузере (без сборки фронтенда)

## Структура

```
змейка/
├── app.py              # маршруты Flask, API
├── config.py           # конфигурация (DATABASE_URL, SECRET_KEY)
├── models.py           # модели User и Score, таблица лидеров
├── wsgi.py             # точка входа для Gunicorn
├── schema.sql          # SQL-схема (необязательно, создаётся автоматически)
├── requirements.txt    # зависимости
├── Procfile            # команда запуска для хостинга
├── Dockerfile          # образ для деплоя
├── docker-compose.yml  # локальный запуск с PostgreSQL
├── .env.example        # шаблон переменных окружения
├── static/
│   ├── css/style.css
│   └── js/common.js    # тема и звук (общие)
│       js/game.js      # логика игры + отправка рекорда
└── templates/
    ├── base.html
    ├── index.html      # вход по нику
    ├── lobby.html      # меню игрока, топ-5
    ├── game.html       # игра
    └── leaderboard.html# таблица лидеров
```

## Локальный запуск

```bash
cd змейка
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env      # и заполни DATABASE_URL
python app.py
```

Открой http://localhost:5000

> Если `DATABASE_URL` не задан, приложение автоматически использует локальный SQLite (`instance/snake_local.db`) — удобно для проверки без базы.

## База данных

Таблицы создаются автоматически при первом запуске (`db.create_all()`).

- **users** — `id`, `nickname` (уникальный), `created_at`
- **scores** — `id`, `user_id`, `score`, `stars`, `levels`, `errors`, `created_at`

Каждая игра добавляет новую строку в `scores`, а рекорд игрока берётся как `MAX(score)`.

## Развёртывание на Timeweb

1. **Создай базу PostgreSQL** в панели Timeweb → «Базы данных». Скопируй строку подключения вида
   `postgresql://user:password@host:5432/dbname`.
2. **Загрузи проект** (Git или файловый менеджер) на сервер/хостинг.
3. **Задай переменные окружения** (в панели приложения или в `.env`):
   ```
   DATABASE_URL=postgresql://user:password@host:5432/dbname
   SECRET_KEY=<длинная случайная строка>
   ```
4. **Установи зависимости и запусти**:
   ```bash
   pip install -r requirements.txt
   gunicorn -w 4 -k gthread --threads 4 -b 0.0.0.0:8080 wsgi:app
   ```
   На Timeweb также достаточно указать стартовую команду из `Procfile`.
5. Открой домен сервера — приложение проверяет соединение с БД через `pool_pre_ping`.

> Порт на Timeweb обычно задаётся переменной `$PORT` — она уже используется в `Procfile`.
> Для HTTPS задай `SESSION_COOKIE_SECURE=True` в `config.py`.

### Вариант через Docker (рекомендуется)

В репозитории есть `Dockerfile` и `docker-compose.yml`.

```bash
# Локально с PostgreSQL
docker compose up --build      # http://localhost:8080
```

На **Timeweb Cloud → App Platform**:
1. Создай приложение из GitHub-репозитория `ZuevPU/game_snake`.
2. Тип сборки — **Dockerfile** (он определяется автоматически).
3. Добавь переменные окружения `DATABASE_URL` и `SECRET_KEY`.
4. Порт приложения — `8080` (берётся из `$PORT`).
5. Задеплой — миграции не нужны, таблицы создаются при старте.

## API

| Метод | Путь                | Назначение                       |
|-------|---------------------|----------------------------------|
| POST  | `/login`            | Вход/регистрация по нику         |
| POST  | `/logout`           | Выход                            |
| POST  | `/api/score`        | Сохранить результат игры (JSON)  |
| GET   | `/api/leaderboard`  | Таблица лидеров (JSON)           |
| GET   | `/api/me`           | Профиль текущего игрока (JSON)   |
| GET   | `/health`           | Проверка живости                 |

## Как играть

- Биты собираются **от младшего разряда к старшему**.
- Панель «Текущий разряд» показывает вес бита `2ⁿ`, «Остаток» — что ещё осталось закодировать. Чётность остатка подсказывает нужный бит.
- Управление: стрелки / WASD / свайпы / кнопки. `Space` — пауза, `H` — подсказка.
- 3 жизни, 8 уровней, звёзды за точность, бонус-бит ★ даёт +30 и замедление.

## Заметки по безопасности

Вход сделан по нику без пароля — для школьной игры это просто, но никто не помешает занять чужой ник. Если нужна защита, добавьте поле `password_hash` (werkzeug) и форму с паролем: модели и маршруты легко расширяются.

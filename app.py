import os
import re
import sys

# Свой .env уже загружает config.py (только локальный).
# Отключаем автозагрузчик Flask, чтобы он не искал .env в родительских папках.
os.environ.setdefault("FLASK_SKIP_DOTENV", "1")

from flask import (
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from sqlalchemy import text

from config import Config
from models import Score, User, db

NICKNAME_RE = re.compile(r"^[A-Za-zА-Яа-яЁё0-9 _\-]{2,20}$")

app = Flask(__name__)
app.config.from_object(Config)
db.init_app(app)


# ------------------------------------------------------------------
# Инициализация БД
#
# Важно: под Gunicorn приложение импортируется КАЖДЫМ воркером
# одновременно. Если просто вызвать db.create_all(), воркеры гонятся
# за создание одних и тех же таблиц и падают с ошибкой
# "duplicate key value violates unique constraint pg_class_relname_nsp_index".
# Поэтому инициализацию сериализуем через advisory-lock PostgreSQL:
# таблицы создаёт только первый воркер, остальные ждут и видят готовую схему.
# ------------------------------------------------------------------
DB_INIT_LOCK_ID = 728274001


def init_db():
    with app.app_context():
        if db.engine.dialect.name != "postgresql":
            # SQLite и прочие локальные варианты — блокировка не нужна
            db.create_all()
            return

        with db.engine.connect() as conn:
            conn.execute(text("SELECT pg_advisory_lock(:id)"), {"id": DB_INIT_LOCK_ID})
            conn.commit()
            try:
                db.create_all()
            finally:
                conn.execute(
                    text("SELECT pg_advisory_unlock(:id)"), {"id": DB_INIT_LOCK_ID}
                )
                conn.commit()


try:
    init_db()
except Exception as exc:  # noqa: BLE001
    # Не роняем воркер: если таблицы уже есть, работать можно.
    print(f"[init_db] warning: {exc}", file=sys.stderr)


# ------------------------------------------------------------------
# Вспомогательные функции
# ------------------------------------------------------------------
def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    return db.session.get(User, uid)


def validate_nickname(raw):
    nick = (raw or "").strip()
    if not NICKNAME_RE.match(nick):
        return None
    return nick


def login_required(view):
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_user():
            session.clear()
            return redirect(url_for("index"))
        return view(*args, **kwargs)

    return wrapped


# ------------------------------------------------------------------
# Страницы
# ------------------------------------------------------------------
@app.route("/")
def index():
    user = current_user()
    if user:
        return redirect(url_for("lobby"))
    return render_template("index.html")


@app.get("/lobby")
@login_required
def lobby():
    user = current_user()
    top = Score.leaderboard(limit=5)
    return render_template("lobby.html", user=user, top=top)


@app.get("/play")
@login_required
def play():
    user = current_user()
    return render_template("game.html", user=user)


@app.get("/leaderboard")
def leaderboard():
    user = current_user()
    top = Score.leaderboard(limit=50)
    return render_template("leaderboard.html", user=user, top=top)


@app.get("/health")
def health():
    return jsonify(status="ok")


# ------------------------------------------------------------------
# Аутентификация (по нику)
# ------------------------------------------------------------------
@app.post("/login")
def login():
    nickname = validate_nickname(request.form.get("nickname"))
    if not nickname:
        return (
            render_template(
                "index.html",
                error="Ник: 2–20 символов, буквы, цифры, пробел, дефис или _.",
            ),
            400,
        )

    user = User.query.filter(
        db.func.lower(User.nickname) == nickname.lower()
    ).first()
    if user is None:
        user = User(nickname=nickname)
        db.session.add(user)
        db.session.commit()

    session.clear()
    session["user_id"] = user.id
    session["nickname"] = user.nickname
    return redirect(url_for("lobby"))


@app.post("/logout")
@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


# ------------------------------------------------------------------
# API
# ------------------------------------------------------------------
@app.post("/api/score")
@login_required
def save_score():
    user = current_user()
    data = request.get_json(silent=True) or {}

    def clamp_int(value, lo, hi):
        try:
            n = int(value)
        except (TypeError, ValueError):
            n = lo
        return max(lo, min(hi, n))

    score = clamp_int(data.get("score"), 0, 1_000_000)
    stars = clamp_int(data.get("stars"), 0, 999)
    levels = clamp_int(data.get("levels"), 0, 999)
    errors = clamp_int(data.get("errors"), 0, 100_000)

    entry = Score(
        user_id=user.id,
        score=score,
        stars=stars,
        levels=levels,
        errors=errors,
    )
    db.session.add(entry)
    db.session.commit()

    rank = None
    top = Score.leaderboard(limit=1000)
    for i, row in enumerate(top, start=1):
        if row["nickname"] == user.nickname:
            rank = i
            break

    best, best_stars, best_levels = user.best_stats()
    return jsonify(
        ok=True,
        personal_best=int(best),
        best_stars=int(best_stars),
        best_levels=int(best_levels),
        rank=rank,
    )


@app.get("/api/leaderboard")
def api_leaderboard():
    limit = request.args.get("limit", 20, type=int)
    limit = max(1, min(100, limit))
    return jsonify(leaderboard=Score.leaderboard(limit=limit))


@app.get("/api/me")
@login_required
def api_me():
    user = current_user()
    return jsonify(user=user.to_dict())


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

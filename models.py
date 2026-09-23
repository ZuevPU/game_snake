from datetime import datetime

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    nickname = db.Column(db.String(32), unique=True, nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    scores = db.relationship(
        "Score",
        backref="user",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    def best_score(self):
        row = (
            self.scores.order_by(Score.score.desc(), Score.created_at.asc()).first()
        )
        return row.score if row else 0

    def best_stats(self):
        """Лучший результат: максимальные очки, звёзды и уровни."""
        return (
            db.session.query(
                db.func.coalesce(db.func.max(Score.score), 0),
                db.func.coalesce(db.func.max(Score.stars), 0),
                db.func.coalesce(db.func.max(Score.levels), 0),
            )
            .filter(Score.user_id == self.id)
            .first()
        )

    def to_dict(self):
        best, stars, levels = self.best_stats()
        return {
            "nickname": self.nickname,
            "best": int(best),
            "stars": int(stars),
            "levels": int(levels),
        }

    def __repr__(self):
        return f"<User {self.nickname}>"


class Score(db.Model):
    __tablename__ = "scores"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    score = db.Column(db.Integer, default=0, nullable=False)
    stars = db.Column(db.Integer, default=0, nullable=False)
    levels = db.Column(db.Integer, default=0, nullable=False)
    errors = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)

    def __repr__(self):
        return f"<Score {self.user_id}:{self.score}>"

    @staticmethod
    def leaderboard(limit=20):
        """Топ игроков: лучший результат каждого пользователя."""
        best_per_user = (
            db.session.query(
                Score.user_id.label("user_id"),
                db.func.max(Score.score).label("best_score"),
            )
            .group_by(Score.user_id)
            .subquery()
        )

        rows = (
            db.session.query(
                User.nickname,
                best_per_user.c.best_score,
            )
            .join(best_per_user, User.id == best_per_user.c.user_id)
            .order_by(best_per_user.c.best_score.desc(), User.nickname.asc())
            .limit(limit)
            .all()
        )
        return [{"nickname": r.nickname, "best": int(r.best_score)} for r in rows]

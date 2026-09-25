"""contracts.md §2.1: register, login, logout, me. Shapes unchanged from #74; the models are
`schemas.py`'s (`Credentials`, `Session`, `Me`)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response
from fastapi.security import HTTPBearer

from ..deps import AuthConnDep, CallerDep, SettingsDep
from ..errors import ApiError
from ..schemas import Credentials, Me, Session
from ..security import create_session, hash_password, now_iso, revoke_session, verify_password
from ._shared import json_body

router = APIRouter()


_optional_bearer = HTTPBearer(auto_error=False)


def _raw_bearer(
    credentials: Annotated[Any, Depends(_optional_bearer)],
) -> str | None:
    return None if credentials is None else str(credentials.credentials)


@router.post("/auth/register", response_model=Session, status_code=status.HTTP_201_CREATED)
async def register(
    body: Annotated[Credentials, Depends(json_body(Credentials))],
    conn: AuthConnDep,
    settings: SettingsDep,
) -> Session:
    from papertree_db import PaperTreeDb

    db = PaperTreeDb(settings.database_file)
    try:
        try:
            created = db.create_user(body.email)
        except Exception as exc:  # sqlite3.IntegrityError on users_email_unique
            # 409 rather than a 500, and deliberately not "that email is taken" phrasing in a
            # way that differs from a wrong-password response — see `login`.
            raise ApiError("email_taken", "could not create that account") from exc
    finally:
        db.close()

    stamp = now_iso()
    conn.execute(
        "INSERT INTO user_credentials (user_id, password_hash, created_at, updated_at) "
        "VALUES (?, ?, ?, ?)",
        (created.user_id, hash_password(body.password), stamp, stamp),
    )
    token = create_session(conn, created.user_id, hours=settings.session_hours)
    return Session(token=token, user_id=created.user_id, email=body.email)


@router.post("/auth/login", response_model=Session)
async def login(
    body: Annotated[Credentials, Depends(json_body(Credentials))],
    conn: AuthConnDep,
    settings: SettingsDep,
) -> Session:
    row = conn.execute(
        "SELECT u.user_id AS user_id, u.email AS email, c.password_hash AS password_hash "
        "FROM users u JOIN user_credentials c ON c.user_id = u.user_id WHERE u.email = ?",
        (body.email,),
    ).fetchone()

    # ONE message and ONE status for "no such user" and "wrong password". Distinguishing them
    # turns the login route into an account-enumeration oracle.
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise ApiError(
            "invalid_credentials",
            "invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_session(conn, row["user_id"], hours=settings.session_hours)
    return Session(token=token, user_id=row["user_id"], email=row["email"])


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    conn: AuthConnDep,
    authorization: Annotated[str | None, Depends(_raw_bearer)],
) -> Response:
    # Revocation is what the session table buys over a signed token; see 0004_auth.sql.
    if authorization is not None:
        revoke_session(conn, authorization)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/auth/me", response_model=Me)
async def me(call: CallerDep, conn: AuthConnDep) -> dict[str, str]:
    row = conn.execute("SELECT email FROM users WHERE user_id = ?", (call.user_id,)).fetchone()
    if row is None:
        raise ApiError("not_found", "no such user")
    return {"user_id": call.user_id, "email": row["email"]}

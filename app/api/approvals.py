"""
数据库写入人工审批模块

工具层遇到 INSERT/UPDATE/DELETE/DDL 等非只读 SQL 时，不直接执行，而是创建
pending approval。前端收到 approval_required 事件后展示审核框，用户批准后再由
后端执行对应 SQL。
"""

import datetime
import os
import uuid
from typing import Any, Optional

from dotenv import load_dotenv
from mysql.connector import Error, connect

from app.api.context import get_thread_context

load_dotenv()


APPROVAL_STATUS_PENDING = "pending"
APPROVAL_STATUS_APPROVED = "approved"
APPROVAL_STATUS_REJECTED = "rejected"
APPROVAL_STATUS_FAILED = "failed"

pending_approvals: dict[str, dict[str, Any]] = {}


def _get_db_config() -> dict[str, Any]:
    config = {
        "host": os.getenv("MYSQL_HOST", "localhost"),
        "port": int(os.getenv("MYSQL_PORT", "3306")),
        "user": os.getenv("MYSQL_USER"),
        "password": os.getenv("MYSQL_PASSWORD"),
        "database": os.getenv("MYSQL_DATABASE"),
        "charset": os.getenv("MYSQL_CHARSET", "utf8mb4"),
        "collation": os.getenv("MYSQL_COLLATION", "utf8mb4_unicode_ci"),
        "autocommit": True,
        "sql_mode": os.getenv("MYSQL_SQL_MODE", "TRADITIONAL"),
    }
    config = {k: v for k, v in config.items() if v is not None}
    missing_keys = [key for key in ("user", "password", "database") if key not in config]
    if missing_keys:
        raise ValueError(f"缺失数据库核心配置：{', '.join(missing_keys)}")
    return config


def create_sql_approval(query: str, reason: str) -> dict[str, Any]:
    approval_id = str(uuid.uuid4())
    now = datetime.datetime.now().isoformat()
    approval = {
        "id": approval_id,
        "thread_id": get_thread_context(),
        "query": query,
        "reason": reason,
        "status": APPROVAL_STATUS_PENDING,
        "created_at": now,
        "updated_at": now,
        "result": None,
        "error": None,
    }
    pending_approvals[approval_id] = approval
    return approval.copy()


def get_sql_approval(approval_id: str) -> Optional[dict[str, Any]]:
    approval = pending_approvals.get(approval_id)
    return approval.copy() if approval else None


def approve_sql_approval(approval_id: str) -> dict[str, Any]:
    approval = pending_approvals.get(approval_id)
    if not approval:
        raise KeyError("审批不存在")
    if approval["status"] != APPROVAL_STATUS_PENDING:
        return approval.copy()

    try:
        with connect(**_get_db_config()) as conn:
            with conn.cursor() as cursor:
                cursor.execute(approval["query"])
                affected_rows = cursor.rowcount

        approval["status"] = APPROVAL_STATUS_APPROVED
        approval["result"] = {
            "affected_rows": affected_rows,
            "message": f"SQL 已审批并执行，影响行数：{affected_rows}",
        }
        approval["updated_at"] = datetime.datetime.now().isoformat()
        return approval.copy()
    except (Error, ValueError) as e:
        approval["status"] = APPROVAL_STATUS_FAILED
        approval["error"] = str(e)
        approval["updated_at"] = datetime.datetime.now().isoformat()
        return approval.copy()


def reject_sql_approval(approval_id: str, reason: str = "") -> dict[str, Any]:
    approval = pending_approvals.get(approval_id)
    if not approval:
        raise KeyError("审批不存在")
    if approval["status"] == APPROVAL_STATUS_PENDING:
        approval["status"] = APPROVAL_STATUS_REJECTED
        approval["result"] = {
            "message": "SQL 已被人工拒绝，未执行。",
            "reject_reason": reason,
        }
        approval["updated_at"] = datetime.datetime.now().isoformat()
    return approval.copy()

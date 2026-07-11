"""
MySQL 数据库查询工具模块

封装数据库查询助手使用的三个 LangChain 工具：
list_sql_tables 用于发现真实表名，get_table_data 用于预览字段和样例数据，
execute_sql_query 用于在确认结构后执行自定义查询。
"""

import os
import re

from dotenv import load_dotenv
from langchain_core.tools import tool
from mysql.connector import Error, connect

from app.api.approvals import create_sql_approval
from app.api.monitor import monitor

load_dotenv()


READ_ONLY_SQL_PREFIXES = ("select", "show", "describe", "desc", "explain", "with")
WRITE_OR_ADMIN_SQL_KEYWORDS = {
    "alter",
    "call",
    "create",
    "delete",
    "drop",
    "grant",
    "insert",
    "load",
    "rename",
    "replace",
    "revoke",
    "set",
    "truncate",
    "update",
}


def _strip_sql_comments_and_literals(query: str) -> str:
    """
    移除注释和字符串字面量，便于做保守的 SQL 安全分类。

    这里不是完整 SQL parser；目标是防止 Agent 直接执行写入/DDL/管理类语句。
    对无法明确判定为只读的 SQL，统一转交人工审核。
    """
    no_block_comments = re.sub(r"/\*.*?\*/", " ", query, flags=re.S)
    no_line_comments = re.sub(r"(--|#).*?$", " ", no_block_comments, flags=re.M)
    no_single_quotes = re.sub(r"'(?:''|\\'|[^'])*'", "''", no_line_comments)
    no_double_quotes = re.sub(r'"(?:""|\\\"|[^"])*"', '""', no_single_quotes)
    return no_double_quotes.strip()


def _has_multiple_statements(query: str) -> bool:
    stripped = query.strip()
    if not stripped:
        return False
    without_trailing_semicolon = stripped[:-1] if stripped.endswith(";") else stripped
    return ";" in without_trailing_semicolon


def _classify_sql(query: str) -> tuple[bool, str]:
    """
    返回 (是否允许直接执行, 原因)。

    只读查询允许直接执行；写入、DDL、权限、存储过程、多语句等都要求人工审核。
    """
    if not query or not query.strip():
        return False, "SQL 为空"

    normalized = _strip_sql_comments_and_literals(query)
    if not normalized:
        return False, "SQL 为空或仅包含注释"

    if _has_multiple_statements(normalized):
        return False, "检测到多条 SQL 语句"

    lowered = normalized.lower().lstrip()
    first_token_match = re.match(r"([a-z]+)", lowered)
    first_token = first_token_match.group(1) if first_token_match else ""
    if first_token not in READ_ONLY_SQL_PREFIXES:
        return False, f"SQL 以 {first_token or '未知关键字'} 开头，不属于只读查询"

    keywords = set(re.findall(r"\b[a-z_]+\b", lowered))
    dangerous_keywords = sorted(keywords & WRITE_OR_ADMIN_SQL_KEYWORDS)
    if dangerous_keywords:
        return False, f"检测到写入或管理类关键字: {', '.join(dangerous_keywords)}"

    return True, "只读查询"


def _format_sql_review_required(query: str, reason: str) -> str:
    approval = create_sql_approval(query, reason)
    monitor.report_approval_required(approval)
    return (
        "该 SQL 涉及数据库修改或高风险操作，已被工具层拦截，未执行。\n"
        f"审批 ID：{approval['id']}\n"
        f"拦截原因：{reason}\n"
        "请在前端人工审核弹窗中选择批准或拒绝；批准后后端才会执行该 SQL。\n"
        "审核前请检查 SQL 的影响范围、目标表、WHERE 条件和回滚方案。\n"
        f"待审核 SQL：\n{query}"
    )


def _escape_sql_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "''")


def _quote_table_name(table_name: str) -> str:
    """
    get_table_data 只接受单个普通表名，避免表名参数拼接注入。
    """
    if not isinstance(table_name, str):
        raise ValueError("表名必须是字符串")
    cleaned = table_name.strip().strip("`")
    if not re.fullmatch(r"[A-Za-z0-9_]+", cleaned):
        raise ValueError("表名只能包含英文字母、数字和下划线")
    return f"`{cleaned}`"


def _create_write_approval(query: str, reason: str) -> str:
    approval = create_sql_approval(query, reason)
    monitor.report_approval_required(approval)
    return (
        "已生成数据库修改审批单，SQL 尚未执行。\n"
        f"审批 ID：{approval['id']}\n"
        f"审批原因：{reason}\n"
        "请在前端人工审核弹窗中检查并批准或拒绝。\n"
        "重要：本次写入请求已经进入人工审核流程，当前工具调用到此结束；"
        "不要为了“直接执行”而再次调用本工具或重复生成同一审批单。\n"
        "审批通过、拒绝或执行失败的最终结果会由前端审批事件返回给用户。\n"
        f"待审核 SQL：\n{query}"
    )


# 集中读取数据库配置，后续三个工具都复用这份连接参数
def get_db_config():
    """
    从环境变量读取 MySQL 连接配置

    所有数据库工具都通过此函数拿到同一份连接参数，避免每个工具重复读取环境变量
    :return: mysql.connector.connect 可直接使用的连接参数
    """
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

    # 去掉未配置的可选项，避免把 None 传给 mysql.connector 造成连接参数异常
    config = {k: v for k, v in config.items() if v is not None}

    # user/password/database 是本教程工具能正常查询业务库的最小必要配置
    required_keys = ["user", "password", "database"]
    missing_keys = [k for k in required_keys if k not in config]
    if missing_keys:
        raise ValueError(f"缺失数据库核心配置：{', '.join(missing_keys)}")

    return config


@tool
def list_sql_tables() -> str:
    """
    查询当前数据库中所有可用表

    作用：让模型先识别真实可用的表名，方便后续预览表结构和编写自定义 SQL。
    :return: 有表：可用的表有：表1,表2,表3...
             没有表：没有可用的表
             出现异常：查询出现异常：异常信息
    """

    # 埋点：工具一被调用，前端可以展示当前正在查询数据库表名
    monitor.report_tool(tool_name="数据库表名查询工具：list_sql_tables", args={})

    # 加载数据库连接信息
    config = get_db_config()

    # MySQL 查询的固定步骤：
    # 1. 创建连接
    # 2. 创建 cursor
    # 3. 执行 SQL
    # 4. 获取返回结果
    # 5. 释放连接和 cursor 资源
    # 这里捕获异常并返回中文提示，避免工具报错直接中断 Agent 执行链路
    try:
        # 使用 with 管理连接和游标，查询结束后自动释放数据库资源
        with connect(**config) as conn:
            with conn.cursor() as cursor:
                sql = "SHOW TABLES"
                cursor.execute(sql)

                # SHOW TABLES 返回形如：[("drugs",), ("inventory",), ("sales_records",)]
                tables = cursor.fetchall()
                if not tables:
                    return "没有可用的表"

                # 取每个元组的第一个元素，拼成模型容易阅读的表名列表
                table_names = [table[0] for table in tables]
                return f"可用的表有：{', '.join(table_names)}"
    except Error as e:
        return f"查询出现异常：{str(e)}"


@tool
def get_table_data(table_name) -> str:
    """
    查询指定表的前 100 行数据

    当前工具调用之前，应先调用 list_sql_tables 完成表名校验。
    此工具的作用：
    1. 完成单表样例数据查询
    2. 为多表查询提供表结构信息和数据格式参考
    :param table_name: 表名
    :return: CSV 格式数据
             1. 第一行是列信息，列之间使用英文逗号分隔
             2. 第二行开始是表数据，值之间也使用英文逗号分隔
             3. 行和行之间使用 \n 分隔
             4. 至多查询 100 条表数据
             例如：
                id,name,age\n -> 列头
                1,张三,18\n
                1,张三,18\n
                1,张三,18\n -> 至多查询 100 条
    """
    # 埋点：工具二被调用，前端可以展示当前正在预览哪张表
    monitor.report_tool(
        tool_name="数据库表数据查询工具：get_table_data",
        args={"table_name": table_name},
    )

    # 获取数据库参数
    config = get_db_config()

    # 查询流程同样是：连接 -> cursor -> 执行 SQL -> 获取列信息和数据 -> 自动释放资源
    try:
        quoted_table_name = _quote_table_name(table_name)
        with connect(**config) as conn:
            with conn.cursor() as cursor:
                # 表名参数已做单表名校验和反引号包裹，避免拼接注入
                sql = f"SELECT * FROM {quoted_table_name} LIMIT 100"
                cursor.execute(sql)

                # cursor.description 保存查询结果的列元信息
                # 例如：[("id", ...), ("name", ...), ("age", ...)]
                # 如果 SQL 没有结果集，description 可能为 None
                description = cursor.description
                if not description:
                    return f"数据表 {table_name} 暂无数据。"

                # 只取每个列信息元组的第一个元素，也就是列名
                # 例如：["id", "name", "age"]
                columns = [desc[0] for desc in description]

                # fetchall 返回表数据，形如：[(1, "张三", 18), (2, "李四", 20)]
                rows = cursor.fetchall()

                # 把每一行数据从元组转成 CSV 行文本
                # 例如：(1, "张三", 18) -> "1,张三,18"
                results = [",".join(map(str, row)) for row in rows]

                # columns 组成 CSV 头部，rows 组成 CSV 数据体
                # 最终返回：
                # id,name,age
                # 1,张三,18
                header_str = ",".join(columns)
                data_str = "\n".join(results)
                return f"{header_str}\n{data_str}"
    except ValueError as e:
        return f"查询出现异常：{str(e)}"
    except Error as e:
        return f"查询出现异常：{str(e)}"


@tool
def execute_sql_query(query) -> str:
    """
    执行自定义 SQL 查询；写入或高风险 SQL 会被拦截并转为人工审核请求

    切记：执行之前，需要通过 list_sql_tables 明确真实表名，
    再通过 get_table_data 明确表结构和数据格式。
    适合多表关联、筛选、聚合、排序等复杂只读查询。
    允许直接执行 SELECT、SHOW、DESCRIBE、EXPLAIN、WITH 等只读语句。
    INSERT、UPDATE、DELETE、DROP、ALTER、TRUNCATE 等修改或管理语句不会被执行，
    工具会返回待人工审核的 SQL 和拦截原因。
    :param query: 要执行的自定义 SQL 语句
    :return: CSV 格式数据
             1. 第一行是列信息，列之间使用英文逗号分隔
             2. 第二行开始是表数据，值之间也使用英文逗号分隔
             3. 行和行之间使用 \n 分隔
             例如：
                id,name,age\n -> 列头
                1,张三,18\n
                1,张三,18\n
    """
    # 埋点：记录模型最终生成的 SQL，便于教学时观察是否真的落到了正确表字段上
    monitor.report_tool(
        tool_name="数据库表数据查询工具：execute_sql_query", args={"query": query}
    )

    allowed, reason = _classify_sql(query)
    if not allowed:
        return _format_sql_review_required(query, reason)

    # 获取数据库参数
    config = get_db_config()

    # 自定义查询和 get_table_data 的结果处理逻辑一致：
    # 执行 SQL -> 读取 description 得到列名 -> fetchall 得到数据 -> 拼成 CSV 返回
    try:
        with connect(**config) as conn:
            with conn.cursor() as cursor:
                # 当前章节依赖提示词约束模型生成只读查询；生产环境建议在工具层限制 SELECT/SHOW
                cursor.execute(query)

                # 非查询类 SQL 没有结果集描述，这里统一返回提示，避免工具调用直接抛错给模型
                description = cursor.description
                if not description:
                    return f"执行自定义 SQL 语句没有查询结果，SQL 为：{query}"
                # description => [("列1", ...), ("列2", ...)]
                columns = [desc[0] for desc in description]

                # rows => [(值1, 值2), (值1, 值2)]
                rows = cursor.fetchall()

                # 每行元组统一转为逗号分隔文本，便于模型读取和后续整理
                results = [",".join(map(str, row)) for row in rows]

                # 第一行是列名，后续是查询数据
                header_str = ",".join(columns)
                data_str = "\n".join(results)
                return f"{header_str}\n{data_str}"
    except Error as e:
        return f"查询出现异常：{str(e)}"


@tool
def update_reading_status(
    paper_id: int,
    status: str,
    importance_level: int,
    reader_name: str = "",
    reading_progress: int = -1,
    next_action: str = "",
) -> str:
    """
    为指定论文生成阅读状态更新审批单，不直接执行数据库修改。

    适用于用户要求“把某篇论文标记为精读/粗读/已复现/未阅读/暂不关注，
    并设置重要性、阅读进度或下一步动作”的场景。

    真实字段映射：
    - 阅读状态字段是 reading_status.status
    - 重要性字段是 reading_status.importance_level
    - 阅读进度字段是 reading_status.reading_progress，取值 0-100

    :param paper_id: papers.id / reading_status.paper_id
    :param status: 未阅读、粗读、精读、已复现、暂不关注
    :param importance_level: 重要性等级，1 最高，5 最低
    :param reader_name: 可选阅读人；为空时更新该 paper_id 下所有阅读状态记录
    :param reading_progress: 可选阅读进度，0-100；传 -1 表示不更新
    :param next_action: 可选下一步动作；为空表示不更新
    :return: 审批单信息，前端批准后才会执行 UPDATE
    """
    monitor.report_tool(
        tool_name="论文阅读状态更新审批工具：update_reading_status",
        args={
            "paper_id": paper_id,
            "status": status,
            "importance_level": importance_level,
            "reader_name": reader_name,
            "reading_progress": reading_progress,
            "next_action": next_action,
        },
    )

    allowed_statuses = {"未阅读", "粗读", "精读", "已复现", "暂不关注"}
    if status not in allowed_statuses:
        return f"无法生成审批单：status 必须是 {', '.join(sorted(allowed_statuses))} 之一。"
    if not isinstance(paper_id, int) or paper_id <= 0:
        return "无法生成审批单：paper_id 必须是正整数。"
    if not isinstance(importance_level, int) or not 1 <= importance_level <= 5:
        return "无法生成审批单：importance_level 必须是 1 到 5 的整数。"
    if reading_progress != -1 and (
        not isinstance(reading_progress, int) or not 0 <= reading_progress <= 100
    ):
        return "无法生成审批单：reading_progress 必须是 0 到 100 的整数，或传 -1 表示不更新。"

    assignments = [
        f"status = '{_escape_sql_string(status)}'",
        f"importance_level = {importance_level}",
    ]
    if reading_progress != -1:
        assignments.append(f"reading_progress = {reading_progress}")
    if next_action:
        assignments.append(f"next_action = '{_escape_sql_string(next_action)}'")

    where_parts = [f"paper_id = {paper_id}"]
    if reader_name:
        where_parts.append(f"reader_name = '{_escape_sql_string(reader_name)}'")

    query = (
        "UPDATE reading_status\n"
        f"SET {', '.join(assignments)}\n"
        f"WHERE {' AND '.join(where_parts)};"
    )

    return _create_write_approval(
        query,
        "用户请求更新论文阅读状态，使用专用工具生成字段受控的 UPDATE SQL。",
    )


if __name__ == "__main__":
    # 本地调试入口：直接运行本文件可验证 .env 中的 MySQL 连接配置是否可用
    print(
        execute_sql_query.invoke(
            {
                "query": "SELECT * FROM `drugs` dgs join sales_records srd on dgs.drug_id = srd.drug_id"
            }
        )
    )

"""
FastAPI 接口层与项目闭环入口

负责承接前端的任务提交、任务取消、文件上传/下载、输出文件列表查询和
WebSocket 长连接。HTTP 接口只做轻量调度，真正的 DeepAgents 执行放到后台
任务中；执行进度、工具调用和最终结果由 monitor 按 thread_id 推送给前端。
"""

import asyncio
from email.policy import HTTP
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List

import uvicorn
from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.agent.main_agent import run_deep_agent
from app.api.approvals import approve_sql_approval, get_sql_approval, reject_sql_approval
from app.api.monitor import manager
from app.api.monitor import monitor

#FastAPI 服务生命周期
@asynccontextmanager
async def lifespan(_app: FastAPI):
    """
    服务生命周期入口。

    启动时绑定当前事件循环到 WebSocket 管理器，确保后台 Agent 任务可以把
    monitor 事件投递回 FastAPI 所在的 loop。
    """
    # 获取 FastAPI 当前使用的事件循环。
    loop = asyncio.get_running_loop()
    # 将事件循环绑定到 WebSocket 管理器，使其可以在后台任务中使用该 loop。
    # 这样后台任务在执行时可以通过 manager 获取到正确的事件循环，从而向 WebSocket 推送消息。
    # 这样，即使 Agent 在其他执行上下文中产生 monitor 消息，
    # manager 也知道应该将消息投递到哪个事件循环。
    manager.set_loop(loop)
    print(f"[Server] WebSocket Manager bound to loop: {id(loop)}")
    # yield 表示启动阶段结束，FastAPI 开始正式接收请求。
    yield
    # 如有需要，可以在这里增加服务关闭时的清理逻辑，例如：
    #
    # - 取消尚未结束的后台任务
    # - 关闭数据库连接
    # - 关闭模型客户端
    # - 断开 WebSocket
    #
    # 当前暂时不处理。

# 当前文件位于 app/api/server.py，运行时目录统一收敛到 app 目录
#  __file__： 当前文件的路径，即 app/api/server.py
# resolve()： 将相对路径解析为绝对路径，得到 app/api/server.py 的绝对路径
# current_dir： 当前文件所在目录，即 app/api
# project_root： 项目根目录，即 app
current_dir = Path(__file__).resolve().parent
project_root = current_dir.parent

# FastAPI 实例化，指定服务标题和生命周期管理器
# lifespan 参数用于指定服务的生命周期管理器，确保在服务启动和关闭时执行特定逻辑。
# 创建 FastAPI 应用
app = FastAPI(title="DeepAgents API", lifespan=lifespan)

# 保存当前正在执行的 Agent 后台任务。
#
# 数据结构：
#
#     {
#         "thread_id_1": asyncio.Task,
#         "thread_id_2": asyncio.Task,
#     }
#
# 作用：
#
# 1. 根据 thread_id 找到对应任务。
# 2. 用户可以主动取消任务。
# 3. 同一个 thread_id 提交新任务时，可以取消旧任务。
# 保存 thread_id -> 后台 Agent 任务，用于同一会话任务替换和主动取消
active_tasks: dict[str, asyncio.Task] = {}

# output 目录：
#
# 用来保存每个 Agent 会话最终生成的文件。
#
# 例如：
#
#     app/output/session_123/report.md
#     app/output/session_123/result.json
#
# output 保存每个会话最终工作区，前端只允许从这里浏览和下载生成文件
output_dir = project_root / "output"
output_dir.mkdir(exist_ok=True)

# updated 目录：
#
# 用来临时保存用户上传的原始附件。
#
# 例如：
#
#     app/updated/session_123/document.pdf
#
# run_deep_agent 启动时，可以将这些附件复制到对应工作目录中。
# updated 暂存用户上传文件，run_deep_agent 启动时会复制到对应 output/session_xxx
updated_dir = project_root / "updated"
updated_dir.mkdir(exist_ok=True)

# 开发环境下，前端和后端通常分别启动。
#
# 例如：
#
#     前端：http://localhost:5173
#     后端：http://localhost:8000
#
# 浏览器会认为二者属于不同来源，因此需要配置 CORS。
# 教学项目通常前后端分别本地启动，这里放开跨域以便 Vite 页面直接调用 API
app.add_middleware(
    CORSMiddleware,
    # 允许所有来源访问。
    # 适合本地教学或开发环境。
    allow_origins=["*"],
    # 是否允许浏览器携带 Cookie、Authorization 等凭据。
    allow_credentials=True,
    # 允许所有 HTTP 方法：
    # GET、POST、PUT、DELETE 等。
    allow_methods=["*"],
    # 允许所有请求头。
    allow_headers=["*"],
)

#请求数据模型
class TaskRequest(BaseModel):
    """前端启动任务时提交的请求体。"""
    """
    前端启动 Agent 任务时提交的 JSON 请求体。

    请求示例：

    {
        "query": "请分析我上传的 PDF",
        "thread_id": "abc-123"
    }

    thread_id 可以不传。
    如果未提供，后端会自动生成 UUID。
    """
    # 用户提交给 Agent 的自然语言问题。
    query: str
    # 会话唯一标识。
    #
    # 相同 thread_id 表示属于同一个任务会话。
    # 未提供时由后端自动生成。
    thread_id: str = None


class RejectApprovalRequest(BaseModel):
    """拒绝 SQL 审批时的请求体。"""

    reason: str = ""

# 后台任务清理方法
def _forget_task(thread_id: str, task: asyncio.Task) -> None:
    """
    清理已结束任务的登记关系。

    done_callback 触发时，active_tasks 中可能已经被新任务替换；只有仍是同一个
    task 时才删除，避免误清理同 thread_id 下刚启动的新任务。
    """

    if active_tasks.get(thread_id) is task:
        #active_tasks 是一个 Python 字典
        # dict.pop(键, 默认值) 作用：
        # 查找字典里 key=thread_id 的元素；
        # 如果存在：删除该键值对，并返回对应 value；
        # 如果不存在：不报错，直接返回你传入的第二个参数 None
        active_tasks.pop(thread_id, None)


#启动 Agent 任务接口
@app.post("/api/task")
async def run_task(request: TaskRequest):
    """
    启动一次 DeepAgents 后台任务。

    HTTP 请求只负责创建后台协程并立即返回，后续执行轨迹、子智能体调用和最终
    答案都会由 monitor 通过 `/ws/{thread_id}` 推送给同一会话的前端。
    """
    # 优先使用前端传入的 thread_id。
    #
    # 如果前端没有传，则自动生成一个 UUID，例如：
    #
    #     7d64ad2d-4ce9-4eef-b799-cd518abfcd2f
    thread_id = request.thread_id or str(uuid.uuid4())

    # 同一个 thread_id 只保留一个活跃任务，新任务会先取消旧任务，避免并发写同一会话目录
    old_task = active_tasks.get(thread_id)

    # 如果旧任务存在并且尚未结束，则取消旧任务。
    #
    # 这样可以避免：
    #
    # - 同一个会话同时执行多个 Agent
    # - 多个任务同时写入同一个会话目录
    # - 前端收到相互交叉的 WebSocket 消息
    if old_task and not old_task.done():
        old_task.cancel()

    # 创建后台异步任务。
    #
    # 注意：
    #
    # await run_deep_agent(...)
    #
    # 会导致接口一直等待 Agent 执行结束。
    #
    # asyncio.create_task(...)
    #
    # 则会把 Agent 交给事件循环后台执行，
    # 当前 HTTP 接口可以立即返回。
    # create_task 把长耗时 Agent 执行交给事件循环，接口本身不用等待最终结果
    # HTTP 接口马上返回：
    # {
    #   "status": "started",
    #   "thread_id": "abc123"
    # }
    task = asyncio.create_task(run_deep_agent(request.query, thread_id))
    # 将任务登记到任务表中。
    active_tasks[thread_id] = task

    # 当任务结束时，自动调用 _forget_task 清理任务记录。
    # finished_task 就是已经完成、异常或取消的 asyncio.Task。
    # lambda 接收一个固定参数：finished_task（结束的任务实例）
    # 内部调用清理函数 _forget_task，同时传入两个参数：
    # 当前对话标识 thread_id
    # 结束的任务对象 finished_task
    task.add_done_callback(lambda finished_task: _forget_task(thread_id, finished_task))
    
    # 此时只代表任务已经启动，
    # 并不代表 Agent 已经执行完成。
    return {"status": "started", "thread_id": thread_id}


@app.post("/api/task/{thread_id}/cancel")
async def cancel_task(thread_id: str):
    """
    取消指定 thread_id 对应的后台 Agent 任务。

    注意：取消会向 asyncio.Task 注入 CancelledError。若底层第三方工具正在执行不可中断
    的同步阻塞调用，任务可能需要等该调用返回后才会真正结束。
    """
    task = active_tasks.get(thread_id)
    if not task or task.done():
        active_tasks.pop(thread_id, None)
        raise HTTPException(status_code=404, detail="任务不存在或已结束")

    # 先发出取消信号，再短暂等待协程响应；若底层阻塞中，则返回 cancelling 给前端继续展示状态
    task.cancel()
    try:
        await asyncio.wait_for(task, timeout=1.0)
    except asyncio.CancelledError:
        _forget_task(thread_id, task)
        return {"status": "cancelled", "thread_id": thread_id}
    except asyncio.TimeoutError:
        return {"status": "cancelling", "thread_id": thread_id}
    except Exception as e:
        _forget_task(thread_id, task)
        return {"status": "cancelled", "thread_id": thread_id, "message": str(e)}

    _forget_task(thread_id, task)
    return {"status": "cancelled", "thread_id": thread_id}


@app.get("/api/approvals/{approval_id}")
async def get_approval(approval_id: str):
    """查看待审批 SQL 的当前状态。"""
    approval = get_sql_approval(approval_id)
    if not approval:
        raise HTTPException(status_code=404, detail="审批不存在")
    return {"approval": approval}


@app.post("/api/approvals/{approval_id}/approve")
async def approve_approval(approval_id: str):
    """人工批准并执行待审批 SQL。"""
    try:
        approval = approve_sql_approval(approval_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="审批不存在")
    monitor.report_approval_result(approval)
    if approval.get("status") == "failed":
        raise HTTPException(status_code=400, detail=approval.get("error") or "SQL 执行失败")
    return {"approval": approval}


@app.post("/api/approvals/{approval_id}/reject")
async def reject_approval(approval_id: str, request: RejectApprovalRequest):
    """人工拒绝待审批 SQL。"""
    try:
        approval = reject_sql_approval(approval_id, request.reason)
    except KeyError:
        raise HTTPException(status_code=404, detail="审批不存在")
    monitor.report_approval_result(approval)
    return {"approval": approval}


@app.post("/api/upload")
async def upload_files(files: List[UploadFile] = File(...), thread_id: str = Form(...)):
    """
    文件上传接口 (File Upload)。

    目标：
    1. 接收用户上传的一个或多个文件。
    2. 保存到 `updated/session_{thread_id}` 目录。
    3. 供 Agent 在后续任务中读取和分析。

    Args:
        files (List[UploadFile]): 文件对象列表。
        thread_id (str): 关联的任务会话 ID。
    """
    # 上传文件先按会话隔离保存，避免不同任务读取到彼此的附件
    target_dir = updated_dir / f"session_{thread_id}"
    target_dir.mkdir(parents=True, exist_ok=True)

    saved_files = []
    for file in files:
        file_path = target_dir / file.filename
        # 直接复制文件流，避免大文件一次性读入内存
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        saved_files.append(file.filename)

    return {"status": "uploaded", "files": saved_files}


@app.get("/api/download")
async def download_file(path: str):
    """
    文件下载接口 (File Download)。

    目标：
    1. 根据绝对路径下载文件。
    2. 严格的安全检查，防止越权访问。

    Args:
        path (str): 文件的绝对路径 (通常从 list_files 接口获取)。
    """
    try:
        # resolve 后再做 is_relative_to，防止 `../` 之类的路径穿越到 output 之外
        abs_path = Path(path).resolve()
        output_abs = output_dir.resolve()

        if not abs_path.is_relative_to(output_abs):
            return {"error": "拒绝访问: 只能下载输出目录下的文件"}
    except Exception:
        return {"error": "无效的路径参数"}

    if not abs_path.exists():
        return {"error": "文件不存在"}

    # FileResponse 会以流式响应返回文件内容，并让浏览器使用原文件名下载
    return FileResponse(abs_path, filename=abs_path.name)


@app.get("/api/files")
async def list_files(path: str):
    """
    文件列表查询接口 (File Explorer)。

    目标：
    1. 列出指定目录下的所有生成文件。
    2. 提供文件元数据（大小、修改时间、下载所需路径）。
    3. 严格的安全检查，防止路径遍历攻击。

    Args:
        path (str): 目标目录的绝对路径 (必须在 output 目录下)。
    """
    print(f"[DEBUG] 请求文件列表: {path}")

    try:
        # 和下载接口保持同一条安全边界：前端只能查看 output 目录内部内容
        abs_path = Path(path).resolve()
        output_abs = output_dir.resolve()

        if not abs_path.is_relative_to(output_abs):
            print(f"[ERROR] 拒绝访问: {abs_path} 不在 {output_abs} 目录下")
            return {"error": "拒绝访问: 只能访问输出目录下的文件"}

    except Exception as e:
        print(f"[ERROR] 路径解析失败: {e}")
        return {"error": f"路径无效: {e}"}

    if not abs_path.exists():
        return {"error": "目录不存在"}

    files = []
    try:
        # 递归返回文件元数据，前端据此渲染文件列表并发起下载请求
        for file_path in abs_path.rglob("*"):
            if file_path.is_file():
                stat = file_path.stat()
                files.append(
                    {
                        "name": file_path.name,
                        "type": "file",
                        "path": str(file_path),
                        "size": stat.st_size,
                        "mtime": stat.st_mtime,
                    }
                )

    except Exception as e:
        print(f"[ERROR] 遍历文件失败: {e}")
        return {"error": str(e)}

    # 最新生成的文件排在前面，方便用户优先看到本次任务产物
    files.sort(key=lambda x: x.get("mtime", 0), reverse=True)
    print(f"[DEBUG] 找到 {len(files)} 个文件")
    return {"files": files}


# 注册websocket接口路径，前端访问 ws://ip:8000/ws/{thread_id}
# thread_id：每个对话唯一会话ID，用来区分不同用户窗口
@app.websocket("/ws/{thread_id}")
async def websocket_endpoint(websocket: WebSocket, thread_id: str):
    """
    WebSocket 实时通讯核心接口 (Real-time Communication)。

    连接建立后，ConnectionManager 会用 thread_id 保存 WebSocket。monitor 后续
    发送事件时只需要按 thread_id 查找连接，就能把进度推给对应页面。循环中的
    receive_text 用于接收前端心跳，避免连接空闲断开。
    """
    print(f"会话向我们发起了请求，要求建立连接：{thread_id} 对应：{websocket}")

    # 1. 握手完成，将当前websocket连接存入全局连接管理器
    # manager内部字典存储 thread_id -> WebSocket对象，后台Agent可根据会话ID定向推送流式回答
    # 连接建立后立即按 thread_id 注册，monitor 后续才能把事件定向推给当前页面
    await manager.connect(websocket, thread_id)

    try:
        # 永久循环，持续监听前端发来的消息（心跳ping）
        while True:
            # 前端通常发送 ping 心跳；服务端回复 pong，顺便维持连接活跃
            # 异步等待接收前端文本消息，无消息时释放事件循环，不阻塞服务
            data = await websocket.receive_text()
            # 回复pong心跳包，告知前端连接正常，防止网关/浏览器自动断连
            await websocket.send_json(
                {"type": "pong", "message": f"服务端已收到: {data}"}
            )
    # 分支1：前端主动关闭页面、浏览器关闭、手动断开WebSocket触发此异常
    except WebSocketDisconnect:
        # 只移除当前 WebSocket 实例，避免旧连接断开时误删同 thread_id 的新连接
        # 从连接管理器移除当前失效websocket对象
        # 只删本次连接，不直接删除thread_id，防止同一会话刷新后新建连接被误清
        manager.disconnect(websocket, thread_id)
        print(f"[WebSocket] 客户端已断开: {thread_id}")

    # 分支2：网络异常、断网、协议错误等所有未知异常统一捕获
    except Exception as e:
        print(f"[WebSocket] 连接异常: {e}")
        # 异常也要清理失效连接，避免堆积无效websocket占用内存
        manager.disconnect(websocket, thread_id)

#本地启动入口
if __name__ == "__main__":
    # 启动 Uvicorn 服务。
    #
    # 如果当前文件实际路径为：
    #
    #     app/api/server.py
    #
    # 并且你在项目根目录运行：
    #
    #     python -m app.api.server
    #
    # 通常模块路径应该写成：
    #
    #     app.api.server:app
    #
    # 如果你将运行目录切换到了 app，
    # 才可能使用：
    #
    #     api.server:app
    # reload=True 表示检测到代码变化后自动重启。
    # 适合开发环境，不适合生产环境。
    uvicorn.run("api.server:app", host="0.0.0.0", port=8000, reload=True)

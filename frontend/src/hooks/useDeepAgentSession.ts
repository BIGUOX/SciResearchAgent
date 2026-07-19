import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// 接口：提交任务、取消、上传文件、SQL审批同意/拒绝、拉取会话文件
import {
  approveSqlApproval,
  cancelTask,
  listSessionFiles,
  rejectSqlApproval,
  startTask,
  uploadSessionFiles
} from "../lib/api";
// WebSocket地址、线程ID持久化工具、TS类型定义
import { WS_BASE_URL } from "../lib/config";

import { createThreadId, getStoredThreadId, storeThreadId } from "../lib/thread";
import type {
  ConnectionState,
  MonitorMessage,
  OutputFile,
  SqlApproval,
  SocketMessage,
  UploadedItem
} from "../types";

// 事件日志最大保留条数，超出自动截断
const MAX_EVENTS = 120;

// Record<string, T>只是TypeScript 类型描述，约束对象的键值类型，类型限制
// data：任意键值对象，键是字符串，值可以是任意类型 unknown
// key：要读取的字段名
// 返回值：字符串 或者 null
function extractString(data: Record<string, unknown>, key: string): string | null {
  // 取出对象对应key的值，类型是 unknown（不确定是什么类型）
  const value = data[key];
  // 类型判断：只有 value 是原生 string 类型才原样返回
  // 数字、布尔、null、undefined、{}、\[\] 全部返回 null
  //明确告诉调用方：拿到的结果要么是字符串，要么是空，后续可以安全判空，不用处理各种杂七杂八的类型。
  return typeof value === "string" ? value : null;
}

// function 声明一个普通 JS/TS 函数
// useDeepAgentSession
// React 约定：以 `use` 开头的函数就是自定义 Hook，必须遵循 Hook 规则：
// - 只能在组件 / 其他 Hook 内部调用
// - 不能放在 if、for、循环、条件判断里
export function useDeepAgentSession() {
  // WebSocket 实例对象，保存长连接
  const socketRef = useRef<WebSocket | null>(null);
  // ws断开后自动重连的延时定时器
  const reconnectTimerRef = useRef<number | undefined>(undefined);
  // ws心跳ping定时轮询定时器
  const heartbeatTimerRef = useRef<number | undefined>(undefined);

  // Set是JS 自带的无重复集合，Set<string>集合里每一项都是字符串
  // 同一个字符串 add 多次，集合里只会存一份
  // new Set()默认创建空集合，里面一开始没有任何字符串
  // 已上传文件名称集合，用来去重，避免重复上传同一个文件
  const uploadedNameSetRef = useRef<Set<string>>(new Set());
  // 已处理过的审批ID集合，防止同一条审批重复生成结果文本
  const handledApprovalResultSetRef = useRef<Set<string>>(new Set());

  // AI原生返回的基础输出文本，不含审批信息
  const baseResultRef = useRef("");

  // key=审批ID，value=该审批对应的提示文案，存储所有审批记录
  // Map<string, string>泛型 K、V 分别严格约束
  const approvalResultMapRef = useRef<Map<string, string>>(new Map());

  // 会话唯一线程ID，初始化读取本地存储的值
  const [threadId, setThreadId] = useState(getStoredThreadId);

  // WebSocket连接状态：connecting / connected / reconnecting / closed
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  // AI运行实时事件日志数组（工具调用、报错、会话创建等）
  const [events, setEvents] = useState<MonitorMessage[]>([]);
  // 会话生成/后端存储的文件列表
  const [files, setFiles] = useState<OutputFile[]>([]);
  // 当前会话在后端的存储路径
  const [sessionPath, setSessionPath] = useState("");

  // 最终完整输出结果：AI原文 + 所有审批拼接文本
  const [result, setResult] = useState("");

  // 全局最新错误信息（ws异常、接口报错等）
  const [lastError, setLastError] = useState("");

  // 最近一次心跳pong响应时间，用来判断连接存活
  const [lastPongAt, setLastPongAt] = useState("");

  // 任务是否正在执行中
  const [isRunning, setIsRunning] = useState(false);

  // 是否正在执行取消任务操作
  const [isCancelling, setIsCancelling] = useState(false);
  // 是否正在上传文件
  const [isUploading, setIsUploading] = useState(false);
  // 前端本地待上传文件列表
  const [uploadedItems, setUploadedItems] = useState<UploadedItem[]>([]);
  // 待人工审核的SQL审批队列
  const [pendingApprovals, setPendingApprovals] = useState<SqlApproval[]>([]);

  // Hook 重新渲染，里面所有普通函数（比如composeResult）都会销毁、再新建。
  // -新建函数 = 内存多占用、依赖数组频繁失效、子组件不必要重渲染；
  //  如果这个函数传给useEffect / 其他 Hook 的依赖，每次都是新函数，会疯狂重复执行逻辑
  // useCallback：缓存函数实例
  // const fn = useCallback(真正的函数体, [依赖数组]);
  // 只有依赖数组里的值发生变化，才会重新生成新函数；
  // 依赖不变，永远复用之前缓存好的旧函数，不会重复创建。
  // 当前依赖数组是空数组
  // () => {}箭头函数：()函数入参列表，这里没有参数，所以空括号；=>箭头函数标识；{}函数体，里面写业务代码
  const composeResult = useCallback(() => {
    // 1. 从Map取出所有审批文案，转成数组
    // approvalResults = [
    //   "审批结果：第一条审批内容...\\n审批 ID：appr\_001",
    //   "审批结果：第二条审批内容...\\n审批 ID：appr\_002"
    // ]
    // approvalResultMapRef.current = 里面存的是一个Map 实例
    // Map 自带内置方法.values()取出 Map 里所有 value
    const approvalResults = Array.from(approvalResultMapRef.current.values());
    // 2. 没有审批记录，直接返回AI原始输出文本
    if (approvalResults.length === 0) {
      return baseResultRef.current;
    }
    // 3. 多条审批用分割线拼接成一段完整文字
    // 数组.join(分割字符串)把数组里面所有元素拼合成一整条完整字符串，数组每两项中间插入你写的分隔内容。
    const approvalText = approvalResults.join("\n\n---\n\n");
    // 4. 判断是否存在AI原文，分两种情况拼接最终输出
    // baseResultRef.current里面存的是普通字符串；
    // 取值:const text = baseResultRef.current;
    return baseResultRef.current
      ? `${baseResultRef.current}\n\n---\n\n${approvalText}`
      : approvalText;
  }, []);

  // - 接收参数 approval：单条审批记录，类型是之前定义的 SqlApproval
  // - useCallback(函数, [composeResult])：只有 composeResult 变化才重建此函数
  const appendApprovalResult = useCallback((approval: SqlApproval) => {
    //`!approval?.id`：审批没有唯一 ID，无效数据，直接 return
    // `handledApprovalResultSetRef.current` 是 `Set`，`.has(approval.id)` 判断这条审批是否已经处理过
    if (!approval?.id || handledApprovalResultSetRef.current.has(approval.id)) {
      return;
    }
    // 把 id 存入 Set 标记 “已处理”
    handledApprovalResultSetRef.current.add(approval.id);

    // - const：常量，不允许重新赋值(数组,map,set可以修改内部数据的)，只能声明一次，不能改指向(const map = new Map();map = new Map(); // ❌ 语法报错)；
    // - let：变量，允许后续重新赋值，可以多次修改。
    // 定义空字符串，用来存放这条审批的说明文字
    let approvalMessage = "";

    // 审批通过 approved
    // 审批通过后会有 affected_rows（影响行数）；
    if (approval.status === "approved") {
      const affectedRows = approval.result?.affected_rows;
      approvalMessage =
        affectedRows === 0
          ? "数据库修改已通过人工审核并执行完成；影响行数为 0，通常表示目标记录已是期望状态，或 WHERE 条件没有匹配到需要变更的行。"
          : typeof affectedRows === "number"
            ? `数据库修改已通过人工审核并执行成功，影响行数：${affectedRows}。`
            : "数据库修改已通过人工审核并执行成功。";
    } else if (approval.status === "rejected") {
      //审批拒绝 rejected
      //读取用户填写的拒绝理由，有理由就拼接展示，没有就用默认文字
      const rejectReason = approval.result?.reject_reason;
      approvalMessage =
        typeof rejectReason === "string" && rejectReason
          ? `数据库修改已被人工拒绝，未执行。拒绝原因：${rejectReason}`
          : "数据库修改已被人工拒绝，未执行。";
    } else if (approval.status === "failed") {
      //审批通过但 SQL 执行失败
      approvalMessage = `数据库修改审批后执行失败，原因：${approval.error || "未知错误"}`;
    } else {
      return;
    }

    // 将审批 ID + 完整文案存入 Map
    // .set(key, value)：存储键值对
    approvalResultMapRef.current.set(
      approval.id,
      `审批结果：${approvalMessage}\n\n审批 ID：${approval.id}`
    );

    // 调用之前的拼接函数，把 AI 原文 + 全部审批文案合成一段完整字符串，赋值给响应式 state result
    // composeResult()：代表执行这个函数，拿到它的返回值（一段拼接好的文本字符串）
    setResult(composeResult());
    // useCallback的依赖数组本质就是一个普通数组，里面可以放任意变量（字符串、数字、函数、对象）
    // 把 composeResult 作为依赖项写进依赖数组
    // composeResult：代表函数本身（函数对象，可以丢进依赖数组）
    // 函数内部用到了外部函数 composeResult，必须写进依赖数组；
    // 只有 composeResult 发生变化时，才会重新创建 appendApprovalResult函数
    // composeResult的变化，不靠 appendApprovalResult调用；两个是互相独立的函数，谁调用谁不会改变对方本身
    // 当 [xxx]更新，React 会创建一个全新的函数对象赋值给 composeResult，此时 composeResult引用改变
    // 它依赖是空数组 []，永远不会更新，所以 appendApprovalResult也只会创建一次
  }, [composeResult]);

  //清理 WebSocket 相关两个定时器的工具函数
  const clearSocketTimers = useCallback(() => {
    //清理断线重连定时器 reconnectTimerRef
    //存在定时器才执行清理
    if (reconnectTimerRef.current) {
      //取消延时重连任务，不让它再过 2 秒自动发起连接
      //setTimeout() → 一次性延时任务
      // 取消用：clearTimeout (定时器 ID)
      window.clearTimeout(reconnectTimerRef.current);
      //清空 ref 里保存的定时器标识，标记 “无延时任务”
      reconnectTimerRef.current = undefined;
    }
    // 清理心跳保活定时器 heartbeatTimerRef
    if (heartbeatTimerRef.current) {
      //setInterval() → 循环重复执行任务
      //取消用：clearInterval (定时器 ID)
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = undefined;
    }
  }, []);

  //重置会话
  //const是用来定义常量变量，变量里存什么都行：字符串、数字、数组、对象、函数全都可以存
  //左边 resetSession 是常量变量名，右边 useCallback(...)执行后返回一个函数，把这个函数赋值给 const 变量
  const resetSession = useCallback(() => {
    // createThreadId()：生成全新唯一的对话 thread_id
    const nextThreadId = createThreadId();
    // storeThreadId(nextThreadId):存入本地持久化存储
    storeThreadId(nextThreadId);
    // setThreadId(nextThreadId):更新页面响应式会话 ID state
    setThreadId(nextThreadId);
    setEvents([]);// 清空WebSocket日志事件列表
    setFiles([]);// 清空会话生成/上传的文件列表
    setSessionPath("");// 清空服务端会话存储路径
    setResult("");// 清空聊天框最终展示文本
    setLastError("");// 清空报错提示
    setUploadedItems([]);// 清空已上传文件记录
    setPendingApprovals([]);// 清空待审核SQL审批队列
    //清空所有 ref 缓存数据（不触发页面渲染，内存缓存）
    uploadedNameSetRef.current.clear();// Set清空：已上传文件名去重集合
    handledApprovalResultSetRef.current.clear();// Set清空：已处理审批ID标记集合
    baseResultRef.current = "";// 清空AI原生输出文本缓存
    approvalResultMapRef.current.clear();// Map清空：所有审批文案缓存
    //重置任务运行状态
    setIsRunning(false);// 标记：无AI任务正在执行
    setIsCancelling(false);// 标记：不在取消任务流程中
  }, []);

  // 据当前会话路径 sessionPath，请求后端接口拉取当前对话绑定的所有文件列表，并更新页面文件数据；
  // 依赖只有 sessionPath，会话路径一变才会重新创建函数
  // async异步函数:内部可以使用 await 等待接口请求完成
  const refreshFiles = useCallback(async () => {
    //sessionPath 是当前会话在服务端的存储地址，如果为空，说明还没有创建有效会话
    if (!sessionPath) {
      return;
    }

    const response = await listSessionFiles(sessionPath);
    if (response.error) {
      throw new Error(response.error);
    }
    //更新页面文件状态
    //response.files：后端返回的当前会话文件数组
    //`|| []` 兜底：如果后端没返回 files 字段，赋值空数组，防止页面渲染报错
    setFiles(response.files || []);
  }, [sessionPath]);

  // 连接 WebSocket
  // useEffect(()=>{
  //   // 挂载/依赖变化执行：连接ws、开定时器、发请求
  //   return ()=>{
  //     // 清理函数：组件卸载、依赖更新前执行
  //     // 关ws、清定时器、取消订阅，防内存泄漏
  //   }
  // }, \[依赖列表\])
  // useEffect(fn, [])：仅组件首次挂载执行；卸载时执行清理函数
  // useEffect(fn, [a,b])：挂载执行 + a/b发生变化时重新执行
  // useEffect(fn)（无第二个参数）：每次组件渲染都执行
  useEffect(() => {
    // 标记副作用是否已销毁
    let disposed = false;
    // 内部封装连接逻辑
    function connect() {
      //- 清空心跳 interval、重连 timeout；
      clearSocketTimers();
      // 获取WebSocket实例对象
      const hadSocket = Boolean(socketRef.current);
      // 存在对象就关闭,关闭当前存在的旧连接
      // socketRef.current?.close()只是关闭网络通道，不会立刻清空 `socketRef.current`
      socketRef.current?.close();
      // 更新连接对象
      // 有旧连接就是「重连中」，初次连接就是「连接中」
      setConnectionState(hadSocket ? "reconnecting" : "connecting");

      //创建一条WebSocket 长连接
      //new WebSocket(地址)
      //浏览器原生 API，专门创建长连接对象：
      // - HTTP 是一问一答短连接，请求完就断开；
      // - WebSocket 建立后，前后端可以随时互相发消息，适合实时推送
      // 地址:ws://127.0.0.1:8080/ws/xxx-uuid-thread-id
      // `WS_BASE_URL`：全局基础域名，固定前缀 `ws://xxx` / `wss://xxx`
      // `/ws/`：后端接口路由，代表这是 websocket 接口，区分普通 http 接口
      // `encodeURIComponent(threadId)`：对会话 ID 编码
      const socket = new WebSocket(`${WS_BASE_URL}/ws/${encodeURIComponent(threadId)}`);
      //缓存实例
      socketRef.current = socket;

      //WebSocket 内置事件：和后端握手成功、通道打通时触发一次
      socket.onopen = () => {
        // disposed 标记来自外层 useEffect，组件已经卸载、本次连接作废，直接放弃后续逻辑，
        // 防止销毁后代码还修改页面状态报错。
        if (disposed) {
          return;
        }
        // 更新连接状态为已连接，页面可以展示「连接成功」标识
        setConnectionState("connected");
        // 清空之前存储的网络报错提示
        setLastError("");
        // 心跳定时器 `setInterval`循环定时器，每 25000ms（25 秒）执行一次；
        // 每 25 秒执行一次，发送 `ping`
        // 告诉网关 / 后端：客户端在线，不要空闲断开长连接；
        // 后端收到 ping 会回复 `pong`，前端收到 pong 证明网络通畅
        heartbeatTimerRef.current = window.setInterval(() => {
          // 双重校验连接确实是打开状态，避免关闭后还发消息
          // 0:WebSocket.CONNECTING正在握手连接，还没打通
          // 1:WebSocket.OPEN连接成功、通道可用，可以收发消息
          // 2:WebSocket.CLOSING正在关闭连接（已经发关闭指令）
          // 3:WebSocket.CLOSED连接彻底关闭，无法发消息
          if (socket.readyState === WebSocket.OPEN) {
            // socket= 创建出来的长连接实例
            // .send()是浏览器原生 WebSocket 对象自带的发送消息方法，用来向前端给后端发数据
            // 把字符串 `ping` 发给后端服务
            socket.send("ping");
          }
        }, 25000);
      };

      // onmessage 是 WebSocket 内置消息监听事件
      // 接收后端通过 ws 推送过来的所有数据
      // 右边箭头函数：后端一发消息，浏览器自动调用这个函数
      // event：浏览器自动传入的事件参数，包含后端发来的数据
      socket.onmessage = (event) => {
        // 若上一条旧连接延迟发过来的残留消息
        // 直接 `return` 丢弃这条旧消息，防止新旧会话数据错乱
        if (socketRef.current !== socket) {
          return;
        }
        try {
          // event.data：后端通过 WebSocket 发过来的原始字符串
          // JSON.parse() 把 JSON 文本转换成 JS 对象
          // as SocketMessage 告诉 TS 这个对象符合预设的消息结构
          const payload = JSON.parse(event.data) as SocketMessage;
          // 前端每 25 秒 `socket.send("ping")`，后端收到后会返回 `type:"pong"` 的心跳回复
          if (payload.type === "pong") {
            // 记录当前时间戳，保存到 state，用来监控网络心跳是否正常
            setLastPongAt(new Date().toISOString());
            return;
          }

          // 过滤非业务消息
          // 本系统只处理 `type = monitor_event` 的业务事件
          if (payload.type !== "monitor_event") {
            return;
          }

          //setEvents更新存放日志事件的数组状态，页面会展示这条消息日志
          //`previous` 代表更新前旧的完整事件数组，基于旧数组改
          //`...previous`：展开旧数组所有日志
          //`payload`：本次后端推送的新消息对象
          // [...previous, payload]把新消息追加到日志数组末尾
          // .slice(-MAX\_EVENTS)slice(负数)代表取数组最后 N 个元素
          // 只保留最新 `MAX_EVENTS` 条日志，防止日志无限堆积占内存
          setEvents((previous) => [...previous, payload].slice(-MAX_EVENTS));

          //判断：当前这条消息是不是「会话创建完成」的通知
          if (payload.event === "session_created") {
            //`extractString` 是封装好的工具函数：安全取出对象里指定字段，并保证返回字符串，避免空 /undefined 报错
            const path = extractString(payload.data, "path");
            if (path) {
              //把会话路径存到全局状态，后面调用接口拉取该会话下的文件列表时
              setSessionPath(path);
            }
          }

          //判断后端推送的消息类型：当前 AI 执行 SQL，需要用户手动审批，进入审批处理逻辑
          if (payload.event === "approval_required") {
            // 取出后端下发的审批完整信息（SQL 语句、审批 id、说明等）
            const approval = payload.data.approval as SqlApproval | undefined;
            //只有 `approval` 对象存在，并且里面有唯一审批 id，才往下执行
            if (approval?.id) {
              //`previous` 代表更新前旧的全部待审批数据
              setPendingApprovals((previous) => {
                //`some()`：遍历旧审批列表
                //判断规则：列表中是否已经存在一条 id 完全相同的审批
                //匹配到任意一条就返回 `true`（已存在），无匹配返回 `false`（新审批）
                const exists = previous.some((item) => item.id === approval.id);
                //`exists = true`（已有这条审批）：直接返回原数组，不做修改；
                //`exists = false`（全新审批）：
                // - `[...previous]` 展开旧列表全部内容；
                // - `, approval` 把当前新审批追加到数组末尾；
                // - 返回新数组，页面会新增一条待审批弹窗。
                return exists ? previous : [...previous, approval];
              });
            }
          }


          if (
            payload.event === "approval_approved" ||
            payload.event === "approval_rejected" ||
            payload.event === "approval_failed"
          ) {
            const approval = payload.data.approval as SqlApproval | undefined;
            //`filter` 过滤数组：只保留 id 和当前审批不相等的条目
            if (approval?.id) {
              setPendingApprovals((previous) =>
                previous.filter((item) => item.id !== approval.id)
              );
              // 调用工具函数，把这条审批的结果（同意 / 拒绝 / 失败）记录保存下来，
              // 拼接到页面最终展示的 AI 回答文本里，让用户能看到这条 SQL 审批历史
              appendApprovalResult(approval);
            }
          }

          //判断后端推送的事件类型：AI 完整任务执行完毕，返回最终回答结果
          if (payload.event === "task_result") {
            //- `payload.data`：后端附带的业务数据；
            // - `extractString` 工具函数，安全取出里面 `result` 字段，并保证是字符串；
            // - `finalResult` = AI 生成的正文回答内容。
            const finalResult = extractString(payload.data, "result");
            //`baseResultRef` 是一个 `ref`，不受 React 渲染更新限制，专门用来存放原始 AI 回答文本
            //如果没有拿到 result 正文，就使用 message 备用文案
            baseResultRef.current = finalResult || payload.message;
            //composeResult()把刚刚缓存的 AI 回答 + 所有 SQL 审批记录拼接成完整对话文本
            setResult(composeResult());
            //AI 是否正在生成回答 → 设为 false，关闭加载动画、停止 loading；
            setIsRunning(false);
            //是否处于 “取消任务” 中 → 设为 false，清除取消状态
            setIsCancelling(false);
          }

          //用户中途手动终止 AI 问答任务
          if (payload.event === "task_cancelled") {
            setResult((previous) => previous || payload.message);
            setIsRunning(false);
            setIsCancelling(false);
          }
          //AI 执行过程出现异常（数据库、接口、逻辑报错等）
          if (payload.event === "error") {
            //把后端返回的错误提示存入全局错误状态，页面弹出 / 展示报错信息给用户
            setLastError(payload.message);
            setIsRunning(false);
            setIsCancelling(false);
          }
        } catch (error) {
          setLastError(error instanceof Error ? error.message : "WebSocket 消息解析失败");
        }
      };

      socket.onerror = () => {
        if (!disposed && socketRef.current === socket) {
          setLastError("WebSocket 连接异常，请确认后端服务已启动");
        }
      };

      //WebSocket 内置关闭事件回调
      socket.onclose = () => {
        //两者不相等 → 这条关闭事件属于废弃旧会话，直接忽略，不执行重连逻辑
        if (socketRef.current !== socket) {
          return;
        }
        //清空心跳、重连相关定时器
        clearSocketTimers();
        //切换会话 ID，主动关闭旧 socket
        //关闭当前页面、组件卸载（disposed = true）
        if (disposed) {
          setConnectionState("closed");
          return;
        }
        //意外断开（必须自动重连）
        //更新页面连接状态为「正在重连」，页面可以显示加载、重连提示文案
        setConnectionState("reconnecting");
        //`setTimeout(connect, 2000)`：延迟 2000ms（2 秒）后重新执行 connect 函数，发起新 WebSocket 连接
        //定时器 ID 存入 `reconnectTimerRef`，后面页面卸载、手动断开时可以清除这个延时，避免后台偷偷重连
        reconnectTimerRef.current = window.setTimeout(connect, 2000);
      };
    }

    //调用 `connect()` = 从头新建一条完整的 WebSocket 长连接
    connect();
    //`useEffect` 内部最后 `return 一个函数`，这个函数叫副作用清理函数
    // 切换会话或关闭页面时，先执行这个清理函数
    // disposed = true全局标记当前组件 / 旧连接已经作废
    return () => {
      disposed = true;
      clearSocketTimers();
      //主动调用 WebSocket 自带 `.close()` 方法，手动关闭当前正在使用的长连接
      //`?.` 可选链，防止 socket 不存在报错
      socketRef.current?.close();
    };
  }, [clearSocketTimers, threadId]);

  // 监听会话路径 `sessionPath`、任务运行状态 `isRunning`，自动刷新当前会话的文件列表，
  // 包含立即刷新 + 定时轮询刷新，组件销毁 / 依赖变更时清理定时器
  useEffect(() => {
    // 没有会话路径，直接不执行刷新逻辑
    if (!sessionPath) {
      return;
    }
    // 组件加载/切换会话后，立刻刷新一次文件列表
    // refreshFiles()异步函数，内部发送网络请求，向后端查询当前会话下所有上传 / 生成的文件，更新页面文件列表状态
    //.catch(...)捕获接口请求中出现的所有异常：网络断开、后端报错、权限不足等，避免报错直接中断页面逻辑
    //(error: unknown)TS 标注，捕获到的错误类型不确定，统一标记为未知类型
    refreshFiles().catch((error: unknown) => {
      setLastError(error instanceof Error ? error.message : "文件列表刷新失败");
    });

    //const timer保存定时器唯一标识，用于后续销毁定时器
    //开启循环定时器：每隔固定时间，自动执行里面的函数，反复拉取文件列表
    //`isRunning = true`：AI 正在运行，会实时生成新文件，每2500ms（2.5 秒）刷新一次
    //`isRunning = false`：AI 空闲，文件不会频繁变动，降低请求频率，每 6000ms（6 秒）刷新
    const timer = window.setInterval(() => {
      refreshFiles().catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : "文件列表刷新失败");
      });
    }, isRunning ? 2500 : 6000);

    // 依赖数组里任意变量发生变化；
    // 组件关闭、页面卸载。
    // `clearInterval(timer)`：停止上面的循环定时器，停止后台自动刷新
    // 不清除会出现多个定时器同时运行，频繁重复请求接口，造成资源浪费
    return () => window.clearInterval(timer);
  }, [isRunning, refreshFiles, sessionPath]);


  // 定义用户点击提交任务后的操作
  // 用户输入问题后，清空页面旧数据、调用接口启动 AI 科研任务，异常时重置加载状态并抛出错误
  const submitTask = useCallback(
    async (query: string) => {
      // 输入清洗与非空校验
      const cleanQuery = query.trim();
      if (!cleanQuery) {
        throw new Error("请输入科研任务");
      }

      setIsRunning(true);// 开启AI加载状态，页面显示loading
      setIsCancelling(false);// 清除“正在取消任务”标记
      setEvents([]);// 清空WebSocket事件日志列表
      setResult("");// 清空上一轮AI回答展示文本
      setLastError("");// 清空历史错误提示
      setPendingApprovals([]);// 清空上一轮未处理的审批弹窗列表
      handledApprovalResultSetRef.current.clear();// 清空已处理审批集合缓存
      baseResultRef.current = "";// 清空原始AI回答缓存ref
      approvalResultMapRef.current.clear();// 清空审批记录映射缓存
      try {
        //调用接口启动任务
        const response = await startTask(cleanQuery, threadId);
        //判断后端返回的结果里存在有效的 `thread_id`
        //- `response.thread_id`：后端接口本次返回的会话 ID
        // - `threadId`：页面当前正在使用的旧会话 ID
        // - `!==`：严格不相等
        if (response.thread_id && response.thread_id !== threadId) {
          storeThreadId(response.thread_id);
          setThreadId(response.thread_id);
        }
        return response;
      } catch (error) {
        setIsRunning(false);
        setIsCancelling(false);
        throw error;
      }
    },
    [threadId]
  );

  const cancelCurrentTask = useCallback(async () => {
    if (!isRunning) {
      throw new Error("当前没有正在执行的任务");
    }

    setIsCancelling(true);
    setLastError("");
    try {
      const response = await cancelTask(threadId);
      if (response.status === "cancelled") {
        setIsRunning(false);
        setIsCancelling(false);
        setResult((previous) => previous || "任务已取消");
      }
      return response;
    } catch (error) {
      setIsCancelling(false);
      throw error;
    }
  }, [isRunning, threadId]);

  const uploadFiles = useCallback(
    async (items: UploadedItem[]) => {
      if (items.length === 0) {
        throw new Error("请选择要上传的文件");
      }
      //过滤：只保留本地从未上传过的新文件
      //`uploadedNameSetRef.current` 是一个 Set 缓存，存着本会话已经上传成功的所有文件名
      //过滤逻辑：只保留文件名不在缓存里的全新文件，跳过重复同名文件，避免重复上传浪费接口请求
      const nextItems = items.filter((item) => !uploadedNameSetRef.current.has(item.name));
      //全部是重复文件，直接短路返回
      if (nextItems.length === 0) {
        return {
          status: "uploaded",
          files: Array.from(uploadedNameSetRef.current)//转换成数组
        };
      }

      setIsUploading(true);
      setLastError("");
      try {
        //nextItems.map(item => item.raw)取出每个文件的原始二进制数据；
        const response = await uploadSessionFiles(
          nextItems.map((item) => item.raw),
          threadId
        );
        //更新已上传文件列表（函数式更新 state）
        setUploadedItems((previous) => {
          //把原有已上传文件的名字全部放入Set，用于快速去重判断
          const names = new Set(previous.map((item) => item.name));
          //拷贝旧数组，不直接修改原state（React state不可变原则）
          const next = [...previous];
          //`nextItems` = 本次刚刚上传成功、后端接收完成的文件数组
          //循环每一个新文件，逐个判断是否需要加入列表
          nextItems.forEach((item) => {
            //当前文件名不在旧列表中，是全新文件
            if (!names.has(item.name)) {
              names.add(item.name);
              uploadedNameSetRef.current.add(item.name);
              //把新文件追加到拷贝出来的新数组
              next.push(item);
            }
          });
          // 传给 `setUploadedItems` 的内部回调函数
          // 返回拼接完成的全新文件数组，
          // React 会更新 `uploadedItems` 状态，页面渲染最新完整文件列表
          return next;
        });
        return response;
      } finally {
        setIsUploading(false);
      }
    },
    [threadId]
  );

  const approveApproval = useCallback(async (approvalId: string) => {
    // 调用后端接口，同意这条SQL审批
    const response = await approveSqlApproval(approvalId);
    // 从待审批弹窗列表移除当前这条审批
    // `filter` 过滤：只保留 id 和当前审批不相等的条目
    setPendingApprovals((previous) => previous.filter((item) => item.id !== approvalId));
    // 调用工具函数，把本次审批详情（SQL 内容、同意结果）追加到对话结果缓存，
    // 页面对话区域会展示这条审批历史记录，让用户看到哪些 SQL 已经放行。
    appendApprovalResult(response.approval);
    return response;
  }, [appendApprovalResult]);

  const rejectApproval = useCallback(async (approvalId: string, reason = "") => {
    const response = await rejectSqlApproval(approvalId, reason);
    setPendingApprovals((previous) => previous.filter((item) => item.id !== approvalId));
    appendApprovalResult(response.approval);
    return response;
  }, [appendApprovalResult]);

  //`useMemo` 用于缓存计算结果，只有依赖 `events`、`files.length` 发生变化时，才会重新统计；
  // 否则直接复用上次算出的数据，减少重复计算、优化页面性能
  const stats = useMemo(() => {
    // 统计工具调用开始事件数量
    // 过滤出事件类型为 `tool_start`（工具开始调用，如查数据库、读取文件等），取数组长度得到总次数
    const toolEvents = events.filter((event) => event.event === "tool_start").length;
    const assistantEvents = events.filter((event) => event.event === "assistant_call").length;
    const errorEvents = events.filter((event) => event.event === "error").length;

    return {
      toolEvents,// 工具调用次数
      assistantEvents,// 助手函数调用次数
      errorEvents,// 错误事件条数
      fileCount: files.length// 当前会话已上传文件总数
    };
  }, [events, files.length]);

  // 自定义 React Hook 函数的返回值
  // 内部：一堆 useState、useEffect、useCallback、useMemo、WebSocket 逻辑、工具函数
  // 页面组件使用这个 Hook 时，能一次性拿到所有需要的数据和操作方法
  return {
    connectionState,
    events,
    files,
    isCancelling,
    isRunning,
    isUploading,
    lastError,
    lastPongAt,
    pendingApprovals,
    refreshFiles,
    resetSession,
    result,
    sessionPath,
    stats,
    cancelCurrentTask,
    approveApproval,
    rejectApproval,
    submitTask,
    threadId,
    uploadFiles,
    uploadedItems
  };
}

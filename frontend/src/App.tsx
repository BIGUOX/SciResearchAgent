import {
  ApiOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  ToolOutlined
} from "@ant-design/icons";//从 Ant Design 图标库里导入图标组件
//从 Ant Design 导入 UI 组件：提示框/警告框、按钮、弹窗、文本排版
import { Alert, App as AntApp, Button, Modal, Typography } from "antd";
//React Hooks：
// useState：保存组件状态
// useEffect：处理副作用，比如监听数据变化、滚动页面
// useRef：保存不会触发重新渲染的引用，比如 DOM 节点、布尔标记
import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "./components/ChatComposer";
import { ConversationThread } from "./components/ConversationThread";
// 只导入 TypeScript 类型/接口/type 定义，编译后会被完全删掉，不会进入最终浏览器JS代码
import type { ChatTurn } from "./components/ConversationThread";
import { API_BASE_URL, WS_BASE_URL } from "./lib/config";
import { useDeepAgentSession } from "./hooks/useDeepAgentSession";
//导入自定义的类型定义
import type { ConnectionState, UploadedItem } from "./types";

// 根据传入的连接状态，返回对应的中文状态文字（比如传入 connecting，就返回 "连接中"）
// function connectionLabel：定义一个名叫 connectionLabel 的函数
// : string：表示这个函数最终一定会返回一段文本字符串
// const labels：创建一个叫 labels 的字典 
// Record<ConnectionState, string>：TS 类型写法
// 意思：这个对象的键（key）只能是 4 种连接状态，值（value）只能是中文字符串
// 字典内的每一行都是一个键值对，表示不同连接状态对应的中文标签
// connecting → 显示文字：连接中
function connectionLabel(state: ConnectionState): string {
  const labels: Record<ConnectionState, string> = {
    connecting: "连接中",
    connected: "已连接",
    reconnecting: "重连中",
    closed: "已关闭"
  };
  //根据传进来的 state 状态值，在labels中查对应的中文，然后把这个中文返回出去
  return labels[state];
}

// function createTurn：函数名叫 createTurn（创建一轮对话）
// : ChatTurn：TypeScript 类型标注，表示函数返回值必须符合预先定义好的 ChatTurn 数据结构（聊天条目格式）
// 使用示例：
// 创建一条新对话条目
// const newChat: ChatTurn = createTurn("你好，请介绍React");
function createTurn(content: string): ChatTurn {
  return {
    // id：唯一标识
    // crypto.randomUUID()：浏览器原生 API，生成一个随机的 UUID（通用唯一识别码）
    // 如果浏览器不支持 crypto.randomUUID，就退而使用 Date.now() 生成一个时间戳作为 ID
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
    // content：用户输入的科研任务内容
    content,
    // events：这一轮对话中发生的事件列表，初始为空
    events: [],
    // files：这一轮对话中上传的文件列表，初始为空
    files: [],
    // isRunning：这一轮对话是否正在执行科研任务，初始为 true
    isRunning: true,
    // 最终回复结果文本，初始为空字符串
    result: "",
    // 时间戳：ISO标准格式的当前时间字符串
    timestamp: new Date().toISOString()
  };
}

// export default：默认导出这个 App 函数组件，作为整个应用的主页面组件
// const [a, b] = ...：数组解构，按顺序取值（useState 返回数组）
// const { x } = ...：对象解构，按属性名取值（antd useApp 返回对象）
// useState 适用：数据要显示在页面上
// useRef 适用：只做内部标记、不参与 UI 渲染
export default function App() {
  // AntApp.useApp()：Ant Design 组件库的全局上下文 Hook
  // message：antd 的全局消息弹窗方法（message.info / message.error / message.success）
  // 调用 antd 的全局Hook，返回上下文对象，解构取出 message 弹窗方法，存入 const 常量变量
  // { 属性名 } = 专门用于对象解构的固定语法格式
  // AntApp.useApp() 执行后返回的是 一个完整对象
  // {
  //   message: 弹窗方法函数,
  //   modal: 弹窗对话框方法,
  //   notification: 通知方法,
  //   // ...其他很多属性
  // }
  // const { message } 从右边的对象里，提取键名 = message 的属性值，直接创建同名变量 message
  const { message } = AntApp.useApp();
  // const：声明常量变量，不能整体重新赋值，但变量内部内容可正常修改 / 调用
  // useState / useRef：React 内置 Hook 函数
  // useDeepAgentSession：本项目自定义 Hook 函数
  // []：数组解构语法（按顺序取值）
  // useState("")
  // React 状态钩子，创建响应式状态，初始值是空字符串 ""
  // 返回一个数组格式：[当前状态值, 修改状态的函数]
  // [query, setQuery]：数组解构
  // query：常量变量，保存当前用户输入框里的文本
  // setQuery：常量变量，保存更新文本的函数（调用它可以修改 query，页面会自动重新渲染
  // 初始是空字符串
  const [query, setQuery] = useState("");

  // useState 本身是一个通用函数，它本身不知道你要存什么类型的数据，可以存字符串、数字、数组、对象
  // <UploadedItem[]> 就是 TypeScript 泛型（Generic）写法
  // UploadedItem[]：代表 UploadedItem 对象组成的数组
  // useState<UploadedItem[]>明确指定数组只能是 UploadedItem 类型
  // stagedItems初始是空数组
  const [stagedItems, setStagedItems] = useState<UploadedItem[]>([]);

  // useState：对话列表，界面要渲染展示
  const [turns, setTurns] = useState<ChatTurn[]>([]);

  //approvalBusy默认是false
  const [approvalBusy, setApprovalBusy] = useState(false);
  //<HTMLElement | null>
  //保存中间聊天滚动区域的 DOM 节点
  const streamRef = useRef<HTMLElement | null>(null);

  // useRef：标记是否自动滚动，只内部逻辑用，不需要页面刷新
  // 保存一个布尔值：是否应该自动滚动到底部。
  const shouldAutoScrollRef = useRef(true);
  //核心业务 Hook
  const session = useDeepAgentSession();

  useEffect(() => {
    setTurns((previous) => {
      if (previous.length === 0) {
        return previous;
      }

      const latestTurn = previous[previous.length - 1];
      const nextLatestTurn = {
        ...latestTurn,
        events: session.events,
        files: session.files,
        isRunning: session.isRunning,
        result: session.result
      };

      return [...previous.slice(0, -1), nextLatestTurn];
    });
  }, [session.events, session.files, session.isRunning, session.result]);

  useEffect(() => {
    const streamNode = streamRef.current;
    if (!streamNode) {
      return;
    }
    if (!shouldAutoScrollRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      streamNode.scrollTo({
        top: streamNode.scrollHeight,
        behavior: "smooth"
      });
    });
  }, [turns]);

  function handleStreamScroll() {
    const streamNode = streamRef.current;
    if (!streamNode) {
      return;
    }

    const distanceToBottom =
      streamNode.scrollHeight - streamNode.scrollTop - streamNode.clientHeight;
    shouldAutoScrollRef.current = distanceToBottom < 96;
  }

  async function handleSubmit() {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      message.warning("请输入科研任务");
      return;
    }

    const nextTurn = createTurn(cleanQuery);
    shouldAutoScrollRef.current = true;
    setTurns((previous) => [...previous, nextTurn]);
    setQuery("");

    try {
      await session.submitTask(cleanQuery);
      message.success("任务已启动，执行过程会显示在对话中");
    } catch (error) {
      setTurns((previous) =>
        previous.map((turn) =>
          turn.id === nextTurn.id
            ? {
              ...turn,
              isRunning: false,
              result: error instanceof Error ? error.message : "任务启动失败"
            }
            : turn
        )
      );
      message.error(error instanceof Error ? error.message : "任务启动失败");
    }
  }

  async function handleCancel() {
    try {
      const response = await session.cancelCurrentTask();
      message.info(response.status === "cancelling" ? "取消请求已发送，正在等待当前调用结束" : "任务已取消");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "取消任务失败");
    }
  }

  async function handleUpload(items: UploadedItem[]) {
    try {
      const response = await session.uploadFiles(items);
      setStagedItems([]);
      message.success(`已上传 ${response.files.length} 个文件`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "上传失败");
    }
  }

  function handleNewSession() {
    session.resetSession();
    setTurns([]);
    setQuery("");
    setStagedItems([]);
  }

  async function handleApproveSql() {
    const approval = session.pendingApprovals[0];
    if (!approval) {
      return;
    }

    setApprovalBusy(true);
    try {
      const response = await session.approveApproval(approval.id);
      const affectedRows = response.approval.result?.affected_rows;
      message.success(
        affectedRows === 0
          ? "SQL 已执行；目标记录可能已是期望状态"
          : typeof affectedRows === "number"
            ? `SQL 已执行，影响 ${affectedRows} 行`
            : "SQL 已审批并执行"
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "审批执行失败");
    } finally {
      setApprovalBusy(false);
    }
  }

  async function handleRejectSql() {
    const approval = session.pendingApprovals[0];
    if (!approval) {
      return;
    }

    setApprovalBusy(true);
    try {
      await session.rejectApproval(approval.id, "用户在前端拒绝执行");
      message.info("已拒绝执行该 SQL");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "拒绝审批失败");
    } finally {
      setApprovalBusy(false);
    }
  }

  const online = session.connectionState === "connected";
  const activeApproval = session.pendingApprovals[0];

  return (
    <div className="chat-app-shell min-h-dvh">
      <aside className="chat-sidebar" aria-label="会话信息">
        <div className="sidebar-brand">
          <span className="panel-kicker">SCIRESEARCH</span>
          <h1>科研助手</h1>
          <p>论文知识库与科研数据工作台</p>
        </div>

        <Button className="new-chat-button" block onClick={handleNewSession}>
          新建科研任务
        </Button>

        <div className="sidebar-section">
          <span className="sidebar-label">THREAD</span>
          <strong className="thread-id" title={session.threadId}>
            {session.threadId.slice(0, 8)}
          </strong>
        </div>

        <div className="sidebar-status-list">
          <div className={`sidebar-status ${online ? "sidebar-status--online" : "sidebar-status--warn"}`}>
            <ApiOutlined aria-hidden />
            <span>WebSocket</span>
            <strong>{connectionLabel(session.connectionState)}</strong>
          </div>
          <div className="sidebar-status">
            <BranchesOutlined aria-hidden />
            <span>助手调度</span>
            <strong>{session.stats.assistantEvents}</strong>
          </div>
          <div className="sidebar-status">
            <ToolOutlined aria-hidden />
            <span>工具调用</span>
            <strong>{session.stats.toolEvents}</strong>
          </div>
          <div className={session.stats.errorEvents > 0 ? "sidebar-status sidebar-status--error" : "sidebar-status"}>
            <CloseCircleOutlined aria-hidden />
            <span>异常</span>
            <strong>{session.stats.errorEvents}</strong>
          </div>
        </div>

        <div className="sidebar-section">
          <span className="sidebar-label">AGENTS</span>
          <ul className="agent-mini-list">
            <li>
              <CloudServerOutlined aria-hidden />
              科研公开信息搜索助手
            </li>
            <li>
              <DatabaseOutlined aria-hidden />
              科研数据查询助手
            </li>
            <li>
              <FileSearchOutlined aria-hidden />
              科研论文知识库助手
            </li>
          </ul>
        </div>

        <div className="sidebar-section sidebar-endpoints">
          <span className="sidebar-label">ENDPOINTS</span>
          <code>{API_BASE_URL}</code>
          <code>{WS_BASE_URL}</code>
        </div>
      </aside>

      <main className="chat-main">
        <header className="chat-topbar">
          <div>
            <span className="panel-kicker">RESEARCH WORKSPACE</span>
            <h2>科研助手对话</h2>
          </div>
          <div className={`run-indicator ${session.isRunning ? "run-indicator--live" : ""}`}>
            {session.isRunning ? <BranchesOutlined aria-hidden /> : <CheckCircleOutlined aria-hidden />}
            {session.isRunning ? "研究中" : "待命"}
          </div>
        </header>

        {session.lastError ? (
          <Alert
            className="chat-alert"
            message={session.lastError}
            showIcon
            type="error"
          />
        ) : null}

        <section className="chat-stream-panel" onScroll={handleStreamScroll} ref={streamRef}>
          <ConversationThread
            onUseExample={setQuery}
            turns={turns}
          />
        </section>

        <ChatComposer
          isCancelling={session.isCancelling}
          isRunning={session.isRunning}
          isUploading={session.isUploading}
          onCancel={handleCancel}
          onNewSession={handleNewSession}
          onQueryChange={setQuery}
          onStagedItemsChange={setStagedItems}
          onSubmit={handleSubmit}
          onUpload={handleUpload}
          query={query}
          stagedItems={stagedItems}
          uploadedItems={session.uploadedItems}
        />
      </main>

      <Modal
        cancelText="拒绝"
        confirmLoading={approvalBusy}
        okText="批准执行"
        onCancel={handleRejectSql}
        onOk={handleApproveSql}
        open={Boolean(activeApproval)}
        title="数据库修改需要人工审核"
      >
        {activeApproval ? (
          <div>
            <Alert
              message="模型请求执行写入或高风险 SQL。请确认目标表、字段、WHERE 条件和影响范围后再批准。"
              showIcon
              type="warning"
            />
            <Typography.Paragraph style={{ marginTop: 16 }}>
              <Typography.Text strong>拦截原因：</Typography.Text>
              <br />
              {activeApproval.reason}
            </Typography.Paragraph>
            <Typography.Paragraph>
              <Typography.Text strong>审批 ID：</Typography.Text>
              <br />
              <Typography.Text code>{activeApproval.id}</Typography.Text>
            </Typography.Paragraph>
            <Typography.Paragraph>
              <Typography.Text strong>待执行 SQL：</Typography.Text>
            </Typography.Paragraph>
            <pre
              style={{
                background: "rgba(0, 0, 0, 0.32)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8,
                maxHeight: 240,
                overflow: "auto",
                padding: 12,
                whiteSpace: "pre-wrap"
              }}
            >
              {activeApproval.query}
            </pre>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

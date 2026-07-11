import {
  ApiOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  ToolOutlined
} from "@ant-design/icons";
import { Alert, App as AntApp, Button, Modal, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "./components/ChatComposer";
import { ConversationThread } from "./components/ConversationThread";
import type { ChatTurn } from "./components/ConversationThread";
import { API_BASE_URL, WS_BASE_URL } from "./lib/config";
import { useDeepAgentSession } from "./hooks/useDeepAgentSession";
import type { ConnectionState, UploadedItem } from "./types";

function connectionLabel(state: ConnectionState): string {
  const labels: Record<ConnectionState, string> = {
    connecting: "连接中",
    connected: "已连接",
    reconnecting: "重连中",
    closed: "已关闭"
  };
  return labels[state];
}

function createTurn(content: string): ChatTurn {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
    content,
    events: [],
    files: [],
    isRunning: true,
    result: "",
    timestamp: new Date().toISOString()
  };
}

export default function App() {
  const { message } = AntApp.useApp();
  const [query, setQuery] = useState("");
  const [stagedItems, setStagedItems] = useState<UploadedItem[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const streamRef = useRef<HTMLElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  approveSqlApproval,
  cancelTask,
  listSessionFiles,
  rejectSqlApproval,
  startTask,
  uploadSessionFiles
} from "../lib/api";
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

const MAX_EVENTS = 120;

function extractString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" ? value : null;
}

export function useDeepAgentSession() {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | undefined>(undefined);
  const heartbeatTimerRef = useRef<number | undefined>(undefined);
  const uploadedNameSetRef = useRef<Set<string>>(new Set());
  const handledApprovalResultSetRef = useRef<Set<string>>(new Set());
  const baseResultRef = useRef("");
  const approvalResultMapRef = useRef<Map<string, string>>(new Map());
  const [threadId, setThreadId] = useState(getStoredThreadId);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [events, setEvents] = useState<MonitorMessage[]>([]);
  const [files, setFiles] = useState<OutputFile[]>([]);
  const [sessionPath, setSessionPath] = useState("");
  const [result, setResult] = useState("");
  const [lastError, setLastError] = useState("");
  const [lastPongAt, setLastPongAt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedItems, setUploadedItems] = useState<UploadedItem[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<SqlApproval[]>([]);

  const composeResult = useCallback(() => {
    const approvalResults = Array.from(approvalResultMapRef.current.values());
    if (approvalResults.length === 0) {
      return baseResultRef.current;
    }

    const approvalText = approvalResults.join("\n\n---\n\n");
    return baseResultRef.current
      ? `${baseResultRef.current}\n\n---\n\n${approvalText}`
      : approvalText;
  }, []);

  const appendApprovalResult = useCallback((approval: SqlApproval) => {
    if (!approval?.id || handledApprovalResultSetRef.current.has(approval.id)) {
      return;
    }
    handledApprovalResultSetRef.current.add(approval.id);

    let approvalMessage = "";
    if (approval.status === "approved") {
      const affectedRows = approval.result?.affected_rows;
      approvalMessage =
        affectedRows === 0
          ? "数据库修改已通过人工审核并执行完成；影响行数为 0，通常表示目标记录已是期望状态，或 WHERE 条件没有匹配到需要变更的行。"
          : typeof affectedRows === "number"
          ? `数据库修改已通过人工审核并执行成功，影响行数：${affectedRows}。`
          : "数据库修改已通过人工审核并执行成功。";
    } else if (approval.status === "rejected") {
      const rejectReason = approval.result?.reject_reason;
      approvalMessage =
        typeof rejectReason === "string" && rejectReason
          ? `数据库修改已被人工拒绝，未执行。拒绝原因：${rejectReason}`
          : "数据库修改已被人工拒绝，未执行。";
    } else if (approval.status === "failed") {
      approvalMessage = `数据库修改审批后执行失败，原因：${approval.error || "未知错误"}`;
    } else {
      return;
    }

    approvalResultMapRef.current.set(
      approval.id,
      `审批结果：${approvalMessage}\n\n审批 ID：${approval.id}`
    );

    setResult(composeResult());
  }, [composeResult]);

  const clearSocketTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }
    if (heartbeatTimerRef.current) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = undefined;
    }
  }, []);

  const resetSession = useCallback(() => {
    const nextThreadId = createThreadId();
    storeThreadId(nextThreadId);
    setThreadId(nextThreadId);
    setEvents([]);
    setFiles([]);
    setSessionPath("");
    setResult("");
    setLastError("");
    setUploadedItems([]);
    setPendingApprovals([]);
    uploadedNameSetRef.current.clear();
    handledApprovalResultSetRef.current.clear();
    baseResultRef.current = "";
    approvalResultMapRef.current.clear();
    setIsRunning(false);
    setIsCancelling(false);
  }, []);

  const refreshFiles = useCallback(async () => {
    if (!sessionPath) {
      return;
    }

    const response = await listSessionFiles(sessionPath);
    if (response.error) {
      throw new Error(response.error);
    }
    setFiles(response.files || []);
  }, [sessionPath]);

  useEffect(() => {
    let disposed = false;

    function connect() {
      clearSocketTimers();
      const hadSocket = Boolean(socketRef.current);
      socketRef.current?.close();
      setConnectionState(hadSocket ? "reconnecting" : "connecting");

      const socket = new WebSocket(`${WS_BASE_URL}/ws/${encodeURIComponent(threadId)}`);
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) {
          return;
        }
        setConnectionState("connected");
        setLastError("");
        heartbeatTimerRef.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send("ping");
          }
        }, 25000);
      };

      socket.onmessage = (event) => {
        if (socketRef.current !== socket) {
          return;
        }
        try {
          const payload = JSON.parse(event.data) as SocketMessage;
          if (payload.type === "pong") {
            setLastPongAt(new Date().toISOString());
            return;
          }

          if (payload.type !== "monitor_event") {
            return;
          }

          setEvents((previous) => [...previous, payload].slice(-MAX_EVENTS));

          if (payload.event === "session_created") {
            const path = extractString(payload.data, "path");
            if (path) {
              setSessionPath(path);
            }
          }

          if (payload.event === "approval_required") {
            const approval = payload.data.approval as SqlApproval | undefined;
            if (approval?.id) {
              setPendingApprovals((previous) => {
                const exists = previous.some((item) => item.id === approval.id);
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
            if (approval?.id) {
              setPendingApprovals((previous) =>
                previous.filter((item) => item.id !== approval.id)
              );
              appendApprovalResult(approval);
            }
          }

          if (payload.event === "task_result") {
            const finalResult = extractString(payload.data, "result");
            baseResultRef.current = finalResult || payload.message;
            setResult(composeResult());
            setIsRunning(false);
            setIsCancelling(false);
          }

          if (payload.event === "task_cancelled") {
            setResult((previous) => previous || payload.message);
            setIsRunning(false);
            setIsCancelling(false);
          }

          if (payload.event === "error") {
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

      socket.onclose = () => {
        if (socketRef.current !== socket) {
          return;
        }
        clearSocketTimers();
        if (disposed) {
          setConnectionState("closed");
          return;
        }
        setConnectionState("reconnecting");
        reconnectTimerRef.current = window.setTimeout(connect, 2000);
      };
    }

    connect();

    return () => {
      disposed = true;
      clearSocketTimers();
      socketRef.current?.close();
    };
  }, [clearSocketTimers, threadId]);

  useEffect(() => {
    if (!sessionPath) {
      return;
    }

    refreshFiles().catch((error: unknown) => {
      setLastError(error instanceof Error ? error.message : "文件列表刷新失败");
    });

    const timer = window.setInterval(() => {
      refreshFiles().catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : "文件列表刷新失败");
      });
    }, isRunning ? 2500 : 6000);

    return () => window.clearInterval(timer);
  }, [isRunning, refreshFiles, sessionPath]);

  const submitTask = useCallback(
    async (query: string) => {
      const cleanQuery = query.trim();
      if (!cleanQuery) {
        throw new Error("请输入科研任务");
      }

      setIsRunning(true);
      setIsCancelling(false);
      setEvents([]);
      setResult("");
      setLastError("");
      setPendingApprovals([]);
      handledApprovalResultSetRef.current.clear();
      baseResultRef.current = "";
      approvalResultMapRef.current.clear();
      try {
        const response = await startTask(cleanQuery, threadId);
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

      const nextItems = items.filter((item) => !uploadedNameSetRef.current.has(item.name));

      if (nextItems.length === 0) {
        return {
          status: "uploaded",
          files: Array.from(uploadedNameSetRef.current)
        };
      }

      setIsUploading(true);
      setLastError("");
      try {
        const response = await uploadSessionFiles(
          nextItems.map((item) => item.raw),
          threadId
        );
        setUploadedItems((previous) => {
          const names = new Set(previous.map((item) => item.name));
          const next = [...previous];
          nextItems.forEach((item) => {
            if (!names.has(item.name)) {
              names.add(item.name);
              uploadedNameSetRef.current.add(item.name);
              next.push(item);
            }
          });
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
    const response = await approveSqlApproval(approvalId);
    setPendingApprovals((previous) => previous.filter((item) => item.id !== approvalId));
    appendApprovalResult(response.approval);
    return response;
  }, [appendApprovalResult]);

  const rejectApproval = useCallback(async (approvalId: string, reason = "") => {
    const response = await rejectSqlApproval(approvalId, reason);
    setPendingApprovals((previous) => previous.filter((item) => item.id !== approvalId));
    appendApprovalResult(response.approval);
    return response;
  }, [appendApprovalResult]);

  const stats = useMemo(() => {
    const toolEvents = events.filter((event) => event.event === "tool_start").length;
    const assistantEvents = events.filter((event) => event.event === "assistant_call").length;
    const errorEvents = events.filter((event) => event.event === "error").length;

    return {
      toolEvents,
      assistantEvents,
      errorEvents,
      fileCount: files.length
    };
  }, [events, files.length]);

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

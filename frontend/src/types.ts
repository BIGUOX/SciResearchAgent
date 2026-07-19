// export
// 导出这个类型，别的文件可以通过 import 引入并使用 ConnectionState
// 方便整个项目统一复用这套状态定义
// type ConnectionState
// type：TypeScript 语法，用来自定义类型
// ConnectionState：这个自定义类型的名字（连接状态类型）
// "connecting" | "connected" | "reconnecting" | "closed"
// 这是 联合字面量类型
// | 意思是「或」
// 含义：ConnectionState 类型的值，只能是这 4 个精确字符串里的其中一个，不能是其他任意字符串 / 别的类型
// ✅ 合法值："connecting"、"connected"、"reconnecting"、"closed"
// ❌ 非法值："error"、"close"、123、true 等，TS 会直接报错提醒
export type ConnectionState = "connecting" | "connected" | "reconnecting" | "closed";

export type MonitorEventName =
  | "session_created"
  | "tool_start"
  | "assistant_call"
  | "approval_required"
  | "approval_approved"
  | "approval_rejected"
  | "approval_failed"
  | "task_result"
  | "task_cancelled"
  | "error"
  | string;

export interface MonitorMessage {
  type: "monitor_event";//固定标识
  event: MonitorEventName;//事件类型
  message: string;//描述文本
  data: Record<string, unknown>;//可变附加数据
  timestamp: string;//时间戳
}

export interface PongMessage {
  type: "pong";
  message: string;
}

export type SocketMessage = MonitorMessage | PongMessage;

export interface TaskResponse {
  status: "started" | string;
  thread_id: string;
}

export interface CancelTaskResponse {
  status: "cancelled" | "cancelling" | string;
  thread_id: string;
  message?: string;
}

export interface UploadResponse {
  status: "uploaded" | string;
  files: string[];
}

export interface OutputFile {
  //文件名称，例如 `report.csv`、`result.pdf`
  name: string;
  //- 固定字面量 `"file"` 代表普通文件；- 也可以是其他任意字符串，用来区分文件分类 / 后缀 / 媒体类型（图片、表格、日志等）
  type: "file" | string;
  path: string;//文件在服务端会话目录下的完整存储路径
  size: number;//文件大小，单位字节
  mtime: number;//时间戳
}

export interface FileListResponse {
  files?: OutputFile[];
  error?: string;
}

// number 是 JavaScript / TypeScript 的基础原始数据类型，用来表示数字（整数、小数、负数等）
// ✅ 合法值：
// 整数：0、100、-5
// 小数：1024.5、3.14
// 特殊数值：NaN、Infinity 等也属于 number 类型
// ❌ 不是：字符串数字 "1024"、布尔值 true/false、数组、对象都不属于 number
// interface：TypeScript 语法，定义接口（数据结构模板），用来规定对象必须具备哪些字段、以及对应类型
export interface UploadedItem {
  uid: string;//唯一标识 ID（字符串类型），用来区分每一个上传文件
  name: string; //文件名（字符串类型），例如 report.pdf、photo.png
  size: number; //文件大小（数值类型），单位通常是字节
  raw: File; //原生浏览器 File 对象，包含原始文件二进制数据、类型、修改时间等底层信息，用于真正上传提交
}

//pending：待审核 approved：已同意 rejected：已拒绝 failed：审批通过但 SQL 执行报错
export type ApprovalStatus = "pending" | "approved" | "rejected" | "failed" | string;

//SQL 人工审批单 
export interface SqlApproval {
  id: string;//审批单唯一 ID，主键
  thread_id?: string | null; //?`代表可选字段，可能不存在；
  query: string; //需要人工审核的完整 SQL 语句
  reason: string; //AI 生成这条 SQL 的执行原因、业务说明，告诉用户为什么要执行这条修改语句
  status: ApprovalStatus; //审批当前状态
  created_at: string;
  updated_at: string;
  //可选、可为 null；普通对象，存储 SQL 执行结果数据：
  // - 审批通过后会有 affected_rows（影响行数）；
  // - 拒绝时会有 reject_reason（用户填写的拒绝理由）；
  // 结构不固定，所以用 Record<string, unknown> 兼容。
  result?: Record<string, unknown> | null;
  // 可选、可为 null；
  // SQL 执行失败时存放错误描述，正常成功 / 拒绝时为 `null`。
  error?: string | null;
}

export interface ApprovalResponse {
  approval: SqlApproval;
}

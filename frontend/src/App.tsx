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

  //同步最新会话数据到对话轮次 turns
  //turns保存多轮问答历史（每一轮用户提问 + AI 回复为一条 turn）
  //AI 任务运行时，事件、文件、加载状态、回答文本会实时变化
  useEffect(() => {
    setTurns((previous) => {
      if (previous.length === 0) {
        return previous;
      }
      // 拿到对话列表最后一轮对话
      const latestTurn = previous[previous.length - 1];
      // 用最新 session 数据覆盖最后一轮对话的实时字段
      const nextLatestTurn = {
        ...latestTurn,
        events: session.events,
        files: session.files,
        isRunning: session.isRunning,
        result: session.result
      };
      // 砍掉最后一条，替换成更新后的新对象，返回全新数组更新 turns
      // `slice(start, end)`：截取数组，`-1` 代表倒数第一个元素
      // 原数组最后一条是当前正在交互的对话，
      // 实时更新 events / 文件 / AI 回答，不能新增一条记录，而是原地替换最后一轮对话
      return [...previous.slice(0, -1), nextLatestTurn];
    });
  }, [session.events, session.files, session.isRunning, session.result]);

  useEffect(() => {
    // 获取滚动容器DOM元素
    const streamNode = streamRef.current;
    // DOM还没挂载，直接退出，不执行滚动
    if (!streamNode) {
      return;
    }
    // 标记为不自动滚动，直接退出
    if (!shouldAutoScrollRef.current) {
      return;
    }
    // 等浏览器下一帧渲染完成后再执行滚动，避免文字未渲染导致滚动不到底
    window.requestAnimationFrame(() => {
      streamNode.scrollTo({
        //`streamNode.scrollHeight`：容器内部所有内容总高度
        top: streamNode.scrollHeight,// 滚动到容器内容最底部
        behavior: "smooth"// 平滑滚动动画
      });
    });
  }, [turns]);// 依赖：对话列表turns发生变化时触发

  function handleStreamScroll() {
    // 获取聊天滚动容器DOM
    const streamNode = streamRef.current;
    // DOM不存在直接退出，防止报错
    if (!streamNode) {
      return;
    }
    // 计算滚动条距离容器底部还有多少像素(下面)
    // 总内容高度 − 滚动上去的距离 − 可视窗口高度 = 滚动条距离底部剩余像素
    //`scrollHeight`：容器内部全部内容的总高度（包含看不见的滚动区域）
    //`scrollTop`：滚动条向上滚动了多少像素,已经滚上去隐藏掉的内容高度(上面)
    //`clientHeight`：容器可视区域高度（页面上能直接看到的部分）
    const distanceToBottom =
      streamNode.scrollHeight - streamNode.scrollTop - streamNode.clientHeight;
    //剩余距离 < 96px → `true`：开启自动滚动，新消息出现页面自动滑到底；
    //剩余距离 ≥ 96px → `false`：关闭自动滚动，不再强行下拉打扰用户看历史
    shouldAutoScrollRef.current = distanceToBottom < 96;
  }

  async function handleSubmit() {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      message.warning("请输入科研任务");
      return;
    }
    //创建全新一轮对话记录
    const nextTurn = createTurn(cleanQuery);
    // 提交新任务，默认开启自动滚动到底部
    shouldAutoScrollRef.current = true;
    // 把新对话追加到 turns 列表，页面立刻展示用户提问
    setTurns((previous) => [...previous, nextTurn]);
    // 清空输入框
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

  //点击「新建对话 / 重置会话」按钮时执行，清空当前所有会话数据，开启全新空白对话
  function handleNewSession() {
    session.resetSession();
    setTurns([]);
    setQuery("");
    setStagedItems([]);
  }

  async function handleApproveSql() {
    // 取出第一条待审批SQL
    const approval = session.pendingApprovals[0];
    // 没有待审批弹窗直接退出
    if (!approval) {
      return;
    }
    // 标记审批操作加载中，防止重复点击
    setApprovalBusy(true);
    try {
      // 调用hook方法同意这条审批
      const response = await session.approveApproval(approval.id);
      // 拿到SQL执行影响行数
      const affectedRows = response.approval.result?.affected_rows;
      // 多分支差异化成功提示
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
  // 判断WebSocket是否在线连接成功
  // 只有状态等于 `connected` 时，`online` 为 `true`，代表网络长连接正常
  // `session.connectionState` 是 WebSocket 连接状态，常见值一般有：
  // - `connected`：已正常连上服务端
  // - `connecting`：正在连接 / 重连中
  // - `disconnected`：断开连接
  const online = session.connectionState === "connected";
  //如果没有待审批，数组为空，`activeApproval` 会是 `undefined`
  //判断是否弹出审批弹窗
  const activeApproval = session.pendingApprovals[0];

  // return 输出页面所有DOM结构，JSX必须外层包一个根标签（这里最外层div）
  //`return ()` 内部：描述页面结构、文字、按钮、弹窗，最终渲染给用户看
  return (
    // 全局最外层大盒子，铺满整个页面高度 min-h-dvh：占满屏幕可视高度
    <div className="chat-app-shell min-h-dvh">

      {/* ========== 左侧侧边栏 aside 侧边语义标签 ========== */}
      {/* aria-label 无障碍标签，给读屏软件使用，不影响页面显示 */}
      <aside className="chat-sidebar" aria-label="会话信息">
        {/* 侧边栏品牌区域盒子 */}
        <div className="sidebar-brand">
          {/* span行内文字，不会自动换行 */}
          <span className="panel-kicker">SCIRESEARCH</span>
          {/* h1 页面一级大标题 */}
          <h1>科研助手</h1>
          {/* p 段落标签，文字自动换行 */}
          <p>论文知识库与科研数据工作台</p>
        </div>

        {/* Button 组件库按钮，block铺满整行；onClick点击触发新建会话函数 */}
        <Button className="new-chat-button" block onClick={handleNewSession}>
          新建科研任务
        </Button>

        {/* 侧边栏一小块区域：展示会话ID */}
        <div className="sidebar-section">
          <span className="sidebar-label">THREAD</span>
          {/* strong 文字加粗；title鼠标悬浮显示完整会话ID */}
          <strong className="thread-id" title={session.threadId}>
            {/* { } 嵌入JS表达式，截取ID前8位展示 */}
            {session.threadId.slice(0, 8)}
          </strong>
        </div>

        {/* 状态统计面板盒子 */}
        <div className="sidebar-status-list">
          {/* 动态className：三元表达式，在线就加在线样式，离线加警告样式 */}
          <div className={`sidebar-status ${online ? "sidebar-status--online" : "sidebar-status--warn"}`}>
            {/* 图标组件 aria-hidden：屏幕阅读器忽略这个图标 */}
            <ApiOutlined aria-hidden />
            <span>WebSocket</span>
            {/* 执行函数把连接状态英文转中文显示 */}
            <strong>{connectionLabel(session.connectionState)}</strong>
          </div>

          <div className="sidebar-status">
            <BranchesOutlined aria-hidden />
            <span>助手调度</span>
            {/* 读取统计对象里助手调用次数 */}
            <strong>{session.stats.assistantEvents}</strong>
          </div>

          <div className="sidebar-status">
            <ToolOutlined aria-hidden />
            <span>工具调用</span>
            <strong>{session.stats.toolEvents}</strong>
          </div>

          {/* 报错大于0，启用红色错误样式 */}
          <div className={session.stats.errorEvents > 0 ? "sidebar-status sidebar-status--error" : "sidebar-status"}>
            <CloseCircleOutlined aria-hidden />
            <span>异常</span>
            <strong>{session.stats.errorEvents}</strong>
          </div>
        </div>

        {/* 智能助手列表区域 */}
        <div className="sidebar-section">
          <span className="sidebar-label">AGENTS</span>
          {/* ul无序列表容器，li是列表每一行 */}
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

        {/* 后端接口地址展示区域 */}
        <div className="sidebar-section sidebar-endpoints">
          <span className="sidebar-label">ENDPOINTS</span>
          {/* code 代码样式标签，适合展示接口地址 */}
          <code>{API_BASE_URL}</code>
          <code>{WS_BASE_URL}</code>
        </div>
      </aside>

      {/* ========== 页面主体聊天区域 main 语义标签 ========== */}
      <main className="chat-main">
        {/* 顶部标题栏 header 模块头部标签 */}
        <header className="chat-topbar">
          <div>
            <span className="panel-kicker">RESEARCH WORKSPACE</span>
            {/* h2 二级标题 */}
            <h2>科研助手对话</h2>
          </div>
          {/* 动态样式：任务运行中添加动态样式 */}
          <div className={`run-indicator ${session.isRunning ? "run-indicator--live" : ""}`}>
            {/* 三元渲染图标：运行中展示分支图标，空闲展示对勾 */}
            {session.isRunning ? <BranchesOutlined aria-hidden /> : <CheckCircleOutlined aria-hidden />}
            {session.isRunning ? "研究中" : "待命"}
          </div>
        </header>

        {/* 条件渲染：存在全局错误才展示红色提示框，否则什么都不渲染(null) */}
        {session.lastError ? (
          <Alert
            className="chat-alert"
            message={session.lastError} // 提示文字
            showIcon // 展示左侧图标
            type="error" // 提示类型：错误红色
          />
        ) : null}

        {/* 聊天滚动区域 section独立内容块 */}
        {/* onScroll 监听滚动事件，滚动执行处理自动滚动的函数 */}
        {/* ref 绑定DOM，JS代码可以拿到这个滚动盒子操作滚动 */}
        <section className="chat-stream-panel" onScroll={handleStreamScroll} ref={streamRef}>
          {/* 自定义组件：渲染全部对话记录，传入对话数组、点击示例回填输入框方法 */}
          <ConversationThread
            onUseExample={setQuery}
            turns={turns}
          />
        </section>

        {/* 底部输入、上传文件自定义组件，批量传入所有状态和操作函数 */}
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

      {/* ========== SQL审批弹窗 Modal浮层组件 ========== */}
      <Modal
        cancelText="拒绝"          // 取消按钮文字
        confirmLoading={approvalBusy} // 审批加载时按钮转圈置灰
        okText="批准执行"          // 确认按钮文字
        onCancel={handleRejectSql} // 点拒绝执行驳回函数
        onOk={handleApproveSql}    // 点确认执行同意审批函数
        open={Boolean(activeApproval)} // 有审批数据弹窗打开，无则关闭
        title="数据库修改需要人工审核"   // 弹窗顶部标题
      >
        {/* 条件渲染：有待审SQL才渲染弹窗内部内容 */}
        {activeApproval ? (
          <div>
            {/* 黄色警告提示框 */}
            <Alert
              message="模型请求执行写入或高风险 SQL。请确认目标表、字段、WHERE 条件和影响范围后再批准。"
              showIcon
              type="warning"
            />
            {/* 组件库段落文字，style行内样式设置外边距 */}
            <Typography.Paragraph style={{ marginTop: 16 }}>
              {/* 文字加粗 */}
              <Typography.Text strong>拦截原因：</Typography.Text>
              <br />{/* 强制换行 */}
              {activeApproval.reason}
            </Typography.Paragraph>

            <Typography.Paragraph>
              <Typography.Text strong>审批 ID：</Typography.Text>
              <br />
              {/* code代码样式展示审批ID */}
              <Typography.Text code>{activeApproval.id}</Typography.Text>
            </Typography.Paragraph>

            <Typography.Paragraph>
              <Typography.Text strong>待执行 SQL：</Typography.Text>
            </Typography.Paragraph>

            {/* pre 代码块标签：保留SQL原有换行、空格、缩进 */}
            <pre
              style={{
                background: "rgba(0, 0, 0, 0.32)", // 背景色
                border: "1px solid rgba(255,255,255,0.12)", // 边框
                borderRadius: 8, // 圆角
                maxHeight: 240, // 最大高度，超出滚动
                overflow: "auto", // 内容超出出现滚动条
                padding: 12, // 内边距
                whiteSpace: "pre-wrap" // 自动换行
              }}
            >
              {/* 渲染完整SQL语句 */}
              {activeApproval.query}
            </pre>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}


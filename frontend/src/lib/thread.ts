const STORAGE_KEY = "deepsearch.thread_id";

//生成全局唯一的字符串 ID，用来作为对话会话标识 `threadId`，区分不同对话上下文
export function createThreadId(): string {
  //crypto.randomUUID()是浏览器内置 API，直接生成标准 36 位 UUID
  // UUID = Universally Unique Identifier通用唯一识别码
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // 如果环境不支持 randomUUID,手动拼接逻辑
  // manual-前缀，标记这是兼容兜底生成的 ID
  // Date.now()当前时间戳（毫秒数字），保证不同时间生成的 ID 基础不重复
  // Math.random().toString(16)：0~1 随机小数转 16 进制字符串，形如 0.8a2f31
  // .slice(2)切掉开头 `0.`只保留后面随机字符，增加随机性，防止同一毫秒内生成重复 ID
  return `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getStoredThreadId(): string {
  //从本地缓存读取上次保存的会话ID
  const existing = window.localStorage.getItem(STORAGE_KEY);

  if (existing) {
    return existing;
  }
  //本地没有存储会话ID，生成全新ID
  const threadId = createThreadId();
  window.localStorage.setItem(STORAGE_KEY, threadId);
  return threadId;
}

//: void函数执行后没有任何返回数据，只做存储操作
//window.localStorage浏览器本地持久化存储,存在用户浏览器里，关闭页面、重启浏览器数据依然保留
//.setItem(STORAGE\_KEY, threadId)
// `STORAGE_KEY`：提前定义好的固定常量字符串，作为存储的键名；
//threadId:要存进去的会话 ID 值
//以 `STORAGE_KEY` 为标记，把当前会话 ID 永久存在本地缓存
export function storeThreadId(threadId: string): void {
  window.localStorage.setItem(STORAGE_KEY, threadId);
}

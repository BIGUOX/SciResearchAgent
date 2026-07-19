const DEFAULT_API_BASE_URL = "http://localhost:8000";

//工具函数：删除字符串末尾所有连续的斜杠 /，统一接口、WebSocket 地址格式，防止拼接路径出现 //
// /\\/+$/ :`\/`：正则里 `/` 是特殊符号，需要转义，代表字面斜杠 `/`
// - `+`：匹配前面符号 1 个或多个，连续多个斜杠一起匹配
// - `$`：匹配字符串末尾，只处理结尾的斜杠，中间的斜杠不动
// replace (正则，"")把匹配到的末尾全部斜杠替换成空字符串，直接删掉
// `http://localhost:8000/`→ `http://localhost:8000`
function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

//根据后端 HTTP 接口地址，自动换算出 WebSocket 服务地址
function deriveWsBaseUrl(apiBaseUrl: string): string {
  //存在配置就直接使用，`stripTrailingSlash` 去掉末尾多余 `/`，防止拼接出现双斜杠
  if (import.meta.env.VITE_WS_BASE_URL) {
    return stripTrailingSlash(import.meta.env.VITE_WS_BASE_URL);
  }

  if (apiBaseUrl.startsWith("https://")) {
    //`^https:\/\/` 匹配字符串开头的 `https://`，全局替换为 `wss://`
    //`https://api.xxx.com` → `wss://api.xxx.com`
    return apiBaseUrl.replace(/^https:\/\//, "wss://");
  }

  if (apiBaseUrl.startsWith("http://")) {
    //把开头 `http://` 替换为 `ws://`
    //正则里单独一个 `/` 会被当成正则结束符
    //想写一个 `/`，正则内部要写成 `\/`
    return apiBaseUrl.replace(/^http:\/\//, "ws://");
  }
  //兜底
  //`window.location.protocol`：页面协议 `http:` / `https:`
  //`window.location.host`：域名 + 端口，如 `localhost:5173`
  //页面是 https 就拼接 wss，http 拼接 ws，自动适配当前访问地址
  //本地开发，页面地址 [http://localhost:5173](https://link.wtturl.cn/?target=http%3A%2F%2Flocalhost%3A5173&scene=im&aid=497858&lang=zh
  // protocol = `http:`
  // 三元返回 `ws`
  // host = `localhost:5173`
  // 拼接结果：`ws://localhost:5173`
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
}

export const API_BASE_URL = stripTrailingSlash(
  //import.meta.env.VITE_API_BASE_URLVite 项目读取 `.env` 文件里的环境变量
  // 变量名以 `VITE_` 开头，前端代码才能访问.存储当前环境后端接口地址，例如 `http://127.0.0.1:8000`
  // VITE_API_BASE_URL=http://localhost:8000 VITE_WS_BASE_URL = ws://localhost:8000
  import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL
);


export const WS_BASE_URL = deriveWsBaseUrl(API_BASE_URL);

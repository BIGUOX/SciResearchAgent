// 给整个应用套上 Ant Design 的主题配置
import "antd/dist/reset.css";//引入 Ant Design 的基础重置样式。它会统一按钮、输入框、弹窗等组件的默认样式
// 从 Ant Design 引入三个东西：
// ConfigProvider：全局配置 Ant Design 主题
// theme：Ant Design 的主题工具
// App as AntApp：Ant Design 的 App 组件，改名叫 AntApp
import { App as AntApp, ConfigProvider, theme } from "antd";
import React from "react";
import ReactDOM from "react-dom/client";//ReactDOM 负责把 React 组件渲染到真实 DOM 里
import App from "./App";
import "./styles.css";

//ReactDOM.createRoot() 创建一个 React 根节点，接收一个 DOM 元素作为参数，然后调用 render() 方法渲染 React 组件树
//document.getElementById("root")获取index.html中id为root的div元素，!表示非空断言，告诉 TypeScript 这个元素一定存在
//render() 渲染 
//<React.StrictMode>React 严格模式。开发环境下会帮你发现一些潜在问题，比如副作用写得不规范。它不会在页面上显示东西。
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        //使用 Ant Design 的暗色主题算法
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#20d6ff",//主色：亮青色
          colorSuccess: "#5dff9f",//成功色：绿色
          colorWarning: "#ffc857",//警告色：黄色
          colorError: "#ff5c7a",//错误色：红色
          colorInfo: "#7c8cff",//信息色：蓝色
          colorBgBase: "#05070b",//背景色：深蓝色
          colorBgContainer: "rgba(12, 18, 28, 0.86)",//容器背景色：深蓝色半透明
          colorBorder: "rgba(113, 247, 255, 0.18)",//边框色：亮青色半透明
          borderRadius: 8,//圆角：8px
          fontFamily://字体：IBM Plex Sans、PingFang SC、Microsoft YaHei、系统默认字体、无衬线字体
            "'IBM Plex Sans', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
          fontFamilyCode://代码字体：JetBrains Mono、SFMono-Regular、Consolas、Liberation Mono、等宽字体
            "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
        },
        // 单独给某些 Ant Design 组件定制样式
        components: {
          //Button：大按钮高度是 46px，主按钮有青色发光阴影
          Button: {
            controlHeightLG: 46,
            primaryShadow: "0 0 24px rgba(32, 214, 255, 0.26)"
          },
          //Input：输入框聚焦时边框是亮青色，悬停时边框是绿色
          Input: {
            activeBorderColor: "#20d6ff",
            hoverBorderColor: "#5dff9f"
          }
        }
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);

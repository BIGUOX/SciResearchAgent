import { CloudServerOutlined, DatabaseOutlined, FileSearchOutlined } from "@ant-design/icons";

const agents = [
  {
    icon: <CloudServerOutlined aria-hidden />,
    name: "科研公开信息搜索助手",
    detail: "最新论文、会议动态、开源项目与公开数据集检索"
  },
  {
    icon: <DatabaseOutlined aria-hidden />,
    name: "科研数据查询助手",
    detail: "论文元数据、实验指标、课题进度与研究任务查询"
  },
  {
    icon: <FileSearchOutlined aria-hidden />,
    name: "科研论文知识库助手",
    detail: "RAGFlow 论文全文、方法、实验结论与相关工作问答"
  }
];

export function AgentTopology() {
  return (
    <section className="console-panel topology-panel" aria-labelledby="topology-title">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">ROUTING MAP</span>
          <h2 id="topology-title">多智能体路由</h2>
        </div>
      </div>
      <div className="agent-hub">
        <div className="main-agent-node">
          <span>MAIN</span>
          <strong>科研调度主智能体</strong>
        </div>
        <div className="agent-links" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="agent-node-list">
          {agents.map((agent) => (
            <div className="agent-node" key={agent.name}>
              <div className="agent-node-icon">{agent.icon}</div>
              <div>
                <strong>{agent.name}</strong>
                <p>{agent.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

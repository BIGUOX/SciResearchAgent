import { PlayCircleOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Button, Input } from "antd";

const { TextArea } = Input;

const presets = [
  "检索 2026 年 RAG 辅助科研文献综述的最新论文和开源项目，并整理关键趋势。",
  "结合 RAGFlow 科研论文知识库和公开资料，整理多模态科学文献理解方向的研究现状，并生成 Markdown。",
  "查询科研业务数据库中的实验验证阶段课题、负责人、截止时间和阻塞任务，并输出研究管理建议。"
];

interface MissionComposerProps {
  query: string;
  isRunning: boolean;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
}

export function MissionComposer({
  query,
  isRunning,
  onQueryChange,
  onSubmit
}: MissionComposerProps) {
  return (
    <section className="console-panel composer-panel" aria-labelledby="composer-title">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">MISSION INPUT</span>
          <h2 id="composer-title">发起科研任务</h2>
        </div>
        <ThunderboltOutlined className="panel-heading-icon" aria-hidden />
      </div>

      <TextArea
        aria-label="科研任务"
        className="mission-textarea"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="输入科研任务，例如：查询 2023 年以后 CVPR/NeurIPS 的多模态论文，并按年份统计数量。"
        autoSize={{ minRows: 7, maxRows: 12 }}
        disabled={isRunning}
      />

      <div className="preset-grid" aria-label="任务模板">
        {presets.map((preset) => (
          <button
            className="preset-chip"
            type="button"
            key={preset}
            onClick={() => onQueryChange(preset)}
            disabled={isRunning}
          >
            {preset}
          </button>
        ))}
      </div>

      <Button
        block
        className="launch-button"
        disabled={isRunning}
        icon={<PlayCircleOutlined />}
        loading={isRunning}
        onClick={onSubmit}
        size="large"
        type="primary"
      >
        {isRunning ? "任务执行中" : "启动主智能体"}
      </Button>
    </section>
  );
}

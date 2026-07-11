-- SciResearchAgent 科研助手结构化数据库初始化脚本
-- 业务定位：
-- 1. RAGFlow 存论文全文、PDF、实验报告等非结构化内容。
-- 2. MySQL 存科研助手需要稳定查询、统计、管理的结构化业务数据。
--
-- 当前结构覆盖：
-- papers              论文元数据
-- reading_status      论文阅读状态
-- datasets            数据集信息
-- experiments         实验指标
-- research_projects   课题进度
-- research_tasks      研究任务
-- user_paper_notes    用户收藏/笔记
-- paper_relations     文献引用/对比关系
--
-- Docker 初始化说明：
-- MySQL 官方镜像只会在数据目录为空的第一次启动时执行本脚本。
-- 如果容器已经启动并生成过 volume，修改本文件后需要重建 volume 才会重新导入。

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE DATABASE IF NOT EXISTS deepsearch_db
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;
USE deepsearch_db;

-- 1. 论文元数据：存论文的结构化索引，不存全文。
CREATE TABLE papers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(500) NOT NULL,
    authors TEXT,
    year INT,
    venue VARCHAR(255),
    publication_type VARCHAR(100),       -- journal, conference, preprint, thesis, report
    keywords TEXT,
    doi VARCHAR(255),
    url VARCHAR(500),
    file_name VARCHAR(255),              -- 本地上传或归档文件名
    ragflow_dataset_name VARCHAR(255),   -- 对应 RAGFlow 知识库名称
    ragflow_document_id VARCHAR(255),    -- 对应 RAGFlow 文档 ID，可为空
    research_area VARCHAR(255),
    abstract TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_papers_year (year),
    INDEX idx_papers_venue (venue),
    INDEX idx_papers_area (research_area)
);

-- 2. 阅读状态：一篇论文对一个用户/团队成员可以有独立阅读进度。
CREATE TABLE reading_status (
    id INT PRIMARY KEY AUTO_INCREMENT,
    paper_id INT NOT NULL,
    reader_name VARCHAR(100) DEFAULT 'default',
    status VARCHAR(50) DEFAULT '未阅读',  -- 未阅读/粗读/精读/已复现/暂不关注
    importance_level INT DEFAULT 3,       -- 1 最高，5 最低
    reading_progress INT DEFAULT 0,       -- 0-100
    last_read_at DATETIME,
    next_action VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_reading_status_paper
        FOREIGN KEY (paper_id) REFERENCES papers(id)
        ON DELETE CASCADE,
    UNIQUE KEY uk_reading_paper_reader (paper_id, reader_name),
    INDEX idx_reading_status (status),
    INDEX idx_reading_importance (importance_level)
);

-- 3. 数据集信息：存实验用到的数据集、任务、模态和许可信息。
CREATE TABLE datasets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255),
    modality VARCHAR(100),               -- text, image, tabular, time-series, multimodal
    task_type VARCHAR(255),
    sample_size INT,
    source_url VARCHAR(500),
    license VARCHAR(255),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_datasets_name (name),
    INDEX idx_datasets_domain (domain),
    INDEX idx_datasets_modality (modality)
);

-- 4. 实验指标：存论文或项目中的结构化实验结果。
CREATE TABLE experiments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    paper_id INT,
    dataset_id INT,
    experiment_name VARCHAR(255),
    method_name VARCHAR(255),
    baseline_name VARCHAR(255),
    metric_name VARCHAR(100),
    metric_value DECIMAL(12,4),
    baseline_value DECIMAL(12,4),
    improvement DECIMAL(12,4),
    split_name VARCHAR(100),              -- train/val/test/scaffold split 等
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_experiments_paper
        FOREIGN KEY (paper_id) REFERENCES papers(id)
        ON DELETE SET NULL,
    CONSTRAINT fk_experiments_dataset
        FOREIGN KEY (dataset_id) REFERENCES datasets(id)
        ON DELETE SET NULL,
    INDEX idx_experiments_metric (metric_name),
    INDEX idx_experiments_method (method_name)
);

-- 5. 课题进度：存研究项目、负责人、阶段和产出。
CREATE TABLE research_projects (
    id INT PRIMARY KEY AUTO_INCREMENT,
    project_name VARCHAR(255) NOT NULL,
    principal_investigator VARCHAR(100),
    members TEXT,
    research_area VARCHAR(255),
    stage VARCHAR(100),                  -- 选题/文献综述/方案设计/实验验证/论文写作/投稿
    progress TEXT,
    outputs TEXT,
    deadline DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_projects_stage (stage),
    INDEX idx_projects_deadline (deadline)
);

-- 6. 研究任务：存项目待办、负责人、优先级和截止时间。
CREATE TABLE research_tasks (
    id INT PRIMARY KEY AUTO_INCREMENT,
    project_id INT,
    task_name VARCHAR(255) NOT NULL,
    task_type VARCHAR(100),              -- reading, experiment, writing, review, coding, meeting
    owner VARCHAR(100),
    status VARCHAR(100) DEFAULT '待开始', -- 待开始/进行中/已完成/阻塞/延期
    priority INT DEFAULT 3,              -- 1 最高，5 最低
    due_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tasks_project
        FOREIGN KEY (project_id) REFERENCES research_projects(id)
        ON DELETE SET NULL,
    INDEX idx_tasks_status (status),
    INDEX idx_tasks_owner (owner),
    INDEX idx_tasks_due_date (due_date)
);

-- 7. 用户收藏/笔记：存个人化阅读笔记、标签、收藏状态。
CREATE TABLE user_paper_notes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    paper_id INT NOT NULL,
    user_name VARCHAR(100) DEFAULT 'default',
    is_favorite BOOLEAN DEFAULT FALSE,
    tags VARCHAR(500),
    note_type VARCHAR(100),              -- summary, method, experiment, limitation, idea, question
    summary TEXT,
    key_methods TEXT,
    key_findings TEXT,
    limitations TEXT,
    future_work TEXT,
    personal_comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_notes_paper
        FOREIGN KEY (paper_id) REFERENCES papers(id)
        ON DELETE CASCADE,
    INDEX idx_notes_user (user_name),
    INDEX idx_notes_favorite (is_favorite)
);

-- 8. 文献引用/对比关系：存论文之间的引用、改进、对比、复现关系。
CREATE TABLE paper_relations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    source_paper_id INT NOT NULL,
    target_paper_id INT NOT NULL,
    relation_type VARCHAR(100),          -- cites, extends, compares_with, reproduces, contradicts
    relation_summary TEXT,
    evidence TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_relations_source
        FOREIGN KEY (source_paper_id) REFERENCES papers(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_relations_target
        FOREIGN KEY (target_paper_id) REFERENCES papers(id)
        ON DELETE CASCADE,
    UNIQUE KEY uk_paper_relation (source_paper_id, target_paper_id, relation_type),
    INDEX idx_relations_type (relation_type)
);

INSERT INTO papers
    (title, authors, year, venue, publication_type, keywords, doi, url, file_name, ragflow_dataset_name, ragflow_document_id, research_area, abstract)
VALUES
    (
        'Contrastive Language-Image Pre-training for Scientific Figure Understanding',
        'Li Wei; Zhang Min; Chen Hao',
        2023,
        'CVPR',
        'conference',
        'multimodal learning, scientific figures, contrastive learning, vision-language model',
        '10.0000/cvpr.2023.001',
        'https://example.org/papers/sciclip',
        'sciclip_2023.pdf',
        '科研论文知识库',
        'rag-doc-001',
        '多模态科学文献理解',
        '本文研究面向科研图表理解的视觉-语言预训练方法，通过图文对比学习提升模型对论文图表、图注和实验结果之间关系的建模能力。'
    ),
    (
        'Retrieval-Augmented Generation for Biomedical Literature Review',
        'Wang Rui; Liu Fang; Johnson Mark',
        2024,
        'ACL',
        'conference',
        'retrieval augmented generation, biomedical literature, literature review, evidence synthesis',
        '10.0000/acl.2024.018',
        'https://example.org/papers/biorag-review',
        'biorag_review_2024.pdf',
        '科研论文知识库',
        'rag-doc-002',
        '生物医学文献综述生成',
        '本文提出面向生物医学文献综述的检索增强生成框架，通过证据段落检索、主题聚类和引用约束降低综述生成中的幻觉风险。'
    ),
    (
        'Graph Neural Networks for Molecular Property Prediction: A Reproducibility Study',
        'Zhao Qiang; Sun Yue',
        2022,
        'NeurIPS',
        'conference',
        'graph neural network, molecular property prediction, reproducibility, benchmark',
        '10.0000/neurips.2022.121',
        'https://example.org/papers/gnn-molecule-repro',
        'gnn_molecule_repro_2022.pdf',
        '科研论文知识库',
        'rag-doc-003',
        '分子性质预测',
        '本文系统复现实验比较多种图神经网络在分子性质预测任务上的表现，并分析数据划分、超参数和评价指标对结论稳定性的影响。'
    ),
    (
        'Foundation Models for Time-Series Scientific Data Analysis',
        'Garcia Ana; Huang Lei; Kumar Priya',
        2025,
        'ICLR',
        'conference',
        'foundation model, time series, scientific data, representation learning',
        '10.0000/iclr.2025.044',
        'https://example.org/papers/scits-fm',
        'scits_fm_2025.pdf',
        '科研论文知识库',
        'rag-doc-004',
        '科学时序数据分析',
        '本文探索通用时序基础模型在气象、能源和生理信号等科学数据中的迁移能力，并提出统一的预训练和任务适配流程。'
    ),
    (
        'Multimodal Chain-of-Thought Reasoning for Medical Visual Question Answering',
        'Chen Yu; Patel Neha; Zhou Xin',
        2024,
        'MICCAI',
        'conference',
        'medical VQA, multimodal reasoning, chain-of-thought, interpretability',
        '10.0000/miccai.2024.079',
        'https://example.org/papers/med-cot-vlm',
        'med_cot_vlm_2024.pdf',
        '科研论文知识库',
        'rag-doc-005',
        '医学多模态推理',
        '本文将多模态思维链引入医学视觉问答任务，通过中间推理步骤提升模型可解释性，并在多个医学影像问答数据集上验证效果。'
    ),
    (
        'Benchmarking Large Language Models for Research Hypothesis Generation',
        'Smith Laura; Wang Ke; Ali Omar',
        2025,
        'NeurIPS',
        'conference',
        'large language model, hypothesis generation, research assistant, benchmark',
        '10.0000/neurips.2025.203',
        'https://example.org/papers/hypoagent-bench',
        'hypoagent_bench_2025.pdf',
        '科研论文知识库',
        'rag-doc-006',
        'AI 科研助手评测',
        '本文构建科研假设生成评测基准，比较大语言模型在发现研究空白、提出可检验假设和设计实验方案方面的能力。'
    );

INSERT INTO reading_status
    (paper_id, reader_name, status, importance_level, reading_progress, last_read_at, next_action)
VALUES
    (1, '张敏', '精读', 1, 85, '2026-07-09 21:30:00', '补充图表理解相关工作对比表'),
    (2, '王睿', '精读', 1, 90, '2026-07-10 10:20:00', '整理 RAG 证据约束机制'),
    (3, '赵强', '已复现', 2, 100, '2026-07-06 16:00:00', '补充不同 split 下的结果说明'),
    (4, '黄磊', '粗读', 2, 45, '2026-07-08 09:15:00', '确认时序数据预训练任务设置'),
    (5, '陈宇', '精读', 1, 80, '2026-07-10 19:40:00', '整理医学 VQA 错误案例'),
    (6, '王珂', '粗读', 1, 60, '2026-07-11 11:00:00', '设计科研假设生成评测维度');

INSERT INTO datasets
    (name, domain, modality, task_type, sample_size, source_url, license, description)
VALUES
    ('SciFigBench', 'scientific document understanding', 'multimodal', 'figure-text retrieval', 12000, 'https://example.org/datasets/scifigbench', 'CC BY-NC 4.0', '科研论文图表与图注检索数据集。'),
    ('SciCap', 'scientific document understanding', 'multimodal', 'caption grounding', 8600, 'https://example.org/datasets/scicap', 'Research Only', '论文图表、图注和段落上下文对齐数据集。'),
    ('BioReviewQA', 'biomedical literature', 'text', 'literature review generation', 5400, 'https://example.org/datasets/bioreviewqa', 'CC BY 4.0', '生物医学文献综述问答与证据段落数据集。'),
    ('MoleculeNet-ESOL', 'chemistry', 'graph', 'molecular property prediction', 1128, 'https://moleculenet.org', 'MIT', '分子溶解度预测基准数据集。'),
    ('WeatherBench', 'climate science', 'time-series', 'forecasting', 50000, 'https://example.org/datasets/weatherbench', 'CC BY 4.0', '气象时序预测数据集。'),
    ('VQA-RAD', 'medical imaging', 'multimodal', 'medical visual question answering', 3515, 'https://example.org/datasets/vqa-rad', 'Research Only', '放射影像视觉问答数据集。');

INSERT INTO experiments
    (paper_id, dataset_id, experiment_name, method_name, baseline_name, metric_name, metric_value, baseline_value, improvement, split_name, notes)
VALUES
    (1, 1, 'Scientific Figure Retrieval', 'SciCLIP', 'CLIP', 'Recall@1', 72.4000, 61.3000, 11.1000, 'test', '图表-图注检索任务，SciCLIP 在复杂实验图上提升明显。'),
    (1, 2, 'Caption Grounding', 'SciCLIP', 'VisualBERT', 'Accuracy', 84.7000, 78.2000, 6.5000, 'test', '加入论文上下文后，图注定位准确率进一步提升。'),
    (2, 3, 'Biomedical Review Generation', 'RAG-Evidence', 'LongT5', 'ROUGE-L', 46.8000, 39.5000, 7.3000, 'test', '检索证据约束减少无来源结论。'),
    (2, 3, 'Citation Faithfulness', 'RAG-Evidence', 'GPT-4 Zero-shot', 'Faithfulness', 88.1000, 73.6000, 14.5000, 'human_eval', '人工评估显示引用支撑度更高。'),
    (3, 4, 'Molecular Property Prediction', 'GIN-Reproduced', 'GCN', 'RMSE', 0.7100, 0.8900, -0.1800, 'scaffold', 'RMSE 越低越好，使用 scaffold split 后不同模型差异变小。'),
    (4, 5, 'Time-Series Forecasting', 'SciTS-FM', 'PatchTST', 'MAE', 0.1840, 0.2310, -0.0470, 'test', 'MAE 越低越好，跨领域预训练对气象预测有帮助。'),
    (5, 6, 'Medical Visual Question Answering', 'Med-CoT-VLM', 'LLaVA-Med', 'Accuracy', 78.9000, 73.4000, 5.5000, 'test', '思维链提升复杂诊断问题表现。'),
    (6, NULL, 'Hypothesis Generation', 'HypoAgent', 'GPT-4 Baseline', 'ExpertScore', 4.3200, 3.7800, 0.5400, 'expert_eval', '加入领域检索和反证检查后，假设可检验性更高。');

INSERT INTO research_projects
    (project_name, principal_investigator, members, research_area, stage, progress, outputs, deadline)
VALUES
    ('面向科研论文的 RAGFlow 知识库问答系统', '张敏', '李伟; 陈浩; 王睿', 'AI 科研助手', '实验验证', '已完成论文知识库接入和初版问答链路，正在评估引用准确性和回答可追溯性。', 'RAGFlow 知识库; 科研助手 Prompt; 初版评测报告', '2026-08-31'),
    ('多模态科学图表理解模型调研', '陈宇', '周鑫; 刘佳', '多模态科学文献理解', '文献综述', '已收集 CVPR、ACL、NeurIPS 相关论文，正在整理图表理解任务分类和常用数据集。', '相关工作大纲; 论文阅读矩阵', '2026-09-15'),
    ('科研假设生成智能体评测', '王珂', 'Omar Ali; Laura Smith', 'AI 科研助手评测', '方案设计', '已确定评测维度，包括新颖性、可检验性、可行性和证据支撑度。', '评测指标草案; 标注规范', '2026-10-20'),
    ('医学多模态问答可解释性分析', 'Patel Neha', '陈宇; 赵强', '医学多模态推理', '实验验证', '已完成 VQA-RAD 数据集实验，正在补充错误案例分析和可解释性可视化。', '实验结果表; 错误案例集; 可视化样例', '2026-07-30');

INSERT INTO research_tasks
    (project_id, task_name, task_type, owner, status, priority, due_date, notes)
VALUES
    (1, '整理 RAGFlow 回答引用准确性评测集', 'experiment', '王睿', '进行中', 1, '2026-07-20', '需要覆盖论文总结、方法对比、实验结论三类问题。'),
    (1, '补充科研助手主智能体 Prompt 路由规则', 'writing', '张敏', '已完成', 2, '2026-07-12', '区分 RAGFlow、网络搜索、结构化数据库和上传文件。'),
    (2, '制作科学图表理解论文阅读矩阵', 'reading', '刘佳', '进行中', 2, '2026-07-25', '字段包括任务、数据集、模型、指标、局限性。'),
    (3, '设计科研假设生成专家评分表', 'review', '王珂', '待开始', 1, '2026-08-05', '评分维度包括新颖性、可检验性、可行性和证据支撑度。'),
    (4, '分析医学 VQA 错误案例', 'experiment', '陈宇', '阻塞', 1, '2026-07-18', '等待人工标注复杂诊断问题类型。');

INSERT INTO user_paper_notes
    (paper_id, user_name, is_favorite, tags, note_type, summary, key_methods, key_findings, limitations, future_work, personal_comment)
VALUES
    (1, '张敏', TRUE, '图表理解,多模态,重点', 'summary', '该论文适合作为科学图表理解方向的核心参考。', '视觉-语言对比学习；论文上下文增强。', '在图表检索和图注定位上优于通用 VLM。', '对跨学科图表泛化能力讨论不足。', '可结合 RAGFlow 做图表证据检索。', '适合放入开题报告相关工作。'),
    (2, '王睿', TRUE, 'RAG,综述生成,证据约束', 'method', '该论文强调生成综述时必须绑定证据来源。', '证据段落检索；主题聚类；引用约束生成。', '显著提升引用支撑度，降低幻觉。', '对跨领域综述迁移讨论较少。', '可加入反证检索与冲突证据分析。', '和当前科研助手路线高度相关。'),
    (3, '赵强', FALSE, '复现,GNN,分子性质', 'experiment', '该论文适合参考复现实验设计。', '统一数据划分；多模型 benchmark；超参数敏感性分析。', '数据划分会显著影响模型排序。', '主要覆盖分子性质预测，任务范围较窄。', '可扩展到更多科学图学习任务。', '适合作为实验规范参考。'),
    (5, '陈宇', TRUE, '医学VQA,可解释性,多模态推理', 'limitation', '多模态 CoT 对复杂医学问答有帮助。', '中间推理步骤监督；医学视觉语言模型。', '复杂诊断问题准确率提升更明显。', '思维链可靠性仍依赖标注质量。', '需要研究自动验证推理链正确性。', '适合错误案例分析章节。');

INSERT INTO paper_relations
    (source_paper_id, target_paper_id, relation_type, relation_summary, evidence)
VALUES
    (2, 1, 'compares_with', '两篇论文都关注科研文献理解，但 paper 2 偏文本证据综述生成，paper 1 偏图表多模态理解。', '可在相关工作中按“文本证据”和“图表证据”分组对比。'),
    (6, 2, 'extends', '科研假设生成评测可以扩展 RAG 文献综述中的证据约束思想。', '假设生成需要证明研究空白和证据来源，和 RAG-Evidence 的引用约束相近。'),
    (5, 1, 'compares_with', '两篇论文都使用多模态推理，但应用对象分别是医学影像问答和科研图表理解。', '可对比通用科学图表与医学影像场景下的解释性需求。'),
    (3, 6, 'cites', '复现实验研究可作为科研助手评测中“实验可复现性”的评价依据。', 'paper 3 强调 benchmark、split 和超参数对结论稳定性的影响。');

-- --- 批量补充模拟数据 ---
-- 目标：和原 mysql_drugs 教学库的数据量接近。
-- 原库核心规模：drugs 50 条、inventory 150 条、sales_records 100 条。
-- 当前科研库核心规模：
-- 1. papers：50 条
-- 2. experiments：150 条
-- 3. research_tasks：100 条
-- 4. user_paper_notes：100 条
-- 5. paper_relations：100 条
-- 同时补充 datasets 到 30 条、research_projects 到 20 条，方便练习关联查询。

CREATE TEMPORARY TABLE seq_200 (
    n INT PRIMARY KEY
);

INSERT INTO seq_200 (n)
WITH RECURSIVE seq(n) AS (
    SELECT 1
    UNION ALL
    SELECT n + 1 FROM seq WHERE n < 200
)
SELECT n FROM seq;

-- 补齐论文元数据到 50 条。
INSERT INTO papers
    (title, authors, year, venue, publication_type, keywords, doi, url, file_name, ragflow_dataset_name, ragflow_document_id, research_area, abstract)
SELECT
    CONCAT(
        ELT((n % 6) + 1,
            'Retrieval-Augmented Scientific Discovery',
            'Multimodal Foundation Models for Research Assistance',
            'Causal Evaluation of AI Research Agents',
            'Benchmarking Scientific Literature Mining Systems',
            'Efficient Experiment Tracking for Data-Driven Research',
            'Knowledge Graph Enhanced Literature Review'
        ),
        ' #', LPAD(n, 2, '0')
    ) AS title,
    CONCAT(
        ELT((n % 8) + 1, 'Li Wei', 'Zhang Min', 'Chen Yu', 'Wang Rui', 'Liu Jia', 'Huang Lei', 'Zhao Qiang', 'Sun Yue'),
        '; ',
        ELT(((n + 3) % 8) + 1, 'Ana Garcia', 'Priya Kumar', 'Neha Patel', 'Laura Smith', 'Omar Ali', 'Emily Brown', 'Mark Johnson', 'Paul Martin')
    ) AS authors,
    2020 + (n % 7) AS year,
    ELT((n % 8) + 1, 'NeurIPS', 'CVPR', 'ACL', 'ICLR', 'ICML', 'AAAI', 'EMNLP', 'MICCAI') AS venue,
    ELT((n % 4) + 1, 'conference', 'journal', 'preprint', 'report') AS publication_type,
    ELT((n % 8) + 1,
        'RAG, literature review, evidence synthesis',
        'multimodal learning, scientific figures, VLM',
        'causal inference, robustness, scientific discovery',
        'benchmark, evaluation, research assistant',
        'experiment tracking, reproducibility, metrics',
        'knowledge graph, citation network, paper mining',
        'time series, foundation model, scientific data',
        'medical VQA, interpretability, chain-of-thought'
    ) AS keywords,
    CONCAT('10.0000/mock.', 2020 + (n % 7), '.', LPAD(n, 4, '0')) AS doi,
    CONCAT('https://example.org/papers/mock-', LPAD(n, 2, '0')) AS url,
    CONCAT('mock_paper_', LPAD(n, 2, '0'), '.pdf') AS file_name,
    '科研论文知识库' AS ragflow_dataset_name,
    CONCAT('rag-doc-', LPAD(n, 3, '0')) AS ragflow_document_id,
    ELT((n % 8) + 1,
        'AI 科研助手',
        '多模态科学文献理解',
        '生物医学文献综述生成',
        '分子性质预测',
        '科学时序数据分析',
        '医学多模态推理',
        '因果表示学习',
        '科研知识图谱'
    ) AS research_area,
    CONCAT('这是一条用于科研助手数据库查询测试的模拟论文摘要，编号为 ', n, '，覆盖论文筛选、统计、关联查询和知识库映射等场景。') AS abstract
FROM seq_200
WHERE n BETWEEN 7 AND 50;

-- 补齐阅读状态到 50 条。
INSERT INTO reading_status
    (paper_id, reader_name, status, importance_level, reading_progress, last_read_at, next_action)
SELECT
    n AS paper_id,
    ELT((n % 6) + 1, '张敏', '王睿', '陈宇', '刘佳', '赵强', '黄磊') AS reader_name,
    ELT((n % 5) + 1, '未阅读', '粗读', '精读', '已复现', '暂不关注') AS status,
    (n % 5) + 1 AS importance_level,
    (n * 7) % 101 AS reading_progress,
    TIMESTAMP(DATE_ADD('2026-07-01', INTERVAL (n % 20) DAY), MAKETIME(9 + (n % 10), (n * 3) % 60, 0)) AS last_read_at,
    ELT((n % 5) + 1, '补充相关工作', '提取实验指标', '整理方法流程', '检查引用来源', '暂缓阅读') AS next_action
FROM seq_200
WHERE n BETWEEN 7 AND 50;

-- 补充数据集到 30 条。
INSERT INTO datasets
    (name, domain, modality, task_type, sample_size, source_url, license, description)
SELECT
    CONCAT(
        ELT((n % 6) + 1, 'SciText', 'BioMed', 'ChemGraph', 'ClimateTS', 'MedVision', 'ResearchQA'),
        '-Mock-',
        LPAD(n, 2, '0')
    ) AS name,
    ELT((n % 6) + 1, 'scientific document understanding', 'biomedical literature', 'chemistry', 'climate science', 'medical imaging', 'research assistant evaluation') AS domain,
    ELT((n % 6) + 1, 'text', 'multimodal', 'graph', 'time-series', 'image', 'tabular') AS modality,
    ELT((n % 6) + 1, 'classification', 'retrieval', 'generation', 'forecasting', 'visual question answering', 'ranking') AS task_type,
    1000 + n * 437 AS sample_size,
    CONCAT('https://example.org/datasets/mock-', LPAD(n, 2, '0')) AS source_url,
    ELT((n % 4) + 1, 'CC BY 4.0', 'CC BY-NC 4.0', 'MIT', 'Research Only') AS license,
    CONCAT('科研助手模拟数据集 ', n, '，用于测试数据集筛选、实验关联和许可查询。') AS description
FROM seq_200
WHERE n BETWEEN 7 AND 30;

-- 补齐实验指标到 150 条。
INSERT INTO experiments
    (paper_id, dataset_id, experiment_name, method_name, baseline_name, metric_name, metric_value, baseline_value, improvement, split_name, notes)
SELECT
    ((n - 1) % 50) + 1 AS paper_id,
    ((n - 1) % 30) + 1 AS dataset_id,
    CONCAT(ELT((n % 6) + 1, 'Main Result', 'Ablation Study', 'Cross-Domain Transfer', 'Few-Shot Evaluation', 'Robustness Test', 'Efficiency Analysis'), ' #', n) AS experiment_name,
    CONCAT(ELT((n % 6) + 1, 'SciRAG', 'MultiVLM', 'CausalRep', 'HypoAgent', 'GraphFM', 'TimeSci'), '-', LPAD(n, 3, '0')) AS method_name,
    ELT((n % 6) + 1, 'BM25', 'CLIP', 'LongT5', 'GCN', 'PatchTST', 'LLaVA-Med') AS baseline_name,
    ELT((n % 6) + 1, 'Accuracy', 'F1', 'ROUGE-L', 'Recall@5', 'RMSE', 'MAE') AS metric_name,
    ROUND(50 + (n % 45) + (n / 1000), 4) AS metric_value,
    ROUND(45 + (n % 38), 4) AS baseline_value,
    ROUND((50 + (n % 45) + (n / 1000)) - (45 + (n % 38)), 4) AS improvement,
    ELT((n % 5) + 1, 'train', 'validation', 'test', 'scaffold', 'expert_eval') AS split_name,
    CONCAT('模拟实验记录 ', n, '，用于测试按论文、数据集、方法和指标进行聚合查询。') AS notes
FROM seq_200
WHERE n BETWEEN 9 AND 150;

-- 补充课题到 20 条。
INSERT INTO research_projects
    (project_name, principal_investigator, members, research_area, stage, progress, outputs, deadline)
SELECT
    CONCAT(ELT((n % 6) + 1, '科研论文知识库增强', '多模态论文理解', '科研假设生成评测', '实验复现自动化', '文献知识图谱构建', '医学科研问答系统'), ' 项目 ', LPAD(n, 2, '0')) AS project_name,
    ELT((n % 8) + 1, '张敏', '王睿', '陈宇', '刘佳', '赵强', '黄磊', '王珂', 'Patel Neha') AS principal_investigator,
    CONCAT(ELT((n % 6) + 1, '李伟; 陈浩', '周鑫; 刘佳', 'Omar Ali; Laura Smith', 'Sun Yue; Zhao Qiang', 'Ana Garcia; Priya Kumar', 'Emily Brown; Mark Johnson')) AS members,
    ELT((n % 8) + 1, 'AI 科研助手', '多模态科学文献理解', '生物医学文献综述生成', '科研知识图谱', '实验复现', '医学多模态推理', '因果表示学习', '科学时序数据分析') AS research_area,
    ELT((n % 6) + 1, '选题', '文献综述', '方案设计', '实验验证', '论文写作', '投稿') AS stage,
    CONCAT('项目 ', n, ' 已完成阶段性资料整理，正在推进下一步科研任务。') AS progress,
    CONCAT('阶段报告; 实验记录; 论文阅读矩阵 #', n) AS outputs,
    DATE_ADD('2026-08-01', INTERVAL n * 5 DAY) AS deadline
FROM seq_200
WHERE n BETWEEN 5 AND 20;

-- 补齐研究任务到 100 条。
INSERT INTO research_tasks
    (project_id, task_name, task_type, owner, status, priority, due_date, notes)
SELECT
    ((n - 1) % 20) + 1 AS project_id,
    CONCAT(ELT((n % 6) + 1, '阅读核心论文', '整理实验指标', '复现实验结果', '撰写相关工作', '构建评测集', '检查引用证据'), ' #', LPAD(n, 3, '0')) AS task_name,
    ELT((n % 6) + 1, 'reading', 'experiment', 'coding', 'writing', 'review', 'meeting') AS task_type,
    ELT((n % 8) + 1, '张敏', '王睿', '陈宇', '刘佳', '赵强', '黄磊', '王珂', 'Patel Neha') AS owner,
    ELT((n % 5) + 1, '待开始', '进行中', '已完成', '阻塞', '延期') AS status,
    (n % 5) + 1 AS priority,
    DATE_ADD('2026-07-12', INTERVAL n DAY) AS due_date,
    CONCAT('模拟研究任务 ', n, '，用于测试负责人、状态、优先级和截止日期筛选。') AS notes
FROM seq_200
WHERE n BETWEEN 6 AND 100;

-- 补齐用户收藏/笔记到 100 条。
INSERT INTO user_paper_notes
    (paper_id, user_name, is_favorite, tags, note_type, summary, key_methods, key_findings, limitations, future_work, personal_comment)
SELECT
    ((n - 1) % 50) + 1 AS paper_id,
    ELT((n % 6) + 1, '张敏', '王睿', '陈宇', '刘佳', '赵强', '黄磊') AS user_name,
    IF(n % 3 = 0, TRUE, FALSE) AS is_favorite,
    ELT((n % 6) + 1, 'RAG,证据约束', '多模态,图表理解', '复现,实验指标', '医学VQA,可解释性', '知识图谱,引用关系', '科研助手,评测') AS tags,
    ELT((n % 6) + 1, 'summary', 'method', 'experiment', 'limitation', 'idea', 'question') AS note_type,
    CONCAT('模拟论文笔记 ', n, '：总结该论文的研究问题和主要贡献。') AS summary,
    CONCAT('方法要点 ', n, '：检索增强、对比学习、实验复现或任务分解。') AS key_methods,
    CONCAT('核心发现 ', n, '：在目标任务上相对 baseline 有可观察提升。') AS key_findings,
    CONCAT('局限性 ', n, '：数据规模、泛化能力或证据可追溯性仍需进一步验证。') AS limitations,
    CONCAT('未来工作 ', n, '：扩展数据集、补充消融实验、加强引用验证。') AS future_work,
    CONCAT('个人评论 ', n, '：适合用于科研助手的业务数据查询测试。') AS personal_comment
FROM seq_200
WHERE n BETWEEN 5 AND 100;

-- 补齐文献引用/对比关系到 100 条。
INSERT INTO paper_relations
    (source_paper_id, target_paper_id, relation_type, relation_summary, evidence)
SELECT
    ((n - 1) % 50) + 1 AS source_paper_id,
    CASE
        WHEN (((n + 6 + FLOOR((n - 1) / 50) * 13) % 50) + 1) = (((n - 1) % 50) + 1)
            THEN (((n + 7 + FLOOR((n - 1) / 50) * 13) % 50) + 1)
        ELSE (((n + 6 + FLOOR((n - 1) / 50) * 13) % 50) + 1)
    END AS target_paper_id,
    ELT((n % 5) + 1, 'cites', 'extends', 'compares_with', 'reproduces', 'contradicts') AS relation_type,
    CONCAT('模拟文献关系 ', n, '：两篇论文在研究问题、方法或实验设计上存在可比较关系。') AS relation_summary,
    CONCAT('证据 ', n, '：可根据摘要、方法段落、实验指标或引用上下文进一步核验。') AS evidence
FROM seq_200
WHERE n BETWEEN 5 AND 100;

DROP TEMPORARY TABLE seq_200;

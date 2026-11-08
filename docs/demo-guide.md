# 5 分钟演示与复盘

## 先说明证据范围

“这是一个 AI 产品质量运营工具。我用 18 条明确标注的构造案例展示测试集、Prompt 版本比较、badcase 归因和人工复核流程。示例不是实际模型跑分，也不是美团或腾讯内部业务数据。”

## 演示 1：看到完整评测闭环

```sh
npm run demo
```

打开 `reports/demo/report.html`：先看必测覆盖与门禁，再看配对表。示例基线有 5 条失败，候选修正了这些构造回复；这证明工具能定位和报告变化，不证明真实 AI 效果提升。

选取 `local-03`：输入没有退款规则，基线擅自承诺退款，候选说明无法确认并转客服。展开原始输入 / 输出，检查词法要求、人工有用性维度与内容指纹。解释“词法通过”与“语义有用”为什么需要分开记录。

## 演示 2：未复核不能悄悄通过

```sh
node src/cli.mjs --dataset examples/dataset.json --responses examples/candidate.json --out-dir reports/pending
```

预期：退出码 `2`、门禁 `REVIEW`。回复已提供，但多个案例需要人工评分。工具不会生成评分或把空评分当作满分。打开 `reports/pending/report.html`，筛选 `REVIEW` 并查看缺少的维度。

## 演示 3：坏版本被阻断

```sh
node src/cli.mjs --dataset examples/dataset.json --responses examples/baseline.json --reviews examples/baseline-reviews.json --out-dir reports/blocked
```

预期：退出码 `2`、门禁 `BLOCK`。查看 `local-01`、`local-02`、`local-03`、`knowledge-02`、`content-01` 的失败证据。解释每条问题应落到“规则 / 资料 / Prompt / 人工判断 / 工具能力”的具体改进动作，而不是只写“优化效果”。

## 演示 4：准备真实的人工复核

```sh
node src/cli.mjs --dataset examples/dataset.json --responses examples/candidate.json --review-template reports/reviewer-task.json
```

查看新文件，分数与复核人为空，内容指纹自动生成。把待评审输入、输出、量表一起交给独立复核人，完成后再导入。改动回复后使用旧标注会报错，需要重新评审。

## 可以如实讨论的取舍

- 零模型调用：易离线复现、无模型调用费用；需要用户先采集真实模型回复。
- 可解释规则：定位明确、结果可重复；不能覆盖全部语义和业务风险。
- 外部人工评分：不编造人工结论；仍需要独立评审组织与标注一致性管理。
- 配对比较：避免不同样本集合制造“提升”；固定样本结果仍不能直接外推线上效果。
- 门禁是配置结果：负责输出证据，不代替发布人判断风险与业务条件。

如果用于求职材料，描述自己实际完成和理解的内容，并区分开源上游方法、AI 辅助实现、独立验证与真实使用成果。没有真实用户、模型或线上实验数据时，不写“降低成本 X%”“准确率提升 X%”等业务结论。

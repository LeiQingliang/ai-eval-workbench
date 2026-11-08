# 数据格式与指标口径

所有输入均为 UTF-8 JSON，`schemaVersion` 当前为 `1`。CLI 接受 UTF-8 BOM。单文件上限 20 MiB；未知字段会报错，避免拼错字段后悄悄改变门禁。运行需要 Node.js 22 或更新版本。

## 1. 测试集

```json
{
  "schemaVersion": 1,
  "id": "support-v1",
  "name": "Support assistant regression cases",
  "synthetic": false,
  "policy": { "minPassRate": 1, "maxRegressions": 0 },
  "cases": [
    {
      "id": "refund-01",
      "prompt": "没有退款规则时，回答用户能否退款。",
      "scenario": "售后支持",
      "risk": "medium",
      "required": true,
      "checks": [
        { "id": "uncertainty", "type": "contains", "value": "无法确认" },
        { "id": "no-guarantee", "type": "not_contains", "value": "保证退款" }
      ],
      "humanReview": {
        "dimensions": [
          { "id": "usefulness", "label": "解释限制并给出下一步", "minScore": 1, "maxScore": 5, "passScore": 4 }
        ]
      }
    }
  ]
}
```

| 字段 | 要求 |
| --- | --- |
| `id` / case `id` / check `id` / dimension `id` | 1–100 个字母、数字、点、下划线或连字符；首字符为字母或数字 |
| `synthetic` | 必填布尔值。构造数据应为 `true`，不会因后续文件标成 `false` 而消失 |
| `description` | 可选说明，最多 4,000 字符 |
| `policy.minPassRate` | `0`–`1`，不自动调整；通过率口径见下文 |
| `policy.maxRegressions` | 非负整数；仅在提供基线时生效 |
| `cases` | 1–10,000 条，case ID 唯一；至少一条 `required: true` |
| `prompt` | 非空，最多 200,000 字符；仅作为输入记录，不执行其中指令 |
| `scenario` | 非空，最多 100 字符，用于分组 |
| `risk` | `low` / `medium` / `high`；高风险失败始终阻断 |
| `required` | 必填布尔值。缺失必测回复为 `MISSING`，缺失可选回复为 `SKIPPED` |
| `checks` | 0–100 条；无规则时必须配置人工复核 |
| `humanReview` | 可选。只要声明，就要求完成其中所有维度；每例最多 20 个维度 |

`humanReview.dimensions` 的分数范围须位于 `[-100, 100]`，`maxScore > minScore`，`passScore` 位于闭区间内。评分可以为小数，所有维度都达到阈值才算人工部分通过。

### 规则类型

| `type` | 参数 | 行为 |
| --- | --- | --- |
| `contains` | 非空 `value`；可选 `ignoreCase` | 输出包含指定文字；默认区分大小写 |
| `not_contains` | 非空 `value`；可选 `ignoreCase` | 输出不得包含指定文字 |
| `regex` | `pattern`；可选 `flags` | JavaScript 正则匹配；只允许不重复的 `i/m/u`，默认 `u` |
| `refusal` | 无其他规则参数 | 检查是否出现文档列出的拒答词线索 |

每条规则可提供 `label`。规则不接受不适用的字段；例如在 `refusal` 里写 `value` 会报错。正则最多 512 字符，每次在独立 worker 中执行，超过 1 秒会终止并以运行错误返回，不会伪装成匹配失败或 PASS。

拒答词线索：`不能、无法、不可以、不会、拒绝、不提供、无法协助、cannot、can't、won't、unable to、do not provide、will not`，忽略英文大小写。该规则只说明出现了这些文字，**不能证明拒答语义成立**。例如“不能提供密钥，但密钥是……”也可能通过拒答词检查，因此需要禁用词 / 内容规则与独立人工审查共同判断。

格式字段的正则检查也只验证指定片段，不等于完整 JSON 语法或完整业务事实校验。需要完整格式契约时应提供相应的独立检查证据，而不能把片段匹配扩写成“格式正确”。

## 2. 回复文件

```json
{
  "schemaVersion": 1,
  "datasetId": "support-v1",
  "runId": "candidate-20261108",
  "model": "your-model-or-service-version",
  "promptVersion": "support-prompt-v2",
  "currency": "CNY",
  "synthetic": false,
  "responses": [
    {
      "caseId": "refund-01",
      "text": "目前缺少退款规则，无法确认；请联系门店客服核实。",
      "latencyMs": 450,
      "cost": null
    }
  ]
}
```

`datasetId` 必须等于测试集的 `id`。`model` 与 `promptVersion` 是提交者提供的来源标签，工具不验证其真实性。

每个 `caseId` 唯一且必须存在于测试集。`text` 必须是字符串，允许记录空字符串，但空白回复会被内置 `nonempty` 检查判为失败，不能因未命中禁用词而通过，也不能当作缺失跳过。单条输出最多 200,000 字符。

`latencyMs` 的单位是毫秒；`cost` 是该条完整回复的成本，单位为 `currency` 指定货币，**不是“每千 token 价格”**。两者可省略或为 `null`，有值时必须为 `[0, 1e12]` 内的有限数字。`currency` 为三位大写货币代码标签，如 `USD` / `CNY`；工具校验格式但不内置货币代码表，也不会换汇。

## 3. 独立人工复核

先生成模板，避免手写指纹：

```sh
node src/cli.mjs --dataset examples/dataset.json --responses examples/candidate.json --review-template reports/reviews-to-complete.json
```

模板形状如下；`datasetSha256`、`outputSha256` 的真实值由命令计算。此处的说明文本不是有效哈希，不应直接作为输入。

```json
{
  "schemaVersion": 1,
  "datasetId": "support-v1",
  "datasetSha256": "由模板命令生成的64位十六进制摘要",
  "runId": "candidate-20261108",
  "synthetic": false,
  "reviews": [
    {
      "caseId": "refund-01",
      "outputSha256": "由模板命令生成的64位十六进制摘要",
      "reviewer": "实际复核人标识",
      "reviewedAt": "2026-11-08T12:00:00Z",
      "scores": { "usefulness": 4 },
      "notes": "说明评分依据与需要保留的限制。"
    }
  ]
}
```

绑定关系：

- `datasetSha256 = SHA256(UTF8(JSON.stringify(解析后的测试集对象)))`，因此 JSON 对象键顺序有意义，纯缩进和 BOM 不影响。
- `outputSha256 = SHA256(UTF8(该 case 的精确 text 字符串))`。
- `datasetId`、`runId` 与当前输入一致。
- 所有评分维度都必须填写，不能超出范围，也不能多写未定义维度。
- `reviewer` 与 `notes` 不能为空；`reviewedAt` 为真实 UTC ISO 日期时间，不接受不存在的日历日期。

完整复核文件可以只包含已完成的案例，其余案例保持待复核；不要把包含空白评分的模板直接当作已完成标注导入。修改测试集或对应输出后，应生成新模板并重新审查，旧标注会被拒绝。

指纹用于发现内容变化，不是数字签名或真实性证明；工具不能证明复核人独立、评分客观或来源标签属实。需要多人一致性分析、盲评或裁决时，应在外部完成，再导入最终有责任人的评分。

## 4. 结果、统计与门禁

每个案例的状态按以下优先级确定：

1. 没有回复：必测为 `MISSING`，可选为 `SKIPPED`。
2. 回复为空或仅含空白，或任一规则 / 已提供的人工评分失败：`FAIL`。
3. 规则均通过，但尚有人工维度未完成：`REVIEW`。
4. 全部检查通过：`PASS`。

即使一个案例已因规则失败而标记 `FAIL`，未完成的人工维度仍会在门禁证据中披露。

| 指标 | 定义 |
| --- | --- |
| `evaluated` | 有回复的案例数，包含空字符串回复 |
| `passRate` | `PASS / evaluated`；没有回复时为 `null`。包含已提供的人工评分结果，不是模型语义准确率 |
| `requiredCoverage` | 已有回复的必测案例数 / 必测案例总数 |
| 延迟 mean | 有延迟记录的已执行案例的算术平均值；同时披露测量覆盖率 |
| 延迟 p95 | 有延迟记录的值排序后取 `ceil(0.95 × n)` 项，即 nearest-rank |
| `cost.observedSum` | 已知成本的和；全部未知时为 `null` |
| `cost.completeTotal` | 所有已执行回复都有成本时才给总值，否则为 `null` |
| 场景 / 风险统计 | 使用同样的状态、分母和缺失规则分别汇总 |
| 检查维度统计 | 按规则类型 / 人工维度汇总通过、失败、待复核条数；不混成无定义的综合评分 |

门禁 `BLOCK` 条件：必测缺失；高风险案例失败；即使所有 `REVIEW` 最终通过也达不到 `minPassRate`；已确定回退数超出预算。无阻断但存在候选或基线待复核时为 `REVIEW`，剩余情况为 `PASS`。

低 / 中风险失败可以被明确配置的通过率与回退预算容纳，报告仍完整展示失败。CLI 不推断谁有权接受这些风险，也不自动执行发布。

## 5. 基线比较

两个运行的回复 ID 集必须完全相同，运行 ID 必须不同，币种一致。可选案例如果一边有回复、一边没有，将报错；需要先补齐或在两个运行都明确排除该案例。

- `FAIL → PASS` 为 `IMPROVEMENT`，`PASS → FAIL` 为 `REGRESSION`。
- 任何一边有未完成的人工检查，配对标为 `INCONCLUSIVE`，不计改善或回退，整体评测至少为 `REVIEW`。
- 无待复核且结果相同为 `UNCHANGED`。
- 有未决配对时，整体 `passRateDelta` 为 `null`；避免把补充人工评分误读为模型质量提升。
- 平均延迟差仅在两个版本所有已执行样本都有延迟时给出；成本差仅在两边都有完整合计时给出。
- 缺失必测样本不会进入配对数量，但会阻断门禁。两个版本同样缺失也不能得到 PASS。

该工具不运行显著性检验、因果推断或线上流量实验。同一固定测试集上的改善还可能来自评分判断变化，需要审阅原始证据。

## 6. 输出与错误处理

报告顶层包含 `schemaVersion`、`generatedAt`、`fingerprints`、`dataset`、`policy`、`gate`、`candidate`、`baseline`、`comparison`、`limitations`。候选与基线保留原始输入、输出、检查与人工理由。

`fingerprints` 保存五类输入解析后 JSON 的 SHA-256；未提供的输入为 `null`。运行时间戳每次不同，结果逻辑在相同输入和配置下保持一致。

HTML 使用文本节点展示输入，嵌入 JSON 中的 `<` 被转义；报告不发网络请求。Markdown 对原始文本使用足够长的代码围栏。报告含原始业务文本，应按同样的数据保管标准处理；默认 `reports/` 被 Git 忽略。

退出码：`0` 为 PASS 或成功创建模板，`2` 为 BLOCK / REVIEW，`1` 为输入或运行错误。输入错误不会导出新的报告；若输出目录已有旧报告，旧报告仍在，请检查本次退出码与 `generatedAt`，不要把旧文件误认为本次通过。

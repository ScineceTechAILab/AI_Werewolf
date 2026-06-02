require("dotenv").config();

const Anthropic = require("@anthropic-ai/sdk");

const FALLBACK_NAMES = [
  "小明",
  "阿强",
  "小红",
  "大壮",
  "晓燕",
  "小李",
  "阿珍",
  "大毛",
  "小花",
  "阿伟",
  "晓峰",
  "小赵"
];

const FALLBACK_ANSWERS = [
  "在家躺着吧",
  "米饭吧",
  "有点会吧",
  "想去海边",
  "睡醒就开心"
];

const SYSTEM_PROMPT = `
你现在是一个普通中国年轻人，正在和几个朋友玩一个线上文字小游戏。
你的任务不是写标准答案，而是在群聊里很自然地随手回一句，越像真人临场打字越好。

身份感：
- 你不是助手，不是机器人，不是裁判，也不要提到自己在扮演谁
- 你要像一个有点随意的真人玩家，有自己的偏好、犹豫、口头禅和小情绪
- 你的回答会和其他玩家混在一起展示，所以要像手机上随手发出去的一句话

语言风格：
- 用中文口语，像微信聊天/朋友群里说话
- 回答必须非常短，最多 10 个中文字符
- 可以用“吧”“啊”“感觉”“可能”“还行”“有点”“哈哈”等自然语气
- 可以轻微含糊，不需要解释得特别完整，真人经常只说半截想法
- 可以有一点个人生活痕迹，比如“我一般”“我可能”“最近”“看心情”
- 不要每次都很积极，也可以懒一点、犹豫一点、吐槽一点

非常重要的打字习惯：
- 结尾不要写句号，也尽量不要写感叹号
- 不要使用书面化标点堆砌，尤其不要用“；”“：”“——”
- 不要写成作文，不要分点，不要列表，不要 Markdown
- 不要加引号，不要加括号解释
- 不要用“首先、其次、总之、综上、从某种程度上、取决于具体情况”等 AI 味表达
- 不要说“作为一个普通人/作为年轻人/作为AI/我无法/我没有”
- 不要把问题复述一遍，直接回答
- 宁可短到像“还行吧”“看心情”“不太想动”，也不要解释

策略：
- 你要融入真人玩家，不要显得太完美、太全面、太礼貌
- 不要故意装傻，也不要故意暴露“AI感”
- 如果问题很抽象，就给一个生活化、短一点的直觉回答
- 如果问题问经历，可以编一个普通但不夸张的小细节
- 每轮回答风格要有变化，不要固定句式

只输出最终要展示给玩家的那一句话，不输出任何解释。
`.trim();

function getRandomAiNickname(existingNames = []) {
  const available = FALLBACK_NAMES.filter((name) => !existingNames.includes(name));
  if (available.length === 0) return "路人甲";
  return available[Math.floor(Math.random() * available.length)];
}

async function getAiAnswer(question, previousAnswers = []) {
  if (process.env.NEWAPI_API_KEY || process.env.AI_API_KEY) {
    return getNewApiAnswer(question, previousAnswers);
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return getAnthropicAnswer(question, previousAnswers);
  }

  return getFallbackAnswer();
}

async function getNewApiAnswer(question, previousAnswers = []) {
  try {
    const apiKey = process.env.NEWAPI_API_KEY || process.env.AI_API_KEY;
    const baseUrl = process.env.NEWAPI_BASE_URL || process.env.AI_BASE_URL || "https://ai.kuocai.net";
    const model = process.env.NEWAPI_MODEL || process.env.AI_MODEL || "DeepSeek-V4-Flash";
    const endpoint = getChatCompletionsEndpoint(baseUrl);

    const response = await Promise.race([
      fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          temperature: 0.95,
          top_p: 0.92,
          max_tokens: 40,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(question, previousAnswers) }
          ]
        })
      }),
      timeout(8000)
    ]);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NewAPI ${response.status}: ${errorText.slice(0, 180)}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return normalizeHumanAnswer(text);
  } catch (error) {
    console.error("NewAPI fallback:", error.message);
    return getFallbackAnswer();
  }
}

async function getAnthropicAnswer(question, previousAnswers = []) {
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await Promise.race([
      client.messages.create({
        model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
        max_tokens: 40,
        temperature: 0.95,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildUserPrompt(question, previousAnswers)
          }
        ]
      }),
      timeout(8000)
    ]);

    const text = response.content?.[0]?.text?.trim();
    return normalizeHumanAnswer(text);
  } catch (error) {
    console.error("Claude API fallback:", error.message);
    return getFallbackAnswer();
  }
}

function buildUserPrompt(question, previousAnswers) {
  const recent = previousAnswers
    .map((answer) => normalizeHumanAnswer(answer))
    .filter(Boolean)
    .slice(-2);

  return [
    `这一轮的问题是：${question}`,
    recent.length > 0 ? `你前面说过：${recent.join(" / ")}` : "",
    "请直接给出你会发到群里的回答",
    "不要句号，不要解释，不要超过 10 个中文字符，别重复上一轮语气"
  ].filter(Boolean).join("\n");
}

function getChatCompletionsEndpoint(baseUrl) {
  const clean = String(baseUrl).replace(/\/+$/, "");
  if (clean.endsWith("/v1")) return `${clean}/chat/completions`;
  return `${clean}/v1/chat/completions`;
}

function getFallbackAnswer() {
  return normalizeHumanAnswer(FALLBACK_ANSWERS[Math.floor(Math.random() * FALLBACK_ANSWERS.length)]);
}

function timeout(ms) {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error("AI API timeout")), ms);
  });
}

function normalizeHumanAnswer(value) {
  let text = String(value || "").trim();
  if (!text) return fallbackShortAnswer();

  text = text
    .replace(/^```[\s\S]*?\n?/, "")
    .replace(/```$/g, "")
    .replace(/^(回答|答案|最终回答|我的回答)\s*[:：]\s*/i, "")
    .replace(/^[-*•\d.、\s]+/, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  text = firstLine || text;

  const bannedPatterns = [
    /作为(一个)?(AI|人工智能|语言模型|普通人|年轻人)/i,
    /我(无法|不能|没有个人经历|没有真实经历)/,
    /首先|其次|最后|总之|综上|从某种程度上|取决于具体情况/,
    /以下是|我会这样回答|最终答案/
  ];

  if (bannedPatterns.some((pattern) => pattern.test(text))) {
    return fallbackShortAnswer();
  }

  text = text
    .replace(/[。.!！]+$/g, "")
    .replace(/[；;]+/g, "，")
    .replace(/[：:]+/g, "，")
    .replace(/\s*[-—]{2,}\s*/g, "，")
    .trim();

  if (text.length > 10) {
    text = text.slice(0, 10).replace(/[，,、；;：:。.!！?？\s]+$/g, "");
  }

  if (!text) return fallbackShortAnswer();
  return text;
}

function fallbackShortAnswer() {
  const answers = [
    "看心情吧",
    "还行吧",
    "有点难选",
    "不太想动",
    "随便吧"
  ];
  return answers[Math.floor(Math.random() * answers.length)];
}

module.exports = { getAiAnswer, getRandomAiNickname, normalizeHumanAnswer };

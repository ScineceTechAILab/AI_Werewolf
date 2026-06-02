const wordPairs = [
  { civilian: "奶茶", undercover: "咖啡", hint: "都能救人，也都能让钱包掉血。" },
  { civilian: "老板", undercover: "甲方", hint: "都拥有改变下班时间的神秘力量。" },
  { civilian: "火锅", undercover: "烧烤", hint: "都适合一群人把计划聊到失败。" },
  { civilian: "地铁", undercover: "公交", hint: "都能让早高峰的人类重新理解生存。" },
  { civilian: "健身房", undercover: "瑜伽馆", hint: "都和自律有关，也都可能只存在于办卡当天。" },
  { civilian: "加班", undercover: "开会", hint: "都让时间出现黑洞。" },
  { civilian: "外卖", undercover: "泡面", hint: "都代表人类对做饭的最后抵抗。" },
  { civilian: "自拍", undercover: "证件照", hint: "都在和真实的脸谈判。" },
  { civilian: "闹钟", undercover: "日历", hint: "都负责提醒你逃不过现实。" },
  { civilian: "短视频", undercover: "直播", hint: "都能把五分钟变成一小时。" },
  { civilian: "论文", undercover: "PPT", hint: "都擅长在截止日前夜进化。" },
  { civilian: "存钱", undercover: "理财", hint: "都听起来成熟，做起来像玄学。" },
  { civilian: "猫", undercover: "狗", hint: "都可能成为家庭真正的主人。" },
  { civilian: "旅行", undercover: "出差", hint: "都要收拾行李，但心情完全不同。" },
  { civilian: "耳机", undercover: "音箱", hint: "都负责把世界调成自己想听的样子。" },
  { civilian: "电梯", undercover: "楼梯", hint: "都连接楼层，也暴露体能。" },
  { civilian: "冰箱", undercover: "微波炉", hint: "都和深夜食物犯罪有关。" },
  { civilian: "朋友圈", undercover: "微博", hint: "都能证明一个人还在互联网活动。" }
];

const roundRoasts = [
  "AI 裁判观察到：有人说得像在描述词语，有人说得像在写离职申请。",
  "本轮空气中出现明显的心虚浓度，请各位保持表情管理。",
  "有一位玩家正在用非常努力的方式假装自己很自然。",
  "AI 裁判暂时不点名，但某些发言已经开始自带马赛克。",
  "这一轮的逻辑含量不高，综艺含量很充足。",
  "现场出现了三种人：会玩的、会装的、和不知道自己在说什么的。"
];

const playerTitles = [
  "最会装的正常人",
  "逻辑废墟建筑师",
  "发言像在写周报",
  "人类观察样本",
  "无效推理冠军",
  "表情管理逃犯",
  "气氛组编外人员",
  "词语保密局局长"
];

function sample(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function getWordPair() {
  return sample(wordPairs);
}

function getRoundRoast() {
  return sample(roundRoasts);
}

function getPlayerTitle() {
  return sample(playerTitles);
}

function buildFinalCommentary(winner) {
  const commentary = {
    civilian: "平民阵营靠集体直觉把卧底送走，过程像推理，结果像玄学。",
    undercover: "卧底成功活到最后，用稳定的心虚和不稳定的逻辑完成潜伏。",
    blank: "白板在没有词的情况下活出了有词的气势，AI 裁判愿称之为空手套线索。"
  };
  return commentary[winner] || "本局结束，AI 裁判正在重新理解人类语言。";
}

module.exports = {
  wordPairs,
  getWordPair,
  getRoundRoast,
  getPlayerTitle,
  buildFinalCommentary
};

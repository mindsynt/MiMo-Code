export type ExtractedEntity = {
  name: string
  type: string
  context?: string
  confidence: number
}

/**
 * Three-tier persistence classifier.
 *
 * - "discard": 单字确认(好的/嗯/ok/yes/y/no/n/继续), 纯元对话(<20字无实质), 纯标点
 * - "persistent": 反引号函数/API, 规则声明, 架构决策, 配置赋值
 * - "short_term": 默认均衡策略
 */
export function classifyPersistence(text: string): "persistent" | "short_term" | "discard" {
  const trimmed = text.trim()
  if (!trimmed) return "discard"

  // discard: pure punctuation
  if (/^[\p{P}\p{Zs}]+$/u.test(trimmed)) return "discard"

  // discard: single word confirmations
  if (/^(好的|嗯|ok|yes|y|no|n|继续|是|对|行|好|知道|明白|可以|嗯嗯|收到|了解)$/i.test(trimmed)) return "discard"

  // persistent: backtick function/API calls — `Bun.write()`
  if (/`[\w.]+\([^)]*\)`/.test(text)) return "persistent"

  // persistent: rule declarations
  if (/(永远|总是|必须|禁止|应该使用|规范|约定|规则(?:是|：|:))/.test(text)) return "persistent"

  // persistent: architecture decisions
  if (/(决定|选用|采用|放弃|用.+?而不是)/.test(text)) return "persistent"

  // persistent: English rule markers
  if (/^(?:Rule|Convention|Note|Policy|Always|Never)\s*[:]/im.test(text)) return "persistent"

  // persistent: "must/should" statements
  if (/\b(?:must|should)\s+(?:use|be|follow|set|keep)\b/i.test(text)) return "persistent"

  // persistent: config assignment — KEY="value" or KEY='value'
  if (/=\s*["']/.test(text)) return "persistent"

  // persistent: config assignment — UPPERCASE_IDENT=value (at least 2 uppercase letters before =)
  // Narrower than generic \b\w+= to avoid false positives on Chinese text like "性能=高"
  if (/\b[A-Z][A-Z_0-9]+\s*=\s*\S+/.test(text)) return "persistent"

  // discard: short meta-conversation (≤10 chars, purely Chinese filler or
  // known English greetings). Long enough substantive text like
  // "我们今天来讨论一下项目的技术选型" (16 chars) is preserved.
  if (
    trimmed.length <= 10 &&
    (/^[\u4e00-\u9fff\s，。！？、；：]+$/.test(trimmed) || /^(hi|hello|hey|thx|thanks)$/i.test(trimmed))
  )
    return "discard"

  return "short_term"
}

export function classifyPersonal(text: string): Array<{ key: string; value: string; confidence: number }> {
  const results: Array<{ key: string; value: string; confidence: number }> = []

  // 显式偏好
  const m1 = text.match(/(?:我喜欢用|我习惯用|我更倾向|优先使用|最好用|推荐使用)\s*[\`]?([\w.\-\/]+)[\`]?/)
  if (m1) results.push({ key: "preferred_tool", value: m1[1], confidence: 0.9 })

  // 否定偏好
  const m2 = text.match(/(?:不要用|别用|不用|避免使用|少用)\s*[\`]?([\w.\-\/]+)[\`]?/)
  if (m2) results.push({ key: "disliked_tool", value: m2[1], confidence: 0.8 })

  // 规则声明
  const m3 = text.match(/(?:必须|应该|要)\s*(?:使用|用)\s*[\`]?([\w.\-\/]+)[\`]?/)
  if (m3) results.push({ key: "required_tool", value: m3[1], confidence: 0.7 })

  return results
}

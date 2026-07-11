/**
 * 分享组件工具函数测试
 *
 * 覆盖：
 * - formatDuration：时间格式化
 * - createOverflow：溢出检测逻辑
 */
import { describe, expect, it } from "bun:test"
import { createOverflow, formatDuration } from "../../src/components/share/common"

// ====== 测试：formatDuration ======
describe("formatDuration", () => {
  const locale = "en"

  it("formats milliseconds", () => {
    expect(formatDuration(500, locale)).toBe("500ms")
  })

  it("formats seconds (rounds down)", () => {
    expect(formatDuration(1500, locale)).toBe("1s")
  })

  it("formats full seconds", () => {
    expect(formatDuration(2000, locale)).toBe("2s")
  })

  it("formats minutes", () => {
    expect(formatDuration(65000, locale)).toBe("1m")
  })

  it("formats large minutes", () => {
    expect(formatDuration(180000, locale)).toBe("3m")
  })

  it("handles zero", () => {
    expect(formatDuration(0, locale)).toBe("0ms")
  })
})

// ====== 测试：createOverflow ======
describe("createOverflow", () => {
  it("returns false initially (no element observed)", () => {
    const overflow = createOverflow()
    expect(overflow.status).toBe(false)
  })

  it("detects overflow when scrollHeight > clientHeight + 1", () => {
    const overflow = createOverflow()
    const el = document.createElement("div")
    Object.defineProperty(el, "scrollHeight", { value: 200 })
    Object.defineProperty(el, "clientHeight", { value: 100 })

    overflow.ref(el)
    expect(overflow.status).toBe(true)
  })

  it("detects no overflow when content fits", () => {
    const overflow = createOverflow()
    const el = document.createElement("div")
    Object.defineProperty(el, "scrollHeight", { value: 100 })
    Object.defineProperty(el, "clientHeight", { value: 200 })

    overflow.ref(el)
    expect(overflow.status).toBe(false)
  })

  it("allows 1px subpixel threshold", () => {
    const overflow = createOverflow()
    const el = document.createElement("div")
    Object.defineProperty(el, "scrollHeight", { value: 101 })
    Object.defineProperty(el, "clientHeight", { value: 100 })

    overflow.ref(el)
    expect(overflow.status).toBe(false)
  })

  it("detects overflow when exceeding 1px threshold", () => {
    const overflow = createOverflow()
    const el = document.createElement("div")
    Object.defineProperty(el, "scrollHeight", { value: 102 })
    Object.defineProperty(el, "clientHeight", { value: 100 })

    overflow.ref(el)
    expect(overflow.status).toBe(true)
  })
})

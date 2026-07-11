/**
 * ContentMarkdown 组件测试
 *
 * 注意：Solid 组件的完整 DOM 渲染需要 JSX 运行时环境。
 *
 * 覆盖：模块导入完整性
 */
import { describe, expect, it } from "bun:test"

describe("ContentMarkdown", () => {
  it("模块可被正确导入", async () => {
    const mod = await import("../../src/components/share/content-markdown")
    expect(mod.ContentMarkdown).toBeDefined()
    expect(typeof mod.ContentMarkdown).toBe("function")
  })
})

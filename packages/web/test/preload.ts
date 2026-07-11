// 测试预加载：设置全局 DOM 环境和 ResizeObserver mock
import { GlobalRegistrator } from "@happy-dom/global-registrator"

// 注册全局 DOM API（document, window, navigator, HTMLElement 等）
GlobalRegistrator.register()

// Mock clipboard API（用于分享组件的复制功能）
Object.defineProperty(globalThis.navigator, "clipboard", {
  value: {
    writeText: async () => {},
    readText: async () => "",
  },
  writable: true,
})

// Mock scrollTo（用于滚动按钮测试）
Element.prototype.scrollIntoView = () => {}

// Mock console.error 抑制测试中的预期错误
const originalConsoleError = console.error
console.error = (...args: unknown[]) => {
  originalConsoleError(...args)
}

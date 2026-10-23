export class CheckinError extends Error {
  constructor(code, message, retryable = false) {
    super(message)
    this.code = code
    this.retryable = retryable
  }
}

// Never persist raw upstream bodies, headers, tokens, or child process output.
export function safeError(error) {
  if (error instanceof CheckinError) return { status: 'failed', code: error.code, message: error.message, retryable: error.retryable }
  return { status: 'failed', code: 'internal', message: '执行失败；请运行 doctor 检查配置、客户端登录和文件权限。', retryable: false }
}

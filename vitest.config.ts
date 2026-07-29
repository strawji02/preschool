import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `import 'server-only'`는 Next 컴파일러가 내부적으로 alias하지만 vitest는 모른다.
      // 서버 전용 모듈(예: features/settlement/data/master.ts)을 테스트할 수 있게
      // 빈 모듈로 연결한다. 가드는 빌드 시점에만 필요하고 테스트에서는 의미가 없다.
      'server-only': path.resolve(__dirname, './src/test/server-only-stub.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
  },
})

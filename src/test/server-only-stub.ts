/**
 * `server-only` 대체 모듈 (vitest 전용).
 *
 * Next는 클라이언트 컴포넌트가 서버 전용 모듈을 import하면 빌드를 실패시키기 위해
 * `server-only`를 내부적으로 alias한다. vitest는 그 alias를 모르므로 해석에 실패한다.
 * 가드는 **빌드 시점**에만 의미가 있고 테스트에서는 필요 없으니 빈 모듈로 대체한다.
 *
 * @see vitest.config.ts
 */
export {}

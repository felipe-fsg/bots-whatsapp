import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // os testes de integração usam o mesmo banco, então rodam um arquivo por vez
    fileParallelism: false,
    testTimeout: 20_000,
  },
});

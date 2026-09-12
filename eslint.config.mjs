// 本仓库的工具化 lint 配置：只启用能捕获「真实缺陷」的规则，不引入风格/格式规则。
// 用途：在人工审查之前先跑一遍，秒级捕获未定义标识符（如模块级函数引用闭包常量）、
// 不可达代码、重复键等——这类问题曾靠多轮子代理审查才发现。
// 运行：npx eslint index.js client.js     （或全局 eslint，见 package.json 的 lint 脚本）
export default [
  {
    files: ['index.js', 'client.js', 'test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // 宿主/浏览器运行时提供的全局
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        requestIdleCallback: 'readonly',
        cancelIdleCallback: 'readonly',
        EventSource: 'readonly',
        fetch: 'readonly',
        React: 'readonly',
        module: 'readonly',
        require: 'readonly',
      },
    },
    rules: {
      // 真实缺陷
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-self-assign': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-cond-assign': ['error', 'except-parens'],
      'no-func-assign': 'error',
      'no-obj-calls': 'error',
      'no-sparse-arrays': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-async-promise-executor': 'error',
      'no-await-in-loop': 'off',
      'require-atomic-updates': 'off',
      // 死代码/未使用（警告级：允许 catch 空块与未用参数，避免噪声）
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
]

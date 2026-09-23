// 本仓库的工具化 lint 配置：只启用能捕获「真实缺陷」的规则，不引入风格/格式规则。
// 用途：在人工审查之前先跑一遍，秒级捕获未定义标识符（如模块级函数引用闭包常量）、
// 不可达代码、重复键等——这类问题曾靠多轮子代理审查才发现。
//
// 运行：npm run lint      （= eslint .，见 package.json 的 lint 脚本）
//
// eslint 已列为 devDependency（^9.0.0，见 package.json），故 npm run lint 与 npx eslint
// 都会优先用 node_modules/.bin 里的 9.x；只有**未安装依赖**时才会回落到 PATH 里的全局那份
// （机器上全局是 8.46.0，读不了 flat config，会报 "couldn't find a configuration file"）。
// 用 `eslint .` 而不是逐个列文件，是为了把配置声称覆盖的 test/ 一并纳入
// （files 已声明 test/**/*.mjs，早先的脚本只传了 index.js client.js，
// 等于配置声称覆盖、实际没跑）。
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
        // test/smoke.mjs 用 setImmediate 构造 mock 请求（req 的 data/end 事件异步触发）；
        // 缺它会报 no-undef —— 这是真实缺口，不是噪声。
        // 只声明 setImmediate：clearImmediate 全仓零引用，且本 globals 同时覆盖浏览器侧的
        // client.js，多声明一个 Node 专有名字等于放行一个在浏览器里必然 ReferenceError 的调用。
        setImmediate: 'readonly',
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

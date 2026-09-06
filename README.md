# mdx-vocabulary

`mdx-vocabulary` 是一个把 MDX 词典导入 PostgreSQL、提供只读查询 API，并在浏览器中搜索和阅读词条的最小全栈应用。

项目目前面向本地开发和功能验证：后端使用 TypeScript、Prisma、PostgreSQL 和 Fastify，前端是独立的 Vite + React 应用。MDX 原始内容会在导入阶段生成可搜索的纯文本和经过清洗的 HTML；公开 API 不返回原始 `entryRaw`。

## 已实现功能

- 将本地 `.mdx` 文件复制到本地数据目录并计算 SHA-256 checksum。
- 使用 PostgreSQL 保存 dictionary、entry 和 import job。
- 使用 `js-mdict` 读取 MDX metadata 和词条。
- 批量导入词条，记录导入状态与进度。
- 标准化 headword、生成排序键、提取纯文本并清洗 HTML。
- 识别 MDX `@@@LINK` redirect，并在查询时最多解析一次目标词条。
- 只列出状态为 `ready` 的字典。
- 在指定字典内进行 exact 和 prefix 搜索，支持 `limit`、`offset`。
- 根据 entry ID 获取词条详情。
- Fastify 参数校验、统一错误响应和 OpenAPI schema。
- Swagger UI 和 JSON/YAML OpenAPI 文档。
- React 搜索页面：选择字典、exact/prefix 搜索、结果预览、完整词条展示。
- Importer、查询服务、HTTP API 的单元及 PostgreSQL integration tests。

## 架构

当前开发链路：

```text
MDX
→ Importer / Worker
→ MdxParserAdapter / js-mdict
→ PostgreSQL / Prisma
→ DictionaryQueryService
→ Fastify REST API
→ Vite proxy
→ React
→ Browser
```

主要边界如下：

- Importer 负责导入编排、状态更新、批量持久化和内容预处理。
- `MdxParserAdapter` 隔离具体 MDX parser；当前实现使用 `js-mdict`。
- Prisma 是 PostgreSQL 的 schema 和数据访问层。
- `DictionaryQueryService` 只负责只读 entry 查询和一跳 redirect 解析。
- Fastify 负责 HTTP 路由、校验、错误响应和 OpenAPI，不托管前端静态文件。
- React 只通过相对 `/api/...` 路径访问后端；开发时由 Vite 转发。

### 数据从 MDX 到浏览器

1. `import-mdx` 将源 MDX 保存到 `APP_DATA_DIR`，创建 dictionary 和 queued import job。
2. Worker claim job，通过 `JsMdictAdapter` 检查文件 metadata 并迭代词条。
3. Importer 清除 PostgreSQL 不接受的 NUL 字符，标准化 headword，生成 sort key，识别 redirect，清洗 HTML，并提取纯文本。
4. 词条按 `IMPORT_BATCH_SIZE` 批量写入 PostgreSQL；成功后 dictionary 变为 `ready`。
5. 浏览器先请求 ready dictionary 列表，再向指定 dictionary 发起 exact 或 prefix 搜索。
6. Fastify 校验请求并调用 `DictionaryQueryService`；服务通过 Prisma 执行显式字段查询。
7. React 展示搜索 DTO 的纯文本预览；点击结果后获取 detail DTO，并渲染后端保存的 `sanitizedHtml`。

## 主要模块

| 路径 | 职责 |
| --- | --- |
| `prisma/schema.prisma` | Dictionary、DictionaryEntry、ImportJob schema、枚举和索引。 |
| `src/cli/import-mdx.ts` | 本地 MDX 导入命令；保存文件、创建 job、启动指定 job worker、输出摘要。 |
| `src/worker.ts` | Claim queued job 并调用 importer；队列为空后退出。 |
| `src/importer/mdx-importer.ts` | 导入状态、批处理、内容转换和失败记录。 |
| `src/mdx/` | Parser 接口以及基于 `js-mdict` 的实现。 |
| `src/storage/` | MDX 文件存储接口和本地目录实现。 |
| `src/jobs/` | PostgreSQL job queue、进度和状态定义。 |
| `src/entries/` | Headword normalization、sort key、redirect 检测、HTML sanitization、纯文本提取。 |
| `src/query/dictionary-query-service.ts` | Exact、prefix、entry detail 查询和一跳 redirect 解析。 |
| `src/http/server.ts` | Fastify 实例、REST routes、validation、error responses、Swagger。 |
| `src/api.ts` | Fastify 进程启动和优雅关闭入口。 |
| `web/src/api.ts` | 浏览器端相对路径 API client 和 DTO 类型。 |
| `web/src/App.tsx` | 字典加载、搜索、结果和详情页面状态。 |
| `web/src/styles.css` | 无 UI framework 的页面及词条基础样式。 |

## 环境要求

- Node.js 24（当前开发和测试版本）
- npm
- PostgreSQL
- 一个可读取的 `.mdx` 文件（导入功能需要）

## 安装依赖

后端和前端分别维护依赖：

```bash
npm install

cd web
npm install
cd ..
```

## PostgreSQL 和 Prisma 准备

创建本地数据库。以下命令以数据库名 `mdx_vocabulary` 为例：

```bash
createdb mdx_vocabulary
```

复制环境变量模板并按本机 PostgreSQL 用户、密码、host 和 port 修改 `DATABASE_URL`：

```bash
cp .env.example .env
```

默认示例：

```dotenv
DATABASE_URL="postgresql://aki@localhost:5432/mdx_vocabulary?schema=public"
APP_DATA_DIR="./data"
IMPORT_BATCH_SIZE="100"
```

环境变量：

| 名称 | 是否必需 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | Prisma PostgreSQL connection URL。 |
| `APP_DATA_DIR` | 否 | 保存导入 MDX 的目录，默认 `./data`。 |
| `IMPORT_BATCH_SIZE` | 否 | 每次批量写入的 entry 数量，默认 `100`。 |
| `HOST` | 否 | Fastify bind host，默认 `127.0.0.1`。 |
| `PORT` | 否 | Fastify port，默认 `3000`。 |

生成 Prisma Client 并应用现有 migration：

```bash
npm run db:generate
npm run db:migrate
```

`db:migrate` 当前使用 `prisma migrate dev`，适合本地开发；仓库尚未提供生产 migration/deployment 工作流。

## 导入 MDX

数据库准备完成后，从仓库根目录执行：

```bash
npm run import-mdx -- /absolute/or/relative/dictionary.mdx
```

该命令会：

1. 验证扩展名和可读性。
2. 将文件复制到 `APP_DATA_DIR`，使用 UUID 作为 storage key。
3. 创建 queued dictionary 和 import job。
4. 启动一个 worker 处理该 job，并等待完成。
5. 输出 dictionary 状态、MDX version、encoding、entry 数、redirect 数量和耗时。

也可以单独运行 worker，处理数据库中当前 queued jobs：

```bash
npm run worker
```

当前 worker 在队列为空后退出，不是常驻服务。项目目前只有 CLI 导入，没有 HTTP upload API。

## 启动 Fastify backend

从仓库根目录运行：

```bash
npm run api
```

默认地址：

```text
http://127.0.0.1:3000
```

当前只读 API：

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/dictionaries` | 按 `importedAt DESC` 列出 ready dictionaries。 |
| GET | `/api/dictionaries/:dictionaryId/search` | 搜索指定 ready dictionary；支持 `q`、`mode`、`limit`、`offset`。 |
| GET | `/api/entries/:entryId` | 获取 entry detail 和 sanitized HTML。 |

搜索示例：

```bash
curl 'http://127.0.0.1:3000/api/dictionaries'
curl 'http://127.0.0.1:3000/api/dictionaries/<dictionaryId>/search?q=apple&mode=exact&limit=20&offset=0'
curl 'http://127.0.0.1:3000/api/dictionaries/<dictionaryId>/search?q=app&mode=prefix&limit=20&offset=0'
curl 'http://127.0.0.1:3000/api/entries/<entryId>'
```

搜索只允许 ready dictionary；不存在的 dictionary 返回 404，非 ready dictionary 返回 409。API 参数错误使用 400，未预期错误使用不包含内部 stack trace 的 500 响应。

## Swagger / OpenAPI

启动 Fastify 后访问：

- Swagger UI：<http://127.0.0.1:3000/docs/>
- OpenAPI JSON：<http://127.0.0.1:3000/docs/json>
- OpenAPI YAML：<http://127.0.0.1:3000/docs/yaml>

## 启动 Vite frontend

先在一个终端启动 Fastify，然后在另一个终端运行：

```bash
cd web
npm run dev
```

打开：

```text
http://127.0.0.1:5173
```

`web/vite.config.ts` 将 `/api` 转发到 `http://127.0.0.1:3000`。前端源代码始终请求相对 `/api/...` URL，不依赖固定 backend host 或 port。

生产前端 build：

```bash
cd web
npm run build
```

输出目录为 `web/dist/`。Fastify 当前不会托管此目录。

## Local Development / Service Control

需要同时运行 Fastify 和 Vite 时，可以从任意当前目录调用根目录开发脚本：

```bash
/path/to/mdx-vocabulary/scripts/dev.sh start
/path/to/mdx-vocabulary/scripts/dev.sh status
/path/to/mdx-vocabulary/scripts/dev.sh restart
/path/to/mdx-vocabulary/scripts/dev.sh stop
```

从仓库根目录可以使用较短形式：

```bash
./scripts/dev.sh start
```

脚本只管理 Fastify backend 和 Vite frontend，不管理 PostgreSQL、importer 或 worker。它使用 `.run/backend.pid`、`.run/frontend.pid` 跟踪自己启动的进程组，日志分别写入 `.run/backend.log` 和 `.run/frontend.log`；`.run/` 不纳入版本控制。

## 测试

运行后端和 integration tests：

```bash
npm test
```

运行后端 TypeScript 类型检查：

```bash
npx tsc --noEmit
```

运行前端类型检查和 production build：

```bash
cd web
npm run build
```

注意：当前 PostgreSQL integration tests 不是完全隔离的 fixture。它们要求 `DATABASE_URL` 指向的数据库已经包含当前 Oxford 测试字典和特定词条，包括 `apple`、`abandon`、`a catch-22 situation`，并断言该字典有 92,667 个 entries。测试过程中还会短暂创建 dictionary/job fixture，并在结束时清理。不要让测试连接生产数据库。

## 项目结构

以下省略 `node_modules/`、`web/dist/`、本地 `data/` 和编译缓存：

```text
mdx-vocabulary/
├── prisma/
│   ├── migrations/
│   └── schema.prisma
├── src/
│   ├── cli/
│   │   └── import-mdx.ts
│   ├── entries/
│   │   ├── html.ts
│   │   └── normalize.ts
│   ├── http/
│   │   └── server.ts
│   ├── importer/
│   │   └── mdx-importer.ts
│   ├── jobs/
│   ├── mdx/
│   ├── query/
│   │   └── dictionary-query-service.ts
│   ├── storage/
│   ├── api.ts
│   ├── config.ts
│   ├── db.ts
│   └── worker.ts
├── tests/
│   ├── dictionary-query-service.integration.test.ts
│   ├── entries.test.ts
│   ├── http-api.integration.test.ts
│   └── importer.integration.test.ts
├── scripts/
│   └── dev.sh
├── web/
│   ├── src/
│   │   ├── api.ts
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── .env.example
├── package.json
├── README.md
└── tsconfig.json
```

## 计划中的生产部署

生产部署尚未实现，计划职责划分为：

```text
Browser
→ Nginx
  ├── /        → static Vite dist
  ├── /api/*   → reverse proxy to Fastify
  └── /docs/*  → reverse proxy to Fastify Swagger
                 → PostgreSQL
```

Nginx 将托管 `web/dist`，并把 `/api` 和 `/docs` 转发给 Fastify。因为 React 始终使用相对 `/api/...`，开发时可以由 Vite proxy 处理，生产时可以无须修改前端代码而改由 Nginx 处理。

仓库当前没有 Nginx 配置、Docker 文件或 deployment automation。

## 尚未实现

- Authentication 和 authorization。
- HTTP dictionary upload/import API 及导入管理 UI。
- 常驻 worker 的进程管理、重试策略和 dead-letter 处理。
- Vocabulary Book、收藏、搜索历史和分页 UI。
- AI 功能。
- 发音播放。
- 独立、可重复创建的 PostgreSQL test database fixture。
- Nginx、Docker 和正式 deployment 配置。
- Production logging、metrics、rate limiting 和 API/docs access policy。

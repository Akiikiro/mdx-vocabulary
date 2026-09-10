# mdx-vocabulary

`mdx-vocabulary` 是一个把 MDX 词典导入 PostgreSQL，并在浏览器中搜索、阅读和收藏词条的本地优先全栈应用。

项目目前面向本地开发和功能验证：后端使用 TypeScript、Prisma、PostgreSQL 和 Fastify，前端是独立的 Vite + React 应用。MDX 原始内容会在导入阶段生成可搜索的纯文本和经过清洗的 HTML；公开 API 不返回原始 `entryRaw`。

## 已实现功能

- 将本地 `.mdx` 文件复制到本地数据目录并计算 SHA-256 checksum。
- 从浏览器选择并上传完整 MDict 文件夹；后端流式保存、验证 package，并复用 worker 导入其中唯一的 MDX。
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
- React Dictionary view：选择字典、prefix autocomplete 候选、键盘选择及可折叠的完整词条展示。
- Dictionary 可声明可选 stylesheet URL；Oxford 8 使用随 Web 应用发布的 `O8C.css`，恢复 sanitized HTML 中保留 class 所支持的词典样式。前端通过安全的 MDict marker 显示 MDD 图片和发音控件，并在当前 dictionary 内解析内部词条引用。
- Package 中唯一的 CSS 会自动绑定并由 Fastify dictionary asset route 提供；已知 stylesheet 通过内容 fingerprint 获得 rendering compatibility profile，使重复导入保持相同 override。MDD 资源按 dictionary 保存并由 scoped resource API 按需读取。
- 单用户本地 Vocabulary Book：收藏词条到 PostgreSQL、持久展示、重新打开完整词条和移除收藏。
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
- Dictionary 的可选 `stylesheetUrl` 元数据声明其浏览器 stylesheet；没有声明的词典继续使用应用基础样式。
- `DictionaryQueryService` 只负责只读 entry 查询和一跳 redirect 解析。
- `VocabularyService` 负责收藏的幂等添加、列表查询和移除，并返回不含原始 MDX HTML 的显式 DTO。
- Fastify 负责 HTTP 路由、校验、错误响应和 OpenAPI，不托管前端静态文件。
- React 只通过相对 `/api/...` 路径访问后端；开发时由 Vite 转发。

### 数据从 MDX 到浏览器

1. 浏览器 package import 或 `import-mdx` CLI 将源 MDX 保存到 `APP_DATA_DIR`，创建 dictionary 和 queued import job。
2. Worker claim job，通过 `JsMdictAdapter` 检查文件 metadata 并迭代词条。
3. Importer 清除 PostgreSQL 不接受的 NUL 字符，标准化 headword，生成 sort key，识别 redirect；对新导入的 definition，先将合法 MDict internal references 转换为不含 dictionary UUID/HTTP URL 的 inert typed markers，再严格清洗 HTML 并提取纯文本。已有 rows 不会在启动时自动重处理。
4. 词条按 `IMPORT_BATCH_SIZE` 批量写入 PostgreSQL；成功后 dictionary 变为 `ready`。
5. 浏览器先请求 ready dictionary 列表，按当前词典的可选 `stylesheetUrl` 动态加载或卸载 stylesheet，再向指定 dictionary 发起 exact 或 prefix 搜索。
6. Fastify 校验请求并调用 `DictionaryQueryService`；服务通过 Prisma 执行显式字段查询。
7. Entry detail 中经过后端验证的 sound markers 会由前端增强为轻量播放按钮，并通过 dictionary-scoped MDD resource API 播放原始音频；任一时刻只播放一个发音。
8. React 展示搜索 DTO 的纯文本预览；点击结果后获取 detail DTO，并渲染后端保存的 `sanitizedHtml`。
9. 收藏操作通过 `VocabularyService` 将 `VocabularyItem` 关联到具体 `DictionaryEntry`；浏览器刷新后从 PostgreSQL 恢复收藏列表。

### Dictionary package import

浏览器使用目录 file input 保留 `webkitRelativePath`，只在本地对扩展名和数量做预览。后端通过 multipart stream 将每个文件写入 staging，并独立验证 package 必须恰好包含一个 MDX、最多一个 CSS。验证成功后，文件原子移动到 dictionary 专属目录，再以 transaction 创建 Dictionary 和 ImportJob；API 启动现有 worker，前端轮询 queued/importing/ready/failed 状态。Stylesheet 内容 SHA-256 用于识别已知 compatibility profile，不依赖 dictionary UUID、文件名或词典名；启动时会幂等补齐旧 package import 尚未记录的 profile。

Package storage layout：

```text
APP_DATA_DIR/
└── dictionaries/<dictionary-id>/
    ├── source.mdx
    ├── styles/
    │   └── <package stylesheet>.css
    └── resources/
        ├── <source>.mdd
        ├── <source>.1.mdd
        └── <other package files>
```

MDD resource foundation 按 dictionary scope 枚举 package 中的 MDD 分卷，依次执行精确 key lookup，并通过通用 resource API 返回解码后的原始 bytes。逻辑资源路径保持大小写和 Unicode，不解释 `audio`、`images` 或语言目录等路径段。MDD 不会整包解压；stylesheet asset route 仍只允许读取该 dictionary 自动绑定的 CSS。

## 主要模块

| 路径 | 职责 |
| --- | --- |
| `prisma/schema.prisma` | Dictionary、DictionaryEntry（包括 nullable、versioned MDX physical locator）、VocabularyItem、ImportJob schema、枚举和索引。 |
| `src/cli/import-mdx.ts` | 本地 MDX 导入命令；保存文件、创建 job、启动指定 job worker、输出摘要。 |
| `src/cli/reprocess-entries.ts` | 对显式指定 dictionary 执行 marker-aware entry dry-run 或原地批量重处理。 |
| `src/cli/backfill-mdx-locators.ts` | 对显式指定 dictionary 校验并 dry-run/apply 持久化 MDX locator；默认不写入。 |
| `src/worker.ts` | Claim queued job 并调用 importer；队列为空后退出。 |
| `src/importer/mdx-importer.ts` | 导入状态、批处理、内容转换和失败记录。 |
| `src/importer/dictionary-package-import-service.ts` | Package 分类验证、dictionary-owned layout 提交及 Dictionary/ImportJob 创建。 |
| `src/mdx/` | Parser 接口以及基于 `js-mdict` 的实现。 |
| `src/mdx/lazy-mdx-adapter.ts` | Hybrid POC：以 MDX checksum 和物理 record offsets 为边界构造 application-owned locator，并通过 bounded process-local parser lifecycle 精确 lazy fetch。 |
| `src/mdx/mdx-locator-persistence.ts` | Prisma nullable locator columns 与 application-owned `MdxEntryLocator` 的严格转换和 partial-state 拒绝。 |
| `src/resources/` | 逻辑 resource path 校验/MDD key 转换、dictionary-scoped 分卷查询及保守的 bytes content-type 检测。 |
| `src/storage/` | MDX 文件存储接口和本地目录实现。 |
| `src/storage/dictionary-package-storage.ts` | Multipart staging、安全路径校验、dictionary package 原子存储和 CSS asset 定位。 |
| `src/dictionary-stylesheets/` | Stylesheet fingerprint/profile 检测，以及已有 package metadata 的幂等 reconciliation。 |
| `src/jobs/` | PostgreSQL job queue、进度和状态定义。 |
| `src/entries/` | Headword normalization、sort key、redirect 检测、HTML sanitization、纯文本提取。 |
| `src/entries/mdict-references.ts` | 校验 MDict sound、image/resource、internal-entry references 并生成 dictionary-independent inert markers，同时阻止 raw HTML 伪造 marker。 |
| `src/entries/dictionary-entry-reprocessing-service.ts` | 从 `entryRaw` 以稳定游标分批重建 sanitized HTML/plain text，并提供 dry-run、进度和失败摘要。 |
| `src/query/dictionary-query-service.ts` | Exact、prefix、entry detail 查询和一跳 redirect 解析。 |
| `src/vocabulary/vocabulary-service.ts` | VocabularyItem 添加、列表、去重和移除业务逻辑及公开 DTO。 |
| `src/query/lazy-dictionary-detail-poc-service.ts` | 非默认 Hybrid POC path；只读验证现有 entry UUID 到 MDX locator 的映射，并执行 lazy transform/sanitize，不注册公开 route。 |
| `src/query/dictionary-detail-shadow-verifier.ts` | 默认关闭的 detail dual-read shadow；保持 stored DTO 响应不变，按确定性采样隔离执行 lazy parity 并输出不含 HTML/path 的结构化结果。 |
| `src/query/lazy-detail-diagnostic-service.ts` | Dictionary-scoped、零写入、有限并发的 persisted-locator parity sampling 与 latency 汇总。 |
| `src/http/server.ts` | Fastify 实例、REST routes、validation、error responses、Swagger。 |
| `src/api.ts` | Fastify 进程启动和优雅关闭入口。 |
| `web/src/api.ts` | 浏览器端相对路径 API client 和 DTO 类型。 |
| `web/src/App.tsx` | 字典加载、debounced autocomplete、候选选择和详情页面状态。 |
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

如果 dictionary stylesheet 已随 Web 静态文件发布，可以在导入时声明其 root-relative URL：

```bash
npm run import-mdx -- /absolute/or/relative/dictionary.mdx --stylesheet-url /dictionaries/dictionary-name/style.css
```

该命令会：

1. 验证扩展名和可读性。
2. 将文件复制到 `APP_DATA_DIR`，使用 UUID 作为 storage key。
3. 创建 queued dictionary（包括可选 stylesheet URL）和 import job。
4. 启动一个 worker 处理该 job，并等待完成。
5. 输出 dictionary 状态、MDX version、encoding、entry 数、redirect 数量和耗时。

也可以单独运行 worker，处理数据库中当前 queued jobs：

```bash
npm run worker
```

当前 worker 在队列为空后退出，不是常驻服务。项目目前只有 CLI 导入，没有 HTTP upload API。

## 重处理已有 entries

Marker-aware HTML pipeline 更新后，可以显式选择一个 dictionary，从既有 `entryRaw` 重新计算 sanitized HTML 和 plain text。命令默认是无写入 dry-run：

```bash
npm run reprocess-entries -- <dictionaryId>
npm run reprocess-entries -- <dictionaryId> --dry-run --batch-size=500
```

检查 dry-run 摘要和失败记录后，只有明确传入 `--apply` 才会原地更新：

```bash
npm run reprocess-entries -- <dictionaryId> --apply --batch-size=500
```

处理以 `(dictionaryId, sourceOrdinal)` 稳定游标分页，每批使用短事务同时更新 `entrySanitizedHtml` 和 `entryPlainText`。它不会删除或重建 entry，因此 entry ID、source ordinal 和 vocabulary relations 保持不变；redirect 的 HTML/plain text 保持为空。该命令不会自动处理其他 dictionaries，也不会在 API 启动时运行。

## 持久化 MDX locators

Hybrid locator backfill 将现有 entry 临时通过 `sourceOrdinal` 与不可变 MDX key list 对齐，并在验证 checksum、headword、raw definition、entry kind 和 redirect 后，仅填写 nullable locator columns。默认及 `--dry-run` 均执行零写入：

```bash
npm run backfill-mdx-locators -- <dictionaryId>
npm run backfill-mdx-locators -- <dictionaryId> --dry-run --batch-size=500
```

只有显式 apply 才会更新 locator fields；不会修改现有 definition content 或 vocabulary relations：

```bash
npm run backfill-mdx-locators -- <dictionaryId> --apply --batch-size=500
```

完整且验证一致的 locator 会被跳过，因此命令可重启；部分填写、checksum 不一致或 MDX identity 不一致均失败关闭。Public detail 默认通过 persisted locator 从 MDX 懒读取；发生 locator、checksum、MDX 或 sanitizer 故障时仍回退到 PostgreSQL 中的既有 sanitized content。

## Lazy detail shadow verification

设置 `LAZY_DICTIONARY_DETAIL_ENABLED=false` 后，public detail 返回 PostgreSQL stored content；此时开发或 staging 环境可以通过 `SHADOW_DETAIL_SAMPLE_RATE`（`0`–`100`，默认 `0`）启用确定性 shadow 百分比，并可用 `SHADOW_DETAIL_SAMPLE_SEED` 固定样本。Shadow 只比较 persisted-locator lazy pipeline，不替换响应；失败会被分类记录但不会使健康的 stored request 失败。无效采样率安全回落为关闭。

独立的大样本诊断命令始终零写入，默认抽样 1,000 条并将并发限制为 2：

```bash
npm run verify-lazy-detail -- <dictionaryId>
npm run verify-lazy-detail -- <dictionaryId> --sample-size=5000 --seed=review --concurrency=2
```

也可显式使用 `--all`，但日常验证优先使用确定性样本。命令报告 stored/lazy latency、lazy locator/fetch/transform 分解以及 mismatch/failure 分类。

## Feature-flagged lazy detail primary

Entry detail 默认使用 persisted locator → MDX exact fetch → marker-aware sanitizer：`LAZY_DICTIONARY_DETAIL_ENABLED` 未设置或精确为 `true` 时启用 lazy-primary；精确设置为 `false` 时切回 stored PostgreSQL detail。其他未识别值安全关闭 lazy-primary。Lazy 失败时临时回退到 stored detail，并输出不含 definition/path 的结构化分类事件。Lazy-primary 开启时不会再对同一请求运行 shadow。

可选 `LAZY_DICTIONARY_DETAIL_WARMUP=true` 会在启动时预热最近导入的 ready package-backed dictionary；预热失败只记录事件，不阻止服务器启动，因为 stored fallback 仍可用：

```bash
LAZY_DICTIONARY_DETAIL_WARMUP=true npm run api
```

关闭或回滚只需显式设置：

```bash
LAZY_DICTIONARY_DETAIL_ENABLED=false npm run api
```

## 启动 Fastify backend

从仓库根目录运行：

```bash
npm run api
```

默认地址：

```text
http://127.0.0.1:3000
```

当前 API：

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/dictionaries` | 按 `importedAt DESC` 列出 ready dictionaries，包括可选 `stylesheetUrl`。 |
| POST | `/api/dictionaries/import` | 接受多文件 `multipart/form-data` package，验证并排队导入，返回 202。 |
| GET | `/api/dictionaries/:dictionaryId/import-status` | 返回 queued/importing/ready/failed 和导入进度。 |
| GET | `/api/dictionaries/:dictionaryId/assets/styles/:file.css` | 读取该 dictionary 自动绑定的 CSS asset。 |
| GET | `/api/dictionaries/:dictionaryId/resources/*` | 按大小写敏感的 Unicode 逻辑路径精确读取该 dictionary 的 MDD resource bytes。 |
| GET | `/api/dictionaries/:dictionaryId/browser-audio/*` | 将经过校验的 Ogg/Speex 发音资源按需转换为浏览器兼容的 mono MP3，并使用包/内容身份感知的磁盘缓存。 |
| GET | `/api/experimental/edge-tts?word=<word>&voice=female|male` | 实验性 Edge TTS 发音；女性固定使用 `en-US-AvaNeural`，男性固定使用 `en-US-BrianNeural`，生成并分别缓存 MP3。 |
| GET | `/api/dictionaries/:dictionaryId/search` | 搜索指定 ready dictionary；支持 `q`、`mode`、`limit`、`offset`。 |
| GET | `/api/entries/:entryId` | 获取 entry detail 和 sanitized HTML。 |
| GET | `/api/vocabulary` | 按添加时间倒序列出收藏及其安全 entry 摘要。 |
| POST | `/api/vocabulary` | 使用 `{ "entryId": "..." }` 收藏词条；首次返回 201，重复收藏幂等返回同一记录和 200。 |
| DELETE | `/api/vocabulary/:id` | 删除指定收藏，成功返回 204。 |

搜索示例：

```bash
curl 'http://127.0.0.1:3000/api/dictionaries'
curl 'http://127.0.0.1:3000/api/dictionaries/<dictionaryId>/search?q=apple&mode=exact&limit=20&offset=0'
curl 'http://127.0.0.1:3000/api/dictionaries/<dictionaryId>/search?q=app&mode=prefix&limit=20&offset=0'
curl 'http://127.0.0.1:3000/api/entries/<entryId>'
curl 'http://127.0.0.1:3000/api/vocabulary'
curl -X POST -H 'content-type: application/json' -d '{"entryId":"<entryId>"}' 'http://127.0.0.1:3000/api/vocabulary'
curl -X DELETE 'http://127.0.0.1:3000/api/vocabulary/<vocabularyItemId>'
```

Oxford 等词典的 `.spx` 发音资源需要运行环境提供支持 Speex 解码和 `libmp3lame` 编码的 `ffmpeg`。默认从 `PATH` 查找，也可通过 `FFMPEG_PATH` 指定可执行文件。原始 `/resources/*` 端点始终返回未经转换的 MDD bytes；前端发音控件使用独立的 `/browser-audio/*` 派生端点。首次请求完成转换后，MP3 缓存在 `APP_DATA_DIR/.cache/pronunciation-audio`。

词条中的 `Female` / `Male` 按钮用于将 Edge TTS 和词典原始发音做实验性 A/B 比较，分别固定使用 `en-US-AvaNeural` 和 `en-US-BrianNeural`。浏览器只请求本地 `/api/experimental/edge-tts`；第三方 Edge Read Aloud 调用完全位于后端。不同 voice 的生成结果分别缓存在 `APP_DATA_DIR/.cache/edge-tts`。该非官方在线服务可能变化或不可用，不应视为离线词典发音的替代品。

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

Dictionary stylesheet 由 `/api/dictionaries` 返回的 `stylesheetUrl` 和 `stylesheetCompatibilityProfile` 驱动，只在显示对应词典时挂载。原始 stylesheet 先加载，profile 对应的应用 compatibility override 后加载。Oxford 8 profile 由 O8C.css 内容 fingerprint 识别，因此静态旧数据、CLI 可读取的本地 stylesheet 及 folder re-import 不依赖 Dictionary UUID，均可获得一致的 sense marker 修正。该机制只负责 CSS，不提供 MDD、图片、字体或音频资源解析。

Dictionary view 的 **Import Dictionary** 使用浏览器目录选择器。选中后会显示 MDX、CSS、MDD、图片及总文件数；确认 Import 后显示 Uploading、Queued、Importing、Ready 或 Failed。Ready 后 dictionary selector 会刷新并自动选中新词典。Package import 的 stylesheet 由 backend asset route 提供，不需要手工指定 `--stylesheet-url`。

页面会在输入停止约 250ms 后通过现有 prefix API 获取最多 30 个原始候选，再过滤 `sb` 模板、去重，并优先展示独立词头、用 `sth` 短语候选补足，最终最多展示 10 个有效候选。点击候选，或使用方向键选择后按 Enter，会直接加载完整词条；Escape 可以关闭候选列表。

顶部 navigation 在独立的 **Dictionary** 和 **Vocabulary Book** views 间切换，不使用客户端路由。Entry Detail 默认展开完整正文；**Collapse** 会保留约 220px 的正文预览和底部渐隐，**Expand** 恢复完整内容，选择新词条时会重新展开。

词条详情中的 **Add to Vocabulary** 会将具体 entry 收藏到 PostgreSQL。已收藏词条显示 **Added to Vocabulary** 且不能重复点击。Vocabulary Book 显示 headword 和添加时间；点击 headword 会切回 Dictionary view、重新获取并展开完整详情，Remove 成功后会立即从列表移除。

数据库中的 `VocabularyItem` 只保存 `id`、唯一的 `entryId` 和 `createdAt`，通过 relation 读取 headword、dictionary 等 entry 数据，不重复存储这些字段。删除 DictionaryEntry 时关联收藏由外键级联删除。

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
│   ├── vocabulary/
│   │   └── vocabulary-service.ts
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
- 搜索历史和分页 UI。
- AI 功能。
- 发音播放。
- 独立、可重复创建的 PostgreSQL test database fixture。
- Nginx、Docker 和正式 deployment 配置。
- Production logging、metrics、rate limiting 和 API/docs access policy。

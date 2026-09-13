# Ollama runtime performance benchmark

## Historical short-prompt run (`hi`; num_ctx not explicitly requested)

- Measured at: 2026-09-12T19:42:24.385Z
- Base URL: `http://192.168.0.100:11435`
- Prompt: `hi`
- Thinking: explicitly disabled with `think: false`
- Sampling: `temperature: 0`, `num_predict: 64`
- Per model: 1 warm-up request(s), then 3 measured request(s)
- Durations are Ollama-reported nanoseconds; rates are calculated tokens/second.
- This runtime benchmark is separate from GPU memory and context measurements.

### Summary

| Model | Status | Avg prompt eval token/s | Median prompt eval token/s | Avg eval token/s | Median eval token/s |
|---|---|---:|---:|---:|---:|
| `qwen38-27b-iq3s` | measured | 114.81 | 113.72 | 52.69 | 52.84 |
| `qwen38-27b-iq3s-40k` | measured | 121.20 | 119.42 | 53.87 | 53.97 |
| `qwen38-27b-iq3s-48k` | measured | 121.23 | 119.51 | 54.06 | 54.11 |
| `qwen38-27b-iq3s-64k` | measured | 119.28 | 118.14 | 53.73 | 53.69 |
| `qwen38-27b-iq3s-96k` | measured | 118.92 | 116.04 | 53.62 | 53.58 |
| `qwen38-27b-iq3s-128k` | measured | 118.79 | 118.36 | 53.72 | 53.67 |

### Measured requests

| Model | Run | total_duration ns | load_duration ns | prompt_eval_count | prompt_eval_duration ns | Prompt eval token/s | eval_count | eval_duration ns | Eval token/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `qwen38-27b-iq3s` | 1 | 312287400 | 3443300 | 13 | 109951000 | 118.23 | 10 | 192778000 | 51.87 |
| `qwen38-27b-iq3s` | 2 | 314216700 | 3734000 | 13 | 115595000 | 112.46 | 10 | 189267000 | 52.84 |
| `qwen38-27b-iq3s` | 3 | 311572200 | 3999200 | 13 | 114316000 | 113.72 | 10 | 187412000 | 53.36 |
| `qwen38-27b-iq3s-40k` | 1 | 297014700 | 2992600 | 13 | 102995000 | 126.22 | 10 | 186341000 | 53.67 |
| `qwen38-27b-iq3s-40k` | 2 | 300010700 | 1492700 | 13 | 110197000 | 117.97 | 10 | 185265000 | 53.98 |
| `qwen38-27b-iq3s-40k` | 3 | 299091200 | 2000300 | 13 | 108856000 | 119.42 | 10 | 185292000 | 53.97 |
| `qwen38-27b-iq3s-48k` | 1 | 295535400 | 2000800 | 13 | 103571000 | 125.52 | 10 | 184813000 | 54.11 |
| `qwen38-27b-iq3s-48k` | 2 | 296424200 | 1508200 | 13 | 108779000 | 119.51 | 10 | 183687000 | 54.44 |
| `qwen38-27b-iq3s-48k` | 3 | 302756300 | 1638500 | 13 | 109544000 | 118.67 | 10 | 186439000 | 53.64 |
| `qwen38-27b-iq3s-64k` | 1 | 298632800 | 3984700 | 13 | 103402000 | 125.72 | 10 | 186312000 | 53.67 |
| `qwen38-27b-iq3s-64k` | 2 | 304775300 | 2999700 | 13 | 110043000 | 118.14 | 10 | 186249000 | 53.69 |
| `qwen38-27b-iq3s-64k` | 3 | 308104300 | 3380300 | 13 | 114062000 | 113.97 | 10 | 185755000 | 53.83 |
| `qwen38-27b-iq3s-96k` | 1 | 296247300 | 1993600 | 13 | 103424000 | 125.70 | 10 | 186845000 | 53.52 |
| `qwen38-27b-iq3s-96k` | 2 | 306178100 | 2599000 | 13 | 112031000 | 116.04 | 10 | 186653000 | 53.58 |
| `qwen38-27b-iq3s-96k` | 3 | 307044400 | 3000300 | 13 | 113015000 | 115.03 | 10 | 185949000 | 53.78 |
| `qwen38-27b-iq3s-128k` | 1 | 304509100 | 5612500 | 13 | 107741000 | 120.66 | 10 | 186507000 | 53.62 |
| `qwen38-27b-iq3s-128k` | 2 | 303948100 | 3500000 | 13 | 109838000 | 118.36 | 10 | 185573000 | 53.89 |
| `qwen38-27b-iq3s-128k` | 3 | 310386100 | 6828300 | 13 | 110775000 | 117.35 | 10 | 186336000 | 53.67 |

## Context-verified 80-word-prompt run — 2026-09-12T19:47:53.941Z

- Base URL: `http://192.168.0.100:11435`
- Prompt: `Write exactly 80 words describing a quiet morning in simple English. Do not use bullet points.`
- Thinking: explicitly disabled with `think: false`
- Request settings: `stream: false`, `think: false`, `temperature: 0`, `num_predict: 64`, and the per-model `options.num_ctx` shown below
- Per model: 1 warm-up request(s), then 3 measured request(s)
- Durations are Ollama-reported nanoseconds; rates are calculated tokens/second.
- This runtime benchmark is separate from GPU memory and context measurements.

### Summary

| Model | Requested num_ctx | Status | Avg prompt eval token/s | Median prompt eval token/s | Avg eval token/s | Median eval token/s |
|---|---:|---|---:|---:|---:|---:|
| `qwen38-27b-iq3s` | 4096 | measured | 357.54 | 356.39 | 54.12 | 54.12 |
| `qwen38-27b-iq3s-40k` | 40960 | measured | 345.14 | 336.52 | 53.26 | 53.34 |
| `qwen38-27b-iq3s-48k` | 49152 | measured | 351.70 | 352.52 | 53.14 | 53.42 |
| `qwen38-27b-iq3s-64k` | 65536 | measured | 332.23 | 331.83 | 52.76 | 52.61 |
| `qwen38-27b-iq3s-96k` | 98304 | measured | 350.65 | 351.24 | 52.92 | 52.92 |
| `qwen38-27b-iq3s-128k` | 131072 | measured | 347.15 | 347.11 | 52.94 | 52.94 |

### Measured requests

| Model | Requested num_ctx | Run | total_duration ns | load_duration ns | prompt_eval_count | prompt_eval_duration ns | Prompt eval token/s | eval_count | eval_duration ns | Eval token/s | Output token count |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `qwen38-27b-iq3s` | 4096 | 1 | 1334373100 | 2000000 | 32 | 87343000 | 366.37 | 64 | 1182566000 | 54.12 | 64 |
| `qwen38-27b-iq3s` | 4096 | 2 | 1275492700 | 1510200 | 32 | 91466000 | 349.86 | 64 | 1179601000 | 54.26 | 64 |
| `qwen38-27b-iq3s` | 4096 | 3 | 1279713700 | 1531100 | 32 | 89789000 | 356.39 | 64 | 1185804000 | 53.97 | 64 |
| `qwen38-27b-iq3s-40k` | 40960 | 1 | 1363054800 | 1687400 | 32 | 86636000 | 369.36 | 64 | 1209575000 | 52.91 | 64 |
| `qwen38-27b-iq3s-40k` | 40960 | 2 | 1299480300 | 1608000 | 32 | 95090000 | 336.52 | 64 | 1199941000 | 53.34 | 64 |
| `qwen38-27b-iq3s-40k` | 40960 | 3 | 1297354900 | 1499700 | 32 | 97107000 | 329.53 | 64 | 1195710000 | 53.52 | 64 |
| `qwen38-27b-iq3s-48k` | 49152 | 1 | 1346916200 | 1992200 | 32 | 85348000 | 374.94 | 64 | 1197840000 | 53.43 | 64 |
| `qwen38-27b-iq3s-48k` | 49152 | 2 | 1300164500 | 2001600 | 32 | 97664000 | 327.65 | 64 | 1198094000 | 53.42 | 64 |
| `qwen38-27b-iq3s-48k` | 49152 | 3 | 1312409000 | 1501000 | 32 | 90775000 | 352.52 | 64 | 1217459000 | 52.57 | 64 |
| `qwen38-27b-iq3s-64k` | 65536 | 1 | 1385146300 | 1501900 | 32 | 94035000 | 340.30 | 64 | 1216601000 | 52.61 | 64 |
| `qwen38-27b-iq3s-64k` | 65536 | 2 | 1306527900 | 4994600 | 32 | 96435000 | 331.83 | 64 | 1201390000 | 53.27 | 64 |
| `qwen38-27b-iq3s-64k` | 65536 | 3 | 1325517100 | 1509200 | 32 | 98599000 | 324.55 | 64 | 1221583000 | 52.39 | 64 |
| `qwen38-27b-iq3s-96k` | 98304 | 1 | 1359791000 | 1501900 | 32 | 90281000 | 354.45 | 64 | 1203023000 | 53.20 | 64 |
| `qwen38-27b-iq3s-96k` | 98304 | 2 | 1309711100 | 3998100 | 32 | 91106000 | 351.24 | 64 | 1209402000 | 52.92 | 64 |
| `qwen38-27b-iq3s-96k` | 98304 | 3 | 1312323300 | 1506300 | 32 | 92414000 | 346.27 | 64 | 1215764000 | 52.64 | 64 |
| `qwen38-27b-iq3s-128k` | 131072 | 1 | 1369758100 | 2007900 | 32 | 93296000 | 342.99 | 64 | 1204576000 | 53.13 | 64 |
| `qwen38-27b-iq3s-128k` | 131072 | 2 | 1309605900 | 1698600 | 32 | 92189000 | 347.11 | 64 | 1213021000 | 52.76 | 64 |
| `qwen38-27b-iq3s-128k` | 131072 | 3 | 1304250500 | 1499900 | 32 | 91078000 | 351.35 | 64 | 1208926000 | 52.94 | 64 |

## Decode speed vs populated context — 2026-09-12T20:35:46.906Z

- Model: `qwen38-27b-iq3s-128k:latest`
- Base URL: `http://192.168.0.100:11435`
- Requested context: `options.num_ctx: 131072`
- Generation: `stream: false`, `think: false`, `temperature: 0`, `seed: 0`, `num_predict: 64`
- Each iteration uses deterministic filler with a distinct leading marker and `keep_alive: 0`; the runner is unloaded after every request to avoid prompt-cache reuse and provide fresh request state.
- Target prompt sizes are approximate. `prompt_eval_count` is the actual Ollama-reported token count.
- Durations are Ollama-reported nanoseconds; rates are calculated tokens/second.

| Target prompt size | Iteration | Actual prompt_eval_count | Prompt eval token/s | eval_count | Eval token/s | total_duration ns |
|---:|---:|---:|---:|---:|---:|---:|
| 1K | 1 | 1027 | 1237.74 | 64 | 53.58 | 5944887800 |
| 1K | 2 | 1028 | 1243.54 | 52 | 53.33 | 5704176400 |
| 1K | 3 | 1028 | 1247.05 | 64 | 53.23 | 6004112600 |
| 8K | 1 | 8195 | 1638.92 | 30 | 50.59 | 9593277400 |
| 8K | 2 | 8196 | 1641.51 | 45 | 50.34 | 9885560300 |
| 8K | 3 | 8196 | 1637.51 | 64 | 49.90 | 10301498500 |
| 16K | 1 | 16388 | 1619.36 | 30 | 47.77 | 14730791300 |
| 16K | 2 | 16389 | 1616.62 | 45 | 47.69 | 15010467800 |
| 16K | 3 | 16389 | 1617.88 | 54 | 47.87 | 15420511000 |
| 32K | 1 | 32772 | 1434.13 | 45 | 44.30 | 28108087800 |
| 32K | 2 | 32773 | 1412.68 | 49 | 44.28 | 28389780700 |
| 32K | 3 | 32773 | 1430.24 | 64 | 44.15 | 28378384300 |
| 64K | 1 | 65540 | 1132.12 | 64 | 37.87 | 63689883600 |
| 64K | 2 | 65541 | 1131.42 | 29 | 38.08 | 62842927400 |
| 64K | 3 | 65541 | 1132.13 | 64 | 37.86 | 63740941400 |
| 96K | 1 | 98308 | 937.05 | 64 | 32.90 | 111346015400 |
| 96K | 2 | 98309 | 943.11 | 64 | 32.85 | 110452298400 |
| 96K | 3 | 98309 | 942.99 | 64 | 32.92 | 110429659600 |
| 120K | 1 | 122885 | 840.73 | 64 | 30.01 | 152912250100 |
| 120K | 2 | 122886 | 836.84 | 53 | 30.16 | 152946971200 |
| 120K | 3 | 122886 | 840.72 | 64 | 29.89 | 152870908900 |

## 96K populated-context performance — 2026-09-12T21:06:40.404Z

- Model: `qwen38-27b-iq3s-96k:latest`
- Base URL: `http://192.168.0.100:11435`
- Requested context: `options.num_ctx: 98304`
- Generation: `stream: false`, `think: false`, `temperature: 0`, `seed: 0`, `num_predict: 64`
- Each iteration uses deterministic filler with a distinct leading marker and `keep_alive: 0`; the runner is unloaded after every request to avoid prompt-cache reuse and provide fresh request state.
- Target prompt sizes are approximate. `prompt_eval_count` is the actual Ollama-reported token count.
- Durations are Ollama-reported nanoseconds; rates are calculated tokens/second.

| Target prompt size | Iteration | Actual prompt_eval_count | Prompt eval token/s | eval_count | Eval token/s | total_duration ns |
|---:|---:|---:|---:|---:|---:|---:|
| 1K | 1 | 1027 | 1254.13 | 64 | 52.60 | 6695093900 |
| 1K | 2 | 1028 | 1252.55 | 52 | 53.34 | 6541730900 |
| 1K | 3 | 1028 | 1256.81 | 64 | 53.29 | 5918826300 |
| 8K | 1 | 8195 | 1644.61 | 30 | 50.49 | 9575219100 |
| 8K | 2 | 8196 | 1639.03 | 45 | 50.71 | 9846895900 |
| 8K | 3 | 8196 | 1638.57 | 64 | 50.49 | 10268872400 |
| 16K | 1 | 16388 | 1618.71 | 30 | 48.22 | 14770487800 |
| 16K | 2 | 16389 | 1619.81 | 45 | 48.28 | 15076838400 |
| 16K | 3 | 16389 | 1617.92 | 54 | 48.24 | 15276081100 |
| 32K | 1 | 32772 | 1433.34 | 45 | 43.95 | 27995117600 |
| 32K | 2 | 32773 | 1432.69 | 49 | 43.82 | 28001497500 |
| 32K | 3 | 32773 | 1431.77 | 64 | 44.16 | 28318028700 |
| 64K | 1 | 65540 | 1131.69 | 64 | 37.74 | 64027039700 |
| 64K | 2 | 65541 | 1126.87 | 29 | 38.10 | 63125079500 |
| 64K | 3 | 65541 | 1139.24 | 64 | 38.02 | 63387391400 |
| 80K | 1 | 81924 | 1036.30 | 64 | 35.39 | 85039273400 |
| 80K | 2 | 81925 | 1036.14 | 64 | 35.25 | 85105106200 |
| 80K | 3 | 81925 | 1036.36 | 47 | 35.46 | 84520259400 |
| 90K | 1 | 92164 | 980.92 | 64 | 33.89 | 100031817500 |
| 90K | 2 | 92165 | 980.99 | 47 | 33.97 | 99538386900 |
| 90K | 3 | 92165 | 981.10 | 64 | 33.87 | 100017018900 |

### 96K vs existing 128K decode comparison

Each average uses the three recorded iterations. Difference is `96K model − 128K model`; percentage difference uses the existing 128K average as the denominator.

| Populated context | 96K avg decode token/s | 128K avg decode token/s | Absolute difference | Percentage difference |
|---:|---:|---:|---:|---:|
| 1K | 53.08 | 53.38 | -0.30 | -0.57% |
| 8K | 50.56 | 50.28 | +0.29 | +0.57% |
| 16K | 48.25 | 47.78 | +0.47 | +0.98% |
| 32K | 43.98 | 44.24 | -0.27 | -0.60% |
| 64K | 37.95 | 37.94 | +0.02 | +0.04% |

## 96K streaming / TTFT benchmark — 2026-09-12T22:22:15.895Z

- Model: `qwen38-27b-iq3s-96k:latest`
- Base URL: `http://192.168.0.100:11435`
- Requested context: `options.num_ctx: 98304`
- Generation: `stream: true`, `think: false`, `temperature: 0`, `seed: 0`, `num_predict: 64`, `keep_alive: 0`
- TTFT is wall-clock milliseconds from request start to the first streamed chunk containing non-empty `response` text. Empty and metadata-only chunks are ignored.
- Each iteration uses deterministic filler with a distinct leading marker; unloading after every request avoids prompt-cache reuse.

| Target prompt size | Iteration | Actual prompt tokens | TTFT ms | Prompt eval token/s | Actual eval_count | Eval token/s | Total wall ms |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1K | 1 | 1027 | 4774.35 | 1235.46 | 64 | 52.76 | 5979.63 |
| 1K | 2 | 1028 | 5141.43 | 1264.13 | 52 | 53.35 | 6079.94 |
| 1K | 3 | 1028 | 4809.74 | 1257.60 | 64 | 53.29 | 6014.11 |
| 8K | 1 | 8195 | 9024.27 | 1651.61 | 30 | 50.47 | 9586.58 |
| 8K | 2 | 8196 | 9055.98 | 1652.64 | 45 | 50.38 | 9895.85 |
| 8K | 3 | 8196 | 9206.25 | 1652.32 | 64 | 50.23 | 10502.66 |
| 16K | 1 | 16388 | 14150.03 | 1631.59 | 30 | 48.39 | 14795.86 |
| 16K | 2 | 16389 | 14096.45 | 1628.37 | 45 | 48.29 | 15066.59 |
| 16K | 3 | 16389 | 14184.07 | 1631.45 | 54 | 48.10 | 15249.14 |
| 32K | 1 | 32772 | 27088.93 | 1442.47 | 45 | 44.41 | 28167.57 |
| 32K | 2 | 32773 | 26868.33 | 1441.73 | 49 | 44.50 | 27963.82 |
| 32K | 3 | 32773 | 26854.31 | 1440.25 | 64 | 44.32 | 28338.25 |
| 64K | 1 | 65540 | 61685.59 | 1140.08 | 64 | 37.94 | 63494.04 |
| 64K | 2 | 65541 | 64569.21 | 1090.20 | 29 | 37.29 | 65529.70 |
| 64K | 3 | 65541 | 63775.18 | 1104.80 | 64 | 36.79 | 65670.58 |
| 80K | 1 | 81924 | 86067.68 | 1004.21 | 64 | 34.41 | 88085.97 |
| 80K | 2 | 81925 | 86161.14 | 1004.48 | 64 | 34.41 | 88085.74 |
| 80K | 3 | 81925 | 86040.34 | 1004.83 | 47 | 34.60 | 87566.84 |
| 90K | 1 | 92164 | 101024.53 | 955.24 | 64 | 33.83 | 103093.40 |
| 90K | 2 | 92165 | 98202.50 | 980.71 | 47 | 33.78 | 99782.46 |
| 90K | 3 | 92165 | 98531.88 | 981.44 | 64 | 33.82 | 100580.30 |

## 128K streaming / TTFT benchmark — 2026-09-12T22:22:15.900Z

- Model: `qwen38-27b-iq3s-128k:latest`
- Base URL: `http://192.168.0.100:11435`
- Requested context: `options.num_ctx: 131072`
- Generation: `stream: true`, `think: false`, `temperature: 0`, `seed: 0`, `num_predict: 64`, `keep_alive: 0`
- TTFT is wall-clock milliseconds from request start to the first streamed chunk containing non-empty `response` text. Empty and metadata-only chunks are ignored.
- Each iteration uses deterministic filler with a distinct leading marker; unloading after every request avoids prompt-cache reuse.

| Target prompt size | Iteration | Actual prompt tokens | TTFT ms | Prompt eval token/s | Actual eval_count | Eval token/s | Total wall ms |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1K | 1 | 1027 | 5367.73 | 1255.47 | 64 | 52.71 | 6581.70 |
| 1K | 2 | 1028 | 5368.98 | 1236.84 | 52 | 52.82 | 6355.83 |
| 1K | 3 | 1028 | 5389.82 | 1240.04 | 64 | 52.52 | 6598.23 |
| 8K | 1 | 8195 | 9645.45 | 1648.42 | 30 | 50.27 | 10165.78 |
| 8K | 2 | 8196 | 9530.50 | 1651.80 | 45 | 50.18 | 10468.14 |
| 8K | 3 | 8196 | 9576.41 | 1646.64 | 64 | 50.29 | 10840.96 |
| 16K | 1 | 16388 | 14716.43 | 1626.43 | 30 | 48.03 | 15349.11 |
| 16K | 2 | 16389 | 14720.86 | 1623.12 | 45 | 47.77 | 15670.31 |
| 16K | 3 | 16389 | 14713.84 | 1622.63 | 54 | 47.86 | 15850.03 |
| 32K | 1 | 32772 | 27404.02 | 1440.89 | 45 | 44.32 | 28498.90 |
| 32K | 2 | 32773 | 27286.46 | 1436.26 | 49 | 44.14 | 28398.14 |
| 32K | 3 | 32773 | 27756.27 | 1434.83 | 64 | 43.88 | 29281.93 |
| 64K | 1 | 65540 | 62359.51 | 1138.14 | 64 | 37.92 | 64134.60 |
| 64K | 2 | 65541 | 61987.65 | 1139.29 | 29 | 38.22 | 62911.31 |
| 64K | 3 | 65541 | 62057.87 | 1139.82 | 64 | 37.92 | 63804.93 |
| 96K | 1 | 98308 | 107932.92 | 951.01 | 64 | 33.02 | 110085.82 |
| 96K | 2 | 98309 | 107966.79 | 950.54 | 64 | 32.97 | 110091.12 |
| 96K | 3 | 98309 | 107928.46 | 950.82 | 64 | 33.09 | 110075.71 |
| 120K | 1 | 122885 | 149721.06 | 847.31 | 64 | 30.09 | 152887.68 |
| 120K | 2 | 122886 | 149713.28 | 847.10 | 53 | 30.25 | 151793.73 |
| 120K | 3 | 122886 | 149715.59 | 846.96 | 64 | 30.20 | 152071.22 |

## 96K vs 128K streaming comparison

Each value is the arithmetic mean of the three independent streaming measurements above.

| Populated context | 96K avg TTFT ms | 128K avg TTFT ms | 96K avg decode token/s | 128K avg decode token/s |
|---:|---:|---:|---:|---:|
| 1K | 4908.51 | 5375.51 | 53.13 | 52.68 |
| 8K | 9095.50 | 9584.12 | 50.36 | 50.25 |
| 16K | 14143.52 | 14717.04 | 48.26 | 47.89 |
| 32K | 26937.19 | 27482.25 | 44.41 | 44.11 |
| 64K | 63343.33 | 62135.01 | 37.34 | 38.02 |

## 96K warm streaming / TTFT benchmark — 2026-09-12T23:13:21.013Z

- Model: `qwen38-27b-iq3s-96k:latest`
- Base URL: `http://192.168.0.100:11435`
- Requested context: `options.num_ctx: 98304`
- Generation: `stream: true`, `think: false`, `temperature: 0`, `seed: 0`, `num_predict: 64`, `keep_alive: 30m`
- One warm-up request was issued first, and the loaded runner was confirmed through `/api/ps` before measurement.
- Measured requests use deterministic filler with distinct leading markers and do not unload the runner between requests.
- TTFT ignores empty and metadata-only chunks and stops at the first chunk containing non-empty generated `response` text.

| Target prompt size | Iteration | Actual prompt tokens | TTFT ms | Prompt eval token/s | Actual eval_count | Eval token/s | Total wall ms | load_duration ns |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1K | 1 | 1034 | 842.32 | 1474.70 | 64 | 34.55 | 2696.42 | 2130800 |
| 1K | 2 | 1035 | 912.26 | 1412.06 | 47 | 48.84 | 1856.49 | 3000100 |
| 1K | 3 | 1035 | 1000.58 | 1340.25 | 64 | 48.68 | 2243.84 | 3001200 |
| 8K | 1 | 8202 | 5286.88 | 1602.60 | 48 | 47.72 | 6314.71 | 11344900 |
| 8K | 2 | 8203 | 5236.29 | 1658.11 | 52 | 50.38 | 6252.96 | 14870100 |
| 8K | 3 | 8203 | 5103.21 | 1674.35 | 64 | 50.10 | 6397.94 | 15972500 |
| 16K | 1 | 16395 | 10397.74 | 1631.44 | 30 | 48.39 | 10958.71 | 16507600 |
| 16K | 2 | 16396 | 10538.41 | 1601.89 | 45 | 48.06 | 11517.22 | 23753800 |
| 16K | 3 | 16396 | 10441.15 | 1623.49 | 54 | 46.80 | 11600.88 | 19915800 |
| 32K | 1 | 32779 | 23183.57 | 1436.65 | 30 | 44.82 | 23923.46 | 25421900 |
| 32K | 2 | 32780 | 23272.16 | 1437.12 | 31 | 44.63 | 24035.15 | 26998600 |
| 32K | 3 | 32780 | 23464.83 | 1435.80 | 49 | 44.52 | 24456.78 | 26678900 |
| 64K | 1 | 65547 | 58480.10 | 1133.22 | 64 | 37.90 | 60347.69 | 38006700 |
| 64K | 2 | 65548 | 58756.97 | 1133.32 | 55 | 38.05 | 60297.07 | 28616300 |
| 64K | 3 | 65548 | 58760.33 | 1132.65 | 64 | 37.95 | 60599.70 | 29447800 |
| 80K | 1 | 81931 | 80506.67 | 1029.67 | 48 | 35.47 | 81993.01 | 38624100 |
| 80K | 2 | 81932 | 81516.86 | 1017.82 | 64 | 35.12 | 83511.26 | 26792400 |
| 80K | 3 | 81932 | 81046.73 | 1026.01 | 64 | 34.32 | 82984.76 | 37534800 |
| 90K | 1 | 92171 | 95727.66 | 973.16 | 59 | 33.92 | 97659.19 | 49090000 |
| 90K | 2 | 92172 | 95745.98 | 973.28 | 64 | 33.66 | 97851.35 | 42455600 |
| 90K | 3 | 92172 | 95795.96 | 973.11 | 49 | 28.40 | 97745.11 | 42625700 |

## 128K warm streaming / TTFT benchmark — 2026-09-12T23:13:21.016Z

- Model: `qwen38-27b-iq3s-128k:latest`
- Base URL: `http://192.168.0.100:11435`
- Requested context: `options.num_ctx: 131072`
- Generation: `stream: true`, `think: false`, `temperature: 0`, `seed: 0`, `num_predict: 64`, `keep_alive: 30m`
- One warm-up request was issued first, and the loaded runner was confirmed through `/api/ps` before measurement.
- Measured requests use deterministic filler with distinct leading markers and do not unload the runner between requests.
- TTFT ignores empty and metadata-only chunks and stops at the first chunk containing non-empty generated `response` text.

| Target prompt size | Iteration | Actual prompt tokens | TTFT ms | Prompt eval token/s | Actual eval_count | Eval token/s | Total wall ms | load_duration ns |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1K | 1 | 1035 | 810.80 | 1464.10 | 64 | 53.41 | 2012.18 | 1625500 |
| 1K | 2 | 1036 | 811.46 | 1457.50 | 52 | 53.39 | 1788.48 | 1499500 |
| 1K | 3 | 1036 | 839.34 | 1485.19 | 64 | 53.34 | 2005.66 | 2000000 |
| 8K | 1 | 8203 | 4997.49 | 1682.11 | 64 | 51.24 | 6265.43 | 9522000 |
| 8K | 2 | 8204 | 5059.31 | 1677.94 | 64 | 50.97 | 6323.01 | 10506000 |
| 8K | 3 | 8204 | 5184.61 | 1677.95 | 64 | 50.95 | 6354.15 | 9709900 |
| 16K | 1 | 16396 | 10200.23 | 1636.07 | 30 | 49.22 | 10848.74 | 19585200 |
| 16K | 2 | 16397 | 10309.13 | 1637.12 | 31 | 49.18 | 10922.02 | 19102800 |
| 16K | 3 | 16397 | 10328.36 | 1634.86 | 54 | 48.65 | 11391.02 | 15499600 |
| 32K | 1 | 32780 | 23005.16 | 1443.48 | 48 | 44.78 | 24174.25 | 28971700 |
| 32K | 2 | 32781 | 23082.90 | 1443.78 | 45 | 44.79 | 24173.86 | 25616400 |
| 32K | 3 | 32781 | 23068.93 | 1444.98 | 49 | 44.91 | 24217.99 | 25570800 |
| 64K | 1 | 65548 | 58027.76 | 1141.36 | 48 | 38.40 | 59328.93 | 33679300 |
| 64K | 2 | 65549 | 58115.46 | 1141.15 | 51 | 38.12 | 59582.73 | 36431200 |
| 64K | 3 | 65549 | 58152.72 | 1140.99 | 64 | 38.14 | 59973.12 | 31398200 |
| 96K | 1 | 98316 | 106542.97 | 930.35 | 64 | 33.10 | 108593.14 | 37009600 |
| 96K | 2 | 98317 | 105769.35 | 938.44 | 49 | 33.14 | 107429.36 | 42811000 |
| 96K | 3 | 98317 | 105038.40 | 944.58 | 49 | 31.89 | 106793.50 | 36888800 |
| 120K | 1 | 122893 | 148538.49 | 833.68 | 64 | 30.19 | 150861.78 | 41023300 |
| 120K | 2 | 122894 | 147273.00 | 841.37 | 43 | 29.82 | 149034.87 | 47353900 |
| 120K | 3 | 122894 | 147533.87 | 839.59 | 64 | 30.10 | 149899.02 | 42130800 |

## 96K cold vs warm TTFT comparison

Positive reduction means the warm-runner TTFT was lower. Each value averages three measurements.

| Populated context | Cold avg TTFT ms | Warm avg TTFT ms | Absolute reduction ms | Percentage reduction |
|---:|---:|---:|---:|---:|
| 1K | 4908.51 | 918.39 | 3990.12 | 81.29% |
| 8K | 9095.50 | 5208.79 | 3886.71 | 42.73% |
| 16K | 14143.52 | 10459.10 | 3684.42 | 26.05% |
| 32K | 26937.19 | 23306.85 | 3630.34 | 13.48% |
| 64K | 63343.33 | 58665.80 | 4677.53 | 7.38% |
| 80K | 86089.72 | 81023.42 | 5066.30 | 5.88% |
| 90K | 99252.97 | 95756.53 | 3496.44 | 3.52% |

## 128K cold vs warm TTFT comparison

Positive reduction means the warm-runner TTFT was lower. Each value averages three measurements.

| Populated context | Cold avg TTFT ms | Warm avg TTFT ms | Absolute reduction ms | Percentage reduction |
|---:|---:|---:|---:|---:|
| 1K | 5375.51 | 820.53 | 4554.98 | 84.74% |
| 8K | 9584.12 | 5080.47 | 4503.65 | 46.99% |
| 16K | 14717.04 | 10279.24 | 4437.80 | 30.15% |
| 32K | 27482.25 | 23052.33 | 4429.92 | 16.12% |
| 64K | 62135.01 | 58098.64 | 4036.37 | 6.50% |
| 96K | 107942.72 | 105783.57 | 2159.15 | 2.00% |
| 120K | 149716.64 | 147781.79 | 1934.86 | 1.29% |

## Warm 96K vs 128K streaming comparison

Each value averages three independent warm-runner measurements.

| Populated context | 96K avg TTFT ms | 128K avg TTFT ms | 96K avg decode token/s | 128K avg decode token/s |
|---:|---:|---:|---:|---:|
| 1K | 918.39 | 820.53 | 44.03 | 53.38 |
| 8K | 5208.79 | 5080.47 | 49.40 | 51.05 |
| 16K | 10459.10 | 10279.24 | 47.75 | 49.01 |
| 32K | 23306.85 | 23052.33 | 44.66 | 44.83 |
| 64K | 58665.80 | 58098.64 | 37.97 | 38.22 |

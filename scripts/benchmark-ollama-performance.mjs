#!/usr/bin/env node

import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_MODELS = [
  'qwen38-27b-iq3s',
  'qwen38-27b-iq3s-40k',
  'qwen38-27b-iq3s-48k',
  'qwen38-27b-iq3s-64k',
  'qwen38-27b-iq3s-96k',
  'qwen38-27b-iq3s-128k',
];

const MODEL_CONTEXTS = new Map([
  ['qwen38-27b-iq3s', 4096],
  ['qwen38-27b-iq3s-40k', 40960],
  ['qwen38-27b-iq3s-48k', 49152],
  ['qwen38-27b-iq3s-64k', 65536],
  ['qwen38-27b-iq3s-96k', 98304],
  ['qwen38-27b-iq3s-128k', 131072],
]);

const DEFAULT_PROMPT = 'Write exactly 80 words describing a quiet morning in simple English. Do not use bullet points.';
const POPULATED_CONTEXT_LABELS = new Map([
  [1024, '1K'],
  [8192, '8K'],
  [16384, '16K'],
  [32768, '32K'],
  [65536, '64K'],
  [81920, '80K'],
  [92160, '90K'],
  [98304, '96K'],
  [122880, '120K'],
]);
const POPULATED_CONTEXT_EXPERIMENTS = {
  '128k': {
    model: 'qwen38-27b-iq3s-128k',
    numCtx: 131072,
    sizes: [1024, 8192, 16384, 32768, 65536, 98304, 122880],
    title: 'Decode speed vs populated context',
  },
  '96k': {
    model: 'qwen38-27b-iq3s-96k',
    numCtx: 98304,
    sizes: [1024, 8192, 16384, 32768, 65536, 81920, 92160],
    title: '96K populated-context performance',
  },
};

const defaults = {
  baseUrl: process.env.OLLAMA_BENCH_BASE_URL ?? 'http://192.168.0.100:11435',
  models: splitModels(process.env.OLLAMA_BENCH_MODELS) ?? DEFAULT_MODELS,
  output: process.env.OLLAMA_BENCH_OUTPUT ?? 'benchmarks/ollama-runtime-performance.md',
  prompt: process.env.OLLAMA_BENCH_PROMPT ?? DEFAULT_PROMPT,
  warmups: integerFromEnvironment('OLLAMA_BENCH_WARMUPS', 1),
  runs: integerFromEnvironment('OLLAMA_BENCH_RUNS', 3),
  timeoutMs: integerFromEnvironment('OLLAMA_BENCH_TIMEOUT_MS', 120_000),
  populatedContext: null,
  streamingTtft: false,
  warmStreamingTtft: false,
};

const config = parseArguments(process.argv.slice(2), defaults);
const baseUrl = parseBaseUrl(config.baseUrl);

if (config.populatedContext) {
  await runPopulatedContextBenchmark(config, baseUrl);
  process.exit(0);
}

if (config.streamingTtft) {
  await runStreamingTtftBenchmark(config, baseUrl);
  process.exit(0);
}

if (config.warmStreamingTtft) {
  await runWarmStreamingTtftBenchmark(config, baseUrl);
  process.exit(0);
}

console.log(`Discovering models at ${baseUrl}`);
const availableModels = await listModels(baseUrl, config.timeoutMs);
const resolvedModels = config.models.map((requested) => ({
  requested,
  resolved: resolveModel(requested, availableModels),
  numCtx: contextForModel(requested),
}));

const results = [];
for (const model of resolvedModels) {
  if (!model.resolved) {
    console.log(`Skipping unavailable model: ${model.requested}`);
    results.push({ ...model, status: 'unavailable', measurements: [] });
    continue;
  }

  console.log(`Benchmarking model=${model.resolved} requested_num_ctx=${model.numCtx}: ${config.warmups} warm-up, ${config.runs} measured`);
  try {
    for (let run = 0; run < config.warmups; run += 1) {
      await generate(baseUrl, model.resolved, model.numCtx, config.prompt, config.timeoutMs);
    }

    const measurements = [];
    for (let run = 1; run <= config.runs; run += 1) {
      const response = await generate(baseUrl, model.resolved, model.numCtx, config.prompt, config.timeoutMs);
      measurements.push(toMeasurement(run, model.numCtx, response));
    }
    results.push({ ...model, status: 'measured', measurements });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed ${model.resolved}: ${message}`);
    results.push({ ...model, status: `failed: ${message}`, measurements: [] });
  }
}

const outputPath = path.resolve(config.output);
await writeBenchmarkReport(outputPath, renderMarkdown(config, baseUrl, results));
console.log(`Wrote ${outputPath}`);

function parseArguments(args, initial) {
  const parsed = { ...initial, models: [...initial.models] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      printHelp();
      process.exit(0);
    }
    const [name, inlineValue] = argument.split('=', 2);
    if (name === '--populated-context') {
      parsed.populatedContext = '128k';
      continue;
    }
    if (name === '--populated-context-96k') {
      parsed.populatedContext = '96k';
      continue;
    }
    if (name === '--streaming-ttft') {
      parsed.streamingTtft = true;
      continue;
    }
    if (name === '--streaming-ttft-warm') {
      parsed.warmStreamingTtft = true;
      continue;
    }
    const value = inlineValue ?? args[++index];
    if (value === undefined) throw new Error(`Missing value for ${name}`);
    if (name === '--base-url') parsed.baseUrl = value;
    else if (name === '--models') parsed.models = requireModels(value);
    else if (name === '--output') parsed.output = value;
    else if (name === '--prompt') parsed.prompt = value;
    else if (name === '--warmups') parsed.warmups = positiveInteger(value, name);
    else if (name === '--runs') parsed.runs = positiveInteger(value, name);
    else if (name === '--timeout-ms') parsed.timeoutMs = positiveInteger(value, name);
    else throw new Error(`Unknown argument: ${name}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/benchmark-ollama-performance.mjs [options]

Options:
  --base-url URL       Ollama base URL
  --models A,B,C       Comma-separated model names
  --output PATH        Markdown output path
  --prompt TEXT        Identical prompt for every request
  --warmups N          Warm-up requests per model (default: 1)
  --runs N             Measured requests per model (default: 3)
  --timeout-ms N       Per-request timeout (default: 120000)
  --populated-context  Run the 128K decode-speed-vs-populated-context experiment
  --populated-context-96k
                       Run the 96K decode-speed-vs-populated-context experiment
  --streaming-ttft     Run 96K and 128K streaming populated-context TTFT experiments
  --streaming-ttft-warm
                       Run warm 96K and 128K streaming TTFT experiments

Environment equivalents:
  OLLAMA_BENCH_BASE_URL, OLLAMA_BENCH_MODELS, OLLAMA_BENCH_OUTPUT,
  OLLAMA_BENCH_PROMPT, OLLAMA_BENCH_WARMUPS, OLLAMA_BENCH_RUNS,
  OLLAMA_BENCH_TIMEOUT_MS`);
}

async function listModels(url, timeoutMs) {
  const response = await fetch(new URL('api/tags', url), { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Model discovery returned HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.models)) throw new Error('Model discovery returned an invalid response');
  return body.models
    .map((model) => model?.name)
    .filter((name) => typeof name === 'string');
}

function resolveModel(requested, available) {
  if (available.includes(requested)) return requested;
  if (!requested.includes(':') && available.includes(`${requested}:latest`)) return `${requested}:latest`;
  return null;
}

async function generate(url, model, numCtx, prompt, timeoutMs) {
  const response = await fetch(new URL('api/generate', url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      think: false,
      keep_alive: '10m',
      options: { temperature: 0, num_predict: 64, num_ctx: numCtx },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Generation returned HTTP ${response.status}`);
  const body = await response.json();
  for (const field of ['total_duration', 'load_duration', 'prompt_eval_count', 'prompt_eval_duration', 'eval_count', 'eval_duration']) {
    if (!Number.isFinite(body[field])) throw new Error(`Generation response is missing numeric ${field}`);
  }
  return body;
}

function toMeasurement(run, numCtx, response) {
  return {
    run,
    numCtx,
    totalDuration: response.total_duration,
    loadDuration: response.load_duration,
    promptEvalCount: response.prompt_eval_count,
    promptEvalDuration: response.prompt_eval_duration,
    promptEvalRate: tokensPerSecond(response.prompt_eval_count, response.prompt_eval_duration),
    evalCount: response.eval_count,
    outputTokenCount: response.eval_count,
    evalDuration: response.eval_duration,
    evalRate: tokensPerSecond(response.eval_count, response.eval_duration),
  };
}

function tokensPerSecond(count, durationNanoseconds) {
  return durationNanoseconds > 0 ? count * 1_000_000_000 / durationNanoseconds : 0;
}

function renderMarkdown(runConfig, url, results) {
  const measuredAt = new Date().toISOString();
  const details = results.flatMap((result) => result.measurements.map((measurement) =>
    `| \`${escapeCell(result.requested)}\` | ${measurement.numCtx} | ${measurement.run} | ${measurement.totalDuration} | ${measurement.loadDuration} | ${measurement.promptEvalCount} | ${measurement.promptEvalDuration} | ${formatRate(measurement.promptEvalRate)} | ${measurement.evalCount} | ${measurement.evalDuration} | ${formatRate(measurement.evalRate)} | ${measurement.outputTokenCount} |`,
  ));
  const summaries = results.map((result) => {
    if (result.status !== 'measured') {
      return `| \`${escapeCell(result.requested)}\` | ${result.numCtx} | ${escapeCell(result.status)} | — | — | — | — |`;
    }
    const promptRates = result.measurements.map((measurement) => measurement.promptEvalRate);
    const evalRates = result.measurements.map((measurement) => measurement.evalRate);
    return `| \`${escapeCell(result.requested)}\` | ${result.numCtx} | measured | ${formatRate(average(promptRates))} | ${formatRate(median(promptRates))} | ${formatRate(average(evalRates))} | ${formatRate(median(evalRates))} |`;
  });

  return `## Context-verified 80-word-prompt run — ${measuredAt}

- Base URL: \`${url.toString().replace(/\/$/, '')}\`
- Prompt: \`${escapeCell(runConfig.prompt)}\`
- Thinking: explicitly disabled with \`think: false\`
- Request settings: \`stream: false\`, \`think: false\`, \`temperature: 0\`, \`num_predict: 64\`, and the per-model \`options.num_ctx\` shown below
- Per model: ${runConfig.warmups} warm-up request(s), then ${runConfig.runs} measured request(s)
- Durations are Ollama-reported nanoseconds; rates are calculated tokens/second.
- This runtime benchmark is separate from GPU memory and context measurements.

### Summary

| Model | Requested num_ctx | Status | Avg prompt eval token/s | Median prompt eval token/s | Avg eval token/s | Median eval token/s |
|---|---:|---|---:|---:|---:|---:|
${summaries.join('\n')}

### Measured requests

| Model | Requested num_ctx | Run | total_duration ns | load_duration ns | prompt_eval_count | prompt_eval_duration ns | Prompt eval token/s | eval_count | eval_duration ns | Eval token/s | Output token count |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${details.length ? details.join('\n') : '| — | — | — | — | — | — | — | — | — | — | — | — |'}
`;
}

async function writeBenchmarkReport(outputPath, section) {
  try {
    const existing = await readFile(outputPath, 'utf8');
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    await appendFile(outputPath, `${separator}${section}`, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(outputPath, `# Ollama runtime performance benchmark\n\n${section}`, 'utf8');
  }
}

function contextForModel(model) {
  const normalized = model.endsWith(':latest') ? model.slice(0, -':latest'.length) : model;
  const context = MODEL_CONTEXTS.get(normalized);
  if (!context) throw new Error(`No num_ctx mapping configured for model: ${model}`);
  return context;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatRate(value) {
  return value.toFixed(2);
}

function splitModels(value) {
  if (value === undefined) return null;
  return requireModels(value);
}

function requireModels(value) {
  const models = value.split(',').map((model) => model.trim()).filter(Boolean);
  if (!models.length) throw new Error('Model list must not be empty');
  return models;
}

function integerFromEnvironment(name, fallback) {
  return process.env[name] === undefined ? fallback : positiveInteger(process.env[name], name);
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
  return number;
}

function parseBaseUrl(value) {
  const url = new URL(value.endsWith('/') ? value : `${value}/`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Base URL must use HTTP or HTTPS');
  return url;
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

async function runPopulatedContextBenchmark(runConfig, url) {
  const timeoutMs = Math.max(runConfig.timeoutMs, 600_000);
  const experiment = POPULATED_CONTEXT_EXPERIMENTS[runConfig.populatedContext];
  if (!experiment) throw new Error(`Unknown populated-context experiment: ${runConfig.populatedContext}`);
  console.log(`Discovering models at ${url}`);
  const availableModels = await listModels(url, timeoutMs);
  const model = resolveModel(experiment.model, availableModels);
  if (!model) throw new Error(`Required model is unavailable: ${experiment.model}`);

  const measurements = [];
  for (const targetTokens of experiment.sizes) {
    for (let run = 1; run <= 3; run += 1) {
      const prompt = populatedContextPrompt(targetTokens, run);
      console.log(`Benchmarking model=${model} requested_num_ctx=${experiment.numCtx} target_prompt=${POPULATED_CONTEXT_LABELS.get(targetTokens)} iteration=${run} fresh_state=true`);
      const response = await generatePopulatedContext(url, model, experiment.numCtx, prompt, timeoutMs);
      measurements.push({
        targetTokens,
        targetLabel: POPULATED_CONTEXT_LABELS.get(targetTokens),
        ...toMeasurement(run, experiment.numCtx, response),
      });
    }
  }

  const outputPath = path.resolve(runConfig.output);
  await writeBenchmarkReport(outputPath, renderPopulatedContextMarkdown(url, model, experiment, measurements));
  console.log(`Wrote ${outputPath}`);
}

function populatedContextPrompt(targetTokens, run, markerNamespace = 'standard') {
  const markerWords = ['amber', 'bronze', 'cobalt'];
  const fillerWords = ['quiet', 'morning', 'garden'];
  const marker = `${markerNamespace}-${markerWords[run - 1]}-${targetTokens}-${run}`;
  const instruction = 'Continue with exactly 64 simple English tokens about a quiet morning.';
  const reservedTokens = 32;
  const fillerCount = Math.max(1, targetTokens - reservedTokens);
  return `${marker} ${Array.from({ length: fillerCount }, (_, index) => fillerWords[(index + run - 1) % fillerWords.length]).join(' ')}\n${instruction}`;
}

async function generatePopulatedContext(url, model, numCtx, prompt, timeoutMs) {
  const response = await fetch(new URL('api/generate', url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      think: false,
      keep_alive: 0,
      options: { temperature: 0, seed: 0, num_predict: 64, num_ctx: numCtx },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Generation returned HTTP ${response.status}`);
  const body = await response.json();
  for (const field of ['total_duration', 'load_duration', 'prompt_eval_count', 'prompt_eval_duration', 'eval_count', 'eval_duration']) {
    if (!Number.isFinite(body[field])) throw new Error(`Generation response is missing numeric ${field}`);
  }
  return body;
}

function renderPopulatedContextMarkdown(url, model, experiment, measurements) {
  const measuredAt = new Date().toISOString();
  const rows = measurements.map((measurement) =>
    `| ${measurement.targetLabel} | ${measurement.run} | ${measurement.promptEvalCount} | ${formatRate(measurement.promptEvalRate)} | ${measurement.evalCount} | ${formatRate(measurement.evalRate)} | ${measurement.totalDuration} |`,
  );
  return `## ${experiment.title} — ${measuredAt}

- Model: \`${model}\`
- Base URL: \`${url.toString().replace(/\/$/, '')}\`
- Requested context: \`options.num_ctx: ${experiment.numCtx}\`
- Generation: \`stream: false\`, \`think: false\`, \`temperature: 0\`, \`seed: 0\`, \`num_predict: 64\`
- Each iteration uses deterministic filler with a distinct leading marker and \`keep_alive: 0\`; the runner is unloaded after every request to avoid prompt-cache reuse and provide fresh request state.
- Target prompt sizes are approximate. \`prompt_eval_count\` is the actual Ollama-reported token count.
- Durations are Ollama-reported nanoseconds; rates are calculated tokens/second.

| Target prompt size | Iteration | Actual prompt_eval_count | Prompt eval token/s | eval_count | Eval token/s | total_duration ns |
|---:|---:|---:|---:|---:|---:|---:|
${rows.join('\n')}
`;
}

async function runStreamingTtftBenchmark(runConfig, url) {
  const timeoutMs = Math.max(runConfig.timeoutMs, 600_000);
  console.log(`Discovering models at ${url}`);
  const availableModels = await listModels(url, timeoutMs);
  const experimentKeys = ['96k', '128k'];
  const results = [];

  for (const key of experimentKeys) {
    const experiment = POPULATED_CONTEXT_EXPERIMENTS[key];
    const model = resolveModel(experiment.model, availableModels);
    if (!model) throw new Error(`Required model is unavailable: ${experiment.model}`);
    const measurements = [];
    for (const targetTokens of experiment.sizes) {
      for (let run = 1; run <= 3; run += 1) {
        const targetLabel = POPULATED_CONTEXT_LABELS.get(targetTokens);
        const prompt = populatedContextPrompt(targetTokens, run);
        console.log(`Streaming model=${model} requested_num_ctx=${experiment.numCtx} target_prompt=${targetLabel} iteration=${run} fresh_state=true`);
        const response = await generateStreaming(url, model, experiment.numCtx, prompt, 0, timeoutMs);
        measurements.push({ targetTokens, targetLabel, run, ...response });
      }
    }
    results.push({ key, experiment, model, measurements });
  }

  const outputPath = path.resolve(runConfig.output);
  const sections = results.map((result) => renderStreamingTtftMarkdown(url, result));
  sections.push(renderStreamingComparison(results));
  await writeBenchmarkReport(outputPath, sections.join('\n'));
  console.log(`Wrote ${outputPath}`);
}

async function generateStreaming(url, model, numCtx, prompt, keepAlive, timeoutMs) {
  const startedAt = performance.now();
  const response = await fetch(new URL('api/generate', url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: true,
      think: false,
      keep_alive: keepAlive,
      options: { temperature: 0, seed: 0, num_predict: 64, num_ctx: numCtx },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Streaming generation returned HTTP ${response.status}`);
  if (!response.body) throw new Error('Streaming generation returned no response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let ttftMs = null;
  let finalChunk = null;

  const consumeLine = (line) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line);
    if (ttftMs === null && typeof chunk.response === 'string' && chunk.response.length > 0) {
      ttftMs = performance.now() - startedAt;
    }
    if (chunk.done === true) finalChunk = chunk;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    let newlineIndex;
    while ((newlineIndex = buffered.indexOf('\n')) !== -1) {
      consumeLine(buffered.slice(0, newlineIndex));
      buffered = buffered.slice(newlineIndex + 1);
    }
    if (done) break;
  }
  consumeLine(buffered);
  const wallDurationMs = performance.now() - startedAt;

  if (ttftMs === null) throw new Error('Streaming response contained no non-empty generated response text');
  if (!finalChunk) throw new Error('Streaming response contained no final metadata chunk');
  for (const field of ['prompt_eval_count', 'prompt_eval_duration', 'eval_count', 'eval_duration']) {
    if (!Number.isFinite(finalChunk[field])) throw new Error(`Final streaming chunk is missing numeric ${field}`);
  }
  return {
    promptEvalCount: finalChunk.prompt_eval_count,
    promptEvalRate: tokensPerSecond(finalChunk.prompt_eval_count, finalChunk.prompt_eval_duration),
    evalCount: finalChunk.eval_count,
    evalRate: tokensPerSecond(finalChunk.eval_count, finalChunk.eval_duration),
    loadDuration: Number.isFinite(finalChunk.load_duration) ? finalChunk.load_duration : null,
    ttftMs,
    wallDurationMs,
  };
}

function renderStreamingTtftMarkdown(url, result) {
  const rows = result.measurements.map((measurement) =>
    `| ${measurement.targetLabel} | ${measurement.run} | ${measurement.promptEvalCount} | ${formatRate(measurement.ttftMs)} | ${formatRate(measurement.promptEvalRate)} | ${measurement.evalCount} | ${formatRate(measurement.evalRate)} | ${formatRate(measurement.wallDurationMs)} |`,
  );
  return `## ${result.key.toUpperCase()} streaming / TTFT benchmark — ${new Date().toISOString()}

- Model: \`${result.model}\`
- Base URL: \`${url.toString().replace(/\/$/, '')}\`
- Requested context: \`options.num_ctx: ${result.experiment.numCtx}\`
- Generation: \`stream: true\`, \`think: false\`, \`temperature: 0\`, \`seed: 0\`, \`num_predict: 64\`, \`keep_alive: 0\`
- TTFT is wall-clock milliseconds from request start to the first streamed chunk containing non-empty \`response\` text. Empty and metadata-only chunks are ignored.
- Each iteration uses deterministic filler with a distinct leading marker; unloading after every request avoids prompt-cache reuse.

| Target prompt size | Iteration | Actual prompt tokens | TTFT ms | Prompt eval token/s | Actual eval_count | Eval token/s | Total wall ms |
|---:|---:|---:|---:|---:|---:|---:|---:|
${rows.join('\n')}
`;
}

function renderStreamingComparison(results) {
  const commonLabels = ['1K', '8K', '16K', '32K', '64K'];
  const byKey = new Map(results.map((result) => [result.key, result]));
  const rows = commonLabels.map((label) => {
    const values96 = byKey.get('96k').measurements.filter((measurement) => measurement.targetLabel === label);
    const values128 = byKey.get('128k').measurements.filter((measurement) => measurement.targetLabel === label);
    return `| ${label} | ${formatRate(average(values96.map((value) => value.ttftMs)))} | ${formatRate(average(values128.map((value) => value.ttftMs)))} | ${formatRate(average(values96.map((value) => value.evalRate)))} | ${formatRate(average(values128.map((value) => value.evalRate)))} |`;
  });
  return `## 96K vs 128K streaming comparison

Each value is the arithmetic mean of the three independent streaming measurements above.

| Populated context | 96K avg TTFT ms | 128K avg TTFT ms | 96K avg decode token/s | 128K avg decode token/s |
|---:|---:|---:|---:|---:|
${rows.join('\n')}
`;
}

async function runWarmStreamingTtftBenchmark(runConfig, url) {
  const timeoutMs = Math.max(runConfig.timeoutMs, 600_000);
  console.log(`Discovering models at ${url}`);
  const availableModels = await listModels(url, timeoutMs);
  const results = [];

  for (const key of ['96k', '128k']) {
    const experiment = POPULATED_CONTEXT_EXPERIMENTS[key];
    const model = resolveModel(experiment.model, availableModels);
    if (!model) throw new Error(`Required model is unavailable: ${experiment.model}`);

    console.log(`Warm-up model=${model} requested_num_ctx=${experiment.numCtx} keep_alive=30m`);
    await generateStreaming(url, model, experiment.numCtx, populatedContextPrompt(1024, 1, `${key}-warmup`), '30m', timeoutMs);
    await confirmRunnerLoaded(url, model, timeoutMs);
    console.log(`Confirmed runner loaded: model=${model}`);

    const measurements = [];
    for (const targetTokens of experiment.sizes) {
      for (let run = 1; run <= 3; run += 1) {
        const targetLabel = POPULATED_CONTEXT_LABELS.get(targetTokens);
        const prompt = populatedContextPrompt(targetTokens, run, `${key}-warm-stream`);
        console.log(`Warm streaming model=${model} requested_num_ctx=${experiment.numCtx} target_prompt=${targetLabel} iteration=${run} keep_alive=30m`);
        const response = await generateStreaming(url, model, experiment.numCtx, prompt, '30m', timeoutMs);
        measurements.push({ targetTokens, targetLabel, run, ...response });
      }
    }
    results.push({ key, experiment, model, measurements });
  }

  const outputPath = path.resolve(runConfig.output);
  const existingReport = await readFile(outputPath, 'utf8');
  const cold = {
    '96k': parseStreamingMeasurements(existingReport, '96K streaming / TTFT benchmark'),
    '128k': parseStreamingMeasurements(existingReport, '128K streaming / TTFT benchmark'),
  };
  const sections = results.map((result) => renderWarmStreamingTtftMarkdown(url, result));
  sections.push(renderColdWarmComparison('96K', cold['96k'], results.find((result) => result.key === '96k').measurements));
  sections.push(renderColdWarmComparison('128K', cold['128k'], results.find((result) => result.key === '128k').measurements));
  sections.push(renderWarmModelComparison(results));
  await writeBenchmarkReport(outputPath, sections.join('\n'));
  console.log(`Wrote ${outputPath}`);
}

async function confirmRunnerLoaded(url, model, timeoutMs) {
  const response = await fetch(new URL('api/ps', url), { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Runner check returned HTTP ${response.status}`);
  const body = await response.json();
  const loaded = Array.isArray(body.models) && body.models.some((candidate) => candidate?.name === model || candidate?.model === model);
  if (!loaded) throw new Error(`Warm-up completed but ${model} was not listed by /api/ps`);
}

function renderWarmStreamingTtftMarkdown(url, result) {
  const rows = result.measurements.map((measurement) =>
    `| ${measurement.targetLabel} | ${measurement.run} | ${measurement.promptEvalCount} | ${formatRate(measurement.ttftMs)} | ${formatRate(measurement.promptEvalRate)} | ${measurement.evalCount} | ${formatRate(measurement.evalRate)} | ${formatRate(measurement.wallDurationMs)} | ${measurement.loadDuration ?? '—'} |`,
  );
  return `## ${result.key.toUpperCase()} warm streaming / TTFT benchmark — ${new Date().toISOString()}

- Model: \`${result.model}\`
- Base URL: \`${url.toString().replace(/\/$/, '')}\`
- Requested context: \`options.num_ctx: ${result.experiment.numCtx}\`
- Generation: \`stream: true\`, \`think: false\`, \`temperature: 0\`, \`seed: 0\`, \`num_predict: 64\`, \`keep_alive: 30m\`
- One warm-up request was issued first, and the loaded runner was confirmed through \`/api/ps\` before measurement.
- Measured requests use deterministic filler with distinct leading markers and do not unload the runner between requests.
- TTFT ignores empty and metadata-only chunks and stops at the first chunk containing non-empty generated \`response\` text.

| Target prompt size | Iteration | Actual prompt tokens | TTFT ms | Prompt eval token/s | Actual eval_count | Eval token/s | Total wall ms | load_duration ns |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows.join('\n')}
`;
}

function parseStreamingMeasurements(markdown, heading) {
  const start = markdown.indexOf(`## ${heading}`);
  if (start === -1) throw new Error(`Existing cold benchmark section not found: ${heading}`);
  const nextSection = markdown.indexOf('\n## ', start + 4);
  const section = markdown.slice(start, nextSection === -1 ? undefined : nextSection);
  const measurements = [];
  for (const line of section.split('\n')) {
    const match = line.match(/^\| (\d+K) \| (\d+) \| (\d+) \| ([\d.]+) \| ([\d.]+) \| (\d+) \| ([\d.]+) \| ([\d.]+) \|$/);
    if (!match) continue;
    measurements.push({ targetLabel: match[1], run: Number(match[2]), ttftMs: Number(match[4]), evalRate: Number(match[7]) });
  }
  if (!measurements.length) throw new Error(`No measurements parsed from existing cold section: ${heading}`);
  return measurements;
}

function renderColdWarmComparison(modelLabel, cold, warm) {
  const labels = [...new Set(warm.map((measurement) => measurement.targetLabel))];
  const rows = labels.map((label) => {
    const coldAverage = average(cold.filter((value) => value.targetLabel === label).map((value) => value.ttftMs));
    const warmAverage = average(warm.filter((value) => value.targetLabel === label).map((value) => value.ttftMs));
    const reduction = coldAverage - warmAverage;
    return `| ${label} | ${formatRate(coldAverage)} | ${formatRate(warmAverage)} | ${formatRate(reduction)} | ${formatRate(reduction / coldAverage * 100)}% |`;
  });
  return `## ${modelLabel} cold vs warm TTFT comparison

Positive reduction means the warm-runner TTFT was lower. Each value averages three measurements.

| Populated context | Cold avg TTFT ms | Warm avg TTFT ms | Absolute reduction ms | Percentage reduction |
|---:|---:|---:|---:|---:|
${rows.join('\n')}
`;
}

function renderWarmModelComparison(results) {
  const commonLabels = ['1K', '8K', '16K', '32K', '64K'];
  const byKey = new Map(results.map((result) => [result.key, result.measurements]));
  const rows = commonLabels.map((label) => {
    const values96 = byKey.get('96k').filter((value) => value.targetLabel === label);
    const values128 = byKey.get('128k').filter((value) => value.targetLabel === label);
    return `| ${label} | ${formatRate(average(values96.map((value) => value.ttftMs)))} | ${formatRate(average(values128.map((value) => value.ttftMs)))} | ${formatRate(average(values96.map((value) => value.evalRate)))} | ${formatRate(average(values128.map((value) => value.evalRate)))} |`;
  });
  return `## Warm 96K vs 128K streaming comparison

Each value averages three independent warm-runner measurements.

| Populated context | 96K avg TTFT ms | 128K avg TTFT ms | 96K avg decode token/s | 128K avg decode token/s |
|---:|---:|---:|---:|---:|
${rows.join('\n')}
`;
}

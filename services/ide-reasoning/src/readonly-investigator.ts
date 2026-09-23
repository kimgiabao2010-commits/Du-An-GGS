import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { GssTaskContract, IdeInvestigationMatch, IdeInvestigationRecord } from '@asq/sdk';

export interface IdeWorkerResult {
  taskId: string;
  status: 'SUCCESS' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
  output: string;
  investigation?: IdeInvestigationRecord;
  failure?: { code: string; message: string };
  durationMs: number;
}

export interface ReadonlyInvestigatorLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxMatches: number;
  maxExcerptChars: number;
  maxOutputBytes: number;
  maxTimeoutMs: number;
}

const defaultLimits: ReadonlyInvestigatorLimits = {
  maxFiles: 250,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
  maxMatches: 100,
  maxExcerptChars: 320,
  maxOutputBytes: 48 * 1024,
  maxTimeoutMs: 15_000,
};

const allowedExtensions = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js', '.json', '.jsx',
  '.kt', '.kts', '.md', '.mjs', '.cjs', '.php', '.proto', '.ps1', '.py', '.rb', '.rs', '.scss', '.sh',
  '.sql', '.swift', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);
const deniedDirectories = new Set([
  '.git', '.next', '.turbo', '.cache', 'build', 'coverage', 'dist', 'node_modules', 'vendor',
]);
const deniedFilePatterns = [
  /^\.env(?:\.|$)/i,
  /\.env(?:\.|$)/i,
  /^(?:\.npmrc|\.pypirc|\.netrc)$/i,
  /^(?:id_rsa|id_ed25519|credentials|secrets?)(?:\.|$)/i,
  /\.(?:key|pem|p12|pfx|jks|keystore)$/i,
  /(?:^|[-_.])(?:credential|secret)(?:s)?(?:[-_.]|$)/i,
];
const stopWords = new Set([
  'about', 'after', 'analyze', 'code', 'could', 'find', 'from', 'have', 'implemented', 'implementation',
  'please', 'repository', 'search', 'show', 'that', 'the', 'this', 'where', 'which', 'with', 'would',
]);

class InvestigationBoundaryError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: 'BLOCKED' | 'FAILED' = 'BLOCKED') {
    super(message);
  }
}

function withinRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function isDeniedFile(name: string): boolean {
  return deniedFilePatterns.some(pattern => pattern.test(name));
}

function searchTerms(value: string): string[] {
  const terms = value.toLowerCase().match(/[a-z0-9_.$:@/-]{3,}/g) ?? [];
  return [...new Set(terms.filter(term => !stopWords.has(term)))].slice(0, 8);
}

function cleanExcerpt(value: string, maxChars: number): { text: string; quarantined: number } {
  let quarantined = 0;
  let text = value.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
  const injection = /ignore (?:all )?previous instructions|forget everything|system override|developer mode|delete files/gi;
  text = text.replace(injection, () => { quarantined++; return '[QUARANTINED_INSTRUCTION]'; });
  text = text
    .replace(/\bsk-[a-z0-9_-]{12,}\b/gi, '[REDACTED_API_KEY]')
    .replace(/\b(authorization\s*:\s*bearer)\s+[^\s'";,]+/gi, '$1 [REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]');
  return { text: text.slice(0, maxChars), quarantined };
}

function numberFromEnvironment(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

export class ReadonlyRepoInvestigator {
  private readonly limits: ReadonlyInvestigatorLimits;

  public constructor(private readonly configuredRoots: string[], limits: Partial<ReadonlyInvestigatorLimits> = {}) {
    this.limits = {
      ...defaultLimits,
      ...limits,
      maxMatches: Math.min(limits.maxMatches ?? defaultLimits.maxMatches, 100),
      maxExcerptChars: Math.min(limits.maxExcerptChars ?? defaultLimits.maxExcerptChars, 320),
      maxOutputBytes: Math.min(limits.maxOutputBytes ?? defaultLimits.maxOutputBytes, 48 * 1024),
    };
  }

  public static fromEnvironment(): ReadonlyRepoInvestigator {
    const roots = (process.env.GSS_IDE_REPOSITORY_ROOTS ?? '').split(process.platform === 'win32' ? ';' : ':')
      .map(root => root.trim()).filter(Boolean);
    return new ReadonlyRepoInvestigator(roots, {
      maxFiles: numberFromEnvironment('GSS_IDE_MAX_FILES', defaultLimits.maxFiles, 1, 2000),
      maxFileBytes: numberFromEnvironment('GSS_IDE_MAX_FILE_BYTES', defaultLimits.maxFileBytes, 1024, 2 * 1024 * 1024),
      maxTotalBytes: numberFromEnvironment('GSS_IDE_MAX_TOTAL_BYTES', defaultLimits.maxTotalBytes, 1024, 16 * 1024 * 1024),
      maxMatches: numberFromEnvironment('GSS_IDE_MAX_MATCHES', defaultLimits.maxMatches, 1, 1000),
      maxOutputBytes: numberFromEnvironment('GSS_IDE_MAX_OUTPUT_BYTES', defaultLimits.maxOutputBytes, 1024, 48 * 1024),
      maxTimeoutMs: numberFromEnvironment('GSS_IDE_MAX_TIMEOUT_MS', defaultLimits.maxTimeoutMs, 1000, 60_000),
    });
  }

  public async execute(task: GssTaskContract, externalSignal?: AbortSignal): Promise<IdeWorkerResult> {
    const started = Date.now();
    try {
      this.validateTask(task);
      if (this.configuredRoots.length === 0) throw new InvestigationBoundaryError('REPOSITORY_ROOT_UNCONFIGURED', 'No IDE repository root is configured.');
      const rootIndex = task.parameters.rootIndex === undefined ? 0 : Number(task.parameters.rootIndex);
      if (!Number.isSafeInteger(rootIndex) || rootIndex < 0 || rootIndex >= this.configuredRoots.length) {
        throw new InvestigationBoundaryError('INVALID_REPOSITORY_ROOT', 'Requested repository root is not allowlisted.');
      }
      const root = await realpath(this.configuredRoots[rootIndex]);
      const requestedPath = typeof task.parameters.path === 'string' && task.parameters.path.trim() ? task.parameters.path.trim() : '.';
      const target = await this.resolveTarget(root, requestedPath);
      const rawQuery = typeof task.parameters.query === 'string' && task.parameters.query.trim()
        ? task.parameters.query.trim() : typeof task.parameters.question === 'string' ? task.parameters.question.trim() : '';
      if (/\bsk-[a-z0-9_-]{12,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[a-z0-9_-]{20,}\.[a-z0-9_-]{10,}/i.test(rawQuery)) {
        throw new InvestigationBoundaryError('SENSITIVE_QUERY_DENIED', 'Credential-like search values are not accepted by the IDE worker.');
      }
      const terms = searchTerms(rawQuery);
      if (terms.length === 0) throw new InvestigationBoundaryError('INVALID_QUERY', 'A bounded literal search term is required.');

      const timeoutMs = Math.min(task.timeoutMs, this.limits.maxTimeoutMs);
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
      const onExternalAbort = () => timeoutController.abort();
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
      if (externalSignal?.aborted) timeoutController.abort();
      try {
        const investigation = await this.collect(task, root, target, requestedPath, terms, timeoutController.signal);
        const output = this.boundOutput(investigation);
        return { taskId: task.taskId, status: 'SUCCESS', output, investigation, durationMs: Date.now() - started };
      } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onExternalAbort);
      }
    } catch (error) {
      const cancelled = externalSignal?.aborted;
      const boundary = error instanceof InvestigationBoundaryError ? error : null;
      const status = cancelled ? 'CANCELLED' : boundary?.status ?? 'FAILED';
      const code = cancelled ? 'CANCELLED' : boundary?.code ?? (error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'INVESTIGATION_FAILED');
      const message = cancelled ? 'IDE investigation was cancelled.' : error instanceof Error ? error.message : 'Unknown IDE investigation failure.';
      return { taskId: task.taskId, status, output: `${code}: ${message}`, failure: { code, message }, durationMs: Date.now() - started };
    }
  }

  private validateTask(task: GssTaskContract): void {
    if (task.schemaVersion !== 'gss.task.v1' || task.target !== 'ide' || !['search_code', 'analyze_code'].includes(task.action) || task.riskLevel !== 'read_only') {
      throw new InvestigationBoundaryError('INVALID_TASK', 'IDE worker accepts only read-only search_code/analyze_code tasks.');
    }
    if (!task.taskId || !task.caseId || !Number.isSafeInteger(task.timeoutMs) || task.timeoutMs < 1000) {
      throw new InvestigationBoundaryError('INVALID_TASK', 'Task identity or timeout is invalid.');
    }
  }

  private async resolveTarget(root: string, requestedPath: string): Promise<string> {
    if (requestedPath.includes('\0') || isAbsolute(requestedPath) || requestedPath.split(/[\\/]+/).includes('..')) {
      throw new InvestigationBoundaryError('PATH_OUTSIDE_ROOT', 'Requested path must be relative and remain inside the repository root.');
    }
    if (requestedPath.split(/[\\/]+/).some(part => deniedDirectories.has(part.toLowerCase()) || isDeniedFile(part))) {
      throw new InvestigationBoundaryError('DENIED_PATH', 'Requested path is protected from IDE investigation.');
    }
    const lexical = resolve(root, requestedPath);
    if (!withinRoot(root, lexical)) throw new InvestigationBoundaryError('PATH_OUTSIDE_ROOT', 'Requested path escaped the repository root.');
    const targetInfo = await lstat(lexical).catch(() => null);
    if (!targetInfo) throw new InvestigationBoundaryError('PATH_NOT_FOUND', 'Requested repository path does not exist.');
    if (targetInfo.isSymbolicLink()) throw new InvestigationBoundaryError('SYMLINK_DENIED', 'Symbolic link targets are not allowed.');
    const canonical = await realpath(lexical);
    if (!withinRoot(root, canonical)) throw new InvestigationBoundaryError('PATH_OUTSIDE_ROOT', 'Canonical path escaped the repository root.');
    return canonical;
  }

  private async collect(task: GssTaskContract, root: string, target: string, requestedPath: string,
    terms: string[], signal: AbortSignal): Promise<IdeInvestigationRecord> {
    const matches: IdeInvestigationMatch[] = [];
    const listing = await this.listFiles(target, signal);
    let scannedFiles = 0, skippedFiles = listing.skipped, scannedBytes = 0, quarantinedFragments = 0,
      truncated = listing.truncated;
    const files = listing.files;
    for (const file of files) {
      if (signal.aborted) throw new DOMException('IDE investigation timed out.', 'AbortError');
      if (scannedFiles >= this.limits.maxFiles || scannedBytes >= this.limits.maxTotalBytes || matches.length >= this.limits.maxMatches) {
        truncated = true; break;
      }
      const fileInfo = await stat(file);
      if (fileInfo.size > this.limits.maxFileBytes || scannedBytes + fileInfo.size > this.limits.maxTotalBytes) {
        skippedFiles++; truncated = true; continue;
      }
      const buffer = await readFile(file, { signal });
      if (buffer.includes(0)) { skippedFiles++; continue; }
      const content = buffer.toString('utf8');
      if (content.includes('\uFFFD')) { skippedFiles++; continue; }
      scannedFiles++; scannedBytes += buffer.byteLength;
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        const lower = lines[index].toLowerCase();
        const term = terms.find(candidate => lower.includes(candidate));
        if (!term) continue;
        const cleaned = cleanExcerpt(lines[index].trim(), this.limits.maxExcerptChars);
        quarantinedFragments += cleaned.quarantined;
        matches.push({ path: relative(root, file).replaceAll('\\', '/'), line: index + 1,
          column: lower.indexOf(term) + 1, term, excerpt: cleaned.text });
        if (matches.length >= this.limits.maxMatches) { truncated = true; break; }
      }
    }
    return {
      schemaVersion: 'gss.ide-investigation.v1', taskId: task.taskId, caseId: task.caseId,
      action: task.action as 'search_code' | 'analyze_code',
      repositoryRootId: `repo-${createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 16)}`,
      requestedPath, queryTerms: terms, scannedFiles, skippedFiles, scannedBytes,
      matchCount: matches.length, truncated, redaction: 'SECRET_PATTERNS_REDACTED', quarantinedFragments, matches,
    };
  }

  private async listFiles(target: string, signal: AbortSignal): Promise<{ files: string[]; skipped: number; truncated: boolean }> {
    const targetInfo = await stat(target);
    if (targetInfo.isFile()) {
      if (isDeniedFile(target.split(/[\\/]/).at(-1) ?? '') || !allowedExtensions.has(extname(target).toLowerCase())) {
        throw new InvestigationBoundaryError('DENIED_FILE_TYPE', 'Requested file is not an allowlisted source/config text type.');
      }
      return { files: [target], skipped: 0, truncated: false };
    }
    if (!targetInfo.isDirectory()) throw new InvestigationBoundaryError('DENIED_FILE_TYPE', 'Requested path is not a regular file or directory.');
    const files: string[] = [], queue = [target];
    const maxDirectories = this.limits.maxFiles * 4;
    let visitedDirectories = 0, skipped = 0;
    while (queue.length) {
      if (signal.aborted) throw new DOMException('IDE investigation timed out.', 'AbortError');
      const directory = queue.shift()!;
      if (++visitedDirectories > maxDirectories) return { files, skipped, truncated: true };
      const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (deniedDirectories.has(entry.name.toLowerCase()) || isDeniedFile(entry.name)) { skipped++; continue; }
        const path = resolve(directory, entry.name);
        if (entry.isSymbolicLink()) { skipped++; continue; }
        if (entry.isDirectory()) {
          if (queue.length + visitedDirectories >= maxDirectories) return { files, skipped, truncated: true };
          queue.push(path);
        } else if (entry.isFile() && allowedExtensions.has(extname(entry.name).toLowerCase())) files.push(path);
        else skipped++;
        if (files.length >= this.limits.maxFiles * 4) return { files, skipped, truncated: true };
      }
    }
    return { files, skipped, truncated: false };
  }

  private boundOutput(investigation: IdeInvestigationRecord): string {
    let output = JSON.stringify(investigation, null, 2);
    while (Buffer.byteLength(output, 'utf8') > this.limits.maxOutputBytes && investigation.matches.length > 0) {
      investigation.matches.pop();
      investigation.matchCount = investigation.matches.length;
      investigation.truncated = true;
      output = JSON.stringify(investigation, null, 2);
    }
    if (Buffer.byteLength(output, 'utf8') > this.limits.maxOutputBytes) {
      throw new InvestigationBoundaryError('OUTPUT_LIMIT', 'IDE investigation metadata exceeded the output limit.', 'FAILED');
    }
    return output;
  }
}

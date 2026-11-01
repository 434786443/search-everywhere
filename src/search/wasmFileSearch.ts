import path from "node:path";

export interface IndexedEntry {
  key: string;
  rel: string;
  library: boolean;
}

export interface FileHit {
  key: string;
  rel: string;
  score: number;
  indices: number[];
}

export interface FileSearchResult {
  hits: FileHit[];
  total: number;
}

interface WasmModule {
  setFiles(json: string): void;
  upsertFiles(json: string): void;
  removeFiles(json: string): void;
  setRecents(json: string): void;
  findFiles(query: string, limit: number, extensions: string): string;
  listByExtension(extensions: string, limit: number): string;
}

const EMPTY: FileSearchResult = { hits: [], total: 0 };

/**
 * Thin wrapper over the OpenIdea file matcher compiled to WebAssembly.
 *
 * The module holds the file set and the recent list; every call crosses the
 * boundary as JSON. A missing or throwing module is reported once, and the
 * search reports itself unavailable so the caller can fall back.
 */
export class WasmFileSearch {
  private failed = false;

  private constructor(
    private readonly module: WasmModule | undefined,
    private readonly log: (message: string) => void,
  ) {}

  static async load(directory: string, log: (message: string) => void): Promise<WasmFileSearch> {
    try {
      // The wasm-pack output is CommonJS; the extension host runs in CommonJS too.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loaded = require(path.join(directory, "file_search.js")) as WasmModule;
      return new WasmFileSearch(loaded, log);
    } catch (error) {
      log(`文件搜索 WASM 加载失败，改用内置匹配：${String(error)}`);
      return new WasmFileSearch(undefined, log);
    }
  }

  get available(): boolean {
    return this.module !== undefined && !this.failed;
  }

  setFiles(entries: IndexedEntry[]): void {
    this.call((module) => module.setFiles(JSON.stringify(entries)));
  }

  upsertFiles(entries: IndexedEntry[]): void {
    this.call((module) => module.upsertFiles(JSON.stringify(entries)));
  }

  removeFiles(keys: string[]): void {
    this.call((module) => module.removeFiles(JSON.stringify(keys)));
  }

  setRecents(keys: string[]): void {
    this.call((module) => module.setRecents(JSON.stringify(keys)));
  }

  find(query: string, limit: number, extensions: string[]): FileSearchResult {
    return this.callResult((module) => module.findFiles(query, limit, JSON.stringify(extensions)));
  }

  listByExtension(extensions: string[], limit: number): FileSearchResult {
    return this.callResult((module) => module.listByExtension(JSON.stringify(extensions), limit));
  }

  private call(action: (module: WasmModule) => void): void {
    if (!this.module || this.failed) return;
    try {
      action(this.module);
    } catch (error) {
      this.fail(error);
    }
  }

  private callResult(action: (module: WasmModule) => string): FileSearchResult {
    if (!this.module || this.failed) return EMPTY;
    try {
      return JSON.parse(action(this.module)) as FileSearchResult;
    } catch (error) {
      this.fail(error);
      return EMPTY;
    }
  }

  private fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.log(`文件搜索 WASM 调用失败，本次会话改用内置匹配：${String(error)}`);
  }
}

export interface IndexStatus { hasFolder: boolean; updating: boolean; failed: boolean; hasPreviousIndex: boolean; unreadableCount: number; }

export function statusText(state: IndexStatus): string {
  if (!state.hasFolder) return "没有打开的文件夹";
  if (state.updating) return "正在更新依赖索引";
  if (state.failed && state.hasPreviousIndex) return "依赖解析失败，仍使用上一份索引";
  if (state.failed) return "依赖包暂不可搜";
  if (state.unreadableCount > 0) return `${state.unreadableCount} 个依赖包无法读取`;
  return "";
}

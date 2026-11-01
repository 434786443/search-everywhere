const REBUILD_NAMES = new Set(["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "gradle.properties"]);

export function parseMavenClasspath(output: string): string[] {
  const jars: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    for (const part of line.split("|")) {
      const trimmed = part.trim();
      if (trimmed.endsWith(".jar") && !jars.includes(trimmed)) jars.push(trimmed);
    }
  }
  return jars;
}

export function parseGradleJars(output: string): string[] {
  const jars: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith("JAR\t")) continue;
    const trimmed = line.slice(4).trim();
    if (!jars.includes(trimmed)) jars.push(trimmed);
  }
  return jars;
}

export function mavenArgs(): string[] {
  return ["-B", "-q", "dependency:build-classpath", "-DincludeScope=test", "-Dmdep.pathSeparator=|"];
}

export function gradleArgs(initScriptPath: string): string[] {
  return ["-q", "-I", initScriptPath, "projects"];
}

export function siblingSourcesJar(jarPath: string): string | undefined {
  if (!jarPath.endsWith(".jar") || jarPath.endsWith("-sources.jar")) return undefined;
  return `${jarPath.slice(0, -4)}-sources.jar`;
}

export function isRebuildPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.endsWith("/gradle/libs.versions.toml")) return true;
  return REBUILD_NAMES.has(normalized.split("/").pop() ?? "");
}

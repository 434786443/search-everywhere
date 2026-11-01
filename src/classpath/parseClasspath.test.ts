import { test } from "node:test";
import assert from "node:assert/strict";
import { gradleArgs, isRebuildPath, mavenArgs, parseGradleJars, parseMavenClasspath, siblingSourcesJar } from "./parseClasspath";

test("parses classpath fixtures", () => {
  assert.deepEqual(parseMavenClasspath("/repo/a.jar|/repo/b.jar\n\n/repo/a.jar"), ["/repo/a.jar", "/repo/b.jar"]);
  assert.deepEqual(parseGradleJars("JAR\t/cache/a.jar\nERR\t:app\tcompileClasspath\tmissing\n"), ["/cache/a.jar"]);
  assert.ok(mavenArgs().includes("-DincludeScope=test"));
  assert.ok(mavenArgs().includes("-Dmdep.pathSeparator=|"));
  assert.deepEqual(gradleArgs("/ext/init.gradle"), ["-q", "-I", "/ext/init.gradle", "projects"]);
  assert.equal(siblingSourcesJar("/repo/gson-2.10.1.jar"), "/repo/gson-2.10.1-sources.jar");
  assert.equal(siblingSourcesJar("/repo/gson-2.10.1-sources.jar"), undefined);
  assert.equal(isRebuildPath("/app/gradle/libs.versions.toml"), true);
  assert.equal(isRebuildPath("/app/settings.gradle.kts"), true);
  assert.equal(isRebuildPath("/app/pom.xml"), true);
  assert.equal(isRebuildPath("/app/src/Main.java"), false);
});

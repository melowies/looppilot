import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

function powershell(
  script: string,
  input = "",
  directory?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        `$ErrorActionPreference='Stop'; ${script}`,
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, LOOPPILOT_STORE_PATH: directory },
      },
    );
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Protected local storage timed out."));
    }, 15000);
    child.stdout.on("data", (data) => {
      output += data.toString();
    });
    // Intentionally discard stderr: it must never enter application diagnostics.
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Protected local storage is unavailable."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error("Protected local storage is unavailable."));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
async function crypt(value: string, decrypt = false) {
  if (process.platform !== "win32") return value;
  const result = await powershell(
    `Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::${decrypt ? "Unprotect" : "Protect"}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`,
    decrypt ? value : Buffer.from(value).toString("base64"),
  );
  return decrypt ? Buffer.from(result, "base64").toString("utf8") : result;
}
export class ProtectedLocalStore<T> {
  constructor(
    private directory: string,
    private parse: (raw: unknown) => T,
    private initial: () => T,
  ) {}
  async transaction<R>(operation: (value: T) => Promise<R> | R): Promise<R> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if ((await lstat(this.directory)).isSymbolicLink())
      throw new Error("Local storage cannot be a symlink.");
    if (process.platform === "win32") {
      await powershell(
        "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[IO.Directory]::GetAccessControl($env:LOOPPILOT_STORE_PATH,[Security.AccessControl.AccessControlSections]::Access); $acl.SetAccessRuleProtection($true,$false); foreach($existing in @($acl.Access)){$acl.RemoveAccessRuleSpecific($existing)}; $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); [IO.Directory]::SetAccessControl($env:LOOPPILOT_STORE_PATH,$acl)",
        "",
        this.directory,
      );
    } else await chmod(this.directory, 0o700);
    const lockPath = join(this.directory, "session.lock");
    const deadline = Date.now() + 20000;
    let lock;
    while (!lock) {
      try {
        lock = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          Date.now() >= deadline
        )
          throw new Error(
            "Local AI storage is busy. Stop other LoopPilot servers; see README for lock recovery.",
          );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const file = join(
      this.directory,
      process.platform === "win32" ? "sessions.dpapi" : "sessions.json",
    );
    try {
      let value: T;
      try {
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error();
        if (process.platform !== "win32") await chmod(file, 0o600);
        value = this.parse(
          JSON.parse(await crypt(await readFile(file, "utf8"), true)),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error(
            "Local AI storage could not be read. Credentials were not overwritten.",
          );
        value = this.initial();
      }
      const result = await operation(value);
      const temporary = join(this.directory, `${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(await crypt(JSON.stringify(value)), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return result;
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}

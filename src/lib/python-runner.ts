import { z } from "zod";
import type {
  PythonExecutionRequest,
  PythonExecutionResult,
  PythonTestResult,
} from "./coding-workspace";

const files = [
  "pyodide.js",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];
const resultSchema = z.object({
  caseId: z.string(),
  status: z.enum([
    "Passed",
    "Wrong Answer",
    "Runtime Error",
    "Time Limit Exceeded",
  ]),
  actualOutput: z.string().max(12000),
  expectedOutput: z.string().max(12000),
  errorMessage: z.string().max(12000).optional(),
});

// Run in an opaque-origin sandbox. Only runtime bytes and this run's code/cases
// cross the boundary. CSP blocks all network access, including from Python's JS bridge.
const workerSource = `
let initialized = false;
self.onmessage = async ({ data }) => {
  if (initialized) return;
  initialized = true;
  const send = self.postMessage.bind(self);
  try {
    const assets = data.assets;
    self.fetch = async (url) => {
      const name = String(url).split('/').pop();
      if (!Object.hasOwn(assets, name)) throw Error('Network access is disabled');
      return new Response(assets[name], {headers: {'Content-Type': name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'}});
    };
    for (const name of ['pyodide.js', 'pyodide.asm.js']) {
      const url = URL.createObjectURL(new Blob([assets[name]], {type: 'text/javascript'}));
      importScripts(url);
      URL.revokeObjectURL(url);
    }
    let stdout = '', stderr = '';
    const py = await loadPyodide({ indexURL: 'https://runtime.invalid/', stdin: () => null,
      stdout: line => { stdout = (stdout + line + String.fromCharCode(10)).slice(0, 12000); },
      stderr: line => { stderr = (stderr + line + String.fromCharCode(10)).slice(0, 12000); } });
    py.globals.set('_request_json', JSON.stringify(data.request));
    send({ type: 'ready' });
    const harness = \`
import json, traceback
from typing import List, Optional
from collections import deque, defaultdict, Counter
_request = json.loads(_request_json)
def _run_case(case):
    expected = case['expectedOutput']
    try:
        payload = json.loads(case['input'])
        grid = payload['grid'] if isinstance(payload, dict) else payload
        if not isinstance(grid, list) or not grid or not all(isinstance(row, list) and len(row) == len(grid[0]) and all(cell in ('0', '1') for cell in row) for row in grid):
            raise ValueError('Input must be a rectangular JSON grid of strings "0" and "1", or {"grid": [...]}')
        want = json.loads(expected)
        if type(want) is not int:
            raise ValueError('Expected output must be a JSON integer')
        namespace = {'List': List, 'Optional': Optional, 'deque': deque, 'defaultdict': defaultdict, 'Counter': Counter, '__name__': '__main__'}
        exec(compile(_request['source'], 'solution.py', 'exec'), namespace)
        actual = namespace['Solution']().numIslands(grid)
        output = json.dumps(actual, allow_nan=False)
        return {'caseId': case['id'], 'expectedOutput': expected, 'actualOutput': output[:12000], 'status': 'Passed' if type(actual) is int and actual == want else 'Wrong Answer'}
    except BaseException:
        return {'caseId': case['id'], 'expectedOutput': expected, 'actualOutput': '', 'status': 'Runtime Error', 'errorMessage': traceback.format_exc()[-12000:]}

json.dumps([_run_case(case) for case in _request['cases']])
\`;
    const results = JSON.parse(py.runPython(harness));
    send({ type: 'result', results, stdout, stderr });
  } catch (error) { send({ type: 'engine-error', message: String(error).slice(0, 1000) }); }
};
`;

export async function executePython(
  request: PythonExecutionRequest,
  signal: AbortSignal,
  onReady: () => void,
): Promise<PythonExecutionResult> {
  // Fetch only fixed local runtime files on the trusted main page. Never fetch code.
  const assets = Object.fromEntries(
    await Promise.all(
      files.map(async (name) => {
        const response = await fetch(`/python/${name}`, { signal });
        if (!response.ok)
          throw new Error(
            "Python runtime could not load. Retry Run Code. Your code and test cases are preserved.",
          );
        return [name, await response.arrayBuffer()];
      }),
    ).catch((error) => {
      if (signal.aborted) throw error;
      throw new Error(
        "Python runtime could not load. Retry Run Code. Your code and test cases are preserved.",
      );
    }),
  );
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "Isolated Python worker";
    frame.sandbox.add("allow-scripts");
    let timer: ReturnType<typeof setTimeout>;
    let executing = false;
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      // Explicit termination before removing the frame releases even an infinite loop.
      frame.contentWindow?.postMessage({ type: "stop" }, "*");
      // Let the sandbox process stop before destroying its browsing context.
      setTimeout(() => frame.remove(), 50);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (data?.type === "boot") {
        frame.contentWindow?.postMessage(
          { type: "start", assets, request, workerSource },
          "*",
          Object.values(assets),
        );
      } else if (data?.type === "ready" && !executing) {
        executing = true;
        clearTimeout(timer);
        onReady();
        timer = setTimeout(() => {
          cleanup();
          resolve({
            stdout: "",
            stderr: "",
            results: request.cases.map((c) => ({
              caseId: c.id,
              expectedOutput: c.expectedOutput,
              actualOutput: "",
              status: "Time Limit Exceeded",
              errorMessage:
                "The sample suite exceeded 5 seconds. Worker stopped; edit your code and run again.",
            })),
          });
        }, 5000);
      } else if (data?.type === "result") {
        const parsed = z.array(resultSchema).max(50).safeParse(data.results);
        cleanup();
        if (
          !parsed.success ||
          parsed.data.length !== request.cases.length ||
          parsed.data.some((r, i) => r.caseId !== request.cases[i].id)
        ) {
          reject(
            new Error(
              "Invalid runner response. Your code and cases are preserved. Retry Run Code.",
            ),
          );
        } else
          resolve({
            results: parsed.data as PythonTestResult[],
            stdout: String(data.stdout ?? "").slice(0, 12000),
            stderr: String(data.stderr ?? "").slice(0, 12000),
          });
      } else if (data?.type === "engine-error") {
        cleanup();
        reject(
          new Error(
            `Python engine failed: ${String(data.message).slice(0, 1000)}. Retry Run Code; your code and cases are preserved.`,
          ),
        );
      }
    };
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Python runtime loading timed out. Retry Run Code; your code and cases are preserved.",
        ),
      );
    }, 30000);
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'"><script>
      let worker;
      onmessage = ({source, data}) => {
        if (source !== parent) return;
        if (data.type === 'stop') { worker?.terminate(); return; }
        if (data.type !== 'start' || worker) return;
        const url = URL.createObjectURL(new Blob([data.workerSource], {type: 'text/javascript'}));
        worker = new Worker(url);
        worker.onmessage = e => parent.postMessage(e.data, '*');
        worker.onerror = e => parent.postMessage({type: 'engine-error', message: e.message || 'Worker could not start'}, '*');
        worker.postMessage({assets: data.assets, request: data.request}, Object.values(data.assets));
      };
      parent.postMessage({type: 'boot'}, '*');
    <\/script>`;
    document.body.append(frame);
  });
}

"use client";
import Editor, { loader } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import type { languages } from "monaco-editor";

loader.config({ paths: { vs: "/monaco/vs" } });

let pythonReady: Promise<void> | undefined;
function preparePython() {
  pythonReady ??= loader.init().then(
    (monaco) =>
      new Promise<void>((resolve, reject) => {
        const amd = window as unknown as {
          require: (
            modules: string[],
            done: (module: {
              conf: languages.LanguageConfiguration;
              language: languages.IMonarchLanguage;
            }) => void,
            fail: (error: unknown) => void,
          ) => void;
        };
        amd.require(
          ["vs/basic-languages/python/python"],
          (python) => {
            monaco.languages.setLanguageConfiguration("python", python.conf);
            monaco.languages.setMonarchTokensProvider(
              "python",
              python.language,
            );
            resolve();
          },
          reject,
        );
      }),
  );
  return pythonReady;
}

export default function PythonEditor({
  value,
  language,
  onChange,
  onSave,
  theme,
  fontSize,
  readOnly,
}: {
  value: string;
  language: string;
  onChange: (value: string) => void;
  onSave: () => void;
  theme: "light" | "vs-dark";
  fontSize: number;
  readOnly: boolean;
}) {
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    preparePython()
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="python-editor">
      {failed && (
        <p role="alert">
          The editor could not load. Reload this page to retry. Your saved code
          is unchanged.
        </p>
      )}
      {!ready && !failed && <p role="status">Loading Python editor…</p>}
      {ready && (
        <Editor
          height="100%"
          language={
            language.toLowerCase() === "python" ? "python" : "plaintext"
          }
          theme={theme}
          value={value}
          onChange={(v) => onChange(v ?? "")}
          loading={<p role="status">Loading code editor…</p>}
          onMount={(editor, monaco) => {
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
              saveRef.current(),
            );
          }}
          options={{
            ariaLabel: "Solution code",
            automaticLayout: true,
            readOnly,
            fontFamily: "Consolas, 'Courier New', monospace",
            fontSize,
            lineHeight: 24,
            minimap: { enabled: false },
            tabSize: 4,
            insertSpaces: true,
            autoIndent: "full",
            autoClosingBrackets: "always",
            autoClosingQuotes: "always",
            matchBrackets: "always",
            lineNumbers: "on",
            folding: true,
            scrollBeyondLastLine: false,
            padding: { top: 16 },
            fixedOverflowWidgets: true,
            accessibilitySupport: "on",
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            acceptSuggestionOnCommitCharacter: false,
            wordBasedSuggestions: "off",
            wordWrap: "off",
          }}
        />
      )}
    </div>
  );
}
